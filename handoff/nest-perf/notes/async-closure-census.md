# Async, closure and route-path census: native NestJS GET /hello/native (2026-10-27)

Worktree t3-ff1a7fe4 (uncommitted tree, compiler dist built 05:31 on 2026-10-27). Nothing in the shared tree was changed
for this census. Build: `SCRIPTC_RUNTIME_STATS=1`, `emitIr`, release -O2, unstripped, from a scratch copy in /tmp/scr-census.
The example is `examples/nestjs` (route `hello/:name` with `@Param('name')`, controller returns `of({message})`, no guards,
no interceptors, no explicit pipes, in-repo `NodeHttpAdapter`).

## Method
- Counters: stats build, 10,000 sequential keep-alive requests after 2,000 warm-up (same output as `bench/counters.mjs`).
- Allocation sites, spawn sites and jobs: gdb attached to the running server after warm-up, breakpoints on the runtime
  entry points (`scr_closure_new` with `$rsi` = capture count and `$rdi` = target function, `scr_box_new*`,
  `scr_dyn_new_func`, `scr_dyn_alloc`, `scr_async_spawn_impl`, `scr_spawn_stackless_fiber`, `scr_resume_fiber`, `sendmsg`
  as the request delimiter), `bt` caller (frame 1) mapped to IR through `main.ir.json` (mangled symbol -> IR function name
  -> file:line). 8 to 12 requests per run; every count was identical across requests (deterministic).
  Caveats: gdb cannot unwind past a fiber stack (frame 1 is always right); `scr_promise_new` is partly inlined in
  `scr_async.c` (3 of 11 promise creations hit the breakpoint, the rest are attributed through their spawn site).
- Instructions: `valgrind --tool=callgrind` on the same binary, 100 warm-up requests, `callgrind_control -z`, 302 requests,
  dump. **266,768 instructions/request** in total. Only *self* cost per function is reliable (fiber stack switching breaks
  callgrind's inclusive attribution), so the numbers below are the self cost of the named runtime functions: a floor for
  each mechanism (inlined compiled-code work and the dispose chains they trigger are not in it).
- Async classification: a debug logger patched into the *scratch copy's* `dist/backend/llvm/emitter.js`
  (`selectStacklessAsync`), run over the full NestJS program: every async function and the reason it ended up where it did.

Per request totals (stats build): dyn objects 31, arrays 31, strings 16, other dyn boxes 21, **dyn function nodes 76**,
`fiber_start` 8, `promise_new` 11, `dyn_invoke` 41, `js_load_probe` 139, `cyc_candidates` 33.7 (of which `cand_box` 18.0,
`cand_dyn` 14.5), `cyc_freed` 60, `dyn_free` 159. Additionally by gdb: **52 `ScrClosure` objects, 89 `ScrBox`
cells**, 10 ready-queue jobs, 0 mmap/munmap (the fiber stack pool no longer overflows), 35 `malloc`, 86 `free`.

---------------------------------------------------------------------------------------------------------------------

## 1. Async path per request

### 1.1 Entries: 8 async bodies per request, 7 on fibers, 1 stackless

`fiber_start` = 8 = 7 `scr_async_spawn_impl` (fiber with its own stack, `scr_fiber_context_start`) + 1
`scr_spawn_stackless_fiber`. The 7 fiberless (never-parks) async functions of the module never run on this route; no
other async body is entered (verified with breakpoints on all 340 async function bodies and spawn wrappers).

| # | async function (source) | mode | why |
|---|---|---|---|
| 1 | `RouterProxy.createProxy` closure, router-proxy.js:4 (`async (req,res,next)`; the adapter's route handler) | **fiber** | returns `res` on the catch path: result type `Promise<dyn>` (dyn return). Has captures (`targetCallback`, `exceptionsHandler`). |
| 2 | `RouterExecutionContext.create` returned closure, router-execution-context.js:66 (`async (req,res,next)`) | **stackless coroutine** | result `void`; 2 await points (`await resultOrDeferred`, `await fnHandleResponse(...)`). Has 13 captures (created once at route setup). This is the only stackless entry per request. |
| 3 | `handler(...)` thunk, router-execution-context.js:47 (`async () => { pipes; callback.apply }`) | fiber | returns `result` (dyn). Never actually parks on this route (`pendingPipes` is undefined). 10 captures. |
| 4 | `InterceptorsConsumer.intercept`, interceptors-consumer.js:8 | fiber | returns `next()` / an Observable (dyn). **Never parks** (no await on the empty-interceptors path). |
| 5 | `fnHandleResponse`, router-execution-context.js:265 (`async (result,res,req,...)`) | fiber | returns `res` (dyn) on the disconnect path. 2 await points. |
| 6 | `RouterResponseController.transformToResult`, router-response-controller.js:43 | fiber | returns `lastValueFrom(...)` or the value (dyn). |
| 7 | `RouterResponseController.apply`, router-response-controller.js:26 | fiber | returns `applicationRef.reply(...)` (`any` -> dyn). **Never parks**. |
| 8 | `Promise.resolve(route.handler(...)).catch(fail)` in `RouteTable.handle` (synthetic `*_catchdyn` async wrapper, http-adapter.ts:120) | fiber | result `Promise<dyn>` (dyn). |

Exclusion reason for all 188 fiber-form async functions of the whole NestJS program: **`fn.returnType.kind === "dyn"`**
(the first test in the `forEach` of `selectStacklessAsync`). Captures do **not** exclude a function from stackless
selection (fn 2 above has 13 and is stackless; 167 stackless functions exist in the program); they only exclude
`awaitCallEligible`/`directAwaitEligible` (entry-without-promise forms), see emitter.ts ~2760-2800.
Other reasons (async-cache global, generator, text still suspends after the coroutine form) cost 0 functions here.
Static totals: 362 async functions, 167 stackless, 188 fiber (all dyn-return), 7 fiberless (never parks).

### 1.2 Experiment: what if the dyn-return exclusion did not exist

In the scratch compiler the dyn-return test was turned into a log line only and the rest of the selection ran unchanged
(this checks the textual park-safety tests only; it does not prove that the coroutine emitter can fulfil a dyn result):

| function | result without the dyn test |
|---|---|
| RouterProxy proxy (1), handler thunk (3), fnHandleResponse (5), transformToResult (6), catchdyn (8) | all five pass the stackless tests (**STACKLESS**) |
| InterceptorsConsumer.intercept (4), RouterResponseController.apply (7) | never park: would be **FIBERLESS** (run inline on the caller's stack, no coroutine frame at all) |

So all 7 fibers per request are convertible *by the existing selection rules*; the blocker is only the dyn result.
Hot wrappers asked about: Nest router-execution-context (3, 5: dyn return), the adapter (8 and `RouteTable.handle`'s
`.catch`: dyn), RxJS `lastValueFrom` is not an async function (it is `new Promise(executor)`: 1 promise, 3 closures, 9 boxes, no fiber).

### 1.3 Promises and microtask jobs per request

- Promises created: **11** = 7 fiber result promises + 1 stackless result promise + 3 explicit
  (`Promise.resolve(route.handler(...))` in the adapter, the `new Promise` in `lastValueFrom`, one dyn-promise adaptation
  at `sc_dfk_44`). `promise_resolve_dyn` is called 9 times (thenable adoption); it creates 2 `scr_dyn_resolve_job`
  closures per request (they ride the ready queue as microtask jobs). One `scr_make_resolve_fn`+`scr_make_reject` pair
  for the `new Promise` in `lastValueFrom`.
- Microtask jobs (`scr_resume_fiber` calls from `scr_loop_run`): **10** per request.
- Awaits that actually suspend: `scr_coro_await_prepare` 2 (the stackless body) + `scr_await_hop` 1; the rest of the
  jobs are fiber resumptions and settled-await hops.
- Cost (callgrind self): fiber machinery `scr_async_spawn_impl` 729 + `scr_ctx_swap` 643 + `scr_fiber_destroy` 335 +
  `scr_trampoline` 230 + `scr_fiber_context_start` 243 + `scr_fiber_park_awaiters` 143 = **~2.3k instr/req**.
  Whole async/promise runtime (spawn, resume, loop, settle, promise release 1.9k, resolve_dyn, await_*, `sc_tr_*`
  trampolines) = **~10k instr/req (3.8% of 267k)**. The dyn call thunks (`sc_dfk_*`) that call async closures from dyn
  code add 1-2k.

### 1.4 Sizing the async opportunity (codex item 5)

Removing all 7 fibers (stackless/fiberless): -7 `ScrFiber` + stack leases per request, **~2.3k instr (0.9%)** directly,
plus a few hundred for the two never-parking functions that would not even need a coroutine frame. The promises stay
(still 11 unless the awaiter/spawn pair is fused). Realistic gain **2-4k instr/req (1-1.5%)**, not 10-35k; the
10-35k estimate is only reachable if promise creation and the 10 jobs also go away (fusing the synchronous
`of(value)` -> `lastValueFrom` -> `await` chain, see section 3). It also removes the 7 stack touches per request, which
callgrind cannot price (cache effects).

---------------------------------------------------------------------------------------------------------------------

## 2. Closures per request

The counter "76 closures" is `dyn_alloc_closure`: **dyn function nodes** (`ScrDyn` kind FUNC, `scr_dyn_new_func`).
The underlying objects are different: per request **52 fresh `ScrClosure`** (`scr_closure_new`), **76 dyn FUNC nodes**,
**89 `ScrBox` cells**. So 24-35 dyn function nodes wrap an *existing* closure or method (see 2.4).

### 2.1 Capture shape (52 fresh closures)

- 2 closures have no captures; 115 capture references in total (average 2.2 per closure), ncaps histogram:
  0:x2, 1:x13, 2:x20, 3:x9, 5:x1, 6:x2, 7:x1, 10:x1 (plus the 2 runtime-made resolve/reject thunks).
- Every capture is a separate `ScrBox` (scr_closure.h). Measured box allocations: 89/req. Static estimate from the IR
  (unique captured locals x invocations): 92. Mutability of those captured bindings, by IR assignment analysis
  (a binding assigned exactly once, textually before the closure is created, and never in a sibling closure is counted as
  init-once, i.e. immutable after creation):
  - **~82 boxes (89%) hold an immutable binding** (parameters never reassigned, `var _this = this`, `const` / init-once vars);
  - **~10 boxes (11%) are genuinely shared mutable** (rxjs `innerSubscriber`, `index`/`outerIndex`/`innerIndex`,
    `isComplete`, `checkComplete`, `isUnsub` (3 writers across 4 sibling closures), `_hasValue`/`_value`
    in `lastValueFrom`, `disconnected` in `fnHandleResponse`, adapter `index`).
  - No TDZ-dependent capture was found on this path (no capture of a binding declared after the closure).
- Existing `lazy-captures.ts` already delays the box of an unrebound *parameter* until the first closure is built and
  lets the body read stable captures without an extra reference, but the cell itself is still allocated: its effect is
  already inside the 89.

### 2.2 Escape destinations (by IR parent context; per-class counts are approximate, assigned by reading each creator)

| destination | closures/req | examples |
|---|---:|---|
| stored on an object (assigned to a field / handed to a constructor that stores it) | ~30 | OperatorSubscriber `_this._next/_error/_complete = function...` (9), tap/switchMap observer callbacks, `lift` operator closures (6), `Observable` subscribe callbacks held by `Subscriber` |
| passed as an argument and invoked synchronously, not retained | ~9 | `errorContext(function(){...})` in `Observable.subscribe` (6), `new Promise(executor)` in `lastValueFrom` (1), `array.forEach`-style (2) |
| passed to the dyn world / Nest and may be retained | ~7 | adapter `next`/`fail` (2), `handler(...)` thunk (1), `fromArrayLike` subscribe fn (2), pipe results (2) |
| returned | ~4 | `pipe.js:20` (`piped`), `pipeFromArray`, `takeUntil`/`switchMap` operator factory returns |
| runtime-made (resolve/reject/job thunks) | 4 | `scr_make_resolve_fn`, `scr_make_reject`, `scr_dyn_resolve_job` x2 |

### 2.3 Top 10 allocation sites (per request; creator function = frame 1 of the allocation)

Counts are exact per request. `dynfn` = `scr_dyn_new_func`, `clos` = `scr_closure_new`, `box` = `scr_box_new*`.
Captures: `imm` = immutable after creation, `MUT` = shared mutable.

| # | creator (IR fn, file:line) | invocations | dynfn | clos | box | closures created and their captures | escape |
|---|---|---:|---:|---:|---:|---|---|
| 1 | `OperatorSubscriber` ctor, rxjs OperatorSubscriber.js:26 | 4 | 9 | 9 | 13 | `_next`,`_error`,`_complete` wrappers: 2 captures each (`onNext/onError/onComplete`, `destination`), all imm | stored on the subscriber (`_this._next = ...`), lives as long as the subscriber |
| 2 | `Observable.subscribe` errorContext callback, Observable.js:23 | 6 | 6 | 6 | 12 | 1 closure x6: captures `_this`, `subscriber` (both init-once imm) | passed to `errorContext(cb)`, called synchronously, dropped: **non-escaping** |
| 3 | `fnHandleResponse` (the async at router-execution-context.js:265) | 1 | 7 | 2 | 3 | `() => this.fromClientDisconnect(req,res)` (3 caps imm), `() => disconnected = true` (1 cap **MUT**); 5 further dyn wrappers of existing functions (`destroyStreamableFile`, `thenOf`, ...) | handed to `switchMap`/`tap` (stored by the operators) |
| 4 | `switchMap` operate callback, switchMap.js:8 | 1 | 2 | 3 | 5 | 3 closures with 3, 6, 2 captures (`innerSubscriber`,`index`,`isComplete`,`checkComplete` **MUT**; `project`,`subscriber`,`resultSelector` imm); plus :13 callbacks (2 closures, 7 captures, 2 MUT) | stored on OperatorSubscriber |
| 5 | `tap` operate callback, tap.js:14 | 1 | 4 | 4 | 2 | 4 closures (2-3 captures): `isUnsub` **MUT** (3 writers), `tapObserver`,`subscriber` imm | stored on OperatorSubscriber |
| 6 | `RouteTable.handle`, http-adapter.ts:97 | 1 | 0 | 2 | 8 | `fail` (3 caps), `next` (7-8 caps: `index` **MUT**, rest imm) | `next` is passed to Nest's `route.handler(req,res,next)`: escapes into dyn code |
| 7 | `lastValueFrom` + executor, lastValueFrom.js:5/7 | 1 | 3 | 5 | 9 | executor (3 caps), SafeSubscriber `next` (2 caps `_value`,`_hasValue` **MUT**), `complete` (6 caps, 1 **MUT**), resolve/reject thunks | executor sync; observer closures stored in the subscriber |
| 8 | `RouterExecutionContext.create` handler thunk, router-execution-context.js:47 | 1 | 1 | 1 | 6 | async closure with 10 captures, all imm (`fnApplyPipes`,`args`,`req`,`res`,`next`,`callback`,`instance`,`handlerObservable$`,`this`,`handlerFiles`) | passed to `interceptorsConsumer.intercept(..., next)`, called once |
| 9 | `fromArrayLike` / `innerFrom` (rxjs `of(value)` path), innerFrom.js:69/106 | 2 | 8 | 2 | 3 | `(subscriber)=>{for(array)...}`: 1 capture (`array`) imm | wrapped in an `Observable`; returned |
| 10 | `lift` (lift.js:9/10) and `pipe` (pipe.js:13/20) | 3+1 | 6 | 8 | 5 | 1 capture each (`init`, `fns`) imm | stored in `Observable.operator` / returned |

Top 10 together: 46 of 76 dyn fn nodes, 42 of 52 closures, 66 of 89 boxes (summed from the rows; row 10 counts lift and pipe
together). The tail is the same rxjs/Nest shape (Subscription `add`/`remove`, `createOperatorSubscriber`, `takeUntil`). By origin: **rxjs creates
61 of the 76 dyn function nodes, 43 of the 52 closures and 62 of the 89 boxes**; Nest 12/4/12; adapter 1/4/10.

### 2.4 Dyn function nodes that wrap an existing closure (~35/req)

`dyn_alloc_closure` 76 vs `scr_closure_new` 52: sites where `dynfn > closures` include rxjs `Subscription.add/remove`
(4+4: `instanceof Subscription`/`isFunction(teardown)` arguments), `createOperatorSubscriber` (4), `innerFrom`
(4), `Observable.js:17` (3), `isObservable` (2: `instanceof Observable` builds the class's dyn wrapper via `sc_dfb_0`, and
`obj.lift` / `obj.subscribe` reads), `fnHandleResponse` (5). Each is a fresh `ScrDyn` FUNC node (alloc +
dispose) around an interned top-level function, a class constructor, or a method read from a prototype. A cached
wrapper per immortal closure (one static `ScrDyn` per interned function value) would remove them.

### 2.5 Instruction cost of the closure realm (callgrind self, per request)

| family | instr/req | breakdown |
|---|---:|---|
| `ScrClosure` | 7.0k | `scr_closure_new` 2.5k (47 per closure), `_destroy` 1.7k, `_release` 1.3k, `_trace` 0.8k, `_gcfree` 0.4k, `_retain_v` 0.3k |
| `ScrBox` | 11.9k | `scr_box_release` 3.4k, `_new_obj_set` 2.6k (64 calls), `_get_ref` 1.5k, `_destroy` 1.4k, `_release_payload` 1.1k, `_gcfree` 0.6k, `_new` 0.4k, `_trace` 0.3k (**~134 instr per box lifecycle**) |
| dyn FUNC nodes | 2.6k | `scr_dyn_new_func` (34 per node); their dispose runs inside `scr_dyn_destroy` (not separable) |
| total | **21.5k (8.1%)** | plus the cycle collector: `cand_box` is 18.0 of 33.7 candidates per request; the whole cycle collector self cost is 9.6k |

### 2.6 Sizing the closure opportunity (codex item 3)

- Embedding immutable captured values in the escaping environment removes ~82 of 89 box allocations per request and
  roughly 82 x 134 = ~11k instr of box lifecycle, minus the cost of storing/retaining the value in the closure (~1-2k)
  = **8-10k instr/req (3-4%)**. It also removes ~16 of the 18 `cand_box` cycle candidates per request (halving the
  candidate buffer traffic; likely another 2-3k of the 9.6k collector self cost) = **~10-13k total (4-5%)**.
- Highest-yield families (all immutable): OperatorSubscriber ctor (16 boxes), `Observable.subscribe` errorContext
  closure (12), handler thunk (10), adapter `RouteTable.handle` (7 of 8). Single non-escaping case: the 6
  `errorContext(function(){...})` callbacks per request (a stack closure/direct inline would remove 6 closures, 12
  boxes, 6 dyn wrappers: ~2.5k instr by itself).
- Keep boxed: ~10 shared mutable cells (`isUnsub`, `index`, `disconnected`, `_value`/`_hasValue`, ...).
- Separate, smaller: caching dyn wrappers for interned functions/classes (~35 allocs/req, est. 3-4k instr).

---------------------------------------------------------------------------------------------------------------------

## 3. Nest route path for GET /hello/native (per request)

Counts per stage: dyn objects/arrays/strings (`scr_dyn_alloc`), dyn function nodes, `ScrClosure`, `ScrBox`, promises,
fibers/coroutines; attributed to the *source location of the allocating function* (gdb frame 1), including runtime
helpers called from it. Fiber and promise counts include the dyn-call thunks (`sc_dfk_*`, `%dyn.class.call.N`) that spawn
them on behalf of a caller.

Call chain (request in, response out):

1. Node-like `http.createServer` callback -> `RouteTable.handle` (adapter): `new URL`, `Request` wrapper, `splitPath`,
   `Object.fromEntries(searchParams)`; builds `fail` and `next` closures (8 boxes); `next()` -> `match` (param object);
   `Promise.resolve(route.handler(req,res,next)).catch(fail)`.
2. `route.handler` = `RouterProxy.createProxy` closure (**fiber**, `await targetCallback(...)`).
3. `targetCallback` = `RouterExecutionContext.create` returned closure (**stackless**): `createNullArray(argsLength)`,
   `fnCanActivate` is null, `setStatus`, `interceptors` is empty so `handlerObservable$` is undefined,
   `handlerFiles = []`, builds the `handler(args,req,res,next,...)` thunk (async closure, 10 captures: 1 closure, 6 boxes).
4. `interceptorsConsumer.intercept(...)` (**fiber**, never parks): `isEmptyArray` -> `return next()`; `next()` is the
   handler thunk (**fiber**): `fnApplyPipes(args,req,res,next)` (sync: `param.extractValue` -> `paramsFactory
   .exchangeKeyForValue` builds a `{req,res,next}` object; no pipes, value not thenable, so no promise) ->
   `callback.apply(instance,args)` = controller `hello(name)` -> `greeting.greet(name)` -> `of({message})`
   (`Observable` + `innerFrom` machinery) -> returned unchanged (`!handlerObservable$`).
5. `await resultOrDeferred` (stackless suspension) then `fnHandleResponse(result,res,req,...)` (**fiber**, 265): result
   `isObservable` -> `disconnect$ = of(null).pipe(switchMap(() => fromClientDisconnect(req,res)), tap(() => disconnected = true))`;
   `result = result.pipe(takeUntil(disconnect$))` (builds 4 `Observable`s through `lift`, `pipe`, 3 operators).
6. `await responseController.transformToResult(result)` (**fiber**) -> `lastValueFrom(result)`: `new Promise(executor)`;
   `source.subscribe(new SafeSubscriber({next,error,complete}))`: subscribes the takeUntil chain: `takeUntil` subscribes
   `disconnect$` (`switchMap` OperatorSubscriber, `innerFrom(of(null))`, `fromClientDisconnect` -> `Observable`,
   `tap` OperatorSubscriber) and then the source `of(value)` (OperatorSubscriber), which emits the value synchronously
   and completes; `lastValueFrom` resolves its promise; teardown unsubscribes the whole subscription tree
   (`Subscription.add/remove/unsubscribe`, `arrRemove`, `execFinalizer`).
7. `await responseController.apply(result,res,status)` (**fiber**, never parks) -> adapter `reply`: `JSON.stringify(body)`,
   `hasHeader`, 2 x `setHeader`, `Buffer.byteLength`, `response.end(text)` (the single `sendmsg`).
8. Back out: promise settles, `.catch(fail)` fiber resolves, `RouterProxy` fiber returns.

| stage | dyn objs | dyn fn nodes | closures | boxes | promises | fibers/coros |
|---|---:|---:|---:|---:|---:|---:|
| 1 adapter `RouteTable.handle` (+ Request/URL) | 7 | 1 | 4 | 10 | 1 | 1 |
| 2 `RouterProxy.createProxy` | 0 | 1 | 0 | 0 | 0 | 0 (fiber started by the dyn thunk, row "thunks") |
| 3 `RouterExecutionContext.create` closures (handler thunk, args, `fnApplyPipes` pipeline, `fromClientDisconnect`) | 6 | 12 | 4 | 12 | 0 | 0 |
| 4 InterceptorsConsumer.intercept | 0 | 0 | 1 | 5 | 0 | 0 |
| 5 rxjs: `of`, `innerFrom`, `isObservable`, `arrRemove` | 3 | 10 | 2 | 2 | 0 | 0 |
| 5 rxjs: `switchMap` (disconnect$) | 0 | 5 | 7 | 11 | 0 | 0 |
| 5 rxjs: `tap` (disconnect$) | 1 | 5 | 6 | 4 | 0 | 0 |
| 5 rxjs: `takeUntil` | 0 | 3 | 3 | 3 | 0 | 0 |
| 5 rxjs: `pipe` / `lift` | 0 | 5 | 5 | 1 | 0 | 0 |
| 6 rxjs: `OperatorSubscriber` ctor (x4) | 8 | 13 | 9 | 13 | 0 | 0 |
| 6 rxjs: `Observable.subscribe` errorContext closure (x6) | 0 | 6 | 6 | 12 | 0 | 0 |
| 6 rxjs: `lastValueFrom` (promise, executor, SafeSubscriber) | 1 | 3 | 5 | 9 | 1 | 0 |
| 6 rxjs: Observable / Subscriber / Subscription core | 9 | 11 | 0 | 7 | 0 | 0 |
| 7 `RouterResponseController` / dyn call thunks (`sc_dfk_*`, `%dyn.class.call.N`: spawn fibers and promises on behalf of callers) | 27 | 1 | 0 | 0 | 8 | 7 |
| other Nest / tslib `__extends` / reflect-metadata (`Reflect.js:1302`, `tslib.js:165`) / app | 21 | 0 | 0 | 0 | 0 | 0 |
| **total** | **83** | **76** | **52** | **89** | **10 (+1 inlined)** | **8** |

(The "dyn objs" column is `scr_dyn_alloc` calls and double counts nothing; arrays/strings/objects created through the
pooled fast paths of `scr_dyn_new_arr`/`_obj`/`_str` are in the same family: 31+31+16 per the counters.)

Observations:
- **rxjs plus the `disconnect$` pipeline is ~80% of the closure realm**: 61/76 dyn fn nodes, 43/52 closures, 62/89 boxes, and
  per request it builds several `Observable`s (`of(value)`, `of(null)`, one per `lift`ed operator application, and
  the `fromClientDisconnect` Observable), 4 `OperatorSubscriber`s, 6 `Observable.subscribe` calls with 6 `errorContext`
  closures, a `SafeSubscriber`, one `Promise`, and the full `Subscription` tree and its teardown.
- The `disconnect$` pipeline is created, subscribed and torn down *for every request* only to be cancelled by a client
  disconnect that never happens on this route: switchMap (5/7/11), tap (5/6/4), takeUntil (3/3/3), part of the
  OperatorSubscribers and `of(null)`. Dyn fn / closures / boxes of that sub-chain: **~45 / ~37 / ~45**.
- The business route work itself (pipes, controller, service, `of(value)`) is tiny: stage 3 (steps 3-4) allocates
  12 / 4 / 12.
- Pipes: zero promises and one `{req,res,next}` object per request (the sync fast path is taken).

### 3.1 Sizing the route residualization (codex item 4)

Allocations in the rxjs sub-chain that exists only to produce one synchronously-available value
(`of(value)` + `takeUntil(disconnect$)` + `lastValueFrom`): **~61 dyn fn nodes, ~43 closures, ~62 boxes, ~30 dyn
objects, 1 promise** (about 200 of the ~300 per-request allocations in these families). Using the per-family callgrind
costs (closure+box+func 21.5k, of which ~80% is rxjs = ~17k), plus the property accesses, dispose chains and cycle
candidates those objects cause, a plausible removal of that chain is **40-70k instr/req (15-26% of 267k)**;
this is an estimate by proportion, not a measured removal (compiled rxjs code is 32k self, compiled Nest 26k,
runtime functions called from them the rest). A conservative first target is only the `Observable`-from-value case:
`isObservable(result) && result is of(v)` skipping `disconnect$` and `lastValueFrom` when the source is a known
synchronous singleton, which preserves errors and the unsubscription order by construction.

---------------------------------------------------------------------------------------------------------------------

## Top opportunities (ranked by measured/estimated instructions per request, of 267k)

1. **Fuse or skip the synchronous rxjs segment** (`of(v)` + `takeUntil(disconnect$ = of(null).pipe(switchMap, tap))` +
   `lastValueFrom`): ~200 allocations/req (61 dyn fn, 43 closures, 62 boxes, 30 dyn objs, 1 promise), est. **40-70k instr**
   (15-26%). Highest value, high risk (semantic preservation of teardown/ordering).
2. **Embed immutable captures instead of boxing them**: removes ~82 of 89 boxes/req and ~16 of 18 box cycle
   candidates; est. **10-13k instr** (4-5%). Moderate risk, generic (benefits all frameworks), first family:
   OperatorSubscriber ctor, `Observable.subscribe` errorContext callback, handler thunk, adapter `next`.
3. **Dyn FUNC node churn**: 76 nodes/req of which ~35 wrap interned functions, classes or method reads; a cached
   wrapper per immortal closure or folding `isFunction(obj.x)` / `x instanceof C` without materializing the function
   value removes ~35 allocs, est. **3-4k instr** (1.3%). Low risk. Also the stack-allocated non-escaping callback
   (6 `errorContext` closures: 6 closures + 12 boxes + 6 nodes) ~2.5k.
4. **Allow dyn returns in stackless selection** (all 7 fibers convertible: 5 stackless, 2 fiberless): -7 fibers/req,
   **~2.3k direct, 2-4k total instr** (1-1.5%), plus the unquantified cache effect of 7 stacks. Medium risk
   (thenable assimilation of dyn results, ordering of the 10 jobs). Far below the 10-35k hypothesis.
5. Cycle collector candidates: after (2) the remaining 14.5 `cand_dyn` + ~2 `cand_box`; whole collector is 9.6k self.

Not an opportunity here: fiber stack mmap/munmap is 0/req now; Nest `RouterExecutionContext.create`/pipes work is
small; async machinery is 3.8% total instructions.

## Reproduction (scratch, removed)
Scratch tree `/tmp/scr-census` (copy of packages/compiler dist + runtime + the example), `build.mjs` (compile with
`SCRIPTC_RUNTIME_STATS=1`, `emitIr`), `fntab.mjs` (IR function -> file:line), gdb scripts `trace*.gdb`, analysis
`an*.mjs`, `census-closures*.mjs`, `stages.mjs`. All run in container `scriptc-legacy-gate`; callgrind via
`valgrind --tool=callgrind` + `callgrind_control -z/-d`. Fixed values to re-derive: 76 dyn fn nodes, 52 closures, 89
boxes, 8 fiber starts (7+1), 10 jobs, 267k instructions per request.

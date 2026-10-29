# scriptc-native NestJS HTTP: per-request profile (2026-10-25)

Worktree t3-ff1a7fe4, examples/nestjs, GET /hello/native, 64 connections, autocannon 4 workers.
Server pinned to core 2, load to cores 8-15. Ryzen AI 9 HX 370.

## Method (and limits)
- `perf` can't run: host `perf_event_paranoid=4`, no sudo, and container `scriptc-legacy-gate` lacks CAP_PERFMON/SYS_ADMIN.
  Used instead: a gdb stack sampler inside the container (SIGWINCH every 20 ms, then `bt`, 1500 samples under load),
  host `strace -c` / `strace -k` (stack per syscall), and /proc utime/stime.
- Release build (-O2, not stripped) via `compile()` with emitIr. No frame-pointer option exists. gdb CFI unwinding fails above
  some frames (`??`), so inclusive % are lower bounds. Self % are reliable.
- Hashed symbols mapped to source through main.ir.json (`%fn.<hash>` -> file and loc).

## Verdict: CPU-bound, not latency-bound
- The server runs a full core under load (utime+stime about 100%, about 79% user / 21% sys).
- 548 epoll_wait for 31k requests: about 57 requests are handled per loop tick and the loop almost never sleeps.
  Keep-alive is on, TCP_NODELAY is set per connection, and there is 1 read + 1 sendmsg per request. No timer or Nagle stalls.
- About 150 us of CPU per request vs about 12.6 us on Node. p99 is batch-induced: about 57 requests x 150 us per tick, plus cycle-collector work.
- Syscalls per request: **native: 1 read, 1 sendmsg, 3 mmap, 3 munmap**. Node: 1 read, 1 write, no mmap.
  mmap+munmap take 72% of native syscall time.

## Base HTTP stack is not the problem (microbench)
Plain `node:http` hello server returning JSON, same load:
| | req/s | p99 |
|---|---:|---:|
| scriptc native | **142k** | 3 ms |
| Node 24 | 81k | 2 ms |
Nest app on the same machine: native about 6.0k req/s vs Node about 79k. The whole gap comes from the Nest/rxjs/dyn layers.
Startup to first response: native 22 ms / 30 MB RSS vs Node 225 ms / 95 MB.

## Where the time goes (self %, 1500 samples)
| layer | self % | top functions |
|---|---:|---|
| refcount / alloc / cycle collector | 22.2 | scr_dyn_release 3.7, scr_weak_disposed 2.0, scr_dyn_dispose 1.7, scr_cyc_* 2.4 (7% incl), scr_dyn_alloc, closures, boxes |
| dyn property / invoke / box | 17.7 | scr_dyn_invoke_impl 3.0, scr_js_transition 2.1, scr_dyn_find_linear_entry 1.1, find_entry, key_copy, this_get/push |
| **class dispatch ladders** | 17.1 | scr_dyn_class_is_key **10.1**, %class.construct:N, %class.instanceof:dynamic, %dyn.class.property.N, staticProperties |
| **fiber stack mmap/munmap (kernel)** | 15.7 | munmap 10.9 (scr_fiber_destroy), mmap 4.9 (scr_fiber_context_start) |
| socket I/O syscalls | 8.7 | sendmsg 6.4, read 2.3 |
| compiled JS bodies | 8.0 | spread thin: rxjs Observable/Subscriber/OperatorSubscriber, Nest router |
| fiber/promise/loop | 3.7 | |
| strings/json/libc | 3.1 | (JSON.stringify 0.3; strcasestr in scr_http_conn_data 0.3) |
| runtime http | 1.1 | |

Innermost compiled owner of each sample: **rxjs (dynamic tier) 51%**, Nest core (dynamic) 12%, app adapter 12%
(NodeHttpAdapter.reply 7.6% incl., `any` params), none or unwinding failed 22%, typed-tier code under 4%.
Inclusive (lower bounds): scr_dyn_construct 20%, rxjs errorContext 18.5%, fiber destroy 11%, dispose chains 10%, cycle collector 7%.

## Ranked opportunities
1. **Fiber stack pool overflow** (15.7% self + page-fault and zeroing cost of fresh stacks).
   Root cause: `packages/runtime/src/scr_async.c` sets `SCR_FIBER_SPARES 64`. Each request spawns about 3 fibers
   (RouteTable.handle -> async Nest handler; router-execution-context `%fn.dec1e6776472`; `scr_promise_resolve_dyn`).
   With about 57 requests per tick, about 170 fibers are live, so the pool drains to 0 (mmap) and then overflows (munmap
   in scr_fiber_destroy): 3 mmap + 3 munmap per request.
   Fix: a high-water-sized pool (e.g. cap 1024, or grow to the observed peak and let the existing 1 s low-water trim
   return memory). Also stop spawning a fiber in `scr_async_dyn.c:scr_promise_resolve_dyn` just to adopt a promise:
   register a reaction, as the wasi path's microtask job does. Gain **+20-25% req/s**. Risk: low (memory held is about
   peak fibers x touched pages).
2. **Linear class-dispatch ladders** (17.1%). Root cause: `backend/llvm/lib-dispatch.ts` (`dyn.classIs`) and
   `frontend/lowering/class-construction.ts` / `class-dynamic-dispatch.ts` emit, for every dyn `new X()`,
   `x instanceof C` and class-property read, a chain of 152 `scr_dyn_class_is_key` calls (strcmp on sig) over every
   compiled class. rxjs classes are ES5 `__extends` functions (dist/cjs), not compiled classes, so each rxjs
   construct/instanceof (`isSubscription`, `new OperatorSubscriber`, ...) walks the **whole ladder and misses**, then
   falls to scr_dyn_construct. Fix: test `v.fn.class_obj != NULL` once before the ladder (rxjs misses then cost one
   branch), then dispatch on a dense class id stored in ScrClassObj (switch / per-class thunk table) instead of strcmp.
   Gain **+18-20%**. Risk: low-medium (codegen change in 4 lifted helpers).
3. **Refcount / dispose / cycle-collector overhead on dyn objects** (about 22%). Specific items:
   (a) `scr_json.c:scr_weak_disposed` runs a weak-key hash lookup on every dyn object free once any WeakMap exists
   (Nest has some). Fix: a per-object "used as weak key" header bit (2% -> ~0).
   (b) scr_cyc_settle/pass/on_dead at 7% inclusive for short-lived rxjs subscriber graphs (closures capture `this`, so
   cycles). Try `SCRIPTC_YOUNG_NURSERY=1` (exists, opt-in) and measure. Batch or defer candidate scanning.
   (c) Retain/release pairs around borrowed dyn receivers in generated code (e.g. `sc_rc_retain_dyn` + release around
   one IC read in `%dyn.class.property.N`). Gain **+10-15%** combined. Risk: medium (GC correctness).
4. **Dyn property/invoke path** (17.7%). `scr_dyn_invoke_impl` generic arg marshalling;
   `scr_js_object.c:scr_js_transition` rehashes the key on every property add (no add-IC per constructor site);
   `scr_dyn_find_linear_entry` linear key scans. Fix: transition/add ICs cached at the site (ctor bodies add fixed key
   sequences), a prepared-call fast path for fixed arity, shaped lookup before the linear scan. Gain **+10-15%**.
   Risk: medium.
5. **Make rxjs statically typed or at least class-shaped** (rxjs = 51% of samples, all dynamic tier). See the
   options below. Cheapest step: resolve rxjs's `es2015` export (dist/esm, real ES classes) instead of `node`/`require`
   (dist/cjs, ES5 `__extends`). Its classes then become compiled classes (needs #2 first, or the ladder grows).
   Gain **+15-30%**, uncertain. Risk: medium (resolver condition policy).

Smaller items: sendmsg vs write (6.4%, inherent); strcasestr header scan in `scr_http_conn_data` (0.3%);
NodeHttpAdapter.reply is `any`-typed (7.6% incl.), and typing `response` as `http.ServerResponse` would make its calls direct.
Fixes 1-4 together should give about 2-2.5x (to about 13-16k req/s). Closing the rest of the gap to Node needs the
rxjs/Nest code off the dynamic tier.

## Decorator costs: startup-only
No reflect-metadata or legacy-decorator code runs per request. The samples first attributed to reflect-metadata were
the shared lifted helpers (`%class.construct:N`, `%class.instanceof:dynamic`), whose IR loc is their first use site.
Native startup is 22 ms in total. The only per-request coupling: every compiled class, decorated Nest classes included,
lengthens the dispatch ladder in #2.

## Dynamic vs typed share, and how to type Nest/rxjs
- Of 11,390 IR functions, 9,600+ are `tier: dynamic` (nest-core 5171, nest-common 2285, rxjs 1381, reflect-metadata 319,
  tslib 271). About 75% of hot samples sit under dynamic-tier functions, typed-tier code is under 4%, and about 57% of
  self time is in dyn runtime (dyn property/invoke 17.7 + ladders 17.1 + dyn refcount/cycle about 22).
  The rest is kernel (fiber stacks 16%, socket I/O 9%).
- **Option 1, type the JS from the shipped .d.ts.** Today scriptc does the opposite: an npm-static package compiles from
  its JS and its .d.ts is hidden (`frontend/npm-static-type-exports.ts`, npmStaticFsShadow). Only type-only exports
  (interfaces/aliases/enums) are bridged through JSDoc typedefs. Values keep JS-inferred types.
  Obstacles: .d.ts are unverified claims about the JS (it must be guarded at boundaries or trusted unsoundly); they omit
  private and implementation fields; rxjs cjs classes are ES5 functions with no class to attach a layout to; and the
  rxjs/Nest .d.ts are `any`-heavy (`Observer<any> | Subscriber<any>`, `...args: any[]`).
  Expected gain: modest, **~1.2-1.4x** on the rxjs share, mainly direct method calls where the receiver type is concrete.
- **Option 2, compile the TS sources.** rxjs 7.8.2 ships `src/**/*.ts` (251 files) in node_modules, and its cjs maps point
  at `../../../src/*.ts` (no sourcesContent, none needed). @nestjs/core and common 12.2.0 ship **no .ts and no source
  maps**, so Nest would need the GitHub tag sources plus its build config.
  Obstacles: rxjs generics, unions, overloads and `this`-typed APIs only partly fit the static tier; Nest's DI is
  `any`/reflect-metadata driven and would stay mostly dynamic even from TS.
  Expected gain: rxjs from src could reach **~1.5-2x on the rxjs half (~1.3-1.5x overall)**; Nest from TS, small.
  Do it after fixes 1-4, which apply to all untyped JS.

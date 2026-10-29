# Authoritative baseline 2026-10-27 15:00-15:30 UTC (worktree t3-ff1a7fe4)

Runtime pack rebuilt from the then-current source in scriptc-legacy-gate (npm run build:native, chown back), compiler dist rebuilt, then both
binaries built once from that state and measured as frozen artifacts (nothing rebuilt between measurements; the 203k/221k/242k/259k drift came
from rebuilding the pack mid-measurement). Nest verified compiled from TS in the TS lane: panic traces name
/tmp/ab/prov/.../packages/core/router/router-execution-context.ts (default lane: node_modules/@nestjs/core/.../router-execution-context.js).
TS lane = SCRIPTC_PROVENANCE_SOURCES=1 SCRIPTC_PROVENANCE_DECLARED=1 with the host provenance cache copied to /tmp and SCRIPTC_PROVENANCE_CACHE set.

| lane | callgrind Ir / request (GET /hello/native) | req/s median (IQR) | server CPU us/req | binary |
|---|---:|---:|---:|---:|
| Node Nest (dist/main.js) | ~106k-125k steady state (see below) | 58,861 (38,642-59,277) | 17.2 | - |
| default (compiled from JS) | **254.3k** (76,293,030 / 300) | 21,710 (21,485-25,402) | 45.4 | 29.8 MB |
| TS (Nest + rxjs from TS) | **203.3k** (60,979,103 / 300; repeat 61,013,619) | 25,258 (22,818-29,686) | 39.6 | 25.0 MB |

Callgrind method: valgrind --tool=callgrind --separate-threads=no inside the container, one keep-alive connection, 100 warmup requests, callgrind_control -d,
300 measured requests, dump; the second dump is the number. Compiled lanes are deterministic (two runs each, identical to <0.1%). Node under valgrind is
not: Ir/request depends on how far V8 has tiered up. 100 warmup: 386k (cold); 1000: 181k; 3000: 106k (two identical runs); 6000: 125k; 10000: 123k; a
3000-request window averaged 145k and 333k with 10000 warmup (GC and compile land in the window). Treat Node as ~105k-125k per request warm.
So compiled Nest is still 1.6x (TS lane) to 2.0x (default) Node's instruction count per request, yet req/s here are not comparable to Ir (below).

req/s: examples/nestjs/bench/run.mjs --warmup 15 --duration 10 --runs 5 (ABAB, 64 connections, server cpus 2-3, client cpus 8-15) with the prebuilt
binaries (new flags --native-bin / --ts-bin added to run.mjs, since the host has no clang to build in-process). THE HOST WAS LOADED: load average 13.7
at start, 22.8 at the end (other agents' vitest and docker builds), so the req/s numbers are noisy: single trials ranged Node 9,226-63,680,
default 11,710-28,102, TS 21,749-31,188. Use the Ir/request figures as the authoritative ones, and the CPU us/req medians as indicative only.

# TS-lane GET /hello/native: callgrind profile (2026-10-27)

Worktree t3-ff1a7fe4. Binary: examples/nestjs/src/main.ts with Nest and RxJS compiled from TypeScript sources
(SCRIPTC_PROVENANCE_SOURCES=1, SCRIPTC_PROVENANCE_DECLARED=1; Nest from the provenance cache, rxjs from node_modules/rxjs/src;
reflect-metadata, tslib, iterare, path-to-regexp, fast-safe-stringify stay JS).
Method: valgrind --tool=callgrind inside scriptc-legacy-gate, 1 keep-alive connection, 100 warmup requests, dump, 300 measured
requests, dump; the second part is the measurement. Release build, unstripped, IR map via emitIr (main.ir.json, `%fn.<hash>` to source).
Gotcha: the container has no network or ~/.cache/scriptc; copy the provenance cache to /tmp and set SCRIPTC_PROVENANCE_CACHE,
otherwise only rxjs resolves and Nest silently stays JS.
Callgrind is blind to fiber switches, so inclusive numbers under scr_ctx_swap nest oddly; exclusive numbers are exact.

Baseline: 70.44 M Ir / 300 = **234.8k instructions per request** (before the lever below). After: 66.39 M / 300 = **221.3k (-13.5k, -5.7%)**.

## Category breakdown (baseline, per request)
Exclusive = self cost of functions assigned to the category. Inclusive anchors are below the table.
| category | excl. instr/req | % | notes |
|---|---:|---:|---|
| dyn property access, inline caches, typed-ref bridge, class-table helpers | 85,200 | 36.3 | see "dyn" below |
| allocation, free, refcount (dyn/closure/box/str/arr destroy, malloc) | 62,700 | 26.7 | scr_dyn_destroy 9.1k, release_survivor/dead/release 12.3k, dyn_alloc 3.6k |
| cycle collector (cyc_*, mg_*, scan_*, dyn_trace, closure_trace, dispose_observers) | 23,600 | 10.1 | scr_cyc_collect_scheduled incl 18.2k |
| RxJS compiled (typed-tier) code | 20,200 | 8.6 | Subscription.add 1.9k, OperatorSubscriber ctor 0.4k, Observable.subscribe closure 1.5k |
| runtime other (arrays, maps, boxes, errors) | 13,100 | 5.6 | scr_box_get_ref, scr_arr_*, scr_map_* |
| HTTP and parsing (http conn, URL, net, loop, head build) | 8,500 | 3.6 | scr_http_conn_data incl 53.9k (includes the whole handler) |
| promises and async fibers | 6,800 | 2.9 | promise_release 1.7k, ctx_swap 1.0k, async_spawn 0.8k; scr_async_spawn incl 33.8k |
| Nest router/guards/pipes/interceptors compiled code (TS) | 5,300 | 2.3 | router-execution-context.ts closures dominate |
| string ops (memcmp, strlen, strcmp, split) | 4,400 | 1.9 | memcmp 2.0k (mostly typed_ref_new key compare) |
| libc other (url parse, timers) | 2,300 | 1.0 | |
| app code (src/http-adapter.ts, app.module.ts) | 2,000 | 0.8 | |
| JSON | 600 | 0.3 | |
Typed-tier compiled code in total (rxjs + Nest + app): 27.5k (11.7%). Everything else is runtime and dyn machinery.

Inclusive anchors (instr/req, nested through fibers so they overlap):
scr_loop_run 234.8k (everything); Observable.subscribe 158.5k; Nest router-execution-context.ts:202 handler closure 142.9k;
lastValueFrom 104.8k; promise executor 104.1k; lift.ts:22 operator closure 95k; takeUntil 90.8k; scr_net_dispatch 57.8k (HTTP in);
tap 53.1k; innerFrom 51.9k; RouteTable.handle (src/http-adapter.ts) 49.4k; switchMap 41.4k; async spawn 33.8k;
cycle collector 18.2k; of() 11.6k. Nest guards/pipes/interceptors/exception zones are mostly not on this path (no guards or pipes
configured); the router cost is the response pipeline (transformToResult, apply, fromClientDisconnect, interceptors consumer) and it is
RxJS-dominated: 90% of the handler inclusive cost is inside rxjs operators and Subscriber/Subscription.

## Top 25 functions by exclusive cost (baseline)
Synthetic helper names (`%dyn.class.*`) are compiler-generated class-table helpers over every compiled class; their file:line
in main.ir.json is meaningless, so the origin column names the construct.
| # | instr/req | function | origin |
|--:|--:|---|---|
| 1 | 9,139 | scr_dyn_destroy | runtime; teardown of ~144 dyn nodes/req, mostly typed-ref capsules (Subscriber/Subscription/Observable) and function values |
| 2 | 8,400 | scr_dyn_typed_ref_new | runtime; 87 capsules/req built by %dyn.class.boxExact:Subscription/Subscriber/Observable, hash probe plus memcmp of the type key |
| 3 | 6,936 | %dyn.class.properties | synthetic 304-class ladder; 3 calls/req from Observable constructor (Observable.ts:32 `this._subscribe = subscribe`) |
| 4 | 6,895 | scr_dyn_typed_ref_in | runtime; dyn-to-class cast (sc_dc_*) of a capsule: Subscription.add (16/req), remove, takeUntil, tap, switchMap |
| 5 | 6,224 | %dyn.class.normalize | synthetic; exact-class re-box of a capsule over 20 hierarchy roots; called by properties, Observable.ts:313/lift.ts:10 property reads, execFinalizer |
| 6 | 4,572 | scr_dyn_release_survivor | runtime; capsule/handle release that stays alive (traced capsules enter the cycle buffer) |
| 7 | 3,886 | scr_dyn_release | runtime |
| 8 | 3,807 | scr_dyn_release_dead | runtime |
| 9 | 3,600 | scr_dyn_alloc | runtime; 92/req |
| 10 | 3,350 | scr_cyc_on_dead | runtime; 125/req |
| 11 | 3,036 | scr_js_probe_load | runtime; JS inline-cache probes (61/req from scr_js_get_probe) |
| 12 | 2,969 | scr_closure_new_embed | runtime; rxjs operators allocate ~49 closures/req (OperatorSubscriber ctor, tap, switchMap, takeUntil, innerFrom) |
| 13 | 2,737 | scr_cyc_settle | runtime cycle collector |
| 14 | 2,685 | scr_mg_first | runtime cycle collector mark pass |
| 15 | 2,530 | scr_dyn_obj_put | runtime; 24 dyn_obj_set/req |
| 16 | 2,389 | scr_dyn_find_entry | runtime; typed_ref_materialize (36/req) and obj_read_receiver |
| 17 | 2,388 | scr_rc_destroy | runtime |
| 18 | 2,360 | scr_dispose_observers | runtime; weak/finalization observer scan on dispose |
| 19 | 2,317 | scr_dyn_property_owner | runtime; from scr_dyn_has_key (49/req: `'unsubscribe' in x`, hasLift, isSubscription) |
| 20 | 2,145 | scr_closure_destroy | runtime |
| 21 | 2,099 | scr_dyn_new_func | runtime; function values boxed to dyn (ldr_materialize, OperatorSubscriber ctor) |
| 22 | 2,018 | memcmp | libc; typed_ref_new key compare (51/req) |
| 23 | 2,016 | scr_dyn_has_key | runtime |
| 24 | 1,963 | scr_closure_release | runtime |
| 25 | 1,961 | scr_dyn_typed_ref_materialize | runtime; capsule property view for dyn reads |
(No compiled Nest or RxJS function reaches the top 25 by exclusive cost; the largest is rxjs Subscription.add at ~1.9k, then
Observable.subscribe closure ~1.5k.)

## Remaining dyn-touching hot functions and what forces dyn
Inclusive dyn-callee cost per compiled function (instr/req) and the construct:
- rxjs Observable.subscribe closure (Observable.ts:211) and _trySubscribe (:233): `this._subscribe(subscriber)` where `_subscribe`
  is a prototype method that the constructor ALSO overwrites per instance (`this._subscribe = subscribe`, Observable.ts:32). A
  method shadowed by an instance assignment forces the per-instance dyn property bag (`%dyn.class.properties`) and dyn-called
  closures (`scr_dyn_call_this`). Subject/ConnectableObservable also override `_subscribe` and `lift`.
- rxjs Subscription.add / remove / unsubscribe / execFinalizer / isSubscription (Subscription.ts:116,187,47,206,199):
  parameter type `TeardownLogic = Subscription | Unsubscribable | (() => void) | void`. A class arm plus a structural interface
  arm (Unsubscribable) plus a function arm has no typed representation, so the value is dyn; `instanceof Subscription` and
  `isFunction(x.unsubscribe)` then cost a capsule cast (sc_dc_*, typed_ref_in) and `dyn_has_key` each. 16+4+... casts/req.
- rxjs Subscriber.next/complete/_next (Subscriber.ts:67,95,112), ConsumerObserver, SafeSubscriber: `destination: Subscriber | Observer`
  (interface `Observer` arm) plus `Partial<Observer>` params: dyn calls of `destination.next(v)` through the capsule.
- rxjs createOperatorSubscriber / OperatorSubscriber ctor (OperatorSubscriber.ts:46,90): `onNext?: (value) => void` closures are
  boxed to dyn function values (scr_dyn_new_func, closure_new_embed) because the callbacks are stored into dyn-typed fields
  of the Subscriber chain (`this._next = onNext ? ... : super._next`: another instance-assigned method override).
- rxjs lift.ts:10/20/22 (hasLift, operate): `source?.lift` on an `any`-typed source (`isFunction(source?.lift)`), dyn property
  read plus `%dyn.class.property.N` ladder plus normalize.
- rxjs innerFrom / isInteropObservable / isObserver / isPromise: duck-typing on `any` input (`obj[Symbol.observable]`, `.then`).
- Nest router-execution-context.ts closures (:177, :202, :508, :587) and RouterResponseController.apply / transformToResult:
  parameters typed `any` / `Promise<any> | Observable<any>` (result of the user handler), `isObservable(result)` duck-type test,
  handler arrays of `Function`; the hand-off into rxjs (`from(...)`, `defer`, `fromClientDisconnect`) crosses class-to-dyn.
- src/http-adapter.ts (RouteTable.handle, reply): the example's own adapter takes untyped req/res objects (`any`).
Fences: all of these are the "structural interface/union with function arm", "any-typed receiver" and "instance-assigned method
override" constructs, not unsupported syntax.

## Ranked generic levers (estimated instr/req saved)
1. **Capsule churn removal (est. 25-35k, large change).** 87 typed-ref capsules are created and destroyed per request. Per capsule:
   typed_ref_new ~100 + dyn_alloc ~40 + memcmp ~20 + materialize/bind ~40 + destroy chain (dyn_destroy 63, release_dead 25,
   release_survivor 18, cyc_on_dead 27, forget 17) ~ 350-450 each, plus the sc_dc_* casts back (53/req, ~130 each).
   Fix directions: (a) represent `Subscription | Unsubscribable | (() => void)` style unions as a typed union with a class arm
   instead of dyn; (b) cache one capsule per typed object (an object header slot; no 87 allocations, no hash probe);
   (c) keep capsules `traced` only when the class can hold a cycle. Evidence: rows 1,2,4,6-10,16,25 in the top 25.
2. **Instance-assigned method override slot (est. 9-12k, medium).** `this._subscribe = subscribe` in Observable.ts:32 costs
   ~3.1k per construction (3/req): properties ladder 2.3k self + normalize 0.34k + bag alloc + capsule, and every `_subscribe`
   call goes through the bag. A hidden nullable closure field on the class (checked first by `this._subscribe(...)`) would remove
   the bag. After the lever below, properties costs ~260/call, so the remaining gain is ~5-6k from allocation and dyn dispatch.
3. **Cycle collector candidacy (est. 6-10k, medium).** 125 cyc_on_dead/req plus mg_first/visit/trace (~11k self) are driven by
   traced capsules and rxjs closures that form Subscriber<->Subscription parent cycles. Skipping candidacy for capsules whose class
   fields cannot reach the capsule back (acyclic by shape), or batching dispose_observers (2.4k), cuts part of it.
Smaller: type_key pointer-equality precheck before memcmp in scr_dyn_typed_ref_new (51 memcmp/req, ~0.9k, <0.5%, not done);
`scr_dyn_has_key` + `property_owner` on `'x' in dynValue` tests (4.3k, shape-cached has-key would save ~2k).

## Implemented: length-bucketed capsule-key ladders (-13.5k/req, -5.7%)
Cause: the compiler-generated class-table helpers (`%dyn.class.properties` 304 branches, `normalize` 20 roots x subclasses,
`computed.N`, `prototypeChainIdentity`, `method.receiver`, ...) are chains of `if (typedRefIs(v, "object:C")) ...`; each skipped class
still costs ~7 instructions, so Observable (deep in the table) paid ~2.3k per call.
Change: new packages/compiler/src/backend/llvm/capsule-ladder.ts, hooked at the top of the statement loop in
`LlEmitter.emitStmts` (emitter.ts). A run of >= 12 consecutive `if` statements whose condition starts with `typedRefIs(local, "lit")`
(directly, or as the left of `test && more` / `test ? more : false`), without else and whose bodies never rebind the local, is emitted
as: null/kind check, load the capsule key length, `switch` on it, and per length the original statements in original order.
A key can only equal a key of equal length, so first-match order is preserved; the IR is untouched, so the js-ic classification of
`%dyn.class.*` helpers is unaffected.
Result (callgrind, same method): properties 6,936 -> 774; normalize 6,224 -> 1,560; computed_0 991 -> 104; prototypeChainIdentity
1,037 -> 183; total 234.8k -> 221.3k.
Gates: new corpus tests `capsule-ladder-many-classes.js` (20 classes, same-length names, subclass chains, dynamic properties) and
`deferred-string-field-reads-undefined.ts`; differential (release+dev) plain and SAN over 14 narrow tests with SCRIPTC_TEST_WORKERS=4;
compiler unit tests (backend, ir, union-narrow); check:native in examples/nestjs, default lane and TS lane.

## Instance-assigned method overrides (2026-10-27, worktree t3-ff1a7fe4)
Target: RxJS `Observable` constructor `this._subscribe = subscribe` (an own function over a prototype method) and the calls
`this._subscribe(sink)`. What the profile showed, and what was changed (two generic changes, no per-instance slot):

Finding: the per-instance "slot" already exists as the hidden property bag (`%dynProperties`, a dyn object per instance, created lazily).
A separate typed slot would have to be mirrored in every bag consumer (the generated view/commit adapters in expr-stream-bridges.ts, the
read-only/orEmpty bag variants, the fieldCreated helpers, the attribute guards for frozen instances), so it was NOT built; the cost was in
how the bag is reached, not in the bag itself.

1. **Typed bag creation in a superclass constructor (L1).** `typedPropertyBag` (class-dynamic-dispatch.ts) refused a storing typed bag for any class with
   subclasses ("a superclass constructor can be the first code to access this bag"), so `Observable`'s `this._subscribe = subscribe` went through
   `%dyn.class.properties(boxExact(this))`: a typed-ref capsule plus the 300-branch ladder. The refusal is now limited to families rooted in
   runtime/builtin classes; compiled families use `%class.properties:C(this)` whose initializer already selects the most derived prototype
   through `%class.bagPrototype:C` (a typed instanceof chain). No capsule, no ladder.
2. **Own-property read of an unobserved callback (L3).** A call of a name in the replaceable-method census (`classCallbackCall`, class-callbacks.ts) read
   `%class.readProperties:C(this)`. For a class with prototype data, an ABSENT bag read returns a FRESH `dyn.objCreate(prototype data)` (so reads see
   prototype members), i.e. one object allocated and freed per call just to ask "does this instance own `name`". For names whose prototype is not
   observed (`observedSlot` false) the call only needs the own bag, so the call now uses a new `%dyn.class.readOwnProperties` read: typed receivers get
   `%class.readOwnProperties:C` = the bag field itself (undefined while absent; `present` is then false and the call takes the existing direct/virtual
   fallback); other receivers read like `readProperties`. Observed names (prototype can be replaced) keep `readProperties`. dispatch-sites.ts counts the new
   callee as a dispatch site.

Semantics kept (all unchanged paths): own property presence/hasOwnProperty, deletion, subclass override, `this` binding of the own function (dynCall receiver),
reading the member as a value, assignment from outside the class, `x._subscribe = undefined` then a call throwing TypeError, keys order. Pinned by corpus
`instance-assigned-method-override.ts` (typed, subclasses override the method, own function with and without `this`) and
`instance-assigned-method-override-js.mjs` (delete, `in`, hasOwn, reassignment, undefined value).

Measurement (callgrind in scriptc-legacy-gate, TS lane, 100 warmup + 300 requests on one keep-alive connection, same runtime pack for all three builds;
the absolute level is higher than the 221k above because the working tree's runtime moved while measuring, only the deltas are comparable):
| build | Ir / 300 req | per request | delta |
|---|---:|---:|---:|
| baseline (L1 and L3 off) | 77,876,144 | 259.6k | |
| L1 only | 77,081,096 | 256.9k | -2.65k (-1.0%) |
| L1 + L3 | 72,683,576 | 242.3k | -17.3k (-6.7%) |
Typed-ref capsule creations per request: 87 -> 84 (L1) -> 67 (L1+L3). Default lane (JS rxjs): 255,504 -> 255,508 per request (no effect, as expected).
Methodology gotcha: `callgrind_control -d` with no pid dumps EVERY valgrind in the container; pass the pid, and keep the machine load in mind (another
agent's runtime instrumentation inflated `scr_dyn_typed_ref_new` to 66% of the profile in two of my builds, so compare builds that share a runtime pack).
Remaining in this area: `Observable` own-`_subscribe` calls still box `this` and the sink for the dynCall (2 capsules per call) and the bag itself is
created with the function boxed to dyn; a closure-typed slot would remove those but needs the view/commit/attribute mirroring above.

## Attempt: parked typed-ref capsule cache (reverted, 2026-10-27)
Measured first (instrumented runtime, TS lane): per request scr_dyn_typed_ref_new is called 87x, but only ~36 are creations
(~51 already hit the live-capsule table, so "87 capsules/req" overstates the churn; creations are ~36/req, dyn_alloc 92/req overall).
Among creations of plain class instances, 63% re-box an object whose previous capsule died within the last 32 capsule deaths
(69% within 64, 72% within 128, 78% within 256), with the object still alive elsewhere. So reuse locality is high.
Design tried: when a plain class-instance capsule (observed, "object:" key, no prototype/symbol tables) reaches rc 0, park it
(rc = sentinel, still in the typed-ref table, still holding +1 on the referent, caches kept) on a 128-entry thread-local LRU;
typed_ref_new revives it by the normal table probe; flush at scr_collect_cycles/exit. Sound for refcounts, the collector (parked
capsule is no candidate), threads (list is thread-local) and `===` identity. Result: typed_ref_new calls 87 -> 67/req, dyn_alloc
92 -> 68, but the pinned referents turn the last owner's release into a "survivor" release, so traced objects become cycle
candidates: scr_mg_first, cyc_settle, cyc_pass, scan_black, closure_trace roughly doubled. Net 72.6M vs 61.0M Ir (+19%) per 300
requests. Reverted entirely.
Clean baseline on the current tree (same method, after other agents' work): 60.99M / 300 = 203.3k instr/req (the 221.3k above is
older). Default lane not re-measured (no change kept).
Conclusion: pinning the referent is the wrong trade. A cache that does NOT pin (stale ptr, revive re-retains) saves only alloc +
table insert/remove, ~130 instr x ~22 revivals = ~3k (~1.4%), and needs a duplicate-entry check across the release callout to keep
`===` identity, so it was not built. The real fix for the churn is upstream: avoid the dyn crossing (typed union with a class arm,
lever 1a) or an object-header slot that the object's own death clears (compiler class-layout change; classes have several
layouts: compact, program-lifetime, runtime-prefix, thread-slot).
Kept: corpus tests tests/corpus/typed-capsule-{identity-churn,cycle,freed-referent}.ts (pass on the unchanged runtime, release+dev,
plain and SCRIPTC_SAN=1), useful guards for any future capsule cache.

## Attempt: tagged union with a structural (dyn) arm (reverted, 2026-10-27)
Target: stop typed values crossing into dyn through `TeardownLogic = Subscription | Unsubscribable | (() => void) | void`,
`Partial<Observer> | ((v) => void) | null`, `Subscriber | Observer`.

Existing representation found: the type mapper (type-mapper.ts, union rule in mapTypeInner) COLLAPSES any union that has a
class-backed protocol view arm (`classImplementedProtocol`, an interface a program class implements) plus object/func arms to DYN
("protocolViewArm" branch); IR unions otherwise already support tagged `object` + `func` + unit arms (`%ScrUnion` box, nullable
pointer form for one ref arm + unit), but `armHasUnionHome`/validate.ts/requireTruthyUnion/eqComparableUnion refuse a `dyn` arm, and
`x instanceof C` on a union with a func arm is fenced (SC1090).

Design built (patch kept at ~/decorator-research-notes/structural-arm-union.patch, against this tree's other agents' edits):
tagged union whose arms are the class (object), the closure (func), unit arms and ONE dyn arm for the structural interface. Invariant:
the dyn arm holds only values that are neither a func-arm closure nor an instance of an object-arm class; entry points enforce it
(typed value: identity > base-class upcast > covariant closure adapter > dynFrom into the dyn arm; dyn value: dynCheck classifies func /
class capsule first, dyn arm last; union-to-union retag: new `reclassify` plan arm, dyn source never stranded). Narrowing reads of such
a union never trust the tag (typed arm in place, dyn arm re-checked with dynCheck, narrowing to the structural type = union->dyn);
instanceof (tag test + capsule class test on the dyn arm), typeof (tag test + dynTest on the dyn arm), `in` and unsupported property /
method reads fall back to boxing the union to dyn (exact, slower), unionEq gets a dyn arm (scr_dyn_strict_eq), dynCheck order puts the
dyn arm last. Nest TS lane compiled and served /hello/native.

Result (callgrind, scriptc-legacy-gate, TS lane, 100 warmup + 300 requests, one keep-alive connection, both binaries built back to back
on the same runtime pack): 60,960,046 -> 60,688,564 Ir per 300 requests = 203.2k -> 202.3k per request (-0.45%). Per function: typed_ref_in
1.64M -> 0.56M (-1.08M, the sc_dc_ casts are gone), typed_ref_new 1.95M -> 1.78M, but dyn_alloc +88k, dyn_destroy +80k: every union
wrap/retag allocates a %ScrUnion box (dyn_alloc_box 41 -> 49 per request, dyn_alloc total 156 -> 163), dyn_new_func unchanged at
2.1k/req (isFunction(any) still boxes the closure arm), and most capsules come from elsewhere (Observable/Subscriber receivers,
`this._subscribe(sink)` dyn calls, `destination.next` on Subscriber|Observer boxing the union for the method call).
Under the 1% bar, so the compiler change was reverted. Findings that would make a second try worth it: (1) the union box allocation
eats the gain, so the representation needs a box-free form (nullable-pointer style: class pointer and closure pointer distinguished by
a header tag) before it can win; (2) method calls on such unions must dispatch per arm (typed call on the class arm, dyn call on the dyn
arm) instead of boxing the whole union; (3) type-guard helpers like isFunction(value: any) need an inlined/specialised form so the
closure arm is not boxed into a dyn function per call.
Pre-existing bugs seen while testing (not from this change, reproduce on the unchanged tree): object literal `{ next: (v) => got.push(v) }`
(number-returning arrow) into `Partial<Observer<number>>` throws "a void result where the '(number) => number' slot promises 'number'";
`defer(() => of('deferred'))` + lastValueFrom in the TS lane throws "expected number at $, got string"; `of(1, 2, 3)` is fenced (overload
selection on a generic function); function-with-properties values boxed to dyn answer typeof "object".
Kept: tests/corpus/union-structural-arm-class-closure.ts and union-structural-arm-observer-guards.ts (identity, instanceof, subclass,
plain object, any-sourced values, array indexOf/splice by identity, lying type guard); both pass on the unchanged compiler, release+dev,
plain and SCRIPTC_SAN=1.

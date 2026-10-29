# Two further techniques for the native NestJS path: build-time snapshot and request-scoped arenas (2026-10-27)

Scope: design research only, no repo edits. Worktree t3-ff1a7fe4. Sources: the repo (paths below), and the earlier notes in this folder
(nest-native-profile.md, dyn-tier-design.md, bench-final.md). Every instruction figure is an ESTIMATE from code reading and the profile
shares; perf is blocked on this host, so nothing here is measured. Claims about GraalVM, V8 and Hermes come from memory, not from a fresh
read of their sources (the earlier Hermes notes did read static_h sources; those points are reused).

## 0. Executive summary

| | Snapshot + closed-world (Graal style) | Request arena / nursery (Erlang, MLKit, Go style) |
|---|---|---|
| Honest best design for scriptc | S0 "tenure after bootstrap" (runtime, mutable immortals), then S1 stage-1/stage-2 build reusing the PGO plumbing | A1 "counted request nursery" (extend the existing young-in nursery to dyn objects and closures), then A2 barrier-based RC elision only if A1 data justifies it |
| Saving per request, first version | S0: 6-10k (2-4%) | A1: 25-35k (10-13%) |
| Saving per request, full version | S1+S2: 25-60k, but 50-70% overlaps PGO | A1+A2: 55-80k (20-30%), optimistic |
| Risk | S0 low-medium, S1 medium, S2 high | A1 low-medium (soundness unchanged), A2 very high |
| Unique value over PGO | Immortal singletons (no RC traffic), cross-function inlining with known targets, cold start | Cheaper allocation, no per-object cycle candidates, bulk free |

Build order after PGO speculation: **A1 first, S0 second**, S1 only if PGO traces show guards and probes still dominate. Neither technique,
nor both plus PGO, gets 2x faster than Node on the Nest benchmark (section 4). Realistic landing zone: 0.6x to 1.0x Node req/s,
about 150k to 190k instructions per request.

Two findings that change the framing of the original idea:
1. "Decorator and reflect-metadata lookups fold to constants" saves approximately nothing per request: the earlier profile found no
   reflect-metadata or decorator code on the request path (nest-native-profile.md, "Decorator costs: startup-only"). Snapshotting buys cold
   start (already 12-22 ms vs 140-225 ms for Node), not steady-state.
2. "Skip refcounting for arena objects" cannot be made sound with a cheap tag check in this runtime, because promotion by copy needs precise
   roots that a refcounted, FFI-heavy runtime does not have. The sound variant keeps the counts and removes the cycle-candidate and
   allocation cost (A1). Real RC elision (A2) needs a store barrier and is a different order of risk.

## 1. What scriptc already has (search results)

Searched: packages/compiler/src, packages/runtime/src, docs/content. No JS-level interpreter, no build-time evaluation of program code, no
heap snapshot or image heap, and no points-to analysis over object graphs. Literal folding exists only for literals and JSON
(backend/literals.ts, backend/json-literal.ts).

Pieces that are close relatives and should be reused:
- **Publication = a primitive image heap.** runtime/src/scr_publish.c and llvm/publish.ts: `publish(root)` walks a graph and sets
  `rc == SIZE_MAX`, so retain/release skip the objects and the collector never walks into them (SCR_CYC_SKIP). Frozen and immutable,
  with a logged undo. Per-type walkers are emitted by the compiler; dyn subgraphs have runtime walkers. This is exactly the "make bootstrap
  state immortal" machinery, except that it also makes the graph immutable (emitted guards throw the frozen-object TypeError), which
  Nest singletons cannot tolerate.
- **ProgramLifetime classes and compact instances** (scr_rc.h: SCR_RC_COMPACT_TAG; llvm/classes.ts `compact`; llvm/shapes.ts): instances of
  program-rooted hierarchies carry no count at all. Proof that an uncounted-header class of objects already works end to end.
- **LifetimeRegion** (experimental; frontend/lowering/lifetime-regions.ts, backend/llvm/regions.ts, runtime scr_region.c): counted regions
  with a release-time walk that decides whether a region is externally referenced ("anything the walk cannot see only leaves references
  unexplained: mistakes keep memory, they never free it"). This is the nearest existing thing to a per-request arena, but only for
  ProgramLifetime class instances, not dyn objects or closures.
- **Young-in nursery** (scr_cycle.c ~1544, SCRIPTC_YOUNG_NURSERY=1, built with SCR_YIN): allocates compiled class and record instances
  young; collects the nursery on its own in time proportional to its size by recomputing "references from young objects" per object,
  marking from objects whose count exceeds the young-internal count, sweeping the rest. No store barrier needed because counts are
  recomputed. Today it covers compiled classes and records, NOT ScrDyn objects, arrays, closures or promises, which is what rxjs/Nest
  allocate (rxjs is 51% of samples, all dynamic tier).
- **Closed-world devirtualization** (frontend/lowering/devirtualize.ts): post-reachability; a `virtualCall` becomes direct when one
  implementation can run. It explicitly refuses "decorated classes, dynamic bases, exported library classes", which is every Nest
  provider. Applies to the static tier only.
- **Escape-ish analyses**: construction-escapes.ts (does `this` escape the constructor), llvm/stack-objects.ts (frame-allocated records
  and classes whose uses only project them), backend/cycle-analysis.ts and cycle-mutability.ts (which types can form cycles),
  runtime-optional-ownership.ts. All are static-tier and per-function or per-type.
- **Profile plumbing**: `--profile-generate`, `merge-profiles`, `--profile-use` (LLVM PGO, docs/content/docs/cli.mdx), and
  backend/native-profile.ts. The PGO-speculation agent will add a site-level training format; a snapshot stage-1 run can share its
  "run the binary, collect, rebuild" driver.
- **Stable function names** (frontend/lowering/stable-names.ts, `%fn.<hash>`) so a stage-1 dump can name closures and classes in stage 2.
- `executable-cache.ts` / build-cache.ts: stage-1 binaries are cacheable.

## 2. Technique 1: build-time initialization, heap snapshot, closed-world points-to

### 2.1 What the prior art does and requires

GraalVM native-image:
- Classes marked `--initialize-at-build-time` run their static initializers inside the builder JVM; the resulting object graph reachable
  from static fields is written into the **image heap** (read-only/read-write partitions) and the points-to analysis (a context-insensitive
  type-flow analysis) then runs over that heap as roots, so fields proven to hold one type or one constant fold, calls devirtualize, dead
  branches vanish.
- Requirements it enforces: init must be deterministic and side-effect free with respect to the outside world. The builder rejects or
  warns on live threads, open files/sockets, `Random`/`SplittableRandom` seeds captured in the image, `System.getenv`/properties baked in,
  `Thread` instances, native resources. Anything that must happen at run time is deferred (`--initialize-at-run-time`). Lazy init that
  Java guarantees at first use is moved earlier, which is only legal when init order is unobservable.
- It relies on Java's static typing: `final` fields are constants, field types are closed. That is what lets the analysis fold
  unguarded. Mutable fields stay loads.

V8 / Node startup snapshots (`node --build-snapshot`) and Wasm pre-initialization (Wizer) are the dynamic-language analogues: they run init,
serialize the heap/linear memory, and restore it at start. They save startup, not steady state, and they impose the same rules:
no live native handles, no pending I/O, a quiescent event loop, no captured environment or time. They do not specialise code to the
snapshot. (From memory.)

Hermes / Static Hermes: ahead-of-time bytecode (HBC) and native compilation of code; there is no application heap snapshot and no
build-time evaluation of program state. Hermes' wins on this path come from per-site property caches and a cheap runtime, not from
snapshots (earlier note, dyn-tier-design.md section 2). So the honest SOTA reference is Graal for the compile-time specialisation idea
and V8/Wizer for the mechanics of dynamic-language snapshots.

### 2.2 What must be true of the Nest program

Snapshot point = after `NestFactory.create(...)` and `app.init()`, immediately before `listen`. Required:
- **Quiescent event loop**: no pending timers other than ones we can recreate, no open sockets or fds, no live fibers or unresolved
  promises. NestFactory.create is async (awaits); the snapshot must be taken after the root fiber settles. A native handle (the HTTP
  server object, Redis/DB clients created in `onModuleInit`) is not snapshotable; apps with such providers must create them after
  restore. Needs an explicit hook: `onRestore`-style lifecycle (a Nest `OnApplicationBootstrap` runs before listen; a DB connect there
  breaks snapshotting).
- **Determinism**: no `Date.now`/`Math.random`/`crypto.randomUUID`/`process.env`/`process.argv`/hostname/cwd results cached in singletons
  (Nest does cache `process.env` through ConfigService, and request IDs/uuids are common). Mitigation: a build-time tracer flags reads of
  these intrinsics during init and either refuses or re-executes just those initializers at startup (a "run-time init list").
- **No I/O at init** (config files read via fs, migrations). Same mitigation: record and replay, or refuse.
- **Identity-stable things**: Symbols (`Symbol()` unique per run; Nest's metadata keys are string constants, but libraries use Symbols),
  WeakMap/WeakRef contents (reflect-metadata uses WeakMap keyed by target; the snapshot must keep the table keyed by image objects),
  Map/Set insertion order, object key order, closure environments (boxes), class constructors (identity of prototypes), getters/setters,
  `Function.prototype.toString` text, proxies, stack traces captured in Errors created at init.
- **Environment**: build host = run host for numeric/locale-dependent state (Intl, os.cpus(), env). The snapshot is per target triple and
  per binary; stage-1 and stage-2 binaries must share class ids and function ids, so the dump must be keyed by `%fn.<hash>` names and
  recomputed if any input changes (cache key = source hash + compiler version).

### 2.3 Design for scriptc

Because scriptc has no interpreter, "run init at build time" means **run a stage-1 native binary**, exactly like a profile-generate
training run. That makes the technique a close cousin of the PGO work already in flight and is why overlap is high.

**S0: tenure after bootstrap (runtime only, no compiler change).**
- At a marked point (`listen()` of the HTTP server, or an explicit `scriptc.tenure()`), run a walk like publication's but marking objects
  *tenured*: a count in the immortal range **without the frozen bit**, so stores still work.
- Soundness argument (important, it is why this is cheap): the collector treats tenured objects as external roots; a child held by a
  tenured parent has a real count including that edge, and the parent never dies, so the child is alive while held. When the parent drops
  the child, the setter's release decrements normally. No cycle can run only through a tenured object that is garbage, because the
  tenured object is a root. Edges from tenured to young objects are therefore simply ordinary counted references. Nothing needs a barrier.
- Effects: retain/release on singletons (services, handlers, route tables, shapes' prototypes, classes, reflect-metadata maps, the DI
  container, module graph) become the existing `rc == IMMORTAL` early-out; the collector stops scanning them; no more dirtying of their
  cache lines.
- Change surface: new sentinel range in packages/runtime/src/scr_rc.h (`SCR_RC_TENURED_MIN`); the inline retain/release fast path must
  test `>=` a threshold instead of `== SCR_RC_IMMORTAL` (llvm/emitter.ts and runtime inline helpers in scr_rc.h; one compare either way);
  a mutable-tenure walker using the publication machinery (scr_publish.c, scr_pub_mark with a flag), dyn walkers for ScrDyn OBJ/ARR/closure/
  map/set; refuse (leave counted) for objects owned by native handles or threads-shared structures. The emitted write guards of
  publishable/freezable types test the rc word as "frozen" when immortal: tenured objects must use a value those guards do not read as
  frozen (stack-objects.ts notes this coupling).
- Threads: tenure is per thread (worker heaps are separate); published objects shared across threads stay on the existing path.

**S1: stage-1/stage-2 build (`scriptc build --snapshot-train`, `--snapshot-use`).**
- Stage 1 runs the program to the snapshot point and dumps, for every tenured object: shape key sequence, class id, closure -> `%fn.hash`
  + captured-box links, array/map contents (as references into the dump), and *for every dynamic site* the receiver shape and callee
  that were observed (this part is identical to PGO speculation's training output; share the format).
- Stage 2 compiles with these as **facts**. What the facts buy that PGO alone does not:
  1. `this.service.method()` in a provider whose `this` is a known singleton: receiver shape and method target are known, guard is one
     pointer compare on the (tenured) shape word; call becomes `call %fn.hash` and LLVM can inline small Nest helpers.
  2. Constant branches: empty guard/pipe/interceptor lists, `options.x` flags, `isEmpty(this.guards)`: loads from tenured arrays whose
     length is fixed after init are guarded by the same shape or "not thawed" bit.
  3. Route dispatch: a Map/array of routes is tenured; the lookup is a hash probe regardless, a switch only if the guard "route table
     not mutated" holds. Gain is small (see 2.5).
- **Why unguarded folding is mostly unavailable.** Graal folds because Java fields are typed and `final`. JS objects are open: any
  `x[k] = v` with an untyped `x` and an unknown `k` may write any singleton. To fold without a guard, scriptc would need a whole-program
  proof that no store site can reach the slot (a points-to analysis over the IR including dyn stores, `Object.assign`, `Reflect.set`,
  spread, `defineProperty`, proxies). rxjs and Nest are full of such sites. So the realistic mechanism is: **a one-load guard**
  (shape word, or a per-object "thawed" bit set by the slow store path) per use, identical in cost to PGO's guard. The snapshot therefore
  does not beat PGO on guards; it beats it on RC (S0), on inlining certainty, and on warm start.
- Where a stronger version is possible: **seal-after-init for known-immutable singletons**. Nest's metadata maps and module/route tables
  are never written after bootstrap. Mark them frozen-with-thaw: stores go through the existing write guard (as for freezable records);
  a store to a frozen tenured object takes a slow path that sets a global "assumption broken" epoch, after which guarded fast paths
  fail over to the generic path (no deopt of running code is needed because every fast path re-reads the flag). Cost: one load+branch
  per guarded use. Risk: a miss in the write-guard coverage is a miscompile, so the guard must live in the shared store primitives
  (scr_json.c set/push/delete sites, the ~12 shape-reset sites listed in dyn-tier-design.md B1).

**S2: points-to over the snapshot (the real Graal part).**
- 0-CFA/type-flow over the IR starting from tenured roots: abstract object = (allocation site or image object), edges = field stores,
  closure captures, calls. Where a call-site's callee set is a singleton, emit a direct call; where the receiver abstract set is one image
  object, fold field loads to constants. dyn-tier-design.md proposes E2 (whole-program call resolution) separately; S2 is E2 seeded by the
  image so roots are concrete and finite. Files: new frontend/lowering/ pass beside devirtualize.ts (reuse `DevirtualizeFacts`
  reachability and `ConstructedClasses`), consuming the dump; backend/llvm/js-ic.ts and expr-dynamic.ts to emit the direct calls with
  jsval arguments.
- This is weeks of work with a high soundness bar; it is the part of the idea that could remove entire layers (the Nest execution
  context's closure chain), but only if that chain is entirely made of image-reachable closures with fixed captures.

### 2.4 Correctness hazards
1. Hidden runtime state captured at init (env, time, random, pid, uuid): stale in the binary. Needs tracing and an allow/deny list.
2. Native handles and timers inside the snapshot (http.Server, Agent pools, setInterval keep-alives). Refuse or rebuild at restore.
3. Non-determinism in iteration order across stages: stage 1 and stage 2 must agree on class ids and `%fn` hashes; compile stage 1 and
   stage 2 from the same source or the dump is invalid. Content-hash the dump to the compile inputs.
4. WeakMap/FinalizationRegistry/WeakRef semantics: `scr_weak_disposed` currently hash-looks-up on every free once a WeakMap exists. Tenured
   keys never die; fine, but entries keyed by young objects must still clear.
5. Frozen-vs-mutable confusion: reusing publication as-is would turn Nest singletons read-only and throw on the first counter increment.
6. Fiber and coroutine state: any suspended coroutine frame reachable from the graph cannot be snapshotted. Require empty loop.
7. Debuggability/semantics drift: lazily-initialised code that ran at build time now has no observable timing. Acceptable only under an
   explicit flag; default off.
8. Multi-threaded binaries: tenure is per thread; the snapshot cannot cross worker heaps.

### 2.5 Expected saving per request (Nest path, ~263k)
What the request path actually does with the snapshot's content (from the profile): ~140 property probes, ~41 dyn invokes, ~608 releases,
class-construct/instanceof ladders (already fixed), rxjs subscriber graphs (51% of samples, mostly freshly allocated per request, NOT image
state), Nest's pre-built handler closures (image state), the NodeHttpAdapter (image state), response objects (per request).

| Item | Estimate | Note |
|---|---|---|
| S0 tenure: retain/release/cycle-candidate traffic on singletons | 6-10k | assume 150-250 of the 608 release calls touch long-lived objects, 20-40 instr each, plus collector scan avoidance |
| S1 direct calls on image receivers (DI calls, guards, pipes, handler closures) | 8-15k | ~15-20 of the 41 invokes at ~500 instr; mostly overlaps PGO call-target speculation (assume 60-70% overlap) |
| S1 field loads on image objects | 3-5k | ~40 of 140 probes; PGO covers most; guard still paid |
| Decorator/reflect-metadata folding | ~0 | not on the request path |
| Route dispatch as switch | 1-3k | adapter lookup is one probe plus a few compares |
| S2 inlining of the fixed Nest pipeline + dead-branch removal | 25-50k | the only large term; requires a full points-to over dyn code; speculative until a trace shows which rxjs/Nest layers are image-resident |
| **Total, first version (S0)** | **6-10k (2-4%)** | |
| **Total, S0+S1, net of PGO overlap** | **12-20k (5-8%)** | |
| **Total, S0+S1+S2** | **40-70k (15-27%)** | optimistic; depends on S2 landing |

### 2.6 Staged landing plan
1. **Measure (1-2 days).** Add an exit/at-listen dump (SCR_STATS exists: scr_stats.h) of: how many of the per-request retain/release/probe/
   invoke operations hit objects that already existed at listen time (tag objects by allocation epoch: one header bit or a side table
   built by an at-listen walk). That single number bounds S0 and S1. Pass criterion: >= 25% of release calls and >= 30% of invokes hit
   pre-listen objects, else stop.
2. **S0 tenure (1-2 weeks).** Mutable tenure at listen, behind `SCRIPTC_TENURE=1` and then a `scriptc build` flag. Measurable first step:
   instructions per request on examples/nestjs with and without; expect 2-4%. Gates: differential corpus, RC audit lane, ASan lane,
   collector-stress lane, `SCR_JS_VERIFY`.
3. **S1 shared with PGO (2-4 weeks, after PGO lands).** Reuse PGO's site-trace format; add image-object ids so facts are keyed by
   (image object, key) instead of by site only; unlock inlining of known targets. Success = measurable gain over PGO alone; if under 3%
   do not continue.
4. **S2 (open-ended).** Only if the trace says the Nest handler chain is image-resident and fixed.

### 2.7 Risk
S0 low-medium (collector soundness argument above is simple but touches the inline RC fast path, which is on every hot path). S1 medium
(stage-skew, stale-state hazards). S2 high (soundness of a whole-program analysis over open objects). Lower payoff than it appears
because the request path is dominated by objects created per request, which a startup snapshot cannot touch.

## 3. Technique 2: request-scoped region/arena allocation with escape detection

### 3.1 Prior art and why direct transplant fails here
- Erlang: per-process heaps, copying GC, messages are copied; no shared mutable state, so escape cannot happen by a store.
- MLKit: static region inference; region lifetimes follow a stack discipline proved by the type system; Cyclone: region-annotated types.
- Go: escape analysis decides stack vs heap per allocation site at compile time; no dynamic promotion.
- All of these either forbid the problem (no shared mutation) or prove it statically. A dynamic "store barrier + promote by copy" scheme
  (generational copying GCs) needs the ability to find and rewrite every pointer to a moved object. scriptc cannot: references live in
  compiled frames without root maps, in native handles (sockets, fibers, FFI), in the runtime's C structures (scr_json.c is 19.6k lines of
  raw `ScrDyn*`), and in coroutine stacks. So **promotion by copy plus forwarding is not available**.
- "Skip refcounting for arena objects (tag check)" fails for the same reason: if retains of arena objects become no-ops, then when such
  an object is stored into a longer-lived container the container's reference is uncounted too. Making this safe needs a barrier at every
  pointer store into a non-arena object and a way to convert uncounted objects to counted ones later, when the true count (including
  stack references) is unknowable. There is no cheap correct mechanism that elides counts and needs no barrier.

### 3.2 The cheapest correct mechanism: keep the counts, drop the collector's per-object work (A1)

Observation: the young-in nursery already implements a barrier-free escape detector built on counts. For a set S of young objects it
computes, per object, the references coming from other members of S; any object whose total count exceeds that is referenced from outside
S (stack, global, older object, runtime structure) and is a root; everything marked from roots survives; the rest is freed in bulk. That is
precisely "arena with escape detection", with escape discovered at sweep time instead of at store time, and **it is correct by
construction** because counts remain exact (the existing invariant: every strong reference is counted, a trace visits exactly the counted
references). Today it is limited to compiled class/record instances and triggers by size (4096).

A1 design:
- Allocate ScrDyn OBJ/ARR/closure/capture-box/promise-state nodes in the young set too (they are the objects rxjs and Nest create:
  76 closures, subscribers, promise reactions, request/response wrappers, JSON values). Header already has `gen` and `buf` fields used by
  SCR_CYC_YOUNG.
- A request checkpoint (after the response is written and the handler fibers have unwound; in practice "the event-loop tick finished
  handling a batch", since ~57 requests are served per tick) triggers `scr_yin_collect`. Requests need no arena identity: the batch is the
  unit, which also sidesteps defining "request end" across promises/rxjs subscriptions that outlive the handler.
- Savings come from: (1) a young object that dies by its last release is never made a cycle candidate; (2) non-final releases of young
  objects skip `scr_cyc_released` (already the behaviour: "a release that leaves it alive makes no call"); (3) cycle garbage (rxjs
  subscriber <-> subscription <-> teardown closures hold `this`) is found by one linear pass over the nursery instead of
  Bacon-Rajan trial deletion walks per candidate; (4) allocation from slab/bump chunks per size class with nothing but a pointer bump
  (scr_alloc.c pools are fast but still ~100 instr with free-list management and the second malloc for entries).
- Not saved: the refcount arithmetic itself (retain/release remain, ~64k). Their cost is partly the dispose chains and cache misses, which
  A1 reduces only marginally.

A2 (optional, later): **barrier-based RC elision for site-proven local objects.**
- Tag allocation sites (or PGO-profiled sites) whose objects never escaped in training; their objects get an "arena-local" header state
  with uncounted local retains; at the chokepoints where a pointer is stored into a non-local container (emitted reference-writes.ts,
  scr_dyn_obj_set*, array push/set, map/set insert, closure capture, promise resolve, global store: each already executes a retain for the
  stored value) a barrier converts the object, and everything it reaches inside the arena, to counted with a *conservative* count
  (e.g. promote to tenured/immortal-until-collected, i.e. leak-safe). Soundness needs every store site covered; a missed one is a
  use-after-free. Treat as research; the audit surface is the same ~12 shape-reset sites plus emitted stores.

### 3.3 Interaction with the memory model
- docs: docs/content/docs/how-it-works.mdx: "Values use reference counting... a cycle collector runs at defined collection points."
  Sweeps happen at those points, so A1 introduces no new observable behaviour (finalization/WeakRef timing is already collector-defined).
- scr_rc.h: the rc word's low 32 bits are the count; class-id in the high half; immortal/published/compact/frozen states already
  partition the word. A1 adds no new rc state (young-ness is in the cycle header: `gen`/`buf`), so it does not touch the inline fast path.
  A2 would need a new state and an inline-check change.
- scr_cycle.c: SCR_YIN code is the base; trial deletion's nursery generation receives survivors; the "survivors that are roots become
  candidates as promoted" rule makes garbage that forms later still detectable. Extending young membership to dyn nodes requires the dyn
  trace function (the same one the collector already uses) to be correct about "exactly the counted references to headered children".
- scr_json.c: dyn nodes come from `scr_dyn_alloc` pooled free lists; a young set needs either a per-chunk bit or a header flag. Chunks
  where all objects are young could be recycled whole after a sweep that frees everything (a bump arena in practice).
- Threads: nurseries are per thread; objects reaching other threads are published (immortal) and exit the young set.

### 3.4 Which allocations stay arena-local (reasoned from what the objects are)
Per request: ~175 allocations, ~159 frees. (The 16-object gap is itself a lead: in steady state allocations and frees must balance, so
either the counters count different things, or about 16 objects per request are retained, which would be a leak worth checking before
building anything.)
| Object class | Approx. count | Local to a request? | Notes |
|---|---|---|---|
| Closures (rxjs operator callbacks, subscribe observers, Nest per-call lambdas, errorContext wrappers) | 76 | ~90% | they capture `this` of per-request subscribers; die when the subscription completes; cyclic with subscriber -> nursery pass is ideal |
| rxjs Subscriber/Subscription/OperatorSubscriber objects, teardown arrays | 15-25 | ~95% | cycles via closures capturing `this` |
| Promise objects, reactions, capsules | 10-15 | ~90% | reactions are held by promises until settled |
| Request/response wrappers, headers object, params/query objects | 10-15 | ~70% | referenced by the native HTTP connection until response is sent; local after |
| JSON result object, serialised strings, response buffers | 10-15 | ~80% | strings are separate counted nodes; the string handed to the socket is released after write |
| Boxes (NUM cells, capture boxes) | 15-25 | ~85% | |
| Escaping: caches, WeakMap entries, per-route memo, loggers, metrics, error stacks | ~10-15 | no | |
Estimate: **~140-150 of 175 (80-85%) allocations and ~125-135 of 159 frees stay local**, i.e. about 100-110 objects per request would
never touch the general pool or Bacon-Rajan buffer in a nursery design. The other ~25-35 are promoted by the sweep and become
ordinary objects.

### 3.5 Expected saving per request
Budget (rough data): refcount/dispose ~64k, allocation 37-53k, cycle collector 22-32k.
| Item | Estimate |
|---|---|
| Cycle collector: no candidate buffering for local objects (~200-300 non-final releases at 30-60 instr, avoided), nursery sweeps replace trial-deletion walks | 12-20k |
| Allocation: bump/slab instead of pool free lists + separate entry malloc, for ~100-110 local objects at ~60-100 instr saved | 8-14k |
| Dispose chains for objects the sweep frees in bulk (dead cycles only; acyclic garbage still disposes by count) | 3-6k |
| **A1 total** | **25-35k (10-13% of 263k)** |
| A2 (barrier-based RC elision on proven-local sites): ~60% of 64k RC work | +30-45k |
| **A1+A2** | **55-80k (21-30%)**, optimistic and high risk |
A1's cost: the sweep itself (linear in nursery size, ~20-30 instr per young object for the count-and-mark pass: ~3-5k per request amortised over a
batch). Net in the table above is after that deduction.

### 3.6 Correctness hazards
1. Dyn trace completeness: every counted reference from a young node must be visited by the nursery trace, or an externally-held-looking
   object is wrongly freed. The same invariant trial deletion already depends on; add a debug lane that cross-checks the nursery sweep
   against a full collection (as `SCR_JS_VERIFY` does for ICs).
2. Native owners: sockets, fibers, coroutine frames hold counted references; they count as "outside" automatically (count > young-internal).
   Fine as long as they hold counts, which the model already requires.
3. Finalization order and `WeakRef`/`FinalizationRegistry`/WeakMap clearing at sweep time: same timing class as the existing collector.
4. Nursery sized too small or too large: too small promotes request-spanning objects early (wasted sweeps), too large hurts cache.
   Tune as a function of live requests per tick (~57 under load).
5. A2 only: missed barrier site = use-after-free; mis-converted counts = leak or premature free. No ASan lane catches a missing barrier
   until the escape happens, so it needs a store-site coverage audit and a stress mode that forces every local object to escape.

### 3.7 Staged landing plan
1. **Measure the existing nursery (days).** Run examples/nestjs with `SCRIPTC_YOUNG_NURSERY=1` and compare instructions per request.
   Expect little, because dyn nodes are not young; the delta and the SCR_STATS counts give the baseline. Also resolve the 175 vs 159
   alloc/free gap.
2. **Extend young membership to ScrDyn OBJ/ARR/closure/promise nodes** behind the same env flag (scr_alloc.c, scr_json.c allocation helpers,
   scr_cycle.c trace for dyn kinds). Measurable: instructions per request, cycle-collector instruction share (target 22-32k -> under 12k),
   RC audit and collector-stress lanes green.
3. **Batch checkpoint** at end of an event-loop tick that handled requests (scr_loop / scr_http entry points) instead of size-only trigger;
   add slab-chunk recycling when a sweep frees a whole chunk.
4. **Default on** after two weeks on the differential corpus and the Nest/Express benchmarks.
5. **A2 only if** steps 1-4 leave RC+dispose above ~20% of instructions; start with the static tier (stack-objects.ts has the analysis)
   and one dyn site class (rxjs subscribers) behind a flag.

### 3.8 Risk
A1 low-medium: it reuses an existing, tested algorithm and soundness rests on the invariants already required. A2 very high.

## 4. Recommendation and the ceiling

### 4.1 Build order after PGO speculation
1. **A1 (counted request/tick nursery for dyn nodes).** Largest first-version saving (25-35k vs 6-10k), independent of PGO (no overlap
   with guarded fast paths), no new unsoundness, and the algorithm already exists. It also gives the measurement (step 1) the other
   dyn work needs.
2. **S0 (mutable tenure at listen).** Cheap, mostly runtime, complements A1 (long-lived objects leave the counted world, short-lived ones
   use the nursery). Do the "how many operations touch pre-listen objects" measurement first.
3. S1 only if PGO traces show guard/probe cost still above ~15% and image receivers dominate. S2 and A2 are research.

### 4.2 Can the combination reach 2x faster than Node?
No, and the arithmetic is not close.
- Instruction budget: Node is ~120k per request. Even a perfect Nest layer cannot go below the HTTP layer. Native bare `node:http`
  measured 142k req/s versus Node's 81k on one pinned core (nest-native-profile.md), i.e. ~1.75x. Node running Nest on that setup is
  ~79k req/s, so Nest costs Node almost nothing beyond bare HTTP, and **2x Node on that setup is ~158k req/s, above native's bare-HTTP
  ceiling of 142k**. On the bench-final setup (Node 95k req/s, native 25.5k), 2x is 190k req/s, which is 1.3x above that bare ceiling.
  The ceiling for "native Nest" with Nest costing zero is ~1.8x Node.
- Realistic stack of savings on 263k (multiplicative, with overlap): PGO speculation -15..-25% (about 200-225k), A1 -10..-13%,
  S0/S1 net -3..-8%, plus the dyn-tier plan A-F in dyn-tier-design.md (-20..-30%, overlapping). That gives roughly **140-190k
  instructions per request**, parity to 1.5x worse than Node in instructions.
- Instructions understate the gap: bench-final shows native at 0.27x Node req/s while instructions are ~0.46x (120k/263k), so native
  runs at a lower IPC (the 120-byte ScrDyn plus 48-byte entries, RC stores dirtying lines, kernel fiber stack mmap/munmap before the pool
  fix). The memory-footprint work (A1 slab locality, S0 no RC writes on shared objects) helps IPC, but equal IPC is the best case.
- Honest outcome: 0.6x to 1.0x Node req/s from PGO + A1 + S0 + the remaining dyn-tier work; about 1.0x to 1.3x if rxjs and the Nest request
  path get compiled from typed sources (the 1.3-2x on the rxjs half in nest-native-profile.md, option 2) and S2 inlines the fixed pipeline.
  2x would require removing rxjs and most of Nest's dynamic dispatch from the request path entirely (a specialised request pipeline
  generated from the snapshot, i.e. S2 at its most aggressive) AND winning on the HTTP layer; probability under 5%.
- Also note the benchmark itself: report requests per second per core and instructions per request together; the 81k vs 95k Node numbers
  differ between notes (pinning to one core vs four), so the 2x target should be defined on one setup before any claim.

### 4.3 Summary of risk and effort
| Step | Effort | Risk | Saving (instr/request) |
|---|---|---|---|
| A1 nursery for dyn nodes | 3-5 weeks | low-medium | 25-35k |
| S0 mutable tenure | 1-2 weeks | low-medium | 6-10k |
| S1 snapshot facts (after PGO) | 2-4 weeks | medium | 6-12k net of PGO |
| S2 points-to over image | 8+ weeks | high | 25-50k, speculative |
| A2 barrier RC elision | 8+ weeks | very high | 30-45k, speculative |

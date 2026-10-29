# Compiled NestJS vs Node NestJS: findings, experiments and proposal (2026-10-27)

**Goal:** compiled NestJS (`examples/nestjs`, `GET /hello/native`) is faster than the same NestJS app running on Node. Only Nest vs Nest counts.

**Primary metric:** callgrind instructions per request, measured in the container `scriptc-legacy-gate`. The host is too loaded for stable req/s numbers, and `perf` is blocked by `perf_event_paranoid=4`.

**Supporting metrics:**
- per-request runtime counters (`SCRIPTC_RUNTIME_STATS=1`, `bench/counters.mjs`);
- req/s from `bench/run.mjs`, which interleaves runs ABAB, warms up, checks the responses are equal, and reports the IQR and CPU µs per request.

## 1. Where we are

| Build | Instructions per request |
|---|---:|
| Compiled Nest, start of the work | 336k |
| Compiled Nest from JS (default lane), now | ~255–265k |
| Compiled Nest, with Nest and RxJS compiled from their TypeScript sources (TS lane), now | ~200–220k |
| Node Nest | ~120k |

- Measurements drifted by ±20k as agents rebuilt the shared runtime pack mid-run. Each experiment's own before/after delta was measured on a single pack and is reliable. The absolute numbers above need one clean re-measurement, which is planned for the PR.
- **req/s, last reliable comparison:** Node ~84k vs native ~30k at 336k instructions. Native bare `node:http` is faster than Node (142k vs 81k req/s), so the entire gap is in Nest, RxJS and the dynamic tier.
- **IPC gap:** native runs at a lower instructions-per-cycle than Node, because of large dyn cells, refcount stores dirtying cache lines, and so on. Equal instruction counts would therefore still not mean equal req/s.

## 2. Experiments

### Kept

| Change | Effect |
|---|---|
| Inline caches: multi-link prototype chain (up to 8 links), shape append, interned key atoms, dispose fast path, URL base cache, freelists | 336k → ~263k |
| Skip erased generic families in direct destroy | Fixed a leak (corpus 8500); RSS flat over 300k requests |
| Embed immutable closure captures in the closure allocation; keep never-captured locals unboxed | −3.2% (89 → 37 capture boxes per request) |
| LLVM profile-guided optimisation (existing `--profile-generate`/`--profile-use`) | −1.5% |
| **Compile Nest and RxJS from their TypeScript sources** | −10%, binary 29.8 → 25.0 MB, untyped functions 2170 → 657 |
| Capsule-key ladder: switch on class-key length instead of ~300 sequential tests | −5.7% (TS lane) |
| Typed property-bag creation in superclass constructors, plus a cheap own-property probe for instance-assigned methods (`this._subscribe = …`) | −6.7% (TS lane), capsules per request 87 → 67 |

### Rejected by measurement (reverted, kept as notes or patches)

| Experiment | Result | Why |
|---|---|---|
| `-O3`, `-march=x86-64-v3`, full LTO | ~0 | Already ThinLTO; the cost is in runtime work, not codegen |
| More inline-cache ways or inline slots | ~0 | 72% of sites are already monomorphic |
| JS-level type feedback / speculation (`.jsfb`) | −0.14% beyond LLVM PGO | Shapes are per-thread at runtime and can't be baked in; the ceiling was about 5–7% |
| Async destackling | −1–1.5% | Not the bottleneck |
| Dyn function node cache | ~0 | Only 6 of 76 nodes per request wrap immortal functions |
| Call-only escape analysis (stack closures) | −0.8% | Only ~9 of 52 closures per request never escape; RxJS stores the rest on subscribers. Patch: `call-only-stack-func/` |
| Reuse typed↔untyped wrappers (parked capsules) | **+19%** | Parked capsules pin objects, which doubles cycle-collector work. Only 36 of 87 crossings allocate |
| Typed union with class/closure/dyn arms (`TeardownLogic`) | −0.45% | Each wrap allocates a union box. Patch: `structural-arm-union.patch` |

## 3. Correctness work found on the way

Dependencies compiled from TS now follow TypeScript's erasure semantics. All fixes are generic, and each has a corpus or provenance-fixture test compared against Node:

- `x!` on a value that is really `undefined` keeps `undefined` (no trap).
- A `Proxy` value stays untyped.
- Optional body-less methods (`m?(): T`) are supported.
- `Iterable<void>` unions work.
- Generic instances are keyed by their bound types when a parameter is untyped. Before this fix, `innerFrom<string>` and `innerFrom<number>` shared one instance.
- `Array.isArray` works on a narrowed read.
- A runtime reverse enum lookup that misses returns `undefined`.
- `this.constructor` works, and so do `Promise.all` over iterables and enum reverse lookups.
- Generic subclasses without prototype data no longer miscompile (`_parentage.remove is not a function`; corpus 8524).
- A never-assigned string field reads `undefined`. An agent had substituted `""`; that was caught and reverted.
- `array-values.ts` no longer produces a null IR when the `undefined` hole can't be represented.
- Stale test oracle directories caused empty expected outputs (1977); fixed in `jsx-oracle.ts`.

**Still open (fix in progress):**
- a void-returning callback slot traps on a closure that returns a number;
- `lastValueFrom(defer(() => of('x')))` in the TS lane fails with "expected number, got string";
- `of(1, 2, 3)` picks the wrong overload;
- `typeof` reports "object" for a function with properties.

## 4. Tests and tooling added

- **Corpus programs:** 1978–1985 (decorators), 84xx–85xx (RxJS and Nest gaps), 8560–8569 (provenance and Proxy), 8600–8603, 8700–8701, 8800–8801 (captures and function identity), and the typed-capsule, instance-method-override, structural-union and capsule-ladder programs.
- **Provenance fixtures:** `tests/fixtures/provenance/cases/{asserted,inner}`, compared against Node.
- **Bench tooling:** `bench/run.mjs` (ABAB, warmup, CPU pinning, response-equality check, IQR, CPU µs per request) and `bench/counters.mjs` (per-request runtime counters).
- **Runtime stats build:** `SCRIPTC_RUNTIME_STATS=1` with `scr_stats.h`, zero-cost when off.
- **check:native:** compares the metadata, context and main outputs with Node, for both lanes.

## 5. What the profile says now (TS lane, ~235k at measurement time)

| Category | Share |
|---|---:|
| Untyped property access, typed↔untyped bridge, class-table helpers | 36% |
| Allocation, free, refcount | 27% |
| Cycle collector | 10% |
| Compiled RxJS code | 9% |
| Runtime other (arrays, maps, boxes) | 6% |
| HTTP and parsing | 4% |
| Promises and fibers | 3% |
| Nest router and interceptors | 2% |
| App code, strings, JSON | 3% |

**Conclusion:** compiled user and library code is only about 12% of the cost. The rest is runtime work from how untyped values are represented and managed: cells → entries → per-value heap cells, refcount on every handoff, cycle candidacy, and about 155 allocations per request. Point optimisations have hit diminishing returns: the last six experiments ranged from −6.7% to +19%.

## 6. Proposal: how to actually close the gap

Ranked by expected saving × confidence. Each step lands on its own, measured on one pinned runtime pack, and gated by the differential corpus (plain and SAN) plus collector-stress lanes.

### P0. Measurement discipline (1–2 days, prerequisite)
- A single script that builds both lanes and Node on a frozen runtime pack, and outputs instructions per request, allocations per request and req/s.
- Run it on a quiet machine. The Mac Studio needs `brew install llvm@22 cmake ninja zig`, or use a dedicated Linux core set.
- Define the target on one setup only: one server core, a fixed client.

### P1. Compact object representation (biggest lever, 3–5 weeks, medium risk) — about −40–60k
- Replace cell → 48-byte entries → per-value heap cell with **shape-owned key layout plus dense inline NaN-boxed slots**: immediates stored in the slot, no per-value cell. This is Hermes' hidden-class plus slot design (dyn-tier-design C2 and D).
- Object templates for literals and `create_this` caches, so a constructor allocates once with the final shape.
- Removes most of the "untyped property" and "allocation" buckets, and improves IPC (fewer cache lines touched per access).

### P2. Counted request nursery for dyn nodes and closures (3–5 weeks, low–medium risk) — about −25–35k
- Extend the existing young nursery to dyn objects and closures. Use bump allocation per request or tick, with no cycle-candidate registration for young objects, and promote survivors at the end of the tick (holy-grail-design A1).
- Keeps refcounts, so it's sound, but removes the cycle-collector bucket and most malloc/free cost.

### P3. Typed bridge without capsules (2–3 weeks, medium risk) — about −15–25k
- Today a typed class instance crossing into untyped code needs a capsule allocation plus a class-ladder lookup.
- Give every compiled class instance a header word that makes it directly a valid untyped value: NaN-boxed pointer with a class-id tag, read through the class's static shape.
- Removes `typed_ref_new` / `typed_ref_in` / `normalize` entirely, rather than caching them. That is why caching failed: the capsule should not exist at all.

### P4. Closed-world call resolution and inlining (4–8 weeks, medium–high risk) — about −15–30k
- With whole-program knowledge (the binary is closed-world), resolve the callee sets of untyped calls (Bun's flow analysis, dyn-tier-design E2), then inline guarded fast paths.
- This also makes escape analysis effective: after inlining RxJS's `subscribe`/`OperatorSubscriber` chain, most of its closures become local.

### P5. Tenure after bootstrap (1–2 weeks, low–medium risk) — about −6–10k
- At `listen()`, mark everything allocated during bootstrap as immortal: no refcount writes on shared singletons such as the router, the DI container and metadata (holy-grail-design S0).

### P6. Keep growing the typed share
- Compile from TS sources by default when a ≥95% TS twin is available (provenance is opt-in today).
- Close the remaining Nest and RxJS fences that the route doesn't reach yet.
- Every function moved from untyped to typed removes work from P1–P3's buckets.

### Expected outcome (honest)
- P1+P2+P3 together: roughly 200k → 110–140k instructions per request. That is parity with Node to slightly better, and req/s parity requires the IPC gains from P1 and P2 as well.
- P4 and P5 give a further 10–20%, so about 1.1–1.3× Node req/s is the realistic best case.
- **2× Node is not achievable on this benchmark.** Native bare `node:http` itself is only ~1.75× Node, and that is the ceiling even if Nest cost nothing.
- Cold start is where native already wins by a wide margin: 12–22 ms vs 140–225 ms.

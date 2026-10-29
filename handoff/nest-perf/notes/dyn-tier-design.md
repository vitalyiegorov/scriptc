# Dynamic-tier design proposal for scriptc (2026-10-26)

Inputs: Bun AOT (see bun-aot-research.md), Static Hermes (facebook/hermes static_h, sparse clone read: lib/BCGen/SH/SH.cpp, include/hermes/VM/static_h.h, PropertyCache.h,
HadesGC.h; clone deleted), scriptc worktree t3-ff1a7fe4 (runtime scr_dyn.h, scr_json.c, scr_js_object.c, scr_cycle.c, scr_dyn_invoke.c, scr_js.h;
compiler llvm/js-ic.ts, jsval.ts, borrowed-inputs.ts), and the earlier decorator-research-notes/nest-native-profile.md and bench-final.md.
All instruction-savings figures below are ESTIMATES from code reading, not measurements (perf is blocked: perf_event_paranoid=4, no valgrind).

## 1. What scriptc already has (so the proposal does not re-propose it)
- jsval: 64-bit NaN-boxed word (scr_js.h): doubles inline, undefined/null/bool immediates, tagged ScrDyn cell / ScrStr / ScrBigInt. Number arithmetic and compare are inlined in
  LLVM (jsval.ts, like Hermes' `_sh_ljs_add_rjs_inline`). 64-bit only.
- Hidden classes: `ScrJsShape` transition tree, per-thread, lazily derived from an object's key sequence; 4-way polymorphic IC records per site (`ScrJsIc`, 168 B), inline LLVM fast
  paths for own-property load, replace-store, dense-array keyed access (js-ic.ts). Everything else goes to `scr_js_get_probe/store_probe/keyed_probe/load_probe`.
- RC with pooled free lists for ARR/OBJ/misc nodes (scr_dyn_alloc), generational Bacon-Rajan cycle collector (nursery/mature/old), intact-parse-region exemption, opt-in
  `SCRIPTC_YOUNG_NURSERY`.
- Borrowed-argument analysis for runtime calls (borrowed-inputs.ts); class-check ladder and fiber-stack pool fixes already landed (bench-final: 25.5k req/s vs Node 95k, 0.27x).

## 2. Where scriptc's dynamic tier still differs from Hermes / Bun AOT / JSC (the gap)
| aspect | Hermes (static_h) | Bun AOT | scriptc dyn tier today |
|---|---|---|---|
| object layout | class (shape) owns keys; object = header + value slots (inline slots + overflow) | fixed-layout fields, 16 B header, 32-bit refs | `ScrDyn` is 120 B (rc, kind, flags, 64 B union, prototype, 2 symbol ptrs) + separately malloc'd `ScrDynEntry[]`, 48 B/entry, each carrying its own key pointer, len, getter, setter, attrs; shape is a side annotation |
| values in objects | NaN-boxed HermesValue in slot (numbers inline) | raw Int32/Double fields where proven | `ScrDyn*` cell: every number/bool stored in an object or array is a heap NUM box (pooled but refcounted) |
| property add | write cache: (old class -> new class) cached per site (`WritePropertyCacheEntry` add cache index), `create_this` has a per-site class cache | layout fixed at allocation | `scr_js_transition` re-hashes key on every add (profile: 2.1% self); `scr_dyn_find_linear_entry` 1.1%; key_copy |
| prototype/method hit | cached | method table / direct call when proven | inline path covers own props only; prototype hits, absent keys, polymorphism all call a probe |
| calls | generic frame-based `_sh_ljs_call` | direct calls from whole-program flow analysis | `scr_dyn_invoke*` : this-stack push, arg array, thunk with per-arg dynCheck, boxed result (41 / request) |
| memory mgmt | no RC; bump-allocated young gen (Hades, evacuating) | JSC generational GC | RC on every cell + cycle candidates; dispose path per object |
| whole-program | no | yes (flow analysis, closed world) | per-function tiering; no cross-function value flow for dyn values |

Hermes verified points: `_sh_ljs_get_by_id_rjs_inline` = tag test + class pointer compare + `_sh_prload_inline(slot)`, miss -> out-of-line call; add/sub/less inline when both are
non-NaN numbers; NaN-box tags 0xf9..; Hades young gen "single contiguous-allocation space" with bump `level_` in AlignedHeapSegment, old gen freelist; Hermes does NOT inline calls
or do speculation — it relies on class caches plus a cheap runtime. Static Hermes without types measures poorly in js-compiled (fib 2.3 s vs node 0.69 s), so cache-in-C alone is not enough;
scriptc already exceeds it. The Bun lesson: with no profile and the best backend available, untyped npm code still loses 7-23% warm to a JIT.

## 3. What the counters say (per NestJS request, ~310k instructions)
~200 allocations, ~608 `scr_dyn_release`, ~140 property probes, ~41 dyn invokes. Rough cost model (estimates): non-final release of OBJ/ARR (calls `scr_cyc_released`) 30-60 instr;
final release + `scr_dyn_dispose` 200-350; alloc+init 100-150; probe 60-150; invoke 600-1000. That attributes only ~130-140k of 310k (about 45%); the other ~170k is compiled JS bodies,
closures/promises, strings, HTTP, kernel-free user code. Consequence: even a perfect dyn-op rewrite caps near -45%; reaching Node's ~4x lower cost needs fewer dyn ops, i.e. types
(.d.ts/full-types, TS sources of rxjs) and whole-program call resolution, not only cheaper ops. Step 0 below exists to replace these guesses.

## 4. Proposal, ranked by (expected saving x confidence) / risk

### Step 0 (prerequisite): make every later step measurable
- Runtime: extend `SCR_STATS` (scr_stats.h already splits dyn_alloc_object/array/closure/string/box, dyn_rc_zero, dyn_alloc_fresh) with: cyc_released_calls, probe calls per kind
  (get/store/keyed/load, by miss reason: proto-hit, absent, polymorphic, dictionary), invoke calls by path, NUM boxes allocated, transition hashes. Dump at exit with `SCR_STATS_JSON=path`.
- Instructions: get `perf stat -e instructions:u` by lowering perf_event_paranoid (owner action) or run in a VM/container with CAP_PERFMON; otherwise count with a fixed-request replay under `gdb`/uftrace.
  Pass criterion for every step: instructions/request (50k-request run, median of 5) down, differential corpus green, `SCRIPTC_JS_IC_WAYS=0` + `-DSCR_JS_VERIFY` lanes green.
- Savings: none (enabler). Risk: none.

### A. Inline the remaining IC cases in LLVM (prototype/method hits, add)  -- compiler only
- Files: `backend/llvm/js-ic.ts`, `ir/js-ic.ts`, `scr_js_object.c` (IC entry layout already has `holder`, `holder_shape`, `slot`).
- Sketch: after the own-property shape compare fails, test entry 0's `holder != NULL` case inline: `holder->shape == entry.holder_shape` (chain length 1) && receiver prototype ptr == cached
  proto, then load `holder->entries[slot].value` (retain as today). Absent-key case (typeof checks, `x.optional`): receiver shape == cached && chain-shape epoch unchanged -> undefined.
  Store add: add-IC `(shape_in -> shape_out, key ptr)` inline: append entry in place when `len < cap`, write key pointer from IC, bump len, store `shape_out` (replaces
  `scr_js_transition` rehash). Fallback is the existing probe, so semantics stay defined in one place.
- Saving: of 140 probes, assume ~100 are proto/absent/add hits at ~70 instr saved each = ~7k, plus transitions ~5k => **~10-14k (3-4.5%)**.
- Risk: low (guarded, falls back; ICs are never patched). Needs a prototype-mutation epoch or per-holder shape check to stay sound; the current probe logic is the oracle.

### B. Cut refcount/cycle-candidate work on survivors and borrowed values
- (B1) "no container edge" bit: a ScrDyn OBJ/ARR whose slots have only held immediates/strings/NUM cells can never be on a cycle. Keep a bit set by the store paths (inline IC store knows
  the value tag: one OR; runtime stores set it conservatively on any cell/func/capsule store). `scr_dyn_release`/`scr_dyn_release_survivor` skip `scr_cyc_released` when clear.
  Files: scr_dyn.h (flag in the header padding next to `non_extensible`), scr_json.c store sites (`scr_dyn_obj_set*`, array push/set; grep the 12 SHAPE_RESET sites, the same set that must
  maintain shapes), js-ic.ts store path, scr_cycle.c.
- (B2) extend `borrowed-inputs.ts` logic to dynamic-tier jsval calls and IC reads: `%dyn.class.property`-style retain+release pairs around a single read disappear when the receiver is an
  unchanged local (existing `canBorrowReceiver`). Profile already named this pair.
- (B3) weak-key header bit instead of `scr_weak_disposed` hash lookup on every free (partly in flight: commits #2201 "Skip NULL children and key-cache walks when disposing dynamic values").
- (B4) evaluate flipping `SCRIPTC_YOUNG_NURSERY` on by default (already exists; pure measurement).
- Saving: assume 608 releases -> ~380 after B2, and ~40% of survivor releases skip the cyc call: ~230 x 35 + ~150 x 40 = **~12-18k (4-6%)**; B3 another ~1-2% (profile: 2.0% self before the fix).
- Risk: medium. Invariants (docs/memory: every strong ref counted, unlink-before-release) must hold; B1 is the dangerous one (a missed store site = leaked cycle, not a crash; add a
  `SCR_JS_VERIFY`-style assert that scans on collection).

### C. Immediates inside object/array slots + immortal small-number cells
- C1 (low risk, first): preallocate immortal NUM cells (rc = SIZE_MAX) for int32 -1..1023, 0, -0, 0.5? and ensure true/false/null/undefined boxes are the existing immortals; `scr_dyn_new_num`
  and the jsval->cell boxing path look up the table before allocating. Release then early-outs on the existing `rc == SIZE_MAX` test.
- C2 (high risk, only if Step 0 shows NUM boxes are a large share of the 200 allocs): let `ScrDynEntry.value` / `arr.items[i]` hold a jsval word (same tagging as scr_js.h: pointer high bits
  0 for legacy cells, 0xFFFA cells, doubles inline), with `scr_dyn_entry_value()` accessors that box on demand for the static tier and shared runtime. Static-tier readers use entry stride 48 / value
  offset 16 (static asserts in scr_dyn.h), so the layout stays and only the *meaning* of the word widens; every reader in scr_json.c (19k lines) and the LLVM "checked-object readers"
  must go through the accessor. Hermes and JSC both keep numbers inline in slots; this is the single largest representation difference.
- Saving: C1 ~ (assume 30 of the 200 allocs are small ints / flags) 30 x (120 alloc + 60 free) = **~5k (1.5-2%)**; C2 (assume 100 boxes avoided) = **~18-25k (6-8%)**, plus shrinking GC
  pressure and cache misses.
- Risk: C1 low; C2 high (wide blast radius) — do last among the representation changes, behind a runtime-feature flag with dual-run differential lanes.

### D. Object templates and compact layout for shaped objects
- Object literals and `new C()` bodies in dyn tier add a fixed key sequence. Emit, per site, a template `(final_shape, key pointers[])`: allocate the entries array pre-keyed with one memcpy, then
  write values straight into slots (no per-add transition, no `scr_dyn_key_copy`, `len` set once). This is Hermes' literal key buffer + `create_this` class cache (`classCacheEntry`).
  Files: `scr_dyn.h` (`scr_dyn_new_obj_template`), `scr_json.c`/`scr_js_object.c`, js-ic.ts (site template record), constructor lowering (`class-construction.ts`).
- Medium term (optional): a `SCR_DYN_OBJ` "compact" form where keys/attributes live only in the shape and entries shrink to 8 B slots (6x smaller than 48 B/entry, like Hermes/JSC). Needs a
  lazily materialized `ScrDynEntry[]` view for the static tier; do not start before C2 since both touch every entry reader.
- Saving: template alloc removes ~k adds x (hash + key_copy + realloc check) ~ 120 instr; assume ~120 object adds/request => **~10-14k (3-4.5%)** and cheaper disposal (`drop_keys` skipped for
  template objects). Risk: medium (key-lifetime accounting in `scr_dyn_cached_key_bytes`).

### E. Direct/cached calls for dyn invokes (Bun's flow analysis, scoped to what scriptc can prove)
- E1 call-site IC: cache the callee closure's code pointer + arity at the site (like the shape IC) and call a jsval-ABI entry of the callee, skipping `scr_dyn_this_push`, arg-array building and the
  per-arg `dynCheck` thunk when the callee is a dynamic-tier function (its params are already dyn). Files: `expr-dynamic.ts` (dynInvoke), `lib-dispatch.ts`, `scr_dyn_invoke.c`, closure descriptor gets a
  `jsval_entry` pointer.
- E2 whole-program resolution (Bun valueflow analogue): 0-CFA over function values / module exports / class prototypes in the IR; where the callee set is a singleton, call `%fn.hash` directly
  with jsval args (LLVM can then inline small rxjs/Nest helpers and drop boxing). Closed-world is plausible because scriptc is already AOT, but `fn.call/apply/bind`, `Function.prototype` mutation and
  `require()` of computed paths must stay on the generic path (Bun forbids builtin patching; scriptc may need the same switch, `--closed-world`, off by default).
- Saving: 41 invokes x ~500 saved x ~60% eligible = ~12k, plus argument/result box allocations avoided (~30-40 allocs) ~5k => **~15-20k (5-6.5%)** for E1; E2 adds more but is the
  largest-effort item (weeks). Risk: E1 low-medium; E2 medium-high.

### F. Runtime bitcode inlining (ThinLTO-style) for hot fast paths
- The runtime pack already ships per-unit LLVM bitcode (`runtime-pack-core.ts`, `bitcode` variant) "imported by the helper for inlining". Widen the set of importable functions to the dyn fast paths:
  `scr_dyn_retain/release` fast halves, `scr_dyn_leaf_alloc`, `scr_dyn_this_push/pop`, `scr_key_equal`, entry find, jsval box/unbox helpers, so -O2 can inline and CSE them in compiled code.
- Saving: removes call/ret + spills on ~800 hot calls x ~8 = **~6-10k (2-3%)**. Risk: low; cost is compile time and binary size (watch the 0.2-0.6 s compile and 0.1-0.3 MB size wins in js-compiled).

### G. Profile-guided hints (not full speculation)
- A training run (`scriptc build --profile-gen`, replay N requests) records per-site: observed shape key sequences (as key strings, not pointers), callee identities, hotness. `--profile-use`
  pre-seeds ICs, orders ICs ways, builds templates for D, chooses E1 call targets, marks cold functions `cold`/`minsize` and hot loops for inlining. Because scriptc's ICs already fill themselves at run
  time and fall back to correct probes, there is no deopt machinery to build; the gain is warm-up and layout, not peak. Bun's result (no profile, loses warm) says this is where the last 5-10% on
  untyped code lives.
- Saving: **~3-6% steady-state, larger on short-lived processes/CLIs**. Risk: low correctness (hints only), medium tooling.

### H. Young-generation bump allocation / deferred RC (stretch, not recommended yet)
- Hades/JSC get cheap allocation and free dead objects at zero cost via bump + evacuation. For scriptc that means no per-object RC or dispose for young dyn objects — deferred/coalesced RC
  (Ulterior RC / LXR style): refcounts only on old objects, young objects found by a tracing nursery scan from the stack, runtime-held roots, and the remembered set (write barrier on stores into
  old objects). scriptc's pooled free lists already make alloc roughly 100 instr, and native handles (sockets, fibers, typed refs) plus the static tier's RC contract (`every strong ref counted`)
  cross this boundary everywhere, so a tracing young gen needs precise root maps for compiled frames. The pragmatic subset: size-class slabs with the entries inline (header + 4 slots) to remove the second
  malloc/pool and `drop_keys`, bump-refill from 64 KB slabs, keep RC. Saving **~8-12k (3-4%)** for the subset; a full young-gen redesign could save 25-35% of the alloc/release budget but is a rewrite of the
  memory model docs and every native-handle owner. Risk: very high. Revisit only if A-F land and Step 0 still shows alloc+dispose >25%.

## 5. Incremental landing order (each step: land, measure instr/request, differential corpus + IC-ways=0 + SCR_JS_VERIFY + collector-stress lanes green)
| # | step | est. saved instr/req (of ~310k) | cumulative | risk |
|---|---|---|---|---|
| 0 | counters + instruction measurement harness | - | - | none |
| 1 | A: inline proto/absent/add IC cases | 10-14k | ~3-4.5% | low |
| 2 | C1 immortal small numbers + B3 weak-key bit + B4 nursery flag measurement | 6-8k | ~5.5-7% | low |
| 3 | F: widen runtime bitcode inlining | 6-10k | ~8-10% | low |
| 4 | B2 borrowed jsval receivers/args in dyn tier | 6-9k | ~10-13% | medium |
| 5 | B1 no-container-edge bit | 6-9k | ~12-16% | medium |
| 6 | E1 call-site IC + jsval entry points | 15-20k | ~17-22% | low-medium |
| 7 | D object templates / create_this class cache | 10-14k | ~20-26% | medium |
| 8 | G profile-guided hints | 9-18k | ~23-32% | low/medium |
| 9 | C2 immediates in slots (flagged, dual-run) | 18-25k | ~29-40% | high |
| 10 | E2 whole-program call resolution / closed-world mode | 15-30k | ~34-49% | medium-high |
| - | H bump/deferred-RC (only if still alloc-bound) | 8-12k (subset) | - | very high |
Percentages overlap (shared work removed twice), so treat the cumulative column as an upper envelope; realistic landing of 1-8 is -20% to -28% instructions (310k -> ~225-250k).

## 6. Honest ceiling and what to do beyond dyn-op tuning
- The js-compiled leaderboard says scriptc is already the best of the field on typed/static code (11 of 22 fixture wins, smallest binaries and RSS) and weakest on JSON, closures, generators, i.e.
  runtime-library/dyn-heavy paths — consistent with the dyn-tier tax. Bun AOT, with a full JSC backend, still loses 7-23% warm on Koa/Express/Fastify; its advertised remedy is types.
- So the largest lever for NestJS-class apps is shrinking the amount of code in the dynamic tier: honor shipped `.d.ts` (or a `full-types` style condition) for npm packages, resolve rxjs `es2015`
  classes (real classes instead of ES5 `__extends`), and compile TS sources where available (nest-native-profile.md: rxjs from src 1.5-2x on its half). Those compound with E2 (known callee sets).
- Do not copy from Hermes: its slow-path-in-C design is already matched; do not copy from Bun: JIT-less speculation/deopt machinery is unnecessary because scriptc's probe fallbacks are the generic path.
  Do copy from Hermes: shape-owned key layout + literal/create_this caches + write-add caches (D, A). Do copy from Bun: closed-world whole-program flow for call resolution (E2) and
  inline-slot representations (C2), plus its "report the split" UX (e.g. a compile-time line: % dyn property accesses free/tested/by name).

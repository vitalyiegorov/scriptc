# Handoff: legacy decorators, native NestJS, and the Nest-vs-Node performance work (2026-10-29)

All work is on the fork `vitalyiegorov/scriptc`. Nothing has been opened as a PR against `vercel-labs/scriptc`.

## Branches

| Branch | Base | State |
|---|---|---|
| `t3/ff1a7fe4` | upstream `edae63752` | **Main line.** `a27cd8ea6` is the WIP checkpoint: decorators, examples/nestjs, provenance TS lane, dyn-tier perf, ~40 bug fixes; it passed lint, format and typecheck and was nearly green in plain CI (open items below). The next commit is an **unfinished** fix for unsound covariant overrides, plus this handoff folder. |
| `perf/p5-tenure` | `a27cd8ea6` | **Kept, ready to merge after 2 fixes.** It tenures the long-lived heap at the first event-loop idle, for −2.9% instructions per request on the default lane and −2.5% on the TS lane, with flat RSS. 419/419 focused differential tests pass, plain and SAN. |
| `perf/p3-capsules` | `a27cd8ea6` | Capsule counters and census, plus `aef8fc43d`: it answers record field reads from the native record and caches class-capsule key hits. **Not measured or gated**; it was stopped mid-run. |
| `perf/p1-closure-func` | `a27cd8ea6` | Census counters plus `c4ca65082`: the closure layout carries a ScrDyn FUNC header, **with the merge disabled**. Unfinished and not gated. |
| `perf/p2-bench-tooling` | `a27cd8ea6` | Bench tooling only (a source-runtime callgrind mode). The nursery experiment itself was rejected; it is in `experiments/`. |

## Open items on the main line (in order)

1. **Covariant override (unfinished commit).** `lower-classes.ts` accepts an override whose parameter narrows to a subclass (corpus 8490 needs this). Passing a base-class value through the base signature aborts natively, where Node prints `undefined`. The work in progress is in `lower-classes.ts`, `lowerer.ts`, `property-access.ts` and `type-mapper.ts`, with repro `tests/corpus/8492-override-narrowed-param-base-value.ts`. Verify it compiles and passes before building on it.
2. **The full SAN suite was never run** to completion on the checkpoint.
3. **The plain "cost-balanced" test group** (about 330 compiler unit-test files) was killed before it finished once; rerun it.
4. **Known environment failure:** `5963-date-to-string` fails in the `scriptc-legacy-validation` image because that image lacks tzdata (US/Pacific).
5. **The wasm-library three.js release tests** time out at 300 s on a loaded host and pass in isolation.
6. **Before merging P5:**
   - (a) A `publish()` to workers after tenure is unguarded, so a tenured mutable object could be shared by pointer. The compiler needs to emit a flag, or publish needs a guard.
   - (b) Tenure is compiled out under `SCR_RC_AUDIT`, so the SAN lane doesn't exercise it. Add a SAN mode that does.
7. **Then:** PR review and simplification rounds, a Codex review, one clean benchmark on a quiet machine, and the PR against upstream.

## How to measure

```
# once, on a host with network:
node examples/nestjs/bench/measure.mjs --prime-provenance --provenance-cache ~/.cache/scriptc/provenance
# per worktree (needs pnpm install, compiler dist, runtime pack, packages/llvm-linux-x64-gnu/bin/scriptc-llvm-codegen):
node examples/nestjs/bench/measure-docker.mjs --lane both --provenance-cache ~/.cache/scriptc/provenance --out result.json
```

- **What it measures:** instructions per request under callgrind; use only our own before/after. Node under callgrind isn't comparable, because V8's JIT is barely warm. Compare against Node with req/s and CPU µs per request from `bench/run.mjs`, on a quiet machine.
- **Baselines at `a27cd8ea6`:** default lane about 254–256k, TS lane about 206–222k. The TS-lane number varies with how the runtime pack was built, so always measure your own baseline in the same worktree.
- **Docker image:** `bench/Dockerfile.measure` (valgrind). Only `scriptc-legacy-validation:local` exists locally; rebuild it from the repo's docker setup.

## Findings (details in `notes/SUMMARY.md` and `notes/ts-lane-profile.md`)

- **Progress:** 336k → about 206–222k instructions per request (TS lane); Node is about 120k (perf, not callgrind). Native bare `node:http` is already faster than Node, so the gap is all Nest, RxJS and the dynamic tier.
- **Where the cost is:** compiled Nest and RxJS code is only about 12% of it. The rest is the runtime: untyped property access and typed↔dyn capsules (36%), allocation and refcount (27%), and the cycle collector (10%).
- **Rejected by measurement:** LLVM flags, more IC ways, JS type-feedback speculation, async destackling, a dyn function-node cache, call-only escape analysis, a capsule cache (+19%), a structural-arm union, compact NaN-boxed slots (P1 census: immediates are already immortal, so nothing to gain), and a request nursery (P2: neutral to +1.2%).
- **Remaining levers:**
  - typed-ref capsules and materialize, about 8–14% (P3);
  - closure-as-dyn-function, about 3–4% (P1);
  - tenure, −2.5–2.9% (P5, done).
- **Ceiling:** realistically about parity with Node, not 2×. Cold start already wins: 12–22 ms vs 140–225 ms.

## Folder contents

- `notes/`: all research notes (SUMMARY.md, ts-lane-profile.md, dyn-tier-design.md, holy-grail-design.md, codex-review.md, bun-aot-research.md, census files, the baseline JSON) and the saved patches of reverted experiments (`call-only-stack-func/`, `structural-arm-union.patch`).
- `experiments/`: the P2 nursery patch (rejected; includes a fix for a stale buffered-bit hang) and the P5 survivor-roots patch (unverified).
- `data/`: the raw measurement JSONs from P1, P2 and P5.

Delete this folder before opening the upstream PR.

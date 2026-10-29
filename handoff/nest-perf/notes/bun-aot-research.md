# Bun AOT (oven-sh/bun#45631) and the js-compiled leaderboard (research notes, 2026-10-26)

Sources: `gh pr view 45631 -R oven-sh/bun` (body; the diff is 15,777 files / +2.09M lines and was NOT read in full),
`gh pr view 757 -R oven-sh/WebKit` (engine half, body), jlucaso1/js-compiled README + published report
(https://jlucaso1.github.io/js-compiled/, run 2026-10-26, commit 418fda4, AMD EPYC 7763 4 threads).
The optional preview-binary run (task 3) was NOT done.

## 1. Bun AOT design
- Draft PR, experimental, `bun build --compile --aot` (`bun compile app.ts`). Executable = copy of `bun` + a machine-code image. No JIT in the
  process (`prctl(PR_SET_MDWE)` on Linux >= 6.7). eval/new Function/node:vm run in JSC's interpreter in the same process.
- Reuses JSC's backend offline, yes: WebKit PR #757 adds `aot/` to JavaScriptCore. Pipeline: Bun front end (Rust) walks imports, parses once,
  runs its own TS checker (TS7-compatible, `src/sema`), lowers syntax tree + types to an SSA IR (`src/aot/lower`), links the whole program,
  and hands it to `AOT::compileProgram()`. JSC then does whole-program flow analysis, IR passes, "place/select/represent", IR -> **B3 -> Air -> machine
  code** (B3/Air given a `B3::Policy` of switches), then image layout, ICF, outlining. It does NOT use DFG/FTL and not bytecode:
  "No function is compiled from bytecode. The interpreter is never a fallback: a function the build saw and can't compile is a build error."
- No type feedback at all: "no profile, no heap snapshot, none of the program runs at build time". Hotness is estimated from loops and the call graph.
  Replacement for speculation:
  1. TS types are *predictions*, not facts, for values the program is given (args from unseen callers, JSON.parse, any, as, !, .d.ts). They are tested
     once at function entry; a failed test continues in a generic ("slow") version of the same function (`add-generic-version` pass), no throw, no conversion.
  2. For values the program makes (`new Vec`, typed object literals) the type is a fact -> fixed layout.
  3. Whole-program flow analysis (`valueflow/`): which allocation sites, closures, builtins and constants reach each position. Closed-world assumption:
     a program with no eval/new Function is "closed", so every caller of a function is known, calls become direct, guards disappear, unreachable code is not compiled.
  4. Each property access ends up free (one load, proven), tested (shape test then load, slow path on miss) or by name (shared stub probing per-VM tables, a cache).
- Value representation: per-value choice of `Int32`, `Double`, `Cell32` or full `JSValue` (unboxed raw numbers in fields).
- Object model: 16-byte header (JSCell 8 + 32-bit order word + 32-bit shape word) then fixed-layout fields (raw Int32/Double/Boolean, 32-bit Cell32 refs,
  JSValue). No butterfly. Classes/literals/object types get compiler-fixed layouts; `delete`, redefinition, unrepresentable store -> that one property moves to a side object.
  An `AOT::Object` is still a `JSObject` (method-table override) so the rest of JSC works. Heap uses a 32 GB cage so refs are 32 bits (`--aot-huge-heap` lifts it).
- GC: JSC's existing generational collector (marking loop given inline cell visits), MarkedBlocks from one reservation. Not refcounting.
- ICs: nothing is patched at runtime. By-name accesses call a shared stub that probes tables per VM; tested accesses inline a shape compare. Own calling
  convention with adapter stubs at the JSC boundary.
- Unsupported / changed semantics: type errors fail the build; existing members of builtins cannot be replaced (`Array.prototype.push = f` throws; Object/RegExp/Promise
  prototypes immutable); closed-world (computed `import()`/`require()` only finds files matching constant parts; `globalThis[name](code)` throws EvalError);
  module runs at most once, not in require.cache; code from disk only with `--aot-allow-code-from-disk` (interpreted, costs Express 13% / Koa 16%);
  32 GB per thread; no cross-compilation; no breakpoints; runtime-generated code (zod 4, ajv, fast-json-stringify, Elysia `new Function`) interpreted;
  `bun:ffi cc()` and native addons that JIT do not work. Linux x64 glibc tested; Windows many failures. Builds slow (tens of seconds, GBs for big apps, no incremental cache).
  Executables 69-82 MB (js-compiled: 51 MB trimmed).
- Does it use TS types? Yes, centrally (above), plus "full types": a new `full-types` export condition shipping `index.full.ts` (JS with types retained, must
  strip to exactly `index.js`) so npm dependencies are compiled with types too; `JSON.parse<T>`, `validate<T>`, `int32` field types.
- Claimed numbers (Linux x64 EPYC 9R14, LTO build):
  - tsc (TS 6.0.3 compiled with --aot) on effect, 370k lines: 4.25 s vs 14.0 s on Bun JIT (3.3x), 963 MB vs 2581 MB, 5.3 vs 29.2 CPU s; TS7 (Go) 2.68 s wall.
  - Claude Code CLI: first prompt 141 ms vs 318, peak private mem 44.7 vs 185 MB, instructions 1.1G vs 5.5G.
  - Servers, first second req/s AOT vs JIT: Koa 33.1k/17.2k (1.93x), Express 46.6k/24.2k (1.93x), Fastify 58.0k/37.8k, node:http 69.1k/46.7k, Hono 59.0k/48.0k, Bun.serve 84.6k/77.9k, Elysia 63.6k/61.6k.
  - **Warm (requests 100k-400k) the JIT wins on untyped npm code**: Koa -22.9%, Fastify -16.9%, Elysia -13.5%, Express -7.1%; Hono/Bun.serve/node:http level.
  - 1,814 idiom micro-benchmarks vs warm JIT (instructions): small-program mode 916 ahead / 223 within 5% / 675 behind, median ratio 0.94; "as in a very large program"
    (no hot-loop inlining guess) 467 ahead / 1229 behind, median 1.44. JetStream2 mostly slower compiled. They state plainly: "A warm JIT still wins on untyped npm code".
  - Startup/memory: first response 9-20 ms vs 11-67 ms; peak RSS 32-57 MB vs 46-86 MB; p99 at 5k rps 54-91 us vs 77-477 us.
- Lesson for scriptc: the strongest AOT-without-profile system built so far (JSC's B3, whole-program flow, 1M+ lines) still loses 7-23% warm on exactly our
  workload class (Koa/Express/Fastify = untyped npm); their stated way out is types, not smarter untyped codegen.

## 2. js-compiled leaderboard (jlucaso1/js-compiled, run 2026-10-26)
- Candidates: node, bun, scriptc (npm 0.3.6, TS->IR->LLVM), geatsc (TS->C++), porffor, perry, js2wasm, assemblyscript, jz-native; extras porffor-js, shermes (Static Hermes),
  quickjs-ng, bun-compile, **bun-aot** (PR artifact 54c5048fb, `--aot --compile-trim-runtime`, Linux x64 only, PR #22), deno-compile (+quickjs), deno.
  **scriptc is included.** 22 fixtures, single-threaded, fresh process per run (JIT warmup counted), median of 5.
- IMPORTANT caveat: all fixtures are erasable TS *with type annotations* (benches/), so this mostly tests typed/static tiers. Nothing here is Express/Nest-like untyped code.
- Fastest runner per fixture (of all candidates, time): scriptc 11 wins (noop, hello, loop-sum, nbody, spectral-norm, crc32, sieve, array-sort, binary-trees, string-build, fs-io),
  bun-aot 6 (map-set, regex, classes, async, generators, pipeline), geatsc 1 (fib 101 ms), perry 1 (mandelbrot), bun-compile 1 (matmul), bun 1 (json), node 1 (closures).
- Coverage: scriptc, node, bun, perry, bun-compile, bun-aot, deno* all 22/22; geatsc 19, porffor 21, shermes 21, quickjs 21, js2wasm 13, assemblyscript 3.
- scriptc vs bun-aot vs node vs bun (ms):
  fib 167 / 379 / 686 / 496; loop-sum 1198 / 2632 / 2584 / 1845; array-sort 126 / 821 / 1785 / 1601; binary-trees 1198 / 1436 / 1925 / 1877; string-build 301 / 595 / 832 / 532;
  map-set 313 / 271 / 1012 / 722; regex 507 / 215 / 1061 / 702; classes 408 / 365 / 659 / 526;
  **json 2574 / 1149 / 1503 / 1123 (scriptc slowest of the viable set bar a few)**; **closures 2291 / 1987 / 1236 / 1267**; async 191 / 104 / 608 / 299;
  **generators 1148 / 338 / 1542 / 699**; pipeline 559 / 418 / 856 / 450; matmul 974 / 1894 / 1268 / 933.
  scriptc rank among all runners: 1st on 11 fixtures, 2nd on 5 (fib, map-set, regex, classes, async), worst relative: json (8th), closures (7th), generators (5th), mandelbrot (5th), pipeline (4th).
- Memory: scriptc lowest peak RSS in nearly every row (e.g. noop 1.9 MB vs bun-aot 19 MB, node 70 MB; binary-trees 89 MB vs bun-aot 240 MB, node 263 MB).
  Binary size: scriptc 0.08-0.28 MB; bun-aot 51 MB; bun-compile 87 MB; deno 100 MB; perry 16 MB. Compile time: scriptc 0.2-0.6 s; bun-aot 0.4-1.2 s; geatsc 22-39 s; porffor 1-5 s.
- Where each wins: scriptc = startup, numeric loops, typed arrays, sort, allocation-heavy typed code, memory, size, compile time. bun-aot = async/generators/regex/map-set/classes/pipeline
  (it inherits JSC's runtime: Yarr regex AOT-compiled, coroutines, Map). Bun JIT = JSON and matmul. Node = closures. Shermes (JS->C, untyped) is mostly the slowest compiled candidate
  (fib 2257 ms vs node 686; nbody 15.7 s), so "untyped JS -> C with runtime calls" alone loses to JITs, consistent with scriptc's own NestJS result.
- Takeaway where scriptc is behind: JSON (parse/stringify, scriptc 2.3x slower than Bun), closures/higher-order, generators, regex, Map/Set-adjacent pipeline.

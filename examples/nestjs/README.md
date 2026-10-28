# NestJS native compilation acceptance example

This standalone application uses the published NestJS 12.2.0 packages (`@nestjs/common` and `@nestjs/core`), reflect-metadata 0.2.2, and RxJS 7.8.2. `package-lock.json` pins the complete dependency graph. Install this directory independently of the root pnpm workspace.

`src/app.module.ts` declares an injectable service and a controller with constructor injection, a method decorator, and a parameter decorator. Its route returns a real RxJS Observable. `src/context.ts` boots and closes a Nest application context. `src/main.ts` starts an HTTP application on localhost port 3000; set `PORT` to choose another port. Its `--check` mode binds an ephemeral port, requests the decorated route and an absent route, and closes the application.

The HTTP application runs on `src/http-adapter.ts`, a small adapter over `node:http` that extends Nest's public `AbstractHttpAdapter`. It replaces `@nestjs/platform-express`: Express's CommonJS dependency tree does not compile natively yet. The adapter implements only what this application uses: literal and `:param` routes (GET routes also answer HEAD), JSON and text replies, status codes and headers, redirects, Nest's not-found and exception layers, `listen()`, and `close()`. Request bodies are not parsed. Middleware, CORS, static assets, views, versioning, a global prefix, and HTTPS throw an error. Nest's handlers get a request object that wraps the Node request (`raw`), as Fastify's does; they do not get the Express request.

Two official adapters are blocked as well. `@nestjs/platform-fastify` builds route matchers and serializers with `new Function` (find-my-way, fast-json-stringify, ajv), and a compiled program cannot evaluate code at runtime. The proposed `@nestjs/platform-node` ([nestjs/nest#18063](https://github.com/nestjs/nest/pull/18063)) is not published to npm. It also routes through find-my-way and loads the same CommonJS packages as Express (`qs`, `send`, `http-errors`).

The TypeScript configuration enables legacy decorators and emitted design metadata. The two application entry points share the same module and controller source. `src/metadata.ts` independently exercises the real reflect-metadata package with inherited and own metadata, key insertion order, symbol and object keys, deletion, and class/prototype/method-function identity. Run its Node acceptance check with `npm run check:metadata`.

The Node acceptance checks currently pass:

```console
$ npm run build
$ npm run check:context
Hello, native Nest!
rxjs value
context closed
$ npm run check:http
200
{"message":"Hello, native!"}
404
http closed
```

After building the root workspace and installing this example’s dependencies, `npm run check:native` compiles all three TypeScript entry points with the local compiler and compares their native stdout, stderr, and exit status against the transpiled Node programs. `SCRIPTC_SAN=1` enables the sanitizer lane. This acceptance driver runs under Node; the application binaries compile the actual dependency sources natively. All three stages pass, in the plain and sanitizer lanes. That covers this application's paths through Nest: dependency injection, decorators and metadata, routing one parameterized GET route, the RxJS response, the 404 path, and shutdown. Other Nest features and RxJS operators may still reach code that does not compile natively yet; a stage that reaches it fails at runtime with a scriptc error.

`npm run bench` (`bench/run.mjs`) measures HTTP throughput of `dist/main.js` under Node and of the native binary with autocannon. Methodology:

- Trials are paired and alternate (Node, native, Node, native, ...), each with a fresh server, so thermal and load drift hits both targets equally.
- Each trial warms up for `--warmup` seconds (default 15, so V8's JIT settles) and then measures `--duration` seconds (default 10).
- The server and autocannon are pinned to disjoint cores with `taskset`: `--server-cpus` (default `2-3`) and `--client-cpus` (default `8-15`); pass `none` to disable. Adjust the lists to your topology (avoid SMT siblings shared between the two).
- `--concurrency 16,64,256` sweeps connection counts (`--connections` is an alias). Run one low level for fixed-load latency and one high level for saturation.
- Both servers' status, content type and body for the route must be byte-identical; the report says so per table.
- The table shows median and inter-quartile range of req/s, median p50/p99 latency, and server CPU microseconds per request (utime+stime of every server thread over the measured window divided by requests, so Node's GC and worker threads count).

Example: `node bench/run.mjs --runs 7 --warmup 20 --concurrency 16,128 --server-cpus 4 --client-cpus 8-15`.

`bench/counters.mjs` reports deterministic per-request runtime counters of the native build (stats flavor). By default it drives one sequential connection; `--concurrency N` keeps N connections busy and `--duration S` measures for S seconds instead of `--requests`, which is closer to the throughput benchmark's conditions.

## Cross-worktree perf measurement (`bench/measure.mjs`)

One script gives comparable numbers from any worktree of this repository: callgrind instructions per request, runtime counters per request (allocations, frees, capsules, cycle-collector passes), optional req/s, and Node Nest as the reference. Binaries are built from the worktree's own `packages/compiler/dist` and runtime pack; the output records the compiler dist hash, the runtime pack hash (`runtime-pack.json` sha256), the runtime source hash, the git HEAD and a hash of the uncommitted diff.

```console
$ node bench/measure-docker.mjs --lane both --node --provenance-cache ~/.cache/scriptc/provenance --out /tmp/result.json
```

Options: `--lane default|ts|both`, `--node` (Node Nest, fewer requests, cached by Node version + app source + request counts in `--cache-dir`, default `~/.cache/scriptc-bench`; `--refresh-node` forces a re-run), `--rps` (req/s through `bench/run.mjs`; needs network for `npx autocannon`, so run it on the host with `node bench/measure.mjs`), `--warmup 100 --requests 300` (callgrind), `--counter-warmup 500 --counter-requests 2000`, `--out <json>`.

- **Lanes.** `default` compiles Nest from its published JavaScript. `ts` sets `SCRIPTC_PROVENANCE_SOURCES=1 SCRIPTC_PROVENANCE_DECLARED=1` (helper `provenance-sources.mjs`) so Nest compiles from TypeScript. With an empty or missing provenance cache Nest silently falls back to JS, so the script resolves the sources first and aborts unless `@nestjs/common`, `@nestjs/core` and `rxjs` all map to TypeScript files; the mapped packages and commits are in the JSON.
- **Prerequisites per worktree.** `npm ci` in `examples/nestjs` (node_modules is per worktree), a built `packages/compiler/dist`, and a built runtime pack (`packages/runtime-linux-x64-gnu`).
- **Docker.** valgrind is not in `scriptc-legacy-validation:local`. `bench/measure-docker.mjs` builds `scriptc-bench:local` from it plus valgrind (`bench/Dockerfile.measure`, needs network once) and runs `measure.mjs` in a throwaway `docker run --rm` with the worktree bind-mounted at the same path, the provenance cache read-only, `--cache-dir` and the directory of `--out` writable, `--network none`, `--cap-add SYS_PTRACE`, your uid and a private `/tmp`. The container therefore never needs the shared `scriptc-legacy-gate` container; if you do use that one, it must mount your worktree path (`docker run -v <wt>:<wt>`; a container cannot gain mounts later) and `callgrind_control` is always called with the server's pid, never bare.
- **Populating the provenance cache (host, network).** `node bench/measure.mjs --prime-provenance --provenance-cache ~/.cache/scriptc/provenance` downloads the TypeScript sources of Nest's dependencies once (content addressed by commit). Pass the same directory to `measure-docker.mjs`. Cached trees are shared between worktrees.
- **What is measured.** Instructions come from the second callgrind dump (`callgrind_control -d <pid>` after the warm-up and after the measured requests), over one keep-alive connection. Counters come from a `SCRIPTC_RUNTIME_STATS=1` build (allocations = `dyn_alloc_object+array+closure+box+string`, frees = `dyn_free`, cycle passes = `cyc_pass`). There is no capsule (`typed_ref_new`) counter in `scr_stats.h`, so capsules are reported as `missing`/`null`.
- **Node.** Under callgrind Node is about 50x slower, so it gets 50 warm-up and 100 measured requests by default and V8's JIT is only partly warmed; treat the number as approximate. All scratch output lives in one temp dir that is deleted at exit, also on failure.

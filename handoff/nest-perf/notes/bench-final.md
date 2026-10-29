## NestJS example: Node vs scriptc-native (GET /hello/native)

Setup: server pinned to cores 0-3 (`taskset`), autocannon (4 workers) pinned to cores 4-11. 64 connections, 3 s warm-up + 10 s, 5 interleaved rounds (Node, native, ...), fresh server per round. Median of 5 reported. Includes coroutine stack pool + class-check dispatch fixes. Native = `compile()` llvm, `npmStatic: 'auto'`, `sanitize: false`; Node = `tsc` dist.

| Metric (64 conns) | Node 24.22.0 | scriptc-native | native / Node |
|---|---|---|---|
| Requests/s (median) | 95,034 | 25,549 | 0.27x |
| Latency p50 (ms) | 0 (<1) | 2 | |
| Latency p99 (ms) | 0 (<1; range 0-1) | 3 | |
| Peak RSS (VmHWM) | 136.6 MiB (139,924 kB) | 35.7 MiB (36,584 kB) | 0.26x |
| Startup to first 200 (median of 5 cold) | 140.8 ms | 11.8 ms | 0.08x |
| Artifact | dist 17 KB (32K on disk) + node_modules 44 MB | single binary 31 MB (32,562,720 B) | |

256 connections (single run, 10 s):

| Metric | Node | scriptc-native |
|---|---|---|
| Requests/s | 94,042 | 22,895 |
| p50 / p99 (ms) | 2 / 3 | 10 / 20 |
| Peak RSS | 172.7 MiB | 36.8 MiB |

No non-2xx responses or errors in any run.

Machine: AMD Ryzen AI 9 HX 370 w/ Radeon 890M, 24 logical CPUs, Node v24.22.0, Linux 7.0.0-30-generic. Load average (1/5/15 min): 2.07 / 2.51 / 3.97 before, 2.77 / 2.50 / 3.69 after (below the 4 threshold, no wait needed).
Note: autocannon reports latency in whole ms, so Node p50/p99 show as 0.

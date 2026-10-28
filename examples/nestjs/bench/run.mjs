// HTTP throughput benchmark: NestJS example on Node vs compiled natively by scriptc.
// Usage: node bench/run.mjs [--target node|native|both] [--duration 10] [--warmup 15]
//        [--concurrency 64[,256,...]] [--runs 5] [--route /hello/native] [--workers 4]
//        [--server-cpus 2-3] [--client-cpus 8-15]   ("none" disables taskset pinning)
// Trials are paired and alternate (Node, native, Node, native, ...) so drift hits both equally.
// The server and the load generator (autocannon, `npx --yes autocannon`) run on disjoint cores.
// Per trial: start server, warm up (--warmup seconds, let the JIT settle), then measure --duration seconds
// and read the server's CPU time (utime+stime of all its threads from /proc/<pid>/stat) around that window.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: {
  target: { type: 'string', default: 'both' }, duration: { type: 'string', default: '10' },
  warmup: { type: 'string', default: '15' }, concurrency: { type: 'string', default: '64' },
  connections: { type: 'string' }, // alias of --concurrency
  runs: { type: 'string', default: '5' }, route: { type: 'string', default: '/hello/native' },
  workers: { type: 'string', default: '4' }, port: { type: 'string', default: '3901' },
  'native-bin': { type: 'string' }, 'ts-bin': { type: 'string' }, // prebuilt binaries (default lane, TS lane); skips the in-process build
  'server-cpus': { type: 'string', default: '2-3' }, 'client-cpus': { type: 'string', default: '8-15' },
} });
const port = Number(o.port);
const levels = (o.connections ?? o.concurrency).split(',').map(Number);
const pin = (cpuList, cmd, args) => cpuList === 'none' ? [cmd, args] : ['taskset', ['-c', cpuList, cmd, ...args]];
const clkTck = Number((await exec('getconf', ['CLK_TCK'])).stdout);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * q, l = Math.floor(i); return s[l] + (s[Math.ceil(i)] - s[l]) * (i - l); };
const median = a => quantile(a, 0.5);

async function buildNode() {
  await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')]);
  return { cmd: process.execPath, args: [join(root, 'dist/main.js')], size: statSync(join(root, 'dist/main.js')).size };
}

async function buildNative() {
  const compiler = await import('../../../packages/compiler/dist/index.js');
  const { compile, renderDiagnostics } = compiler;
  await (await import('../provenance-sources.mjs')).applyProvenanceSources(compiler, join(root, 'src/main.ts'));
  const outDir = join(root, 'bench/out');
  mkdirSync(outDir, { recursive: true });
  const r = await compile(join(root, 'src/main.ts'), { outPath: join(outDir, 'program'), outDir, backend: 'llvm', npmStatic: 'auto', sanitize: false });
  if (!r.ok) throw new Error(renderDiagnostics(r.diagnostics, r.sourceTexts, { color: false }));
  return { cmd: r.binaryPath, args: [], size: statSync(r.binaryPath).size };
}

const peakRssKb = pid => { try { return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]); } catch { return 0; } };
// utime+stime of the whole process (every thread, including exited ones), in microseconds.
const cpuUs = pid => { const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) * 1e6 / clkTck; };

async function startServer(b) {
  const t0 = performance.now();
  const [cmd, args] = pin(o['server-cpus'], b.cmd, b.args);
  const child = spawn(cmd, args, { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; child.stderr.on('data', d => { err += d; });
  let exited = false; child.on('exit', () => { exited = true; });
  for (;;) {
    if (exited) throw new Error(`server exited early: ${err}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${o.route}`);
      if (res.status === 200) {
        // Compare what the client sees except volatile headers (date, connection keep-alive details).
        const body = Buffer.from(await res.arrayBuffer()).toString('base64');
        return { child, startupMs: performance.now() - t0, response: `${res.headers.get('content-type')}|${body}` };
      }
    } catch {}
    if (performance.now() - t0 > 30000) { child.kill(); throw new Error('server not ready in 30s'); }
    await sleep(2);
  }
}

async function load(seconds, connections) {
  const [cmd, args] = pin(o['client-cpus'], 'npx', ['--yes', 'autocannon', '-j', '-d', String(seconds), '-c', String(connections), '-w', o.workers,
    `http://127.0.0.1:${port}${o.route}`]);
  const { stdout } = await exec(cmd, args, { maxBuffer: 1 << 26 });
  const j = JSON.parse(stdout);
  return { rps: j.requests.average, total: j.requests.total, p50: j.latency.p50, p99: j.latency.p99, bad: j.non2xx + j.errors };
}

async function trial(b, connections) {
  const { child, startupMs, response } = await startServer(b);
  try {
    await load(Number(o.warmup), connections);
    const c0 = cpuUs(child.pid);
    const r = await load(Number(o.duration), connections);
    const cpuPerReq = (cpuUs(child.pid) - c0) / r.total;
    return { ...r, cpuPerReq, startupMs, response, rss: peakRssKb(child.pid) };
  } finally { child.kill('SIGKILL'); await sleep(300); }
}

const prebuilt = p => async () => ({ cmd: p, args: [], size: statSync(p).size });
const targets = [];
if (o.target !== 'native') targets.push({ name: 'Node', build: buildNode });
if (o.target !== 'node') targets.push({ name: 'scriptc native', build: o['native-bin'] ? prebuilt(o['native-bin']) : buildNative });
if (o.target !== 'node' && o['ts-bin']) targets.push({ name: 'scriptc native (TS lane)', build: prebuilt(o['ts-bin']) });
for (const t of targets) {
  try { t.b = await t.build(); } catch (e) { t.failure = String(e.message ?? e).split('\n').slice(0, 8).join('\n'); }
}
const live = targets.filter(t => !t.failure);

console.log(`Machine: ${cpus()[0].model}, ${cpus().length} threads; Node ${process.version}; GET ${o.route}; ${o.warmup}s warm-up + ${o.duration}s x ${o.runs} paired trials (ABAB); autocannon ${o.workers} workers; server cpus ${o['server-cpus']}, client cpus ${o['client-cpus']}\n`);
for (const connections of levels) {
  for (const t of live) t.trials = [];
  for (let i = 0; i < Number(o.runs); i++) {
    for (const t of live) {
      const r = await trial(t.b, connections);
      t.trials.push(r);
      console.error(`[c=${connections}] run ${i + 1} ${t.name}: ${Math.round(r.rps)} req/s, ${r.cpuPerReq.toFixed(1)} cpu-us/req`);
    }
  }
  const same = live.length < 2 || live.every(t => t.trials.every(r => r.response === live[0].trials[0].response));
  console.log(`### ${connections} connections (response bytes identical across targets: ${same ? 'yes' : 'NO'})\n`);
  console.log('| Target | req/s median | req/s IQR | p50 (ms) | p99 (ms) | server CPU us/req | peak RSS (MB) | startup (ms) | size (MB) | non-2xx/errors |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const t of live) {
    const rs = t.trials, k = f => rs.map(f);
    console.log(`| ${t.name} | ${Math.round(median(k(r => r.rps)))} | ${Math.round(quantile(k(r => r.rps), 0.25))}-${Math.round(quantile(k(r => r.rps), 0.75))} | ${median(k(r => r.p50))} | ${median(k(r => r.p99))} | ${median(k(r => r.cpuPerReq)).toFixed(1)} | ${(Math.max(...k(r => r.rss)) / 1024).toFixed(1)} | ${Math.round(median(k(r => r.startupMs)))} | ${(t.b.size / 1048576).toFixed(2)} | ${rs.reduce((n, r) => n + r.bad, 0)} |`);
  }
  console.log();
}
for (const t of targets) if (t.failure) console.log(`${t.name} build failure:\n${t.failure}`);

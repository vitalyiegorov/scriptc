// Deterministic per-request runtime counters for the NestJS example, compiled natively with the
// runtime stats flavor (packages/runtime/src/scr_stats.h, SCRIPTC_RUNTIME_STATS=1).
// Usage: node bench/counters.mjs [--requests 10000] [--warmup 2000] [--route /hello/native] [--port 3902]
//        [--concurrency 1] [--duration 0]
// --concurrency N keeps N keep-alive connections busy (default 1 = sequential). --duration S (seconds) measures for
// S seconds instead of a fixed --requests count; per-request values divide by the requests actually completed.
// Needs the native toolchain (clang); the build and the server run wherever this script runs.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import http from 'node:http';

process.env.SCRIPTC_RUNTIME_STATS = '1'; // read by the compiler at compile time
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: {
  requests: { type: 'string', default: '10000' }, warmup: { type: 'string', default: '2000' },
  route: { type: 'string', default: '/hello/native' }, port: { type: 'string', default: '3902' },
  concurrency: { type: 'string', default: '1' }, duration: { type: 'string', default: '0' },
  keep: { type: 'boolean', default: false },
} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scratch = mkdtempSync(join(tmpdir(), 'scr-counters-'));
const statsFile = join(scratch, 'stats.jsonl');
let child;

async function build() {
  const compiler = await import('../../../packages/compiler/dist/index.js');
  const { compile, renderDiagnostics } = compiler;
  await (await import('../provenance-sources.mjs')).applyProvenanceSources(compiler, join(root, 'src/main.ts'));
  const outDir = join(scratch, 'out');
  mkdirSync(outDir, { recursive: true });
  const r = await compile(join(root, 'src/main.ts'), { outPath: join(outDir, 'program'), outDir, backend: 'llvm', npmStatic: 'auto', sanitize: false });
  if (!r.ok) throw new Error(renderDiagnostics(r.diagnostics, r.sourceTexts, { color: false }));
  return r.binaryPath;
}

const agent = new http.Agent({ keepAlive: true, maxSockets: Number(o.concurrency) });
const get = () => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: Number(o.port), path: o.route, agent }, res => {
    res.resume(); res.on('end', () => resolve(res.statusCode)); 
  }).on('error', reject);
});

async function dump() { // SIGWINCH (number 28; the app's shutdown hooks own SIGUSR2) appends one JSON line to the stats file
  const before = lines().length;
  child.kill('SIGWINCH');
  for (let i = 0; i < 500 && lines().length === before; i++) await sleep(10);
  const all = lines();
  if (all.length === before) throw new Error('no stats line after SIGUSR2');
  return JSON.parse(all.at(-1));
}
const lines = () => { try { return readFileSync(statsFile, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

try {
  const t0 = performance.now();
  const bin = await build();
  console.error(`built ${bin} (${(statSync(bin).size / 1048576).toFixed(1)} MB) in ${Math.round(performance.now() - t0)} ms`);
  child = spawn(bin, [], { env: { ...process.env, PORT: o.port, SCR_STATS_FILE: statsFile, SCR_STATS_SIGNAL: '28' }, stdio: ['ignore', 'ignore', 'inherit'] });
  let exited = false; child.on('exit', () => { exited = true; });
  for (let i = 0; ; i++) {
    if (exited) throw new Error('server exited early');
    if (i > 3000) throw new Error('server not ready in 30s');
    try { if (await get() === 200) break; } catch {}
    await sleep(10);
  }
  const conc = Number(o.concurrency), seconds = Number(o.duration);
  let bad = 0, n = 0;
  // Run `conc` parallel loops until `done()`; counts completed requests and non-200s.
  const drive = async done => {
    let count = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (!done(count)) { count++; if (await get() !== 200) bad++; }
    }));
    return count;
  };
  await drive(c => c >= Number(o.warmup));
  const a = await dump();
  if (seconds > 0) { const end = performance.now() + seconds * 1000; n = await drive(() => performance.now() >= end); }
  else n = await drive(c => c >= Number(o.requests));
  const b = await dump();
  console.log(`GET ${o.route}: ${n} keep-alive requests over ${conc} connection(s) after ${o.warmup} warm-up; non-200: ${bad}\n`);
  console.log('| counter | per request | total |\n|---|---:|---:|');
  for (const k of Object.keys(b)) {
    const d = b[k] - a[k];
    console.log(`| ${k} | ${(d / n).toFixed(3)} | ${d} |`);
  }
} finally {
  agent.destroy();
  child?.kill('SIGKILL');
  if (!o.keep) rmSync(scratch, { recursive: true, force: true });
}

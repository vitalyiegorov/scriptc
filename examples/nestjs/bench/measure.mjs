// Reproducible perf measurement of the NestJS example, comparable across git worktrees.
//
// Usage: node bench/measure.mjs [--lane default|ts|both] [--node] [--rps] [--out result.json]
//          [--provenance-cache <dir>] [--cache-dir <dir>] [--refresh-node]
//          [--warmup 100] [--requests 300]                 callgrind: warm-up / measured requests (native lanes)
//          [--node-warmup 50] [--node-requests 100]        callgrind: Node (≈50x slower under valgrind, so fewer)
//          [--counter-warmup 500] [--counter-requests 2000] runtime-stats counters
//          [--rps-runs 3] [--rps-duration 5] [--rps-warmup 5] [--server-cpus L] [--client-cpus L]
//          [--prime-provenance]    resolve + download TS sources for the TS lane into the cache, then exit (needs network)
//
// What it measures, per lane (default = published JS of the Nest packages; ts = Nest compiled from TypeScript sources via
// SCRIPTC_PROVENANCE_SOURCES=1 SCRIPTC_PROVENANCE_DECLARED=1, see ../provenance-sources.mjs):
//   * callgrind instructions/request: GET --route over ONE keep-alive connection, warm-up requests, then measured
//     requests; the server runs under `valgrind --tool=callgrind` and is dumped by PID (callgrind_control -d <pid>).
//   * runtime counters/request (allocations, frees, capsules, cycle-collector passes) from a SCRIPTC_RUNTIME_STATS=1 build.
//   * --rps: req/s through bench/run.mjs (host only, needs npx autocannon).
// --node adds Node Nest instructions/request (fewer requests, cached by Node version + app source in --cache-dir).
// Binaries are built from THIS worktree's compiler dist and runtime pack; their content hashes are recorded.
//
// Needs valgrind (+ callgrind_control), clang, the built compiler (packages/compiler/dist), the runtime pack, and
// examples/nestjs/node_modules in the worktree. Run it inside a container with `node bench/measure-docker.mjs ...`
// (same arguments) when valgrind is not installed on the host. All scratch output lives in one temp dir that is removed
// at the end, also on failure.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { arch, cpus, homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..'); // examples/nestjs
const repo = join(root, '../..');
const { values: o } = parseArgs({ options: {
  lane: { type: 'string', default: 'both' }, node: { type: 'boolean', default: false }, rps: { type: 'boolean', default: false },
  out: { type: 'string' }, 'provenance-cache': { type: 'string' }, 'cache-dir': { type: 'string', default: join(homedir(), '.cache', 'scriptc-bench') },
  'refresh-node': { type: 'boolean', default: false }, 'prime-provenance': { type: 'boolean', default: false },
  route: { type: 'string', default: '/hello/native' }, port: { type: 'string', default: '3911' },
  warmup: { type: 'string', default: '100' }, requests: { type: 'string', default: '300' },
  'node-warmup': { type: 'string', default: '50' }, 'node-requests': { type: 'string', default: '100' },
  'counter-warmup': { type: 'string', default: '500' }, 'counter-requests': { type: 'string', default: '2000' },
  'rps-runs': { type: 'string', default: '3' }, 'rps-duration': { type: 'string', default: '5' }, 'rps-warmup': { type: 'string', default: '5' },
  'server-cpus': { type: 'string' }, 'client-cpus': { type: 'string' },
  // internal: child process that builds one binary with a clean environment
  '_build': { type: 'string' }, '_stats': { type: 'string' }, '_dir': { type: 'string' }, '_result': { type: 'string' },
} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = (...bufs) => { const h = createHash('sha256'); for (const b of bufs) h.update(b); return h.digest('hex'); };
const PROV_REQUIRED = ['@nestjs/common', '@nestjs/core', 'rxjs'];

function hashTree(dir, filter = () => true) {
  const h = createHash('sha256');
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (filter(p)) { h.update(relative(dir, p)); h.update('\0'); h.update(readFileSync(p)); h.update('\0'); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

// ---------------------------------------------------------------- internal build child
if (o._build) {
  const lane = o._build, stats = o._stats === '1';
  // Clean slate: only the lane's own flags are set.
  for (const k of Object.keys(process.env)) if (k.startsWith('SCRIPTC_PROVENANCE_') && k !== 'SCRIPTC_PROVENANCE_CACHE') delete process.env[k];
  delete process.env.SCRIPTC_RUNTIME_STATS;
  if (stats) process.env.SCRIPTC_RUNTIME_STATS = '1';
  if (lane === 'ts') { process.env.SCRIPTC_PROVENANCE_SOURCES = '1'; process.env.SCRIPTC_PROVENANCE_DECLARED = '1'; }
  const compiler = await import(join(repo, 'packages/compiler/dist/index.js'));
  const entry = join(root, 'src/main.ts');
  const result = { lane, stats };
  if (lane === 'ts') {
    const sources = await compiler.resolveProvenanceSources(entry);
    result.provenance = { packages: sources.packages.map(p => ({ name: p.name, version: p.version, repo: p.repo, commit: p.commit, files: Object.keys(p.entries).length })), notes: sources.notes };
    const bad = PROV_REQUIRED.filter(n => !sources.packages.some(p => p.name === n && Object.keys(p.entries).length > 0));
    if (bad.length > 0) {
      throw new Error(`TS LANE INVALID: no TypeScript sources resolved for ${bad.join(', ')}; Nest would silently compile from JS.\n` +
        `provenance cache: ${process.env.SCRIPTC_PROVENANCE_CACHE ?? '~/.cache/scriptc/provenance (default)'}\n` +
        `resolver notes:\n  ${sources.notes.join('\n  ')}\n` +
        `Populate the cache on a host with network: node bench/measure.mjs --prime-provenance --provenance-cache <dir>`);
    }
    if (o['prime-provenance']) { writeFileSync(o._result, JSON.stringify(result)); process.exit(0); }
    compiler.setProvenanceSources(sources);
  } else {
    compiler.setProvenanceSources(null);
  }
  const outDir = o._dir;
  mkdirSync(outDir, { recursive: true });
  const r = await compiler.compile(entry, { outPath: join(outDir, 'program'), outDir, backend: 'llvm', npmStatic: 'auto', sanitize: process.env.MEASURE_SAN === '1' });
  if (!r.ok) throw new Error(compiler.renderDiagnostics(r.diagnostics, r.sourceTexts, { color: false }));
  result.binary = r.binaryPath;
  result.size = statSync(r.binaryPath).size;
  writeFileSync(o._result, JSON.stringify(result));
  process.exit(0);
}

// ---------------------------------------------------------------- main
const lanes = o.lane === 'both' ? ['default', 'ts'] : [o.lane];
if (!['default', 'ts', 'both'].includes(o.lane)) throw new Error('--lane must be default, ts or both');
const scratch = mkdtempSync(join(tmpdir(), 'scr-measure-'));
const children = new Set();
let cleaned = false;
const cleanup = () => {
  if (cleaned) return; cleaned = true;
  for (const c of children) { try { c.kill('SIGKILL'); } catch {} }
  rmSync(scratch, { recursive: true, force: true });
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('exit', cleanup);

const childEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('SCRIPTC_') && k !== 'SCRIPTC_PROVENANCE_CACHE' && k !== 'SCRIPTC_RUNTIME_PACK' && k !== 'SCRIPTC_YOUNG_NURSERY') delete env[k];
  if (o['provenance-cache']) env.SCRIPTC_PROVENANCE_CACHE = o['provenance-cache'];
  return env;
};
const log = (...a) => console.error('[measure]', ...a);

async function build(lane, stats) {
  const dir = join(scratch, `${lane}${stats ? '-stats' : ''}`);
  const resultFile = join(scratch, `${lane}${stats ? '-stats' : ''}.json`);
  const args = [fileURLToPath(import.meta.url), '--_build', lane, '--_stats', stats ? '1' : '0', '--_dir', dir, '--_result', resultFile];
  if (o['prime-provenance']) args.push('--prime-provenance');
  try {
    await exec(process.execPath, args, { env: childEnv(), maxBuffer: 1 << 26 });
  } catch (e) {
    throw new Error(`build ${lane}${stats ? ' (stats)' : ''} failed:\n${String(e.stderr || e.message).trim().split('\n').slice(-40).join('\n')}`);
  }
  return JSON.parse(readFileSync(resultFile, 'utf8'));
}

if (o['prime-provenance']) {
  const r = await build('ts', false);
  console.log(`provenance cache primed for ${r.provenance.packages.map(p => `${p.name}@${p.version}`).join(', ')}`);
  cleanup(); process.exit(0);
}

for (const bin of ['valgrind', 'callgrind_control']) {
  try { execFileSync('which', [bin], { stdio: 'ignore' }); } catch { throw new Error(`${bin} not found; run via bench/measure-docker.mjs or install valgrind`); }
}
if (!existsSync(join(root, 'node_modules/typescript'))) throw new Error('examples/nestjs/node_modules missing in this worktree: run `npm ci` in examples/nestjs');
if (!existsSync(join(repo, 'packages/compiler/dist/index.js'))) throw new Error('packages/compiler/dist missing: build the compiler in this worktree first');

// ---------------------------------------------------------------- attribution
const packDir = join(repo, 'packages', `runtime-${process.platform}-${arch()}-gnu`);
const sh = (...a) => { try { return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const attribution = {
  worktree: repo,
  gitHead: process.env.MEASURE_GIT_HEAD || sh('rev-parse', 'HEAD'),
  gitBranch: process.env.MEASURE_GIT_BRANCH || sh('rev-parse', '--abbrev-ref', 'HEAD'),
  gitDiffSha256: process.env.MEASURE_GIT_DIFF || (sh('diff', 'HEAD') === null ? null : sha(sh('diff', 'HEAD'))),
  compilerDistSha256: hashTree(join(repo, 'packages/compiler/dist'), p => !p.endsWith('.map')),
  runtimePackSha256: existsSync(join(packDir, 'runtime-pack.json')) ? sha(readFileSync(join(packDir, 'runtime-pack.json'))) : null,
  runtimePackDir: packDir,
  runtimeSourceSha256: hashTree(join(repo, 'packages/runtime/src')), // the stats flavor is built from these sources
  appSourceSha256: hashTree(join(root, 'src')),
  nodeVersion: process.version,
  machine: `${cpus()[0].model}, ${cpus().length} threads`,
};
if (attribution.runtimePackSha256 === null) log(`WARNING: ${join(packDir, 'runtime-pack.json')} not found; runtimePackSha256 is null`);

// ---------------------------------------------------------------- http driving
const sleepUntilReady = async (get, isDead, what, secs = 900) => {
  const t0 = performance.now();
  for (;;) {
    if (isDead()) throw new Error(`${what} exited early`);
    try { if (await get() === 200) return; } catch {}
    if (performance.now() - t0 > secs * 1000) throw new Error(`${what} not ready in ${secs}s`);
    await sleep(50);
  }
};
function client(port) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 }); // one keep-alive connection
  const get = () => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: o.route, agent }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  const drive = async n => { let bad = 0; for (let i = 0; i < n; i++) if (await get() !== 200) bad++; if (bad) throw new Error(`${bad} non-200 responses`); };
  return { get, drive, close: () => agent.destroy() };
}
function launch(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts });
  children.add(child);
  let err = '', dead = false;
  child.stderr.on('data', d => { err = (err + d).slice(-4000); });
  child.on('exit', () => { dead = true; children.delete(child); });
  return { child, isDead: () => dead, stderr: () => err, kill: () => { try { child.kill('SIGKILL'); } catch {} } };
}

// ---------------------------------------------------------------- callgrind
async function callgrind(label, cmd, args, { warmup, requests, cwd, valgrindArgs = [] }) {
  const dir = join(scratch, `cg-${label}`);
  mkdirSync(dir, { recursive: true });
  const port = Number(o.port);
  const srv = launch('valgrind', ['--tool=callgrind', `--callgrind-out-file=${dir}/cg.%p.out`, '--trace-children=no', '--cache-sim=no', ...valgrindArgs, cmd, ...args],
    { cwd, env: { ...childEnv(), PORT: String(port) } });
  const c = client(port);
  try {
    log(`${label}: starting under callgrind (slow)`);
    await sleepUntilReady(c.get, srv.isDead, `${label} server\n${srv.stderr()}`);
    const pid = srv.child.pid; // the valgrind process itself; never use `callgrind_control -d` without a pid
    const dumps = () => readdirSync(dir).filter(f => f.startsWith(`cg.${pid}.out`)).sort();
    const dump = async () => {
      const before = new Set(dumps());
      await exec('callgrind_control', ['-d', String(pid)]);
      let fresh = [];
      for (let i = 0; i < 600 && fresh.length === 0; i++) { fresh = dumps().filter(f => !before.has(f)); if (!fresh.length) await sleep(100); }
      if (fresh.length !== 1) throw new Error(`expected one new callgrind dump, got ${fresh.length}`);
      await sleep(200); // let the writer finish
      return join(dir, fresh[0]);
    };
    await c.drive(warmup);
    const f1 = await dump();
    await c.drive(requests);
    const f2 = await dump();
    const num = (f, key) => { const m = new RegExp(`^${key}: (\\d+)`, 'm').exec(readFileSync(f, 'utf8')); if (!m) throw new Error(`no ${key} in ${f}`); return Number(m[1]); };
    // Each dump file is one part: its summary is the cost since the previous dump (totals: equals summary per part).
    if (process.env.MEASURE_KEEP) { mkdirSync(process.env.MEASURE_KEEP, { recursive: true }); copyFileSync(f2, join(process.env.MEASURE_KEEP, `${label}.callgrind.out`)); }
    const total = num(f2, 'summary');
    return { instrPerRequest: Math.round(total / requests), instrTotal: total, warmupRequests: warmup, measuredRequests: requests };
  } finally { c.close(); srv.kill(); await sleep(200); }
}

// ---------------------------------------------------------------- runtime counters
async function counters(bin) {
  const statsFile = join(scratch, 'stats.jsonl');
  rmSync(statsFile, { force: true });
  const port = Number(o.port) + 1;
  const srv = launch(bin, [], { env: { ...childEnv(), PORT: String(port), SCR_STATS_FILE: statsFile, SCR_STATS_SIGNAL: '28' } });
  const c = client(port);
  const lines = () => { try { return readFileSync(statsFile, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  const dump = async () => {
    const before = lines().length;
    srv.child.kill('SIGWINCH');
    for (let i = 0; i < 500 && lines().length === before; i++) await sleep(10);
    if (lines().length === before) throw new Error('no stats line after SIGWINCH');
    return JSON.parse(lines().at(-1));
  };
  try {
    await sleepUntilReady(c.get, srv.isDead, `stats server\n${srv.stderr()}`, 60);
    const n = Number(o['counter-requests']);
    await c.drive(Number(o['counter-warmup']));
    const a = await dump();
    await c.drive(n);
    const b = await dump();
    const per = {};
    for (const k of Object.keys(b)) per[k] = (b[k] - a[k]) / n;
    const sum = ks => ks.reduce((s, k) => s + (per[k] ?? 0), 0);
    const hasCapsule = Object.keys(per).some(k => /typed_ref|capsule/.test(k));
    return {
      warmupRequests: Number(o['counter-warmup']), measuredRequests: n,
      allocations: sum(['dyn_alloc_object', 'dyn_alloc_array', 'dyn_alloc_closure', 'dyn_alloc_box', 'dyn_alloc_string']),
      frees: per.dyn_free,
      capsules: hasCapsule ? sum(Object.keys(per).filter(k => /typed_ref_new/.test(k))) : null,
      capsulesNote: hasCapsule ? undefined : 'MISSING: no typed_ref_new/capsule counter in packages/runtime/src/scr_stats.h',
      cyclePasses: per.cyc_pass,
      raw: per,
    };
  } finally { c.close(); srv.kill(); await sleep(200); }
}

// ---------------------------------------------------------------- rps via run.mjs
async function rps(bins) {
  const args = [join(here, 'run.mjs'), '--target', o.node ? 'both' : 'native', '--runs', o['rps-runs'], '--duration', o['rps-duration'], '--warmup', o['rps-warmup'], '--route', o.route, '--port', String(Number(o.port) + 2)];
  if (o['server-cpus']) args.push('--server-cpus', o['server-cpus']);
  if (o['client-cpus']) args.push('--client-cpus', o['client-cpus']);
  const first = bins.default ?? bins.ts;
  args.push('--native-bin', first);
  if (bins.default && bins.ts) args.push('--ts-bin', bins.ts);
  const { stdout } = await exec(process.execPath, args, { cwd: root, maxBuffer: 1 << 26 });
  const out = {};
  for (const line of stdout.split('\n')) {
    const cell = line.split('|').map(s => s.trim());
    const name = cell[1];
    if (!/^(Node|scriptc native)/.test(name ?? '')) continue;
    const key = name === 'Node' ? 'node' : name.includes('TS lane') ? 'ts' : bins.default ? 'default' : 'ts';
    out[key] = { reqPerSecMedian: Number(cell[2]), iqr: cell[3], p50ms: Number(cell[4]), p99ms: Number(cell[5]), serverCpuUsPerReq: Number(cell[6]), errors: Number(cell[11] ?? cell[10]) };
  }
  return { ...out, raw: stdout };
}

// ---------------------------------------------------------------- Node lane (cached)
async function nodeLane() {
  const warm = Number(o['node-warmup']), n = Number(o['node-requests']);
  const key = sha(process.version, attribution.appSourceSha256, readFileSync(join(root, 'package-lock.json')), String([warm, n, o.route])).slice(0, 16);
  const cacheFile = join(o['cache-dir'], `node-${process.version}-${key}.json`);
  if (!o['refresh-node'] && existsSync(cacheFile)) { log(`node: cached result ${cacheFile}`); return { ...JSON.parse(readFileSync(cacheFile, 'utf8')), cached: true }; }
  const dist = join(scratch, 'node-dist');
  await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), '--outDir', dist, '--incremental', 'false']);
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules')); // resolve deps for dist/main.js
  const r = await callgrind('node', process.execPath, [join(dist, 'main.js')], { warmup: warm, requests: n, cwd: root, valgrindArgs: ['--smc-check=all-non-file'] });
  const res = { ...r, nodeVersion: process.version, cached: false,
    note: `Node under callgrind is ~50x slower, so only ${warm} warm-up + ${n} measured requests; V8 JIT (smc-check=all-non-file) is only partly warmed, treat as approximate` };
  mkdirSync(o['cache-dir'], { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(res, null, 2));
  return res;
}

// ---------------------------------------------------------------- run
const started = new Date();
const result = { schema: 'scriptc.nest-measure.v1', timestamp: started.toISOString(), args: { lane: o.lane, route: o.route, node: o.node, rps: o.rps }, attribution, lanes: {}, caveats: [] };
let failure = null;
try {
  log('building binaries from this worktree');
  const SRC = process.env.MEASURE_SOURCE === '1'; // callgrind the source-built (stats) runtime: sees uncommitted runtime edits without a pack rebuild
  const builds = await Promise.all(lanes.flatMap(l => SRC ? [build(l, true)] : [build(l, false), build(l, true)]));
  const bin = {}, statsBin = {};
  for (const b of builds) { (b.stats ? statsBin : bin)[b.lane] = b.binary; result.lanes[b.lane] ??= {}; if (!b.stats || SRC) { result.lanes[b.lane].binarySizeBytes = b.size; if (b.provenance) result.lanes[b.lane].provenance = b.provenance; } }
  for (const l of lanes) {
    result.lanes[l].callgrind = await callgrind(l, SRC ? statsBin[l] : bin[l], [], { warmup: Number(o.warmup), requests: Number(o.requests), cwd: root });
    result.lanes[l].counters = await counters(statsBin[l]);
    log(`${l}: ${result.lanes[l].callgrind.instrPerRequest} instr/req`);
  }
  if (o.node) result.node = await nodeLane();
  if (o.rps) { result.rps = await rps(bin); }
  if (lanes.some(l => result.lanes[l].counters.capsules === null)) result.caveats.push('capsules (typed_ref_new) counter does not exist in scr_stats.h; reported as null');
  result.caveats.push('counters come from the SCRIPTC_RUNTIME_STATS=1 flavor (source-built runtime); callgrind and rps use the normal release pack');
  if (o.node) result.caveats.push(result.node.note);
} catch (e) { failure = e; }

if (failure === null) {
  const cg = l => result.lanes[l]?.callgrind, ct = l => result.lanes[l]?.counters;
  const f = (v, d = 0) => v == null ? 'missing' : v.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cols = [...lanes.map(l => ({ name: l, cg: cg(l), ct: ct(l) })), ...(result.node ? [{ name: 'node', cg: result.node }] : [])];
  const rows = [
    ['instr/request (callgrind)', c => f(c.cg.instrPerRequest)],
    ['requests warm-up+measured', c => `${c.cg.warmupRequests}+${c.cg.measuredRequests}`],
    ['allocations/request', c => c.ct ? f(c.ct.allocations, 2) : '-'],
    ['frees/request', c => c.ct ? f(c.ct.frees, 2) : '-'],
    ['capsules/request', c => c.ct ? f(c.ct.capsules, 2) : '-'],
    ['cycle passes/request', c => c.ct ? f(c.ct.cyclePasses, 3) : '-'],
    ...(o.rps ? [['req/s (run.mjs)', c => f(result.rps?.[c.name]?.reqPerSecMedian)]] : []),
  ];
  const lines = [`| metric | ${cols.map(c => c.name).join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`, ...rows.map(([n, fn]) => `| ${n} | ${cols.map(fn).join(' | ')} |`)];
  const table = lines.join('\n');
  result.table = table;
  const text = JSON.stringify(result, null, 2);
  if (o.out) { mkdirSync(dirname(o.out), { recursive: true }); writeFileSync(o.out, text + '\n'); }
  console.log(text);
  console.log(`\ncompiler dist ${attribution.compilerDistSha256.slice(0, 12)}, runtime pack ${(attribution.runtimePackSha256 ?? 'none').slice(0, 12)}, git ${(attribution.gitHead ?? '?').slice(0, 9)}${attribution.gitDiffSha256 ? ` +dirty ${attribution.gitDiffSha256.slice(0, 8)}` : ''}\n`);
  console.log(table);
  for (const c of result.caveats) console.log(`note: ${c}`);
}
cleanup();
if (failure) { console.error(`measure failed: ${failure.message}`); process.exit(1); }

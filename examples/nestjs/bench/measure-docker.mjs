// Runs bench/measure.mjs inside a throwaway container (`docker run --rm`) built from the same image as
// `scriptc-legacy-gate` (plus valgrind, see Dockerfile.measure), with THIS script's worktree mounted at the same path. Takes measure.mjs's arguments.
//   node bench/measure-docker.mjs --lane both --node --provenance-cache ~/.cache/scriptc/provenance --out /abs/result.json
// The container has no network (the TS lane needs a pre-populated --provenance-cache, see README), a private /tmp
// (valgrind's vgdb pipes are per container, so parallel runs in other containers cannot interfere), and runs as your uid.
// Mounted: the worktree (rw), the provenance cache (ro), --cache-dir (rw, Node result cache), dirname(--out) (rw).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const image = process.env.MEASURE_IMAGE ?? 'scriptc-bench:local'; // scriptc-legacy-validation:local + valgrind (bench/Dockerfile.measure)
if (image === 'scriptc-bench:local' && spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.error(`[measure-docker] building ${image} (needs network once)`);
  if (spawnSync('docker', ['build', '-q', '-t', image, '-f', join(here, 'Dockerfile.measure'), here], { stdio: 'inherit' }).status !== 0) process.exit(1);
}
const argv = process.argv.slice(2);
const take = name => { const i = argv.indexOf(name); if (i < 0) return undefined; return resolve(argv[i + 1]); };
const abs = (name, fallback) => { const v = take(name) ?? fallback; const i = argv.indexOf(name); if (i >= 0) argv[i + 1] = v; else if (fallback) argv.push(name, v); return v; };
const mounts = new Map([[repo, 'rw']]);
const cache = take('--provenance-cache');
if (cache) { abs('--provenance-cache'); mounts.set(cache, 'ro'); }
const cacheDir = abs('--cache-dir', join(homedir(), '.cache', 'scriptc-bench'));
mkdirSync(cacheDir, { recursive: true });
mounts.set(cacheDir, 'rw');
const out = take('--out');
if (out) { abs('--out'); mkdirSync(dirname(out), { recursive: true }); mounts.set(dirname(out), 'rw'); }

const git = a => { try { return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const diff = git(['diff', 'HEAD']);
const env = { MEASURE_GIT_HEAD: git(['rev-parse', 'HEAD']), MEASURE_GIT_BRANCH: git(['rev-parse', '--abbrev-ref', 'HEAD']), MEASURE_GIT_DIFF: createHash('sha256').update(diff).digest('hex') };
const dockerArgs = ['run', '--rm', '--network', 'none', '--cap-add', 'SYS_PTRACE', '--user', `${process.getuid()}:${process.getgid()}`,
  '-e', 'HOME=/tmp', ...(process.env.MEASURE_PASS ?? '').split(',').filter(Boolean).flatMap(k => ['-e', `${k}=${process.env[k] ?? ''}`]), ...(process.env.MEASURE_SOURCE ? ['-e', 'MEASURE_SOURCE=' + process.env.MEASURE_SOURCE] : []), ...(process.env.SCRIPTC_YOUNG_NURSERY ? ['-e', 'SCRIPTC_YOUNG_NURSERY=' + process.env.SCRIPTC_YOUNG_NURSERY] : []), ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
  ...[...mounts].flatMap(([p, m]) => ['-v', `${p}:${p}:${m}`]),
  '-w', join(repo, 'examples/nestjs'), image, 'node', 'bench/measure.mjs', ...argv];
// `--cache-dir` defaults to ~/.cache inside measure.mjs; we always pass the absolute one.
if (!argv.includes('--cache-dir')) dockerArgs.push('--cache-dir', cacheDir);
const r = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
process.exit(r.status ?? 1);

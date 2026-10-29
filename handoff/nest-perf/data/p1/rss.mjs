// RSS stability: build the Nest example (default or ts lane), drive N requests, sample VmRSS per chunk.
// usage (inside the bench image, repo mounted): node rss.mjs <repo> <lane> [requests=100000] [chunks=10]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const [repo, lane = 'default', total = '100000', chunks = '10'] = process.argv.slice(2);
const root = join(repo, 'examples/nestjs');
const scratch = mkdtempSync(join(tmpdir(), 'scr-rss-'));
const port = 3917;
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const k of Object.keys(process.env)) if (k.startsWith('SCRIPTC_PROVENANCE_') && k !== 'SCRIPTC_PROVENANCE_CACHE') delete process.env[k];
if (lane === 'ts') { process.env.SCRIPTC_PROVENANCE_SOURCES = '1'; process.env.SCRIPTC_PROVENANCE_DECLARED = '1'; }
const compiler = await import(join(repo, 'packages/compiler/dist/index.js'));
if (lane === 'ts') await (await import(join(root, 'provenance-sources.mjs'))).applyProvenanceSources(compiler, join(root, 'src/main.ts'));
const outDir = join(scratch, 'out');
mkdirSync(outDir, { recursive: true });
const r = await compiler.compile(join(root, 'src/main.ts'), { outPath: join(outDir, 'program'), outDir, backend: 'llvm', npmStatic: 'auto', sanitize: false });
if (!r.ok) throw new Error(compiler.renderDiagnostics(r.diagnostics, r.sourceTexts, { color: false }));
const child = spawn(r.binaryPath, [], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
const get = () => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/hello/native', agent }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});
const rss = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, 'utf8'))[1]);
try {
  for (let i = 0; ; i++) { if (i > 3000) throw new Error('not ready'); try { if (await get() === 200) break; } catch {} await sleep(10); }
  let bad = 0;
  const drive = async n => { let c = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (c < n) { c++; if (await get() !== 200) bad++; } })); };
  await drive(2000);
  const samples = [rss()];
  const per = Number(total) / Number(chunks);
  for (let i = 0; i < Number(chunks); i++) { await drive(per); samples.push(rss()); }
  console.log(JSON.stringify({ lane, requests: Number(total), nonOk: bad, rssKbAfterWarmupThenPerChunk: samples }));
} finally { agent.destroy(); child.kill('SIGKILL'); rmSync(scratch, { recursive: true, force: true }); }

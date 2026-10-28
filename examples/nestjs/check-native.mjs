import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as compiler from '../../packages/compiler/dist/index.js';
import { applyProvenanceSources } from './provenance-sources.mjs';

const { compile, renderDiagnostics } = compiler;

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const sanitize = process.env.SCRIPTC_SAN === '1';

async function run(command, args) {
  try {
    const result = await exec(command, args, { encoding: 'buffer', timeout: 30_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    if (typeof error.code !== 'number' || !Buffer.isBuffer(error.stdout) || !Buffer.isBuffer(error.stderr)) throw error;
    return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
  }
}

function applicationStderr(bytes) {
  if (!sanitize) return bytes;
  return Buffer.from(bytes.toString('utf8').split('\n').filter(line =>
    !line.startsWith('scriptc RC audit skipped:') &&
    !/^==\d+==WARNING: ASan doesn't fully support makecontext\/swapcontext/.test(line),
  ).join('\n'));
}

await exec(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')]);
for (const [name, args] of [['metadata', []], ['context', []], ['main', ['--check']]]) {
  const outDir = join(root, 'dist/native', `${name}${sanitize ? '-san' : ''}`);
  mkdirSync(outDir, { recursive: true });
  await applyProvenanceSources(compiler, join(root, 'src', `${name}.ts`));
  const result = await compile(join(root, 'src', `${name}.ts`), {
    outPath: join(outDir, 'program'), outDir, backend: 'llvm', npmStatic: 'auto', sanitize,
  });
  if (!result.ok) throw new Error(renderDiagnostics(result.diagnostics, result.sourceTexts, { color: false }));
  const oracle = await run(process.execPath, [join(root, 'dist', `${name}.js`), ...args]);
  const native = await run(result.binaryPath, args);
  assert.equal(oracle.exitCode, 0, `${name}: Node acceptance must succeed`);
  assert.equal(native.exitCode, oracle.exitCode, `${name}: exit status\n${native.stderr.toString("utf8")}`);
  assert.deepEqual(native.stdout, oracle.stdout, `${name}: stdout`);
  assert.deepEqual(applicationStderr(native.stderr), oracle.stderr, `${name}: stderr`);
  console.log(`${name}: Node/native stdout, stderr, and exit status match`);
}

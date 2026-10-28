import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = join(import.meta.dirname, "../../..");
const cliEntry = join(repoRoot, "packages/cli/src/main.ts");
const tsxLoader = join(dirname(require.resolve("tsx/package.json")), "dist/loader.mjs");

const PROGRAM = `const n = Number(process.argv[2] ?? "10");
let total = 0;
for (let i = 0; i < n; i++) total += i % 3 === 0 ? i : 1;
console.log(\`total \${total}\`);
if (process.argv[3] === "exit") process.exit(3);
// Never runs in the profiled runs.
function depth(k: number): number {
  return k <= 0 ? 0 : 1 + depth(k - 1);
}
if (process.argv[3] === "depth") console.log(depth(n));
`;

async function scriptc(args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, ["--import", tsxLoader, cliEntry, ...args], {
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

test.skipIf(process.platform !== "linux")(
  "instrumented runs write profiles that merge and optimize the program, stale or not",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-profile-"));
    const env = { ...process.env, SCRIPTC_CACHE_DIR: join(dir, "cache") };
    const entry = join(dir, "main.ts");
    const raw = join(dir, "raw");
    try {
      await writeFile(entry, PROGRAM);
      const instrumented = join(dir, "instrumented");
      await scriptc(
        ["build", entry, "--profile-generate", join(raw, "%p.profraw"), "-o", instrumented],
        env,
      );
      expect((await execFileAsync(instrumented, ["1000"])).stdout).toBe("total 167499\n");
      // process.exit leaves through _Exit, which skips the profile runtime's
      // atexit writer; the runtime writes the profile itself.
      await expect(execFileAsync(instrumented, ["1000", "exit"])).rejects.toMatchObject({
        code: 3,
        stdout: "total 167499\n",
      });
      const profiles = (await readdir(raw)).filter((name) => name.endsWith(".profraw"));
      expect(profiles).toHaveLength(2);

      const merged = join(dir, "app.profdata");
      const merge = await scriptc(
        ["merge-profiles", "-o", merged, ...profiles.map((name) => join(raw, name))],
        env,
      );
      expect(merge.stdout).toBe(`${merged}\n`);

      const optimized = join(dir, "optimized");
      await scriptc(["build", entry, "--profile-use", merged, "-o", optimized], env);
      expect((await execFileAsync(optimized, ["1000"])).stdout).toBe("total 167499\n");

      // A sparse profile leaves out the runtime functions the runs never
      // reached.
      const sparse = join(dir, "sparse.profdata");
      await scriptc(
        ["merge-profiles", "--sparse", "-o", sparse, ...profiles.map((name) => join(raw, name))],
        env,
      );
      expect((await stat(sparse)).size).toBeLessThan((await stat(merged)).size);
      await scriptc(["build", entry, "--profile-use", sparse, "-o", optimized], env);
      expect((await execFileAsync(optimized, ["1000"])).stdout).toBe("total 167499\n");

      // A profile from an older version of the program still builds it.
      await writeFile(entry, PROGRAM + 'console.log("edited");\n');
      await scriptc(["build", entry, "--profile-use", merged, "-o", optimized], env);
      expect((await execFileAsync(optimized, ["1000"])).stdout).toBe("total 167499\nedited\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  300_000,
);

test("profile options are refused where they cannot apply", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-profile-refusal-"));
  const env = { ...process.env, SCRIPTC_CACHE_DIR: join(dir, "cache") };
  const entry = join(dir, "main.ts");
  try {
    await writeFile(entry, PROGRAM);
    for (const [args, message] of [
      [["build", entry, "--emit=llvm", "--profile-use", "a.profdata"], "--emit=exe"],
      [
        ["build", entry, "--profile-generate", "%p.profraw", "--profile-use", "a.profdata"],
        "cannot be combined",
      ],
      [["coverage", entry, "--profile-use", "a.profdata"], "build/run option"],
      [["merge-profiles", "a.profraw"], "merge-profiles takes -o"],
      [["merge-profiles", "-o", "out.profdata"], "merge-profiles takes -o"],
      [["build", entry, "--sparse"], "--sparse is a merge-profiles option"],
      [
        ["build", entry, "--optimization=dev", "--profile-use", join(dir, "a.profdata")],
        "optimized build",
      ],
      [["build", entry, "--profile-use", join(dir, "missing.profdata")], "cannot read"],
    ] as const) {
      await expect(scriptc([...args], env)).rejects.toMatchObject({
        stderr: expect.stringContaining(message),
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

const DYNAMIC = `function dyn(v) { return v; }
function read(o) { return o.x; }
function write(o, v) { o.x = v; }
function twice(f, v) { return f(f(v)); }
const shapes = [dyn({ x: 1 }), dyn({ x: 2, y: 0 }), dyn({ y: 0, x: 3 })];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o = shapes[i % 3];
  write(o, read(o) + 1);
  sum += twice(function (a) { return a + 1; }, read(o));
}
console.log("sum " + sum);
if (process.argv[2] === "exit") process.exit(0);
`;

test.skipIf(process.platform !== "linux")(
  "an instrumented dynamic program records type feedback that its profile-use build consumes",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-feedback-"));
    const env = { ...process.env, SCRIPTC_CACHE_DIR: join(dir, "cache") };
    const entry = join(dir, "main.js");
    const raw = join(dir, "raw");
    try {
      await writeFile(entry, DYNAMIC);
      const plain = join(dir, "plain");
      await scriptc(["build", entry, "--optimization=speed", "-o", plain], env);
      const expected = (await execFileAsync(plain)).stdout;
      const instrumented = join(dir, "instrumented");
      await scriptc(
        [
          "build",
          entry,
          "--optimization=speed",
          "--profile-generate",
          join(raw, "%p.profraw"),
          "-o",
          instrumented,
        ],
        env,
      );
      expect((await execFileAsync(instrumented)).stdout).toBe(expected);
      // process.exit leaves through _Exit; the feedback is written there too.
      expect((await execFileAsync(instrumented, ["exit"])).stdout).toBe(expected);
      const files = await readdir(raw);
      const feedback = files.filter((name) => name.endsWith(".jsfb"));
      expect(feedback).toHaveLength(2);
      const doc = JSON.parse(await readFile(join(raw, feedback[0]!), "utf8"));
      const read = doc.sites.find((s: { id: string }) => s.id.includes("|get:x|"));
      expect(read).toMatchObject({ count: 600, other: 0 });
      expect(read.obs).toHaveLength(3); // { x }, { x, y } and { y, x }
      const call = doc.sites.find((s: { id: string }) => s.id.endsWith("#c"));
      expect(call).toBeDefined();

      const merged = join(dir, "app.profdata");
      await scriptc(
        [
          "merge-profiles",
          "-o",
          merged,
          ...files.filter((n) => n.endsWith(".profraw")).map((n) => join(raw, n)),
        ],
        env,
      );
      const sidecar = JSON.parse(await readFile(`${merged}.jsfb`, "utf8"));
      expect(sidecar.sites.find((s: { id: string }) => s.id === read.id).count).toBe(1200);

      const optimized = join(dir, "optimized");
      await scriptc(
        ["build", entry, "--optimization=speed", "--profile-use", merged, "-o", optimized],
        env,
      );
      expect((await execFileAsync(optimized)).stdout).toBe(expected);

      // A damaged sidecar, and a profile of another version of the program,
      // leave the build correct.
      await writeFile(`${merged}.jsfb`, "{damaged");
      await scriptc(
        ["build", entry, "--optimization=speed", "--profile-use", merged, "-o", optimized],
        env,
      );
      expect((await execFileAsync(optimized)).stdout).toBe(expected);
      await writeFile(`${merged}.jsfb`, JSON.stringify(sidecar));
      await writeFile(
        entry,
        DYNAMIC.replace("o.x", "o.y").replace("function write", "var unused = 1;\nfunction write"),
      );
      await scriptc(
        ["build", entry, "--optimization=speed", "--profile-use", merged, "-o", optimized],
        env,
      );
      expect((await execFileAsync(optimized)).stdout).toMatch(/^sum /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  600_000,
);

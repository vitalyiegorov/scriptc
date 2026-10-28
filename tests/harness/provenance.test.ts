import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyze,
  compile,
  resolveProvenanceSources,
  setProvenanceSources,
} from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/greet/main.ts");
/* Suite-flavor segment: the plain and SCRIPTC_SAN=1 suites both run these
 * same (unsanitized) builds and may run concurrently — the suite lock is
 * per flavor — so they must never share a build dir. */
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance", flavor);

const EXPECTED = "hello, world\nHELLO, COMPILER!\nhello, chain!\n";

async function buildAndRun(name: string, program = entry): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, name);
  const result = await compile(program, { outPath, outDir, backend: "llvm" });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

afterEach(() => {
  setProvenanceSources(null);
  delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
});

describe("provenance sources", () => {
  test("attested source compiles natively and byte-matches the published dist under Node", async () => {
    const node = await execFileAsync(process.execPath, [entry], { encoding: "utf8" });
    expect(node.stdout).toBe(EXPECTED);

    // The manifest maps greeter to its source tree and compiles it as program modules.
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest.json");
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("greeter");
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.entries["greeter"]).toMatch(/attested-src\/greeter\/src\/index\.ts$/);
    setProvenanceSources(sources);
    const fromSource = await buildAndRun("greet-static");
    expect(fromSource).toBe(node.stdout);
  });

  test("maps a published dist/esm subpath to its unmodified TypeScript source", async () => {
    const subpathEntry = join(fixtureDir, "cases/echo/main.ts");
    const node = await execFileAsync("node", [subpathEntry], { encoding: "utf8" });
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest.json");
    const sources = await resolveProvenanceSources(subpathEntry);
    expect(sources.packages[0]?.entries["greeter/echo"]).toMatch(
      /attested-src\/greeter\/src\/echo\.ts$/,
    );
    setProvenanceSources(sources);
    expect(await buildAndRun("echo-static", subpathEntry)).toBe(node.stdout);
  });

  test("per-package attribution counts the source static; the @__PURE__ dead const elides", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest.json");
    setProvenanceSources(await resolveProvenanceSources(entry));
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    // No blockers anywhere: the dead const elided instead of fencing.
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.provenanceElided ?? []).toHaveLength(1);
    expect(coverage.provenanceElided![0]!.message).toContain("'Legacy'");
    // Attribution: every counted statement of the greeter source is
    // static (the elided declaration never counts — it lowers to nothing).
    const srcStats = [...(coverage.statsByFile ?? [])].filter(([f]) =>
      f.includes("attested-src/greeter/"),
    );
    expect(srcStats.length).toBeGreaterThan(0);
    for (const [, s] of srcStats) {
      expect(s.failed).toBe(0);
    }
  });

  test("a package that ships its own TypeScript compiles from it without an attestation", async () => {
    const shippedEntry = join(fixtureDir, "cases/shipped/main.ts");
    const node = await execFileAsync(process.execPath, [shippedEntry], { encoding: "utf8" });
    const sources = await resolveProvenanceSources(shippedEntry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("shipped");
    expect(pkg.dir).toBe(join(fixtureDir, "node_modules/shipped"));
    expect(pkg.entries["shipped"]).toMatch(/node_modules\/shipped\/src\/index\.ts$/);
    // Every exported subpath maps too: the driver's other dependencies may import it.
    expect(pkg.entries["shipped/extra"]).toMatch(/node_modules\/shipped\/src\/extra\.ts$/);
    setProvenanceSources(sources);
    expect(await buildAndRun("shipped-static", shippedEntry)).toBe(node.stdout);
  });

  test("a shipped `x!` over an undefined value keeps flowing as undefined instead of trapping", async () => {
    const assertedEntry = join(fixtureDir, "cases/asserted/main.ts");
    const node = await execFileAsync(process.execPath, [assertedEntry], { encoding: "utf8" });
    expect(node.stdout).toContain("m0 undef\n");
    const sources = await resolveProvenanceSources(assertedEntry);
    expect(sources.packages).toHaveLength(1);
    setProvenanceSources(sources);
    expect(await buildAndRun("asserted-static", assertedEntry)).toBe(node.stdout);
  });

  test("a class beside structural interface arms dispatches like innerFrom, keeps identity, and tells generic instances apart", async () => {
    const innerEntry = join(fixtureDir, "cases/inner/main.ts");
    const node = await execFileAsync(process.execPath, [innerEntry], { encoding: "utf8" });
    expect(node.stdout).toContain("true\n");
    setProvenanceSources(await resolveProvenanceSources(innerEntry));
    expect(await buildAndRun("inner-static", innerEntry)).toBe(node.stdout);
  });

  test("generic instances stay apart under different type arguments, and a rest overload of a generic function selects", async () => {
    const sharedEntry = join(fixtureDir, "cases/genshare/main.ts");
    const node = await execFileAsync(process.execPath, [sharedEntry], { encoding: "utf8" });
    expect(node.stdout).toBe("deferred\n1\ntrue\n1,2,3,1,1\n");
    setProvenanceSources(await resolveProvenanceSources(sharedEntry));
    expect(await buildAndRun("genshare-static", sharedEntry)).toBe(node.stdout);
  });

  test("shipped TypeScript reading DOM globals Node lacks throws Node's ReferenceError at the read", async () => {
    const domEntry = join(fixtureDir, "cases/domglobals/main.ts");
    const node = await execFileAsync(process.execPath, [domEntry], { encoding: "utf8" });
    expect(node.stdout).toBe("undefined\nReferenceError: requestAnimationFrame is not defined\n");
    const sources = await resolveProvenanceSources(domEntry);
    expect(sources.packages).toHaveLength(1);
    setProvenanceSources(sources);
    expect(await buildAndRun("domglobals-static", domEntry)).toBe(node.stdout);
  });

  test("unsupported code inside shipped TypeScript defers to a runtime throw instead of failing the build", async () => {
    for (const [name, expected] of [
      ["fenceunused", "ok\n1\n"],
      ["fencecalled", "ok\ntrue\ntrue\n1\n"],
    ] as const) {
      const caseEntry = join(fixtureDir, `cases/${name}/main.ts`);
      const node = await execFileAsync(process.execPath, [caseEntry], { encoding: "utf8" });
      expect(node.stdout).toBe(expected);
      setProvenanceSources(await resolveProvenanceSources(caseEntry));
      expect(await buildAndRun(`${name}-static`, caseEntry)).toBe(node.stdout);
      if (name === "fencecalled") {
        const { coverage } = analyze(caseEntry);
        expect(coverage.diagnostics).toHaveLength(0);
        expect((coverage.runtimeFences ?? []).map((d) => d.code)).toContain("SC2020");
      }
      setProvenanceSources(null);
    }
  });

  test("an unmappable source reports a note and uses native package resolution", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = join(fixtureDir, "manifest-broken.json");
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes).toHaveLength(1);
    expect(sources.notes[0]).toContain("greeter");
    expect(sources.notes[0]).toContain("published package resolution used");
    setProvenanceSources(sources);

    expect(await buildAndRun("greet-published")).toBe(EXPECTED);
  });
});

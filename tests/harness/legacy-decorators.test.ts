import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);

test("legacy decorated heritage preserves callable bases and names incompatible native storage", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "scriptc-legacy-heritage-"));
  try {
    const entry = join(outDir, "main.ts");
    writeFileSync(
      join(outDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          experimentalDecorators: true,
          strict: true,
          target: "ES2022",
          types: [],
        },
      }),
    );
    writeFileSync(
      entry,
      `
function Ordinary(this: any, value: number): void { this.value = value; }
function callable(target: any): any { return Ordinary; }
@callable class CallableBase { constructor(value: number) {} }
class CallableChild extends CallableBase { constructor() { super(7); } }
console.log((new CallableChild() as any).value);
class Replacement { private value = 11; }
function replace(target: any): any { return Replacement; }
@replace class Original {}
class Derived extends Original {}
try { new Derived(); } catch (error: any) { console.log(error.name, error.message.includes("replacement native class")); }
`,
    );
    const result = await compile(entry, {
      backend: "llvm",
      sanitize: process.env["SCRIPTC_SAN"] === "1",
      outDir,
      outPath: join(outDir, "program"),
    });
    if (!result.ok)
      throw new Error(
        result.diagnostics
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
          .join("\n"),
      );
    const { stdout, stderr } = await execFileAsync(result.binaryPath, [], { encoding: "utf8" });
    expect(stdout).toBe("7\nError true\n");
    expect(stderr).toBe("");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120_000);

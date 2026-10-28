import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../src/index.js";

test.each([
  "const value = (this.value = 1); console.log(value);",
  "exports.value = 1; const value = this.value; console.log(value);",
  "const read = () => this.value; exports.value = 1; console.log(read());",
])("initial CommonJS helper reads preserve the mutation boundary: %s", async (source) => {
  const root = mkdtempSync(join(tmpdir(), "scriptc-cjs-helper-"));
  try {
    const file = join(root, "main.cjs");
    writeFileSync(file, source);
    const outPath = join(root, "program.ir");
    const result = await compile(file, { outputKind: "ir", outPath, outDir: root });
    expect(result.ok).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("SC1090");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

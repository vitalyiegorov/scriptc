import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as ts from "./ts7/adapter.js";
import { Ts7Api } from "./ts7/rpc-api.js";
import { Ts7Host } from "./ts7/program-host.js";
import { erasedTypeOnlyImport } from "./type-only-imports.js";

const SOURCE =
  'import { A } from "./a";\n' +
  'import { B } from "./b";\n' +
  'import { C, D } from "./c";\n' +
  'import { E } from "./e";\n' +
  'import { F } from "./f";\n' +
  "export interface I extends A {}\n" +
  "export type T = typeof D;\n" +
  "export class K extends B<C> {}\n" +
  "export function g(x: E): F { return new F(); }\n";

function erasedImports(root: string, file: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-type-only-imports-"));
  const entry = join(directory, root, file);
  mkdirSync(join(directory, root), { recursive: true });
  const host = new Ts7Host((options) => new Ts7Api(options), { cwd: directory });
  writeFileSync(entry, "export {};\n");
  host.addVirtualFile(entry, SOURCE);
  const program = host.createProgram([entry], { noLib: true, types: [] });
  try {
    const source = program.getSourceFile(entry)!;
    return source.statements.nodes
      .filter(ts.isImportDeclaration)
      .filter((stmt) => erasedTypeOnlyImport(stmt))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
  } finally {
    program.dispose();
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a dependency's imports used only as types are erased like its compiler's emit", () => {
  // A and C/D appear in types only; B (class extends) and F (new) are
  // values; E is a parameter type only.
  expect(erasedImports("node_modules/pkg/src", "index.ts")).toEqual(["./a", "./c", "./e"]);
});

test("a project file keeps every import not written as an erased type import", () => {
  expect(erasedImports("src", "index.ts")).toEqual([]);
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../src/index.js";

test("legacy lowering preserves the original decorator contract diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-legacy-typecheck-"));
  try {
    const entry = join(directory, "main.ts");
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          experimentalDecorators: true,
          target: "ES2022",
          types: [],
        },
      }),
    );
    writeFileSync(
      entry,
      "function invalid(target: number): void {}\n@invalid class Target {}\nconsole.log(new Target());\n",
    );
    const result = await compile(entry, {
      outputKind: "ir",
      outDir: directory,
      outPath: join(directory, "main.ir"),
    });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Unable to resolve signature of class decorator"),
      ),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([
  {
    name: "assignment-semantics class fields",
    options: { useDefineForClassFields: false },
    source:
      "function dec(target: any, key: string): void {}\nclass Target { @dec value = 1; }\nconsole.log(new Target().value);\n",
    expected: ["SC0002", "useDefineForClassFields"],
  },
  {
    name: "a class decorator returning a subclass of its target",
    options: {},
    source:
      "function extend<T extends new (...args: any[]) => any>(target: T): T { return class extends target { extra = 1; }; }\n@extend class Target {}\nconsole.log(new Target());\n",
    expected: ["SC1090", "extends its untyped parameter"],
  },
  {
    name: "an unassigned decorated declare field",
    options: {},
    source:
      "function dec(target: any, key: string): void {}\nclass Target { @dec declare kind: string; }\nconsole.log(new Target().kind);\n",
    expected: ["SC1090", "'declare' fields not assigned"],
  },
])("legacy decorators refuse $name explicitly", async ({ options, source, expected }) => {
  const directory = mkdtempSync(join(tmpdir(), "scriptc-legacy-refusal-"));
  try {
    const entry = join(directory, "main.ts");
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          experimentalDecorators: true,
          target: "ES2022",
          types: [],
          ...options,
        },
      }),
    );
    writeFileSync(entry, source);
    const result = await compile(entry, {
      outputKind: "ir",
      outDir: directory,
      outPath: join(directory, "main.ir"),
    });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === expected[0] && diagnostic.message.includes(expected[1]!),
      ),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

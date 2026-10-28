import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as ts from "./ts7/adapter.js";
import { createProgram, Ts7Host } from "./ts7/program-adapter.js";
import { legacyMetadataEntries } from "./legacy-metadata.js";

function metadata(
  source: string,
  strictNullChecks = true,
  decoratedOnly = false,
): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-legacy-metadata-"));
  const host = new Ts7Host({ cwd: dir });
  const file = join(dir, "main.ts");
  host.addVirtualFile(file, source);
  host.addVirtualFile(
    join(dir, "dependency.ts"),
    "export class Dependency {}\nexport interface Shape { x: number }\n",
  );
  const program = createProgram(
    [file],
    { types: [], strictNullChecks, target: ts.ScriptTarget.ESNext },
    host,
  );
  try {
    const result: Record<string, unknown> = {};
    const checker = program.getTypeChecker();
    for (const declaration of program.getSourceFile(file)!.statements.nodes) {
      if (!ts.isClassDeclaration(declaration) || declaration.name?.text !== "Target") continue;
      const entries = (node: ts.ClassLikeDeclaration | ts.ClassElement) =>
        Object.fromEntries(
          legacyMetadataEntries(checker, node, declaration, {
            strictNullChecks,
            target: "esnext",
          }).map(({ key, value }) => [key, value]),
        );
      result["class"] = entries(declaration);
      for (const member of declaration.members.nodes) {
        if (member.name && (!decoratedOnly || member.modifiers?.nodes.some(ts.isDecorator)))
          result[ts.getTextOfNode(member.name)] = entries(member);
      }
    }
    return result;
  } finally {
    program.dispose();
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("serializes syntax rather than inferred native types", () => {
  const result = metadata(`
class Dependency {}
interface Shape { x: number }
class Target {
  constructor(value: Dependency, shape: Shape) {}
  inferred = 1;
  primitive!: string;
  tuple!: [string, number];
  callback!: () => void;
  object!: { x: number };
  symbol!: symbol;
  bigint!: bigint;
  method(this: Target, value: number, ...rest: string[]): boolean { return true; }
  inferredReturn() { return 1; }
  async asyncReturn() { return 1; }
  voidReturn(): void {}
}
`);
  expect(result).toEqual({
    class: { "design:paramtypes": "[Dependency, Object]" },
    inferred: { "design:type": "Object" },
    primitive: { "design:type": "String" },
    tuple: { "design:type": "Array" },
    callback: { "design:type": "Function" },
    object: { "design:type": "Object" },
    symbol: { "design:type": "Symbol" },
    bigint: { "design:type": "BigInt" },
    method: {
      "design:type": "Function",
      "design:paramtypes": "[Number, String]",
      "design:returntype": "Boolean",
    },
    inferredReturn: {
      "design:type": "Function",
      "design:paramtypes": "[]",
      "design:returntype": "void 0",
    },
    asyncReturn: {
      "design:type": "Function",
      "design:paramtypes": "[]",
      "design:returntype": "Promise",
    },
    voidReturn: {
      "design:type": "Function",
      "design:paramtypes": "[]",
      "design:returntype": "void 0",
    },
  });
});

test("preserves value imports, erases type-only class imports to Function, and retains forward reads", () => {
  expect(
    metadata(`
import { Dependency, Shape } from './dependency';
import type { Dependency as TypeOnly } from './dependency';
import type * as Types from './dependency';
class Target {
  constructor(value: Dependency, erased: TypeOnly, shape: Shape, namespaced: Types.Dependency, forward: Later) {}
}
class Later {}
`),
  ).toEqual({
    class: {
      "design:paramtypes": `[Dependency, Function, Object, Function, (() => { throw new ReferenceError("Cannot access 'Later' before initialization"); })()]`,
    },
  });
});

test("unions, aliases, conditional types, and readonly arrays follow serialization erasure", () => {
  expect(
    metadata(`
type Count = 1 | 2;
type Words = 'a' | 'b';
type Values = number[];
type Call = () => void;
class Target {
  union!: string | number;
  nullable!: string | null;
  literals!: 'a' | 'b';
  unknown!: string & unknown;
  conditional!: number extends string ? string : number;
  readonly!: readonly number[];
  alias!: Count;
  words!: Words;
  values!: Values;
  call!: Call;
}
`),
  ).toMatchObject({
    union: { "design:type": "Object" },
    nullable: { "design:type": "Object" },
    literals: { "design:type": "String" },
    unknown: { "design:type": "String" },
    conditional: { "design:type": "Object" },
    readonly: { "design:type": "Array" },
    alias: { "design:type": "Number" },
    words: { "design:type": "String" },
    values: { "design:type": "Array" },
    call: { "design:type": "Function" },
  });
  expect(metadata("class Target { nullable!: string | null; }", false)).toMatchObject({
    nullable: { "design:type": "String" },
  });
});

test("paired accessors use the setter type and parameter list; inherited constructors emit nothing", () => {
  expect(
    metadata(`
class Base { constructor(value: string) {} }
class Target extends Base {
  get value(): number { return 1; }
  set value(next: number) {}
}
`),
  ).toEqual({
    class: {},
    value: { "design:type": "Number", "design:paramtypes": "[Number]" },
  });
});

test("accessor pairs share canonical keys across identifier, string, numeric, and computed spellings", () => {
  const result = metadata(`
class Target {
  get x(): unknown { return undefined; }
  set "x"(next: number) {}
  get 0x10(): unknown { return undefined; }
  set "16"(next: string) {}
  get ["computed"](): unknown { return undefined; }
  set computed(next: boolean) {}
  static get split(): unknown { return undefined; }
  set "split"(next: number) {}
}
`);
  expect(result["x"]).toEqual({ "design:type": "Number", "design:paramtypes": "[Number]" });
  expect(result["0x10"]).toEqual({ "design:type": "String", "design:paramtypes": "[String]" });
  expect(result['["computed"]']).toEqual({
    "design:type": "Boolean",
    "design:paramtypes": "[Boolean]",
  });
  expect(result["split"]).toEqual({ "design:type": "Object", "design:paramtypes": "[]" });
});

test("matches the pinned TypeScript emitter for decorated signatures and imported types", () => {
  const source = `
import { Dependency } from './dependency';
import type { Dependency as TypeOnly } from './dependency';
function dec(...args: any[]): any {}
interface Shape { x: number }
type Count = 1 | 2;
type Values<T> = T[];
type Branded = string & { brand: true };
@dec
class Target<T extends string, V extends undefined> {
  constructor(value: Dependency, erased: TypeOnly, shape: Shape) {}
  @dec inferred = 1;
  @dec primitive!: string;
  @dec array!: readonly number[];
  @dec tuple!: [string, number];
  @dec literal!: 'a' | 'b';
  @dec nullable!: string | null;
  @dec unknown!: number & unknown;
  @dec symbol!: symbol;
  @dec bigint!: bigint;
  @dec alias!: Count;
  @dec branded!: Branded;
  @dec promise!: Promise<number>;
  @dec generic!: T;
  @dec voidGeneric!: V;
  @dec get value(): number { return 1; }
  set value(next: number) {}
  @dec get x(): unknown { return undefined; }
  set "x"(next: number) {}
  @dec get 0x10(): unknown { return undefined; }
  set "16"(next: string) {}
  @dec get ["computed"](): unknown { return undefined; }
  set computed(next: boolean) {}
  @dec method(this: Target<T, V>, value: number, ...rest: Values<string>): boolean { return true; }
  @dec inferredReturn() { return 1; }
  @dec async asyncReturn() { return 1; }
  @dec assert(value: unknown): asserts value is number {}
}
`;
  const dir = mkdtempSync(join(tmpdir(), "scriptc-metadata-oracle-"));
  try {
    const file = join(dir, "main.ts");
    writeFileSync(file, source);
    writeFileSync(join(dir, "dependency.ts"), "export class Dependency {}\n");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          types: [],
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        files: ["main.ts"],
      }),
    );
    // The oracle is a separate compiler process. Its AST never enters the
    // native checker/parser world used by the implementation under test.
    const require = createRequire(import.meta.url);
    execFileSync(process.execPath, [
      require.resolve("typescript5/bin/tsc"),
      "--project",
      join(dir, "tsconfig.json"),
    ]);
    const emitted = readFileSync(join(dir, "main.js"), "utf8");
    const expected = [...emitted.matchAll(/__metadata\("([^"]+)", (.+)\)/g)].map((match) => [
      match[1],
      match[2]!.replace(/\s+/g, ""),
    ]);
    const actual = metadata(source, true, true);
    const ordered = [
      ...Object.entries(actual).filter(([key]) => key !== "class"),
      ["class", actual["class"]],
    ];
    const entries = ordered
      .flatMap(([, value]) => Object.entries(value as Record<string, string>))
      .map(([key, value]) => [key, value.replace(/\s+/g, "")]);
    expect(expected.length).toBeGreaterThan(20);
    expect(entries).toEqual(expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

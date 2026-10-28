import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import * as ts from "./ts7/adapter.js";
import { createProgram, Ts7Host } from "./ts7/program-adapter.js";
import {
  genericLegacyDecoratorSignatures,
  lowerLegacyDecorators,
  registerLegacyDecoratorClasses,
  registerTranspiledLegacyDecoratorClasses,
} from "./legacy-decorators.js";

function compare(source: string, emitDecoratorMetadata = false): void {
  source = `declare let result: any;\n${source}`;
  const dir = mkdtempSync(join(tmpdir(), "scriptc-legacy-decorators-"));
  const file = join(dir, "main.ts");
  const host = new Ts7Host({ cwd: dir });
  host.addVirtualFile(file, source);
  const program = createProgram(
    [file],
    { types: [], experimentalDecorators: true, target: ts.ScriptTarget.ESNext },
    host,
  );
  try {
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
        .map((diagnostic) => diagnostic.code),
    ).toEqual([]);
    const lowered = lowerLegacyDecorators(program.getSourceFile(file)!, program.getTypeChecker(), {
      emitDecoratorMetadata,
      genericSignatures: genericLegacyDecoratorSignatures(
        program.getImplementationSourceFiles(),
        program.getTypeChecker(),
      ),
    })!;
    const evaluate = (text: string): unknown => {
      // The oracle stays in its own process; only source strings cross
      // between TypeScript 5 and the compiler's TypeScript 7 world.
      const javascript = execFileSync(
        process.execPath,
        [
          "-e",
          `const ts = require(process.argv[1]); const fs = require('node:fs'); process.stdout.write(ts.transpileModule(fs.readFileSync(0, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: ${emitDecoratorMetadata}, module: ts.ModuleKind.CommonJS } }).outputText);`,
          createRequire(import.meta.url).resolve("typescript5"),
        ],
        { input: text, encoding: "utf8" },
      );
      const context = { result: undefined, exports: {} };
      runInNewContext(javascript, context);
      return JSON.stringify(context.result);
    };
    expect(evaluate(lowered.text)).toEqual(evaluate(source));
    host.addVirtualFile(file, lowered.text);
    const rewritten = createProgram([file], { types: [], target: ts.ScriptTarget.ESNext }, host);
    try {
      expect(
        ts
          .getPreEmitDiagnostics(rewritten)
          .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
          .map((diagnostic) => [diagnostic.code, diagnostic]),
      ).toEqual([]);
      const classes = new Set<ts.Node>();
      registerLegacyDecoratorClasses(rewritten.getSourceFile(file)!, lowered, classes);
      expect(classes.size).toBeGreaterThan(0);
    } finally {
      rewritten.dispose();
    }
  } finally {
    program.dispose();
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("matches legacy evaluation order, descriptors and accessor pairs", () => {
  compare(`
const events: string[] = [];
function dec(label: string): any {
  events.push('evaluate:' + label);
  return (...args: any[]) => {
    events.push('apply:' + label + ':' + String(args[1]) + ':' + String(args[2]?.value !== undefined));
    if (args[2]?.get) { const get = args[2].get; args[2].get = function () { return get.call(this) + 10; }; }
  };
}
@dec('class') /* class in trivia */ class Target {
  static { events.push('static'); }
  @dec('static') static method() {}
  @dec('field') field = 1;
  @dec('method-outer') @dec('method-inner') method(@dec('parameter-0') x: number, @dec('parameter-1') y: string) {}
  @dec('getter') get value() { return this.field; }
  set value(v: number) { this.field = v; }
  constructor(@dec('ctor-0') x: number, @dec('ctor-1') y: string) {}
}
const instance = new Target(1, 'x'); instance.value = 4;
result = [events, instance.value, Object.getOwnPropertyDescriptor(Target.prototype, 'method')!.enumerable];
`);
});

test("captures computed keys once before decorator factories", () => {
  compare(`
const events: string[] = [];
function key(): string { events.push('key'); return 'method'; }
function dec(): any { events.push('factory'); return (_: any, key: any) => { events.push(key); }; }
class Target { @dec() [key()]() {} }
result = events;
`);
});

test("keeps the lexical class name while replacing its outer binding", () => {
  compare(`
let original: any;
function dec<T extends Function>(target: T): any { original = target; return class extends (target as any) { replacement = true; }; }
@dec class Target { static self() { return Target; } }
result = [Target !== original, original.self() === original, (new Target() as any).replacement];
`);
});

test("rewrites abstract and default export declarations as valid statements", () => {
  compare(
    `function dec(target: any): void {} @dec export default abstract class Target { abstract method(): void; } result = typeof Target;`,
  );
});

test("erases decorated generic class storage while keeping its type alias", () => {
  compare(`
function dec<T extends Function>(target: T): void {}
@dec class Target<T extends object = object> { constructor(public value: T) {} read(): T { return this.value; } }
result = new Target<{ value: number }>({ value: 7 }).read().value;
`);
});

test("decorates anonymous default exports and nested declarations", () => {
  compare(`
const events: string[] = [];
function dec(target: any): void { events.push(target.name); }
@dec export default class { value = 1; }
class Outer { method() { @dec class Nested { value = 2; } return new Nested().value; } }
result = [events, new Outer().method()];
`);
});

test("evaluates metadata type values eagerly without a metadata provider", () => {
  compare(
    `
function dec(...args: any[]): void {}
try {
  @dec class Target { constructor(value: Later) {} }
  class Later {}
  result = 'did not throw';
} catch (error) { result = (error as Error).name; }
`,
    true,
  );
});

test("composes outer self aliases with nested decorator expressions", () => {
  compare(`
let original: any;
class Replacement {}
function replace(target: any): any { original = target; return Replacement; }
let captured: any;
function capture(value: any): ClassDecorator { captured = value; return () => {}; }
@replace class Outer { run() { @capture(Outer) class Inner {} return Inner; } }
new original().run();
result = captured === Outer;
`);
});

test("skips falsy decorators and delegates to an installed Reflect.decorate", () => {
  compare(`
const absent: any = undefined;
@absent class Skipped {}
const events: string[] = [];
function dec(target: any): void { events.push('apply'); }
(Reflect as any).decorate = (decorators: any[], target: any) => { events.push('reflect:' + decorators.length); return target; };
@dec class Target {}
result = [events, typeof Skipped, typeof Target];
`);
});

test("retains property decorator argument count and descriptor results", () => {
  compare(`
const events: number[] = [];
function dec(...args: any[]): any { events.push(args.length); return { value: 8, writable: true, configurable: true }; }
class Target { @dec field!: number; }
result = [events, Object.getOwnPropertyDescriptor(Target.prototype, 'field')!.value];
`);
});

test("pins custom generic decorator factory results", () => {
  compare(`
type Tag = <T extends Function>(target: T) => T | void;
function factory(): Tag { return target => { (target as any).tag = 7; }; }
@factory() class Target {}
result = (Target as any).tag;
`);
});

test("avoids generated name collisions with escaped source identifiers", () => {
  compare(String.raw`
const \u005f_scriptc_legacy_0 = 41;
function dec(target: any): void {}
@dec class Target {}
result = __scriptc_legacy_0 + 1;
`);
});

test("groups equivalent accessor spellings at the decorated accessor position", () => {
  compare(`
const events: string[] = [];
function dec(...args: any[]): void { events.push('accessor'); args[2].get = () => 42; }
function parameter(...args: any[]): void { events.push('parameter'); }
class Target { @dec get x() { return 1; } set "x"(@parameter value: number) {} }
result = [events, new Target().x];
`);
});

test("keeps dynamic accessor declarations separate", () => {
  compare(`
let index = 0; const events: string[] = [];
function key(): string { return 'key' + index++; }
function dec(...args: any[]): void { events.push('get:' + args[1]); }
function parameter(...args: any[]): void { events.push('parameter:' + args[1]); }
class Target { @dec get [key()]() { return 1; } set [key()](@parameter value: number) {} }
result = events;
`);
});

test("keeps merged namespace exports live on the decorated constructor", () => {
  compare(`
function dec(target: any): void {}
@dec class Target {}
namespace Target { export let value = 1; export const label = 'merged'; export function increment() { value++; } }
Target.increment();
(Target as any).value = 9;
result = [Target.value, Target.label];
`);
});

test("retains merged interfaces and abstract members only in the type world", () => {
  compare(`
function dec(target: any): void {}
interface Target { value: number; }
@dec abstract class Target { value = 1; abstract method(): number; }
class Child extends Target { method() { return this.value; } }
result = new Child().method();
`);
});

test("erases class generic parameters in heritage and generic method constraints", () => {
  compare(`
function dec(target: any): void {}
class Base<T> { value!: T; }
@dec class Target<T> extends Base<T> { identity<U extends T>(value: U): U { return value; } }
result = new Target<number>().identity(7);
`);
});

test("preserves shorthand self-reference keys after class replacement", () => {
  compare(`
let original: any; class Replacement {}
function dec(target: any): any { original = target; return Replacement; }
@dec class Target { self() { return {Target}; } }
result = new original().self().Target === Target;
`);
});

test("reads decorator targets after evaluating factories", () => {
  compare(`
const events: boolean[] = []; class Replacement {}
function factory(): any { (Target as any) = Replacement; return (target: any) => { events.push(target === Replacement.prototype); }; }
class Target { @factory() method() {} }
result = events;
`);
});

test("evaluates decorated unique symbol field getters once", () => {
  compare(`
 const events: string[] = []; const key: unique symbol = Symbol();
 const keys = { get field(): typeof key { events.push("key"); return key; } };
 function dec(...args: any[]): void { events.push("dec"); }
 class Target { @dec [keys.field] = 1; }
 result = [events, new Target()[key]];
 `);
});

test("registers published JavaScript targets by their tslib import identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-legacy-tslib-"));
  const file = join(dir, "main.js");
  const host = new Ts7Host({ cwd: dir });
  host.addVirtualFile(
    file,
    `import { __decorate as apply } from "tslib"; let Target = class Target { method() {} }; apply([], Target.prototype, "method", null); var Aliased_1; let Aliased = Aliased_1 = class Aliased {}; Aliased = Aliased_1 = apply([], Aliased); function __decorate(...args) {} class Other {} __decorate([], Other.prototype, "method", null);`,
  );
  const program = createProgram(
    [file],
    { allowJs: true, types: [], target: ts.ScriptTarget.ESNext },
    host,
  );
  try {
    const classes = new Set<ts.Node>();
    registerTranspiledLegacyDecoratorClasses(program, classes);
    expect(
      [...classes].map((node) => (ts.isClassExpression(node) ? node.name?.text : undefined)),
    ).toEqual(["Target", "Aliased"]);
  } finally {
    program.dispose();
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publishes merged namespace exports during each initializer and across blocks", () => {
  compare(
    `function dec(target: any): void {} @dec class A {} namespace A { export const x = 1, y = A.x; export let {left, right = left} = {left: 2, right: undefined as number | undefined}; } result = [A.x, A.y, A.left, A.right];`,
  );
  compare(
    `function dec(target: any): void {} @dec class A {} namespace A { export let x = 1; } namespace A { export function f() { return x; } } A.x = 2; result = A.f();`,
  );
});

test("keeps parenthesized computed accessor names separate like the legacy emitter", () => {
  compare(
    `const events: string[] = []; function dec(...args:any[]):void { events.push("get"); } function param(...args:any[]):void { events.push("param"); } class A { @dec get [("x")]() { return 1; } set x(@param value: number) {} } result = events;`,
  );
});

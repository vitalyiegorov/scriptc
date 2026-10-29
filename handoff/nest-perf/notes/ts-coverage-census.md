# TypeScript coverage census: what the static tier still refuses in real TS sources

Measured 2026-10-26 on branch t3/ff1a7fe4 (compiler `dist` as built at the time, uncommitted edits from other agents included). Analysis only, no compiler sources edited.

## Method

- Sources: shallow clones at release tags (rxjs 7.8.2, zod v4.6.7, date-fns v4.4.0, class-transformer v0.5.1, inversify monorepo `@inversifyjs/*` plus `inversify` 8.2.3, hono v4.13.14, typeorm 1.1.2, nest v12.2.0). The npm packages were installed beside them so dependencies resolve. Nest's own sources were fetched by the provenance resolver from the package's gitHead (af37111368) because the v12.2.0 clone made the compiler crash (see Crashes).
- Mechanism: `analyze(entry, { tier: "static-only", explainDynamic: true })` from `packages/compiler/dist/index.js`, with `SCRIPTC_PROVENANCE_MANIFEST` mapping each package name to its clone directory, then `resolveProvenanceSources` + `setProvenanceSources` (the same path as `SCRIPTC_PROVENANCE_SOURCES=1`). No native link. Scripts lived in `/tmp/census-scripts` (deleted).
- Data source: `coverage.tiers.requests`, which lists every committed refusal and runtime fence (reached and unreached), with unit and enclosing function. This is far more than `coverage.diagnostics`, which carries only 0-5 entries: most refusals are compiled to runtime fences (`statementsFailed`), and the build fails only on the few reached ones. Default and `static-only` tier modes are identical today (demotion not landed), so these are all refusals.
- Counting: unique `(file, line, message)`; `SC2004` ("uses inherit the blocker on its declaration") is propagation and excluded from family counts (445 sites in total, listed per package below). "Lines" counts unique source lines per family, which removes the 9-24x message fan-out of one site (for example the nine `Reflect.*` messages from one line).
- Drivers were small API tours (`drv/*.ts`): rxjs operators, `z.object().safeParse`, date-fns `format/addDays/parseISO`, class-transformer `plainToInstance`, `Container.bind().get`, `new Hono().get().request`, typeorm `DataSource` + `EntitySchema`, `NestFactory.createApplicationContext`. The analysis lowers the whole imported source graph (unreached bodies too), so the driver barely matters for the counts. Decorator-based drivers were run separately (see Decorators).

## Per-package totals (static-only, source-mapped)

| package | stmts total | failed (fenced) | dynamic | root sites | SC2004 propagated | notes |
|---|---|---|---|---|---|---|
| rxjs 7.8.2 | 774 | 22 | 277 | 42 | 9 | already heavily worked (corpus 8400-8517) |
| zod 4.6.7 | 806 | 188 | 88 | 458 | 104 | most refusals sit in the json-schema/to-json-schema/visit paths |
| date-fns 4.4.0 | 758 | 42 | 114 | 133 | 65 | |
| class-transformer 0.5.1 | 275 | 12 | 163 | 39 | 6 | decorator-free driver |
| inversify (+6 @inversifyjs) | 1699 | 167 | 706 | 233 | 48 | |
| hono 4.13.14 | 762 | 74 | 146 | 220 | 6 | 181 of the messages are one generic-class pattern (about 40 lines) |
| typeorm 1.1.2 | 15570 | 267 | 6685 | 493 | 77 | plus `tinyglobby` mapped; `debug` has no .d.ts |
| nest 12.2.0 (common+core, rxjs) | 6076 | 573 | 2486 | 626 | 130 | 264 root sites are one tooling gap (below) |
| class-validator 0.15.1 | n/a | n/a | n/a | n/a | n/a | compiler crash with sources mapped; see Crashes |

## Ranked families (packages affected x unique lines; counts are lines in 8 measured packages)

| # | family | pkgs | lines | per-package lines | fix size | kind | rxjs 8400-8517 coverage |
|---|---|---|---|---|---|---|---|
| 1 | any/unknown <-> static boundary: casts from unknown/any to recursive or function-bearing interfaces, `any` members and elements, `unknown` slots | 7 | 494 | zod 299, typeorm 93, nest 53, inversify 38, rxjs 6, date-fns 4, hono 1 | L | needs IR/runtime work (checked-dynamic cast to non-JSON shapes, recursive record validation) plus type mapping | partly: 8411, 8413-8415, 8431, 8480 made `any` params/fields/arrays/rest tails work; recursive/function-bearing casts untouched |
| 2 | Stdlib and @types/node members without lowering: `Object.assign`, `Object.keys` on some shapes, `Promise.all` tuple/combined result, `string\|symbol.toString`, `this.constructor`, `Function.prototype`, `Map<...>.set` on unsupported key types, `Iterator.return`, `TemplateStringsArray.raw`, `require`/`exports` | 8 | 214 | typeorm 95, inversify 42, nest 46, zod 16, hono 10, date-fns 3, class-transformer 1, rxjs 1 | M (many small lowerings; each S) | lowering change per member (runtime helper where needed) | 8421, 8422 touched builtin statics/bind; no coverage of the listed members |
| 3 | Function values: optional/default params as values, generic functions as values (`xs.map(id)`), `Function.prototype.bind` with unrepresentable signature, `arguments.length` in optional/rest functions, method calls on `a \|\| b` receivers, generic arrows capturing frames | 8 | 122 | inversify 26, nest 39, typeorm 24, zod 14, rxjs 9, hono 5, date-fns 3, class-transformer 2 | M | lowering change (function-value adapters; arity thunks) | 8411, 8422, 8430, 8511, 8515 cover related adapters (any-param values, bind, spread args, optional slots); generics-as-values still refused |
| 4 | Union layouts: conversion with no unambiguous layout (`this as A \| B`, `null \| Subject<T>` to `null \| Subject<unknown>`), union reads/logical ops outside conditions, string conversion of object-arm unions | 7 | 129 | date-fns 48, nest 24, inversify 21, zod 13, rxjs 5, hono 7, typeorm 11 | M-L | type-mapping change (union layout selection) plus lowering of narrow-free operators | 8400, 8510, 8512, 8517 (union protocol views, conditional union pattern) |
| 5 | Generic-class instances with several type-argument tuples (`Context<unknown,unknown,unknown>` x10): `this` and arrow-field members mismatch `Foo%a` vs `Foo%b`; `as this` casts; class values with differing constructor signatures | 7 | 98 | hono 40, typeorm 23, nest 16, inversify 14, date-fns 2, rxjs 2, zod 1 | M-L | lowering change (generic-class identity per instantiation, `this` typing) | well covered: 8440, 8450-8452, 8470, 8500, 8501, 8513, 8516; hono still hits it (see repro note) |
| 6 | Spread/assign/update shapes: `x._count++` on `any` member, assignment to non-variable/non-array element, spreads of differing element types into literals, short-circuit assignment, `Object` spread with absent earlier contributor | 6 | 92 | nest 30, typeorm 28, zod 17, inversify 7, hono 6, rxjs 4 | S-M | lowering change | 8430, 8431 (spread args only) |
| 7 | Method override variance: parameter or return types differ from the base, async override of a sync-returning base, optional param added, redeclared inherited field without initializer | 5 | 110 | typeorm 53, date-fns 32, nest 15, rxjs 9, inversify 1 | M | lowering/type-mapping (vtable slot adapters; widen exact-match rule) | 8401, 8470 (optional param, generic any-family override); async-override and return-narrowing still refused |
| 8 | Factory-made / non-program class values: `$constructor(...)`-style classes, `new checks.$ZodX(...)`, `instanceof` with non-program RHS, `extends` a runtime class, `new Ctor(...)` through a record/slot | 5 | 80 | typeorm 39, zod 31, nest 7, date-fns 2, rxjs 1 | L | IR/runtime (class values as first-class dynamic constructors) | 8451, 8490 (generic class constructor values, adapted ctor class-value slots); factory pattern not covered |
| 9 | `this` in static methods (receiver is a dynamic class value), `this` in object-literal methods, `this.constructor` | 3 | 77 | typeorm 51, nest 22, zod 4 | M | lowering change (static receiver as class value) | none |
| 10 | Index signatures and hybrid keys: `delete` on struct+overflow shapes, rest bindings over index-signature shapes, `for-in` over records, index signatures outside string/number shapes | 6 | 26 | zod 12, nest 5, hono 4, rxjs 2, typeorm 2, date-fns 1 | M | type mapping / IR (hybrid record) | none |
| 11 | Record exactness (SC2002): width-coercion misses for spread copies, `Object.freeze(...) as never`, `def as SomeDef` | 4 | 38 | date-fns 23, zod 9, typeorm 5, nest 1 | S-M | type-mapping change | none |
| 12 | Symbol-keyed access, tagged templates (non-top-level tags), `import(expr)`, enum reverse lookup at runtime index, module-namespace objects, custom `[Symbol.iterator]` shapes in `for-of` | 5 | 30 | nest 17, typeorm 10, zod 1, rxjs 1, date-fns 1 | S each | lowering change | 8412 (symbol-iterator detection), 8410 (const-keyed methods) |
| 13 | Map/Set key and value element types: `RegExp`, `Function`, `unknown`, records as keys | 5 | 29 | nest 14, class-transformer 9, zod 3, typeorm 2, inversify 1 | M | type mapping/runtime (identity-keyed maps over more key types) | none |
| 14 | Abstract classes: abstract method values, calls to an abstract method with no concrete implementation below the static receiver (polymorphic `Parser<V>[]`) | 4 | 36 | typeorm 21, nest 12, inversify 2, date-fns 1 | M | lowering change (vtable for abstract slots) | 8400-8517 touched dispatch of generic overrides, not abstract |
| 15 | `Reflect.*` and other namespace members used as values (one polyfill line fans out to 9 messages in 5 packages) | 5 | 9 | zod 1, class-transformer 2, inversify 2, typeorm 2, nest 2 | S | lowering change (alias to existing call lowering) | none |
| 16 | Packaging: npm deps without `.d.ts` (`debug`), `import('class-validator')` | 2 | 8 | nest 7, typeorm 1 | S | tooling | none |
| T | Tooling, not language: package deep-subpath imports (`@nestjs/common/internal`) are not source-mapped, so 264 nest root sites are `isNil`/`isString`/`isFunction` helpers resolved against .d.ts; typeorm has 15 CJS `exports` references in a bundled dependency | 1 (+typeorm) | 264 | nest 264 | S | provenance resolver: map every exported subpath of a mapped package, not only specifiers the entry's relative closure names | n/a |

Ranking uses packages x lines: family 1 (3458), 2 (1712), 3 (976), 4 (903), 5 (686), 6 (552), 7 (550), 8 (400), 9 (231), 10 (156), 11 (152), 12 (150), 13 (145), 14 (144). Family T would rank high by raw count (264) but is a tooling fix.

Rough cost-to-benefit: the cheapest big wins are T (resolver, removes about 40% of nest's root sites), 6, 11, 12, 15 (all S), then 2 (many S's), 3 and 7 (M). Families 1 and 8 dominate zod and typeorm but are L and need runtime design.

## Other findings

### Crashes (internal TypeErrors, not diagnostics)

- class-validator 0.15.1 sources mapped (`validateSync`, or even `isEmail` alone): `TypeError: Cannot read properties of null (reading 'type')` at `dist/frontend/lowering/deferred-module-initializers.js:356` (`typeEvents(expr.type)` called with a null IR expression).
- nest v12.2.0 clone mapped as source (the gitHead af37111368 source did not crash): `TypeError ... (reading 'kind')` at `dist/frontend/lowering/lowerer.js:2732` (`expr.kind` on a null expression). A decorator-based nest driver hits the same crash.
- Both are null IR expressions reaching a traversal: likely one lowering path that leaves a hole after a refusal. Worth a bug report each; they hide whatever the next refusals are.

### Preconditions that refuse a whole package before any feature

- class-validator is not `strictNullChecks`-clean: `SC0002` (tsconfig disables strictNullChecks) plus 36 `SC0001` ordinary type errors (`'x' is possibly undefined`, `has no initializer`). Packages that are not strict TypeScript cannot be compiled from their own sources under the project's tsconfig, so a dependency-from-source plan needs per-package compiler options or patches.
- typeorm: `SC2013` for `debug` (no own `.d.ts`), `SC1010` for `picomatch`/`fdir` (not resolved).

### Decorators (legacy `experimentalDecorators`, decorator-based drivers)

- class-transformer `@Type(() => Date) d!: Date`: `SC0001 Expected 2 arguments, but got 3. (in the legacy decorator lowering)`: the property-decorator lowering calls the returned function with a descriptor argument that the decorator's `(target, key)` signature does not take. Real-world property decorators commonly have this signature.
- inversify `@inject(A) public a: A` (parameter-property decorator): `SC0001 Object is of type 'unknown'. (in the legacy decorator lowering)`.
- typeorm decorator-based driver: reaches `SC1090` redeclared inherited fields (aurora-postgres) and method-signature overrides before decorators matter.
- Related research: `decorators-coverage-plan.md` in this directory.

## Minimal repros (Node runs each; scriptc refuses with the listed diagnostic)

All verified with `analyze(..., { tier: "static-only" })` and `node --experimental-transform-types` (Node 24.22). Files were in `/home/vitalii/census-scratch/rep` (deleted).

1. any/unknown boundary (SC1090 checked cast of 'unknown' to a function-bearing, recursive interface)
```ts
interface Def { type: string; inner?: ZodType }
interface ZodType<D extends Def = Def> { _zod: { def: D; run: (x: unknown) => unknown } }
type Processor<T extends ZodType> = (schema: T, ctx: { seen: Map<ZodType, { count: number }> }, json: Record<string, unknown>) => void;
const proc: Processor<ZodType> = (schema, ctx, json) => { json.type = schema._zod.def.type; ctx.seen.set(schema, { count: 1 }); };
const procs: Record<string, Processor<any>> = { a: proc };
const x: unknown = { _zod: { def: { type: 't' }, run: (v: unknown) => v } };
const json: Record<string, unknown> = {};
procs['a']!(x as ZodType, { seen: new Map() }, json);
```
Another form: `Handler = (...args: any[]) => any` field filled with `(x: number) => x + 1` gives `SC1090 '(number) => number' values where '() => unknown' is expected`.

2. Stdlib members (SC2020 `Object.assign`, `string | symbol.toString`; SC1090 static member through a computed class value)
```ts
const target: { a?: number; b?: string } = {};
Object.assign(target, { a: 1 }, { b: 'x' });
console.log((Symbol('s') as symbol | string).toString());
class K { static tag = 'k'; who(): string { return (this.constructor as typeof K).tag; } }
```

3. Function values (SC1090 `bind`, `arguments.length`)
```ts
function id<T>(x: T): T { return x; }
const bound = id.bind(null, 3);
function count(a?: number, ...r: number[]) { return arguments.length; }
```

4. Union layouts (SC2003, SC1090 logical operators on union values)
```ts
type Next<T> = { kind: 'N'; value: T }; type Err = { kind: 'E'; error: unknown };
class Notification<T> { constructor(public kind: 'N' | 'E', public value?: T, public error?: unknown) {}
  toRecord(): Next<T> | Err { return this as Next<T> | Err; } }
const caps: (string | undefined)[] = ['1', undefined];
console.log((caps[1] && parseInt(caps[1])) || 0);
```

5. Generic-class instances (hono: `Context<unknown,unknown,unknown>` x10, `this` in arrow fields `render = (...args) => { this.#renderer ??= ... }`, SC1090 "'Context%a' values where 'Context%b' is expected"). I could not isolate a few-line repro: variants with arrow-field `this`, `as this` clones and several instantiations pass. The trigger needs more of hono's `Context` shape (a bisect of `hono/src/context.ts` would find it). Treat the family as real but unreproduced in miniature.

6. Spread/assign/update (SC1045)
```ts
const o: { n: number } = { n: 1 };
(o as any)._count++;
```

7. Method override variance (SC1090 different signature; async override; return type)
```ts
class Base { run(): Promise<number> { return Promise.resolve(1); } g(x: number): number { return x; } }
class Derived extends Base { async run(): Promise<number> { return 2; } g(x: number, y: number = 1): number { return x + y; } }
const b: Base = new Derived();
console.log(await b.run(), b.g(1));
```

8. Factory-made classes (SC2002 'record shapes must match' on `new $ZodString(...)` through a `$constructor` cast; zod's pattern)
```ts
function $constructor<T>(name: string, init: (inst: T, def: unknown) => void) {
  class Cls { constructor(def: unknown) { init(this as unknown as T, def); } }
  Object.defineProperty(Cls, 'name', { value: name });
  return Cls as unknown as new (def: unknown) => T;
}
interface ZString { kind: string }
const $ZodString = $constructor<ZString>('ZodString', (inst) => { inst.kind = 'string'; });
console.log(new $ZodString({}).kind);
```

9. `this` in static methods (SC1090)
```ts
class Model { static create<T extends typeof Model>(this: T): InstanceType<T> { return new this() as InstanceType<T>; }
  static isModel(o: unknown): boolean { return o instanceof this; } }
class User extends Model {}
console.log(User.create() instanceof User, Model.isModel(new User()));
```

10. Hybrid index signature (SC1090 delete; SC1031 rest binding)
```ts
interface Schema { type?: string; examples?: unknown[]; [k: string]: unknown }
const s: Schema = { type: 'a', examples: [1], other: 2 };
delete s.examples;
const { type, ...rest } = s;
```

11. Record exactness (SC2002)
```ts
const frozen = Object.freeze({ status: 'aborted' }) as never;
```
(date-fns form: spreading a wider options record into a narrower options type.)

12. Misc syntax (SC1090 enum reverse lookup at runtime index; computed `import()`; SC2020 `TemplateStringsArray.raw`)
```ts
enum Method { GET, POST }
const i: number = process.argv.length > 5 ? 1 : 0;
console.log(Method[i]);
const name = process.argv.length > 9 ? 'node:fs' : 'node:path';
const m = await import(name);
```

13. Map keys (SC2009/SC1090 `Function` key, SC2020 `Map<Function,...>.set`)
```ts
class A {} class B extends A {}
const m = new Map<Function, { n: number }[]>();
m.set(A, []); m.set(B, [{ n: 1 }]);
```

14. Abstract classes (SC1090 abstract call with no concrete impl; class used as unrelated class)
```ts
abstract class Parser<V> { abstract parse(s: string): V | undefined; run(s: string): V | undefined { return this.parse(s); } }
class NumP extends Parser<number> { parse(s: string) { return s === '' ? undefined : Number(s); } }
class StrP extends Parser<string> { parse(s: string) { return s; } }
const ps: Parser<number | string>[] = [new NumP(), new StrP()];
console.log(ps.map(p => p.run('4')));
```

15. Reflect members as values (SC2005, SC1090 generic method as value)
```ts
const get = Reflect.get; const own = Reflect.ownKeys;
console.log(get({ a: 1 }, 'a'), own({ a: 1 }));
```

16. Iterator return (SC2020 `ArrayIterator<number>.return`)
```ts
const it = [1][Symbol.iterator](); it.return?.();
```

The "createRequire" form of CommonJS `require` passes; bare `require`/`exports` are `SC2020`.

## Caveats

- Counts come from one driver per package at the tag listed; unreached bodies are included, so numbers describe whole-package source, not the driver's path. Family boundaries are mine (regex over normalized diagnostics); about 51 lines (6%) stayed unclassified (examples: `destructuring on 'any'-typed values`, rest bindings with unpackable types, `a runtime-provided class value ('Error')`, generators `SC1071`, overload sets `SC2007`).
- hono's 181 messages collapse to about 40 lines of one family; nest's 277 `binding form` messages are almost all one resolver gap.
- Nest numbers use sources from gitHead af37111368, not the v12.2.0 tag (crash).
- A repro for family 5 and a bisect of the two crashes were not done.

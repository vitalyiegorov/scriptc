# Legacy decorator test-suite coverage plan for scriptc

Scope: TypeScript LEGACY decorators (`experimentalDecorators` + `emitDecoratorMetadata`). Standard TC39 decorators are noted only as future scope.
Oracle for every corpus program: `tsc` (typescript5) + node stdout, as the existing `// @tsc-legacy-decorators` programs do.

Provenance note: the first-pass file `/tmp/decorators-coverage-plan.md` was wiped, so Part A is REBUILT. TypeScript/SWC/Babel paths were spot-checked through `gh api` (directory listings); behaviors in Part A are from tsc semantics knowledge and are tagged "verify with oracle" where I did not read the fixture itself. Part B (new sources) was read directly (issue bodies, fixture inputs).

## 0. What scriptc already covers (read from the repo)

Corpus `tests/corpus/1974-decorators-legacy`, `1975-decorators-legacy-edges`, `1976-decorators-legacy-metadata`; unit `packages/compiler/src/frontend/legacy-decorators.test.ts` (text-lowering checks), `legacy-metadata.test.ts` (includes a real `tsc` oracle over ~30 decorated signatures), `packages/compiler/test/legacy-decorators.test.ts` (TS1238-style diagnostic), `tests/harness/legacy-decorators.test.ts` (callable/native heritage refusal). Docs: `docs/content/limitations/language-features/decorators.mdx`.

COVERED (C): factory order top-down / application bottom-up across class, method, accessor, property, parameter; static members and static block; method/accessor descriptor mutation; accessor pairing across identifier/string/numeric/computed/parenthesized spellings and dynamic keys; computed key evaluated once before factories; class replacement via return incl. inner lexical name vs outer binding, `original.self()`, shorthand self keys; abstract, default-export, anonymous default-export, nested (function-local) classes, generic classes + generic ctor/method constraints; merged namespace+class (live exports, multi-declarator, destructured, split blocks); interface+class merge; falsy decorator skipped; `Reflect.decorate` delegation incl. arg counts; property decorator arg count (3 args, undefined descriptor) and descriptor results; unique-symbol computed field key read once; tslib-imported helpers; `super` calls in decorated subclasses; metadata: syntax-based serialization (primitives, alias, union, nullable, literals, conditional, readonly array, tuple, symbol, bigint, branded, Promise, generic, `this` param, asserts), strictNullChecks on/off (unit only), value import kept / type-only import -> `Object`/`Function`, forward-reference TDZ ReferenceError (class declared later), setter type for paired accessors, inherited ctor emits nothing, metadata evaluated eagerly with no provider, diagnostics TS "Unable to resolve signature of class decorator".

NOT FOUND in the repo (treated as gaps): any `enum` metadata test; `useDefineForClassFields`; `declare`/`abstract` decorated fields; decorated overloads; ctor overloads; ambient `declare class` types; `import("./x").T` types; real `reflect-metadata`; `@Inject()`-style param-decorator reading `design:paramtypes`; static-method parameter decorators; special property keys; invalid-target diagnostics table.

---------------------------------------------------------------------------

## PART A. First-pass baseline (rebuilt): TypeScript, SWC, Babel, Node/V8/test262

### A1. TypeScript release-5.9
Dirs: https://github.com/microsoft/TypeScript/tree/release-5.9/tests/cases/conformance/decorators
- `class/` (decoratorOnClass1-5,8,9; decoratedBlockScopedClass1-3; decoratedClassExportsCommonJS/System; decoratedClassFromExternalModule; constructableDecoratorOnClass01; decoratorChecksFunctionBodies; `constructor/` + `constructor/parameter/`; `accessor/`; `method/`; `property/`)
- top level: `decoratorCallGeneric`, `decoratorInAmbientContext`, `decoratorMetadata`, `decoratorMetadata-jsdoc`, `decoratorMetadataWithTypeOnlyImport(2)`, `legacyDecorators-contextualTypes`, `missingDecoratorType`
- `invalid/`: decoratorOnArrowFunction, Enum, Enum2, FunctionDeclaration, FunctionExpression, FunctionParameter, ImportEquals1/2, Interface, InternalModule, TypeAlias, Var
- `tests/cases/compiler/`: `classExpressionWithDecorator1`, `commentOnDecoratedClassDeclaration`, `baseConstraintOfDecorator`
- emit: https://github.com/microsoft/TypeScript/blob/release-5.9/src/compiler/transformers/legacyDecorators.ts and `typeSerializer.ts` (serialization rules)
Behaviors: `var C_1` self alias for class decorators with inner references (decoratedBlockScopedClass); export/export default decorated classes; param-decorator on ctor and methods incl. `this` parameter (error); decorator on overloads; accessor decorator on first accessor only (TS1207); metadata keys `design:type/paramtypes/returntype` ordering after user decorators in the array; TS1272 for isolatedModules.
### A2. SWC
Parity fixtures in `crates/swc_ecma_transforms_proposal` and `swc_ecma_transforms_typescript` (legacy decorator + metadata). Issues list in Part B.
### A3. Babel
https://github.com/babel/babel/tree/main/packages/babel-plugin-proposal-decorators/test/fixtures (dirs `legacy-class-constructors` [mutate-existing / return-new-constructor], `legacy-class-export-default`, `legacy-class-ordering`, `legacy-class-prototype-methods|properties` [mutate-descriptor, return-descriptor, numeric-props, string-props, mutate-initializer, child-classes-properties, properties-without-initializer], `legacy-class-static-methods|properties`, `legacy-decl-to-expression`, `legacy-object-*` (object literal decorators: tsc does NOT support these; skip), `legacy-regression`). Babel's legacy semantic for fields differs from tsc (descriptor with `initializer`); do not port those, only methods/ordering/keys.
### A4. Node/V8/test262
Only TC39 standard decorators exist; future scope only.

---------------------------------------------------------------------------

## PART B. New sources

### B1. Bun (https://github.com/oven-sh/bun) - experimentalDecorators + emitDecoratorMetadata transpiler
Tests: `test/bundler/transpiler/decorators.test.ts` (ports of esbuild's decorator suite: evaluation order, factory order, parameter decorators, "class field order", "changing static method", "class extending from another class", "decorated fields moving to constructor", "decorators with different property key types" [`arguments[0]` computed method, `[y] = 10`, `"string" = 30`, `12e3 = ...`, `[12e3+1]()`], "only class/property/argument decorators", ctor statements with parameter properties + decorators + statements ("with parameter properties, statements, and decorators"), "export default class (anonymous name)", "field with supra-BMP string-literal key", "decorator and declare", "removes decorated declare and abstract fields from a class expression"); `test/bundler/transpiler/decorator-metadata.test.ts` ("type serialization", "design: type, paramtypes, returntype", "class with only constructor argument decorators", "more types" [template-literal types], "rest parameters and defaults"); `test/bundler/bundler_decorator_metadata.test.ts` (`decorator_metadata/TypeSerialization`, `ImportIdentifiers`).
Issues (divergence from tsc):
- #44120 `X | undefined` / `X | null` serialized as `X` under strict (tsc: `Object`; elision only with strictNullChecks off) - C (unit); add end-to-end.
- #7591 / #17056 forward/circular class reference as `design:type` -> TDZ ReferenceError (tsc emits it too) - C.
- #20664 decorated but uninitialized field dropped from instance (`Object.keys(new Schema())` expected `["id","name","date"]` ONLY when `useDefineForClassFields` true; with false tsc emits no own props -> `[]`). Must pin BOTH settings - GAP.
- #6172, #8439 interface/type imported without `import type` while emitting metadata -> import elision vs `Import named not found` - partly C (type-only import erased); add "value-imported interface" case.
- #6326, #34494, #27575 tsconfig `extends` not honoured -> pins config inheritance (extends chain with experimentalDecorators in parent) - GAP (cheap: tsconfig `extends`).
- #7444 non-null `!` on decorated field (mikro-orm) - trivial.
- #32299 decorators in plain `.js`: scriptc docs already say unsupported.
Standard-decorator issues (future scope): #33406 member decorator expressions evaluated after class decorator expressions; #37011 static block relocated after decorator application; #31910 optional chain through lowered private members; #29724 `Symbol.metadata`.

### B2. Deno / swc config (https://github.com/denoland/deno)
#30889 swc panic on type import in decorator (same as swc #11915: `import("./x").T`); #28009 `Reflect.getMetadata is not a function` (metadata calls with no provider: tsc `__metadata` returns undefined when `Reflect.metadata` is absent - GAP: scriptc must NOT throw when `Reflect.metadata` is missing); #28266 deprecation of the flags (no behaviour); #26427 Nest ModuleRef DI.
### B3. WebKit/JSC, SpiderMonkey, V8
Standard decorators only (JSTests/stress/decorators*, SpiderMonkey js/src/jit-test decorators). Future scope list: context object shape, `addInitializer`, `accessor`, `Symbol.metadata`, evaluation order of decorator expressions vs computed keys, decorators on private names, `static` blocks. Nothing legacy.

### B4. esbuild (https://github.com/evanw/esbuild) - no emitDecoratorMetadata support (#257, #3680)
Tests: `internal/js_parser/ts_parser_test.go` (TestTSExperimentalDecorator*), `internal/bundler_tests/bundler_ts_test.go` + snapshots `snapshots_ts.txt` (TSExperimentalDecorators*).
Divergences:
- #3230 static member referenced in a decorator ARGUMENT: `@ArrayMaxSize(Cls.MaxFiltersSize)` on a property of `Cls` that also has `static readonly MaxFiltersSize = 20`. tsc evaluates decorators AFTER the class body, so it works. GAP -> program P3.
- #3658 class decorator + `#private` fields: private fields must keep working (esbuild lowers them). P3.
- #2220, #3913, #1675 `useDefineForClassFields` interplay: `@query() private canvas?: X` must NOT emit an own field when flag false, while `declare field` + decorator still calls decorator (#1675). P2.
- #3684 decorators on `declare` and `abstract` fields must still run (tsc runs decorator for `declare`/abstract properties). P2.
- #3911 `@Resource testA;` property decorator returning a function: return value of a property decorator is ignored by tsc (`testA` stays undefined). P4 (fresh-return table).
- #3482/#3496 target lowering: not relevant (native).
- #3960 undefined target on property decorator: standard decorators, future.

### B5. oxc (https://github.com/oxc-project/oxc) - thorough tsc port
Fixtures: `tasks/transform_conformance/tests/legacy-decorators/test/fixtures/` - `oxc/*` (accessor-name-collision, class-without-name-with-decorated-static-element, computed-key-property-decorator[-with-initializer], export-class-method-decorated, fields-with-declare-modifier, static-field [`@Bar() class Foo { static foo = `${Foo.name}` }`], use-define-for-class-fields, with-class-private-properties[-unnamed-default-export], with-typescript-remove-class-properties-without-initializer), `oxc/metadata/*` (abstract-class, ambient-declared-class, bound-type-reference [`Ns.Value`], class-expression-via-const, constructor-overload, cross-file-imported-enum, enum-types [string, template-string, number, unary negative/positive/bitwise, auto-increment, mixed, computed], erased-import-no-type-keyword, forward-ref-class, getter-setter-method, namespace-imported-enum, nullable-union, params, private-in-expression-in-decorator [`@dec(#zoo in Cls)`], readonly-array-interface-shadow, static-anonymous-class-expression, this, unbound-type-reference, without-decorator) and a copy of the TypeScript `decorators/*` conformance inputs (`typescript/*`).
Issues: #21922 (seven tsc divergences: alias to primitive, brand intersection `string & {__brand}` -> String, `ReadonlyArray<T>` generic form -> Array, strictNullChecks off, cross-file enum, forward/cyclic TDZ, `accessor` keyword design:type), #26197 / #22228 / #14740 cross-file enum must emit `String`/`Number` (not the enum object), #22227 TDZ, #10926 abstract class loses ctor metadata, #4047.
New behaviors: enum serialization (Number / String / Object-for-mixed; negative/unary/computed members); ambient `declare class` -> `Object` without throwing; `Ns.Value` qualified types; class decorator with private `in` check; abstract class ctor `design:paramtypes`; constructor overload uses implementation signature; user-shadowed global `interface ReadonlyArray` -> `Object`; `const C = class {}`; two `static X = class extends Error {}` + class decorator + ctor metadata (naming `_a` temporaries collision); decorated `export default class {}` static field; accessor-name-collision (`prop` vs `_prop` vs `[prop]` temp naming).

### B6. SWC issues (https://github.com/swc-project/swc)
#10094 negative-number enum member -> must stay `Number`; #11032/#11033/#9430 enum in same/different module wrong (tsc: Number/String, or `Object` for mixed); #5626 `bigint` -> `BigInt`; #9430 issue 1: getter `design:type` returns `Function` not `String` (accessor type, not method); #11915 + deno #30889 `import("./x").Foo` panic (tsc: `Object`; verify); #6498 / #5047 / nestjs/graphql #2568 circular ESM class reference TDZ; #862 class + member decorators both emitted; #1620 / #9431 property decorators receive `undefined` descriptor (3 args), only methods/accessors get descriptor; #666 Nest app.
### B7. Biome / rolldown / ts-jest / ts-node / tsx / vite / vitest
Biome: parser only. Rolldown uses oxc (see #21922). Vite/vitest/tsx use esbuild: no metadata (vitest + Nest #9228 / #17047: injected providers `undefined` because `design:paramtypes` is absent); vite #15565/#13736 tsconfig option ignored; tsx: nothing unique. ts-jest/ts-node: nothing unique beyond tsc. Net: no new behavior beyond B4.

### B8. NestJS / TypeORM / class-transformer / class-validator
Nest: `packages/common/test/decorators/inject.decorator.spec.ts`, `injectable.decorator.spec.ts`; issues nest#14422 (type-only import -> `Object` paramtype breaks DI), #13426 (`@Inject()` no args), #9228/#17047; nestjs/graphql#2568 (`T & {}` or `Relation<T>` wrapper to dodge TDZ); SWC recipe "Common pitfalls" (`import type`, `Relation<T>`).
TypeORM: #8872 (lazy relation getter installed on prototype by decorator is shadowed by own field with `useDefineForClassFields`/ES2022: tsc default true for ES2022 target), #4526/#6018 (same-file/circular entities), #9894 (`Relation` import elision), #2897 (no metadata -> column type unguessable).
class-transformer: `test/functional/implicit-type-declarations.spec.ts` (metadata only for DECORATED members; `Date`, `Promise`, `string[]` -> Array), `transformer-order.spec.ts` (stacked decorator order), `inheritence.spec.ts` (decorators on base and sub member), `promise-field.spec.ts`. class-validator: nothing compiler-visible.
Key semantics: metadata entries come AFTER user decorators in the `__decorate` array, so they APPLY FIRST and a user decorator can read `design:type`/`design:paramtypes` during application (class decorator reading `Reflect.getMetadata("design:paramtypes", target)`). Parameter decorators for the ctor come in the class `__decorate` array (ordered `__param(0,..)` before `__metadata`). Re-decorating an inherited member on the subclass replaces the entry for that key only on `Sub.prototype`.

### B9. inversify, tsyringe, type-graphql
inversify (inversify/monorepo `packages/container/libraries/core/src/metadata/decorators/inject*.spec.ts`): param decorators on ctor params and on properties, `@inject` reading target+index; tsyringe: `@injectable()` reads `design:paramtypes`, errors when a param type is `Object` ("TypeInfo not known"); static-method? none. type-graphql: `tests/functional/enums.ts`, `metadata-storage.ts` (needs `design:type` for enum / array / Promise return types; arrays lose element type -> need `() => [X]`). Net-new: DI constructors with `@inject(TOKEN) p: Iface` (interface -> `Object`) mixed with class-typed params; optional/default/rest ctor params; parameter properties. Library tests mostly test runtime, not compiler.

### B10. MobX (https://github.com/mobxjs/mobx)
`packages/mobx/__tests__/base/stage3-decorators*.ts` = standard decorators (future scope). Legacy (v6): property decorators that install prototype accessors + `makeObservable(this)`; depend on `useDefineForClassFields:false`; same shadowing hazard as TypeORM #8872. Covered by P2.

### B11. Angular (https://github.com/angular/angular)
`packages/compiler-cli/src/ngtsc/transform/jit/test/downlevel_decorators_transform_spec.ts`: downlevels to `ctorParameters`/`propDecorators` with lazy `type` thunks, a separate Angular transform, not tsc legacy semantics. Out of scope; only the pattern "decorator args referring to later-declared classes through arrow thunks (`() => B`)" is worth one line in P5.

### B12. reflect-metadata (https://github.com/rbuckton/reflect-metadata)
Layout: `Reflect.ts` (~93 KB, also `ReflectLite.ts`, `ReflectNoConflict.ts`), `test/*.ts` (reflect-decorate, definemetadata, deletemetadata, getmetadata, getmetadatakeys, getownmetadata, getownmetadatakeys, hasmetadata, hasownmetadata, metadata, other; ~15-20 `it` cases per file, e.g. ThrowsIfDecoratorsArgumentNotArray..., ExecutesDecoratorsInReverseOrder..., DecoratorPipeline..., DecoratorCorrectTargetInPipeline..., DecoratorCorrectDescriptorInPipeline...). Runner: gulp + mocha 3, `test/vm.ts` loads `Reflect.js` inside `vm.createContext` sandboxes (suites: Reflect.js, with polyfilled Map/Set/WeakMap, ReflectLite) and `registry.ts` hosts shared state across module instances.
Recommendation on running its suite as a differential acceptance test: do NOT run the whole suite. It depends on gulp/mocha, `vm` contexts, `module.builtinModules`, `require` hooks and deliberately-broken Map/Set/WeakMap sandboxes that a native compiler cannot or should not replicate. Instead (a) one smoke program that compiles the REAL `Reflect.ts` (vendored as a corpus npm-style dir like `6xxx-npm-*`) and runs a hand-written script: defineMetadata/get/getOwn/has/keys on object, property and class targets with prototype chains, `Reflect.decorate`/`Reflect.metadata` through tsc-emitted `__decorate`; this is the only proof that docs' "import reflect-metadata first" path works (1976 uses a hand-made polyfill) and doubles as a language-feature stress test; (b) port the ~10 pure `reflect-decorate` + `getmetadata` assertions into the same script (no mocha). Mark (a) as an acceptance test with a size/time budget; if Reflect.ts needs unsupported features (WeakMap polyfill probing, `Function("return this")`), record the refusal and fall back to (b) with a 40-line in-test implementation.

---------------------------------------------------------------------------

## PART C. Merged taxonomy and gap table

Legend: C covered, P partial, G gap. "Pin" = corpus program in Part D.

| # | Behavior | Status | Sources | Pin |
|---|---|---|---|---|
| 1 | Evaluation/application order, 5 decorator kinds, descriptors, accessor pairing, computed keys once | C | TS, Babel, Bun | - |
| 2 | Class replacement return; inner vs outer binding; `original` self refs | C | TS decoratedBlockScopedClass, oxc | - |
| 3 | Replacement by `class extends target {}` (mixin-style), static self-refs afterwards, static inherited from replaced class | G | Bun "changing static method", Babel return-new-constructor | P3 |
| 4 | Decorator ARGUMENT referencing static of the same class / `Foo.name` in static initializer | G | esbuild#3230, oxc static-field | P3 |
| 5 | Class decorator + `#private` fields, `#x in Cls` inside decorator args | G | esbuild#3658, oxc private-in-expression | P3 |
| 6 | Enum metadata: numeric -> Number, string -> String, mixed/computed -> Object, negative/unary members -> Number, `const enum`, `declare enum`, cross-file, `NS.Enum` | G | swc#10094/11032/11033/9430, oxc#26197/#14740, oxc enum-types | P6 |
| 7 | Primitive alias, brand intersection `string & {__b}`, `string & {x:number}` -> Object, `ReadonlyArray<T>` generic, shadowed global `ReadonlyArray`, `bigint`, `this`, template literal | P | oxc#21922, swc#5626, Bun tests | P6 |
| 8 | strictNullChecks on/off end-to-end (`X|undefined`, optional `p?: X`) | P (unit only) | Bun#44120, oxc#21922 bug4 | P6 (second tsconfig dir) |
| 9 | Ambient `declare class` / unresolved name -> `Object` without throw; `typeof` guard; `Ns.Value` qualified | G | oxc fixtures | P6 |
| 10 | `import("./b").B` type in decorated member -> tsc output (verify; expected Object) | G | swc#11915, deno#30889 | P6 |
| 11 | DI ctor: param decorators with parameter properties, defaults, optional, rest; ctor overloads; abstract class ctor; interface param -> Object; class-with-only-param-decorators still gets class `__decorate` | G | Bun tests, oxc constructor-overload/abstract-class, Nest, tsyringe | P1 |
| 12 | Class decorator (and param decorator) READS `design:paramtypes` during application (metadata applied before user decorators); `@Inject()` inference | G | Nest#13426, class-transformer | P1 |
| 13 | Metadata only on decorated members (undecorated field/method gets none) | P | class-transformer implicit-type | P1 |
| 14 | `useDefineForClassFields` true vs false: decorated uninitialized field, initialized field order, field shadowing prototype accessor installed by decorator (lazy relation) | G | TypeORM#8872, Bun#20664, esbuild#2220/#3913 | P2 (two tsconfig variants) |
| 15 | `declare` and `abstract` decorated properties run decorator, emit no field | G | esbuild#3684/#1675, Bun "decorator and declare" | P2 |
| 16 | Special keys: `__foo`/`__proto__`-like names, `["1"]`, numeric `12e3`, `Symbol.iterator`, supra-BMP string, key stringification when `Reflect.decorate` exists | G | Bun, oxc computed-key | P4 |
| 17 | Fresh-descriptor returns: method decorator returning new descriptor, returning undefined, accessor returning new, property decorator return ignored, `Object.defineProperty` side effects, non-configurable | P | Babel return-descriptor, esbuild#3911, swc#1620 | P4 |
| 18 | Static-method parameter decorators (target = constructor), static accessor and static property decorators | G | tsc `__param`, Babel static-methods | P4 |
| 19 | Metadata key collisions: user `Reflect.metadata("design:type", X)` on same member (order: user vs design entries), user class named `Object`/`String`/`Function`/`Promise`/`Reflect`/`__decorate` shadowing | G | TS typeSerializer, oxc shadow fixture | P5 |
| 20 | `Reflect.metadata` absent: no throw, no metadata (decorators still run) | P (unit "eagerly without provider") | Deno#28009 | P5 |
| 21 | Circular cross-file entities (TypeORM-style): value-typed -> ESM TDZ ReferenceError at load; `Relation<T>` / `T & {}` wrapper -> `Object` and works; arrow-thunk args | P (same-file only) | Bun#17056, swc#6498/#5047, nestjs/graphql#2568, TypeORM#6018/#9894 | P5 |
| 22 | Inherited re-decoration replaces key on subclass only; `getMetadata` walks chain, `getOwnMetadata` does not | P | class-transformer inheritance | P5 |
| 23 | tsconfig `extends` carrying the flags | G | Bun#6326/#34494 | P5 (reuse extends in one dir) |
| 24 | Real `reflect-metadata` import path | G | reflect-metadata | P7 |
| 25 | Invalid-target / contract diagnostics table | P (1 case) | TS decorators/invalid | U1 |
| 26 | Decorated overloads, `export` before/after `@`, decorators on `this` param | G | TS | U1 |
| 27 | Standard decorators (context arg, accessor, addInitializer, Symbol.metadata, ordering vs class decorators, static block placement) | future | Bun#33406/#37011, MobX stage3, V8/JSC/SM | - |

---------------------------------------------------------------------------

## PART D. Revised prioritized minimal plan (<= 8 corpus programs + 1 unit table)

Numbers continue after 1976. Each program prints values compared with tsc+node. Prefer extending existing programs only if they stay under ~150 lines; otherwise new dir.

P1 `1977-decorators-legacy-di` (metadata, ctor-centric)
- Pins: #11, #12, #13. A tiny `Container` with `@Injectable` class decorator reading `design:paramtypes` inside the decorator; `@Inject(TOKEN)` param decorators mixed with class-typed params, interface param (-> Object), parameter properties (`private readonly s: Svc`), default value (`n = 5` -> Number? verify: syntactic from annotation, none -> Object), optional `?`, rest `...r: string[]` -> Array, ctor overload, abstract base ctor, class with ONLY param decorators, undecorated field with no metadata, static-method param decorator count.
- Sources: Nest inject spec/#13426, Bun decorator-metadata "class with only constructor argument decorators"/"rest parameters and defaults", oxc constructor-overload + abstract-class (#10926), tsyringe.

P2 `1978-decorators-legacy-fields` (two dirs/tsconfigs: useDefine false and true, same source via `// @tsc-legacy-decorators` variants)
- Pins: #14, #15. Decorated uninitialized field (`Object.keys` / `hasOwn` result), initialized field ordering relative to ctor body and parameter properties, decorator that installs a prototype getter (lazy-relation) with field shadowing under true vs false, `declare` and `abstract` decorated properties (decorator runs, no own property), `!` definite field.
- Sources: TypeORM#8872, Bun#20664, esbuild#2220/#3913/#3684/#1675, oxc use-define-for-class-fields + fields-with-declare-modifier.

P3 `1979-decorators-legacy-class-binding`
- Pins: #3, #4, #5. Decorator returning `class extends target { extra }`, static members and `static self()` after replacement, subclass of replaced class, `@Bar() class Foo { static foo = `${Foo.name}` }`, property decorator argument `@Max(Cls.LIMIT)` using a static of the same class, class decorator on class with `#private` + `static #count`, `#x in Cls` in a member decorator argument.
- Sources: Bun "changing static method"/"class extending", esbuild#3230/#3658, oxc static-field/private-in-expression, Babel return-new-constructor.

P4 `1980-decorators-legacy-keys-and-returns`
- Pins: #16, #17, #18. Table-driven: keys `__foo`, `"1"`, `1`, `12e3`, `Symbol.iterator`, supra-BMP string, computed from `arguments[0]` in a function; decorator logs `typeof key`/String(key)/argument count; method decorator returning: new descriptor, undefined, descriptor with changed `enumerable`; accessor returning new get; property decorator returning a function (ignored); static method with param decorator (target is constructor), static accessor, static property.
- Sources: Bun "different property key types", Babel numeric-props/string-props/return-descriptor, esbuild#3911, swc#1620/#9431.

P5 `1981-decorators-legacy-metadata-interplay` (multi-file)
- Pins: #19, #20, #21, #22, #23. Files: `a.ts` and `b.ts` with classes referencing each other (TypeORM style): variant 1 value-typed property in a cycle caught as ReferenceError at import; variant 2 `Relation<T>` (type alias `T`) and `B & {}` -> Object, plus `() => B` thunks; user `Reflect.metadata` colliding with design keys (order), local `class String {}`/`Object`-named shadows, run section with `Reflect.metadata` deleted (no throw), inherited re-decoration with get vs getOwn; tsconfig via `extends`.
- Sources: Bun#17056/#7591/#6326, swc#6498/#5047, nestjs/graphql#2568, TypeORM#6018/#9894, Deno#28009, class-transformer inheritance.
- Caution: keep the cycle in ESM exactly as tsc/node observe; if native ESM cycle semantics differ, record as limitation, not as a decorator bug.

P6 `1982-decorators-legacy-metadata-types` (extends 1976 coverage, SECOND tsconfig dir `strictNullChecks:false` via a sibling `1982b` with same source)
- Pins: #6, #7, #8, #9, #10. Numeric/string/mixed/computed/negative-unary enum, `const enum`, `declare enum`, cross-file enum and `import * as NS` enum, `NS.Class`; primitive alias; brand intersection vs `string & {x:number}`; `ReadonlyArray<T>`; shadowed `interface ReadonlyArray`; bigint; `this`; `declare class Ambient`; `import("./dep.js").T`; optional `p?: X`; `X | undefined`.
- Sources: oxc enum-types/cross-file/namespace/ambient/readonly-array-interface-shadow, #21922, swc#10094/#11033/#5626/#11915, Bun#44120.
- Expected values come from the tsc oracle output, never hand-written.

P7 `6xxx-npm-reflect-metadata-legacy` (acceptance, optional)
- Pins: #24. Real `reflect-metadata` import + decorators from 1976 flow + 10 ported `reflect-decorate`/`getmetadata` assertions. See B12 recommendation: smoke + subset, not the full mocha/vm suite.

U1 unit table `packages/compiler/test/legacy-decorators.test.ts` (table-driven, one `it.each`)
- Pins: #25, #26. Expected diagnostics by tsc code for: decorator on arrow function, enum, function declaration, function expression, function parameter (non-class), `import =`, interface, namespace, type alias, `var`; wrong signature for each of class/method/property/parameter decorator (TS1238/1240/1241/1239); two decorated accessors of the same name (TS1207); decorator on overload; experimentalDecorators missing (TS1219); decorators on class constructor; `@` before vs after `export`. Generate the expected set once from tsc, check in as data.
- Sources: TS `conformance/decorators/invalid/*`, `class/decorator*`, `legacyDecorators-contextualTypes`.

Dedupe notes: dropped Babel object-literal decorators (not tsc), Angular downlevel (separate transform), MobX/V8/JSC/SM (standard), vite/vitest/tsx (esbuild-only), TS `System`/CommonJS export-shape tests (scriptc has no module formats), per-engine target lowering issues (esbuild#3482/#3496). Total: 6 corpus programs + 1 optional acceptance + 1 unit table, covering 24 of the 27 taxonomy rows.

Cleanup: no repositories were cloned; all reads were via `gh api` and raw.githubusercontent.com.

---------------------------------------------------------------------------

## PART E. Extra behaviors merged from parallel passes (Bun/Deno/esbuild/oxc/Nest deep reads), folded into the programs above

Add to P1: ctor parameter property whose name equals the imported decorator (`@field("a") readonly field`) must resolve the import (swc#3960); `design:paramtypes` for rest `...a: string[]` -> Array and unannotated default -> Object.
Add to P2: property decorator that RETURNS a descriptor (`{value:42}`) or defines a prototype getter: with assign semantics (useDefine false) the prototype value is visible (prints 42); with define semantics own `undefined` shadows it (Deno#13281/#14329). Decorated uninitialized field key presence in both modes (Bun#20664).
Add to P3: self-reference inside a method of a class-decorated class (`copy(){return new E()}`) sees the replacement (swc#8900); class decorator returning a subclass with an extra field (Deno specs `experimental/ts`); same-name namespace + class decorator (Deno#27895, already C); static initializers run before member `__decorate`, and see the undecorated class (rolldown#5374, oxc#11111); `@dec` class with block-scoped redeclaration inside `try {}` (oxc decoratedBlockScopedClass3).
Add to P4: instance members are decorated before static members regardless of source order (oxc#27742; scriptc 1974 only partly exercises this); parameter decorator expression scope: `m(@dec(foo) foo = 2)` sees the OUTER `foo` (esbuild#2147); `arguments[0]` inside decorator and computed key within a function; getter-only vs getter+setter descriptor passed.
Add to P6: `import X = ns.Type` alias used only in metadata -> erased, `Object` (swc#9969); getter without return annotation -> `Object`; `null`/`undefined`/`void`/`never` -> `void 0`; `symbol` -> Symbol; template-literal -> String; `typeof x`, `T["k"]`, mapped types, `object` -> Object; ReadonlyMap/ReadonlySet (check with tsc); `accessor` keyword field with legacy decorator (oxc#21922 bug 7: tsc answer = the field type; verify tsc accepts the combination under experimentalDecorators before pinning).
Add to U1: `emitDecoratorMetadata` without `experimentalDecorators` (TS5052-style option diagnostic; Bun regression 27526); decorators on constructor / `#private` name / object literal / enum / namespace are errors (esbuild parser tests); `@x export @y class` and `@x[y] class` parse errors; TS1272 when isolatedModules + metadata + non-type-only imported type.
Caveat from the pass on tsc quirks: decorator arguments that read `#private` statics of their own class behave inconsistently across tsc/esbuild (esbuild#3230); do NOT pin that case, only the non-private static reference in P3.

Standard-decorator future scope (kept out of this suite): context object, `addInitializer`, `accessor`, `Symbol.metadata`, member-vs-class decorator expression order (Bun#33406), static blocks vs decorator application (Bun#37011), optional chains with lowered privates (Bun#31910).

## Addendum: tsc/SWC/Babel baseline details (late sub-agent report)
Extra tsc answers to pin (from TS release-5.9 baselines and typeSerializer.ts; check each with the oracle):
- Rest params: `...a: number[]` gives Number (element type), `...a` gives Object. A `this` param is dropped from paramtypes (emitDecoratorMetadata_restArgs.ts).
- `async m()` returntype is Promise. With no return annotation, returntype is `void 0` (no inference).
- Metadata keys: method gets type=Function + paramtypes + returntype. Property gets type only. Ctor gets paramtypes only when the class or a ctor param is decorated. getMetadataKeys order is [returntype, paramtypes, type].
- Class+param merge order: `__decorate([C, P_param, metadata])`, applied right to left.
- Serializer: readonly T[] gives Array. Template literal gives String. Type predicate gives Boolean, `asserts x` gives void 0. Conditional types serialize the union of their branches. Generic T gives Object. `import("./b").B` gives Object. Self-reference `x: Foo` gives Foo (SWC/Babel wrongly give Object).
- Unresolvable `A.B.C.D.E` gives a guarded typeof chain, falling back to Object.
- Name collisions (decoratorMetadataWithImportDeclarationNameCollision1-8) emit a guarded runtime ref.
- Getter metadata uses the getter type, else the setter param type (swc#6833).
- Symbol-keyed method param decorators get the evaluated key (swc#5962).
- `__foo` key (decoratorWithUnderscoreMethod.ts).
- Don't pin: TS#63189 (`static s = this` gives void 0, a tsc bug) and TS7 #63857 regression.
- Babel legacy property 3rd-arg descriptor/initializer semantics are NOT tsc semantics, so skip them.

## Addendum 2: DI libs / MobX / Angular / reflect-metadata (verified with the repo's tsc where noted)
- Property decorators get 3 args, the third `undefined` (`__decorate([d], C.prototype, "x", void 0)`). scriptc already does this (core-agent note). The earlier "2 args" note is wrong.
- A property decorator returning a descriptor is defineProperty'd on the prototype. With useDefineForClassFields=false, `this.y = 1` against a getter-only descriptor throws TypeError. With true, the own field shadows it.
- `@(c => 5) class B {}`: under `__decorate`, B becomes 5. Reflect.decorate (reflect-metadata installed) throws TypeError. Falsy decorator entries are skipped by `__decorate` but throw under Reflect.decorate.
- In-place `desc.value = wrapper` with no return replaces the method (also for static and overloaded methods).
- `@d class E { constructor(@inj(E) p) {} }`: inj sees the final rebound class.
- `constructor(Dep: Dep)` gives paramtypes [imported Dep]. `m<U>(a: U)` gives the guarded `typeof U` global lookup, else Object.
- Serialization rows verified (string|null gives String in the tested config; check strict mode separately): numeric/const enum gives Number, string enum gives String, mixed enum gives Object; 1n/bigint gives BigInt; Promise<T> gives Promise; Map gives Map; NS.In gives NS.In; `*g()` and `: never` returns give void 0; an object-pattern param gives Object, an array-pattern param gives Array, `z = 3` gives Number.
- design:* entries are applied first, so user decorators can read design:type at decoration time. Instance members are decorated before statics.
- tsyringe autoInjectable `class extends target` inherits paramtypes through the prototype chain.
- reflect-metadata: don't run its mocha/vm suite. Instead (a) compile ReflectLite as a differential corpus program, and (b) hand-port ~40 getMetadata/getMetadataKeys/hasMetadata/deleteMetadata/decorate cases (Object.create chains, own-first deduped key order).
- MobX 6: only define-semantics interplay and "subclass field read in super ctor" are relevant. Angular downlevel spec: only items 7, 8 and 15 (circular imports CJS vs ESM) transfer.

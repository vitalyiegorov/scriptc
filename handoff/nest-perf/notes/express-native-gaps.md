# Express 5.3.0 under scriptc: what is missing for a native build

Date: 2026-10-25. Compiler: the built `packages/compiler/dist` + `packages/cli/dist` of worktree
`t3-ff1a7fe4`. This worktree has a large uncommitted change set, so some findings may come from
that work in progress, especially R4 below. Native link and run happened in the container
`scriptc-legacy-gate`.

Target: `@nestjs/platform-express@12.2.0`, which depends on `express@5.3.0` (also cors 2.8.6,
multer 2.4.0, path-to-regexp 8.4.2). Express 5.3.0 installs 65 packages. multer and cors were not
analyzed.

## How it was measured

```
npm i express@5.3.0 --ignore-scripts                    # scratch dir
scriptc coverage app.js --npm-static=express...          # .js entry (see note)
scriptc coverage app.js --npm-static=express... --print diagnostics   # JSON, 160 diagnostics / 99 groups
scriptc build app.js --npm-static=express...             # in the container: builds OK (rc 0)
./app                                                    # runtime probe
```

- The `...` suffix is required. Without it express is refused with SC2013: "ships no own .d.ts".
- The entry has to be a `.js` file that does `require('express')`.
  - A `.ts` entry plus `declare module 'express'` keeps the package from joining the program: SC2013, "entry did not join the type-checked program".
  - `import x = require()` is rejected under ESM.
  - Installing `@types/express` together with `@types/node@26.6.5` gave 218 TS errors (duplicate declarations against `ambient/scriptc-node-fallback.d.ts`). This is a type-world issue, not an Express one, and I did not look into it further.
- `coverage` is report-only. **`build` succeeds even with all these fences**: every fence becomes a runtime throw.
  - Coverage splits them into "runs at startup" (101–102 sites) and "deferred to runtime" (58 sites).
- The "Node islands" section of coverage is report-only (`node-islands/policy.ts:8-9`).
  - Its R2.x "object-model" pre-scan reasons (constructor functions, `F.prototype.x =`, `Object.defineProperty`, `__proto__`) are **not** build blockers. The dynamic tier compiles those patterns, and I checked several of them with micro tests.
  - The R2.5 report on `parseurl` ("write of builtin module member url.path") is a false positive: the `url` there is a local `Url` instance.
- Runtime-only gaps came from an iterative probe. I stubbed or patched packages in the scratch copy, rebuilt and ran again, with `gdb` breakpoints on `scr_throw*` in `--optimization dev` builds. The probe got `express()` to create the app, register a route and `listen()`. It stops at the first request, on blocker C1.

## Headline

| Category | Diagnostic groups | Diagnostics | Notes |
|---|---|---|---|
| A. CJS export/require model | 16 (+4 masked) | ~52 | Most of the load-time fences. debug, express core, qs, iconv-lite, http-errors, gopd, es-define-property, ipaddr.js |
| B. Builtin functions/prototypes as values, reflection | ~40 | ~60 | Almost all in the ljharb stack (get-intrinsic, object-inspect, call-bind…), which comes in through `qs → side-channel` |
| C. Package JSDoc trusted as types | ~8 | ~13 | `@param {Response} res` becomes the fetch `Response`, and so on. Stripping JSDoc in the probe removed all of them |
| D. Dynamic-object / native-surface gaps | ~12 | ~18 | Error expandos, array length writes, `util.inherits` over a class, `Buffer.byteLength` shapes, zlib zstd, `apply` with DYN args |
| E. Runtime-only (no diagnostic) | 6 | n/a | Function-object reserved keys, function-valued prototypes, **expandos and re-prototyping on native req/res**, **a silent miscompile**, misclassified startup work, fences swallowed by try/catch |

The critical path to a working app has 4 items that no npm-static rewrite or package shim can
cover:
1. CJS materialized exports object (A1).
2. Function-object reserved keys and function-valued prototypes (E1/E2).
3. Extensible, re-prototypable native `IncomingMessage`/`ServerResponse` (C1/E3). This is the big one.
4. The silent miscompile (E4).

Everything else can be handled by rewrites, shims or small lowering additions.

---

## Blocker catalogue

Paths are relative to `node_modules/` and `packages/compiler/src/`. Effort: S is under 1 day,
M is a few days, L is a week or more.

### A. CommonJS export / require model

The current model compiles every module's exports to a **static table**. It has no first-class
exports object. Express and its dependencies use the exports object as a value in many ways.

| # | Package / site / pattern | Diagnostic | Compiler area | General? | Minimal general fix | Effort |
|---|---|---|---|---|---|---|
| A1 | `debug/src/node.js:240` `module.exports = require('./common')(exports)`; `debug/src/browser.js:258` same; `express/lib/application.js:40` `var app = exports = module.exports = {}` followed by `app[method] = …` (computed export writes, l.471); `express/lib/express.js:42,62` `mixin(app, proto)` where `proto = require('./application')`; `http-errors/index.js:31` `populateConstructorExports(module.exports, …)` (masked); `iconv-lite/lib/index.js:102` `new codecDef(opts, module.exports)`, `:173` `module.exports.enableStreamingAPI(…)` (masked); `qs/lib/stringify.js:29,239` `formats` module as value; `gopd/index.js:6` | SC1090 "'exports' as a value…", "'module.exports' as a value…", "module namespace objects as values (access 'X' members directly)", "assignment to 'exports' (not a writable local…)", "the CommonJS 'module' object in this position" | `frontend/lowering/cjs-exports-object.ts:lowerCjsExportsObjectValue` (~274), `isFreshExportsReset` (~285); `expressions/identifiers.ts:lowerIdentifierExpr` (~648); `expressions/binary.ts:lowerBinary` (~1057) | **General** CJS-model gap | **Materialized exports.** When a module's exports object escapes (value use, computed-key write, passed to a call, `this`-less method call on `module.exports`), compile the module's exports as one DYN object, `module.exports`/`exports` included, with Node's replace semantics. Importers then read members dynamically. The table fast path stays for modules that do not escape. | L |
| A2 | `require('debug')('ns')` in body-parser (json/raw/text/urlencoded/read), finalhandler, express (application, view), router (index, layer, route), send: 11 sites | SC1090 "the exports object of 'debug' as a value (its exports compile to a static table…)" | `cjs-inline-require.ts:lowerInlineRequireValue` (~492), `lower-stmts.ts:lowerCjsSingleValueExport` (~7748) | General (a downstream effect of A1/A3 on debug) | Clears once debug's export is modeled as a single function value: A3 fold, then A4 call-result export, plus A1 for `common(exports)`. A synthesized DYN namespace object for any table (as the bundler `__toCommonJS` getter path already does) also covers `require(x)` as a value in general | (in A1/A3/A4) |
| A3 | `debug/src/index.js:6-10` `if (typeof process === 'undefined' \|\| process.type === 'renderer' \|\| process.browser === true \|\| process.__nwjs) module.exports = require('./browser.js'); else module.exports = require('./node.js')`; `ipaddr.js/lib/ipaddr.js:1-9,…` classic UMD `(function(){ … if (typeof module !== "undefined" && module !== null && module.exports) module.exports = ipaddr; else root['ipaddr'] = ipaddr; … }).call(this)` | SC1090 "replacing module.exports outside a top-level statement (a conditional or environment-dependent export object)" ×3; downstream: SC1090 "export members attached before a 'module.exports =' assignment" ×17 (debug/browser.js, which Node never loads); SC1030 misreport at `proxy-addr/index.js:32-33` | `lower-stmts.ts:lowerExprStatement` (~8007); rewrite passes in `frontend/services.ts:120-175`, `npm-static-umd.ts` | General pattern (UMD / environment detection) | **npm-static rewrite.** Fold Node-decidable environment tests (`typeof process`, `process.browser`, `process.type`, `process.__nwjs`, `typeof module !== 'undefined' && module.exports`, `typeof window`) to their Node value. Drop the dead branch, so browser.js never joins. Unwrap a `(function(){…}).call(this)` / `(function(root){…})(this)` module IIFE. The worktree already has a WIP parameterless-IIFE unwrap for cors in `npm-static-umd.ts` | S–M |
| A4 | `es-define-property/index.js:14` `module.exports = $defineProperty` (a `var` reassigned in try/catch); `gopd/index.js:15` same; `call-bind-apply-helpers/actualApply.js:10` `module.exports = $reflectApply \|\| bind.call($call, $apply)`; debug node.js (call result); ipaddr after unwrap: `module.exports = ipaddr` where `ipaddr` is a `var` assigned `{}` earlier ("exporting the mutable 'let' binding by reference") | SC1090 "'module.exports =' with a non-literal value…", SC1090 "exporting the mutable 'let' binding … by reference" | `lower-stmts.ts:lowerCjsExportStatement` (~7607) / `lowerCjsSingleValueExport` | General | Accept any expression as the whole-module value. Store it in a module slot at the statement's position (Node copies the value at that point) and type it DYN when it is not a single static shape. For a `var` that is never reassigned after the export statement, export its value | M |
| A5 | `proxy-addr/index.js:32-33` `var isip = ipaddr.isValid` (a member function of a single-value export object, attached after `module.exports = ipaddr`); `require-only.js` `express.Router` (from `exports.Router = Router`, where `Router = require('router')`) | SC1090 "the reference to 'isValid' / 'Router' (a binding form with no lowering)" | `expressions/identifiers.ts:lowerIdentifierExpr` (~1076) → `lowerer.ts:rejectUnresolved` (generic fallback); `cjsMemberAliasValueOf` | General | Route reads of members of an exported object, and of re-exported requires, through a DYN member read when the static alias path fails. Make `exports.X = <require binding>` re-export the module value. Overlaps #2178 | M |
| A6 | `qs/lib/formats.js:12` `module.exports = { 'default': …, formatters: { RFC1738: function(){}, … } }` (quoted key, nested methods) | SC1090 "module.exports table entries beyond plain 'name: value' properties (methods, accessors, spreads, computed names)" | `lower-stmts.ts:lowerCjsExportStatement` (~7703) | General | Accept string-literal keys and method or accessor entries in the table: desugar `{ m(){} }` to `m: function(){}`, and accessors to the existing getter table | S |
| A7 | `debug/src/node.js:32` `try { const supportsColor = require('supports-color') … } catch {}`; `iconv-lite/lib/index.js:65` lazy `var raw = require("../encodings")` inside `getCodec` | SC1090 "require() with bindings outside the module's top level"; SC1090 "the reference to 'supportsColor' (a binding form with no lowering)" | `lower-stmts.ts:lowerVarDeclarator` (~2084) | General | Lazy run-once module init for nested requires, with `lowerEsmInits`' run-once closures as the precedent. The binding is DYN. Absent optional packages throw MODULE_NOT_FOUND, which the existing "unloaded" package entries already model | M |
| A8 | `on-finished/index.js:208`, `raw-body/index.js:309` `function tryRequireAsyncHooks(){ try { return require('async_hooks') } catch (e) { return {} } }`; `iconv-lite/lib/index.js:166` | SC2009 "values of type 'ScriptcRequire'…: return type 'any' does not compile" | type mapping of `require` as a value | General | Lower `return require('<builtin>')` inside a function as the builtin namespace value, which needs builtin-namespace-as-DYN (B4) | S (after B4) |
| A9 | `express/lib/view.js:81` `require(mod).__express` (template engines, `res.render` only) | SC1090 "require() with a computed specifier" (deferred) | `cjs-inline-require.ts:lowerUncompiledRequireCall` (~534) | General | Extend open **#2079** (computed `createRequire` specifiers resolved at run time) to plain `require(expr)`. Not needed for a JSON API | M (low priority) |

Masked sites that only appeared once earlier fences were stubbed out: `http-errors/index.js:31`,
`iconv-lite/lib/index.js:173`, the ipaddr let-export, and `proxy-addr` `ipaddr.isValid`. Expect a
few more of these as fences clear.

### B. Builtin functions and prototypes as values, reflection

Almost all of these come from the ljharb "intrinsics" stack: get-intrinsic, call-bind-apply-helpers,
call-bound, function-bind, object-inspect, side-channel-*, gopd, dunder-proto, get-proto,
math-intrinsics, es-*. **qs is the only thing that pulls it in, through `side-channel`.** With a
`side-channel` stub, 13 packages drop out of the program. The remaining direct express sites are
`querystring.parse` / `url.parse` as values and the namespace `in` / `for-in` sites.

| # | Sites | Diagnostic | Compiler area | General? | Fix | Effort |
|---|---|---|---|---|---|---|
| B1 | `call-bind-apply-helpers/functionCall.js` `module.exports = Function.prototype.call` (used at `actualApply.js:10`, `index.js:14`, `get-intrinsic/index.js:139,245`); `$apply` at `get-intrinsic/index.js:140,246` | SC1090 "the reference to '$call' / '$apply' (a binding form with no lowering)" ×9 | `identifiers.ts:lowerIdentifierExpr` → `rejectUnresolved` (root cause: the declaration `var $call = Function.prototype.call` was refused) | General | Box `Function.prototype.call/apply/bind` as DYN function values whose invocation dispatches `dynInvoke` with an explicit receiver | M |
| B2 | `math-intrinsics/abs.js` etc. `module.exports = Math.abs` (read at `get-intrinsic/index.js:143-148`); `get-intrinsic:102,112` `isFinite`, `parseFloat`; `:1` `JSON.rawJSON` / `JSON.isRawJSON`; `object-inspect:1` all 12 `Reflect.*`; `object-inspect:23` `RegExp.prototype.test` bound value; **`parseurl/index.js:16` `var parse = url.parse`**; **`express/lib/utils.js:172` `fn = querystring.parse`** (runtime) | SC1090 "library functions as values (call 'X' directly)", "'Reflect.apply' as a function value", "regex methods as values", "the reference to 'abs' (a binding form…)" | `identifiers.ts` (~623/655); `lowerer.ts:lowerNamespaceBuiltinProperty` (~14234); `builtin-function-fences.ts:builtinFunctionFenceValue`; `builtin-namespaces.ts:fencedMember` (~265); `surfaces.ts` `OBJECT_CALLABLE_VALUES` (~790) | General | Extend the callable-value table to every stdlib namespace function (Math, Reflect, JSON, globals, `url`, `querystring`, …). Each one is a DYN closure wrapping the direct lowering | M (mechanical) |
| B3 | `object-inspect/index.js:1-15` `Map.prototype`, `Set.prototype`, `WeakMap.prototype`, `WeakSet.prototype`, `WeakRef.prototype`, `Boolean.prototype.valueOf`; `object-inspect:2,6` `Object.getOwnPropertyDescriptor(Map.prototype,'size')`; `dunder-proto/get.js:20` `Object.getPrototypeOf`; `parseurl/index.js:17` `url.Url`; `object-inspect/util.inspect.js:1` | SC2020 "'X.prototype' … no scriptc lowering yet" (hint: "prototype objects are not values here") | `surfaces.ts:stdlibMemberFence` (~3286) | General | Expose builtin prototypes as DYN prototype objects (`dyn.functionPrototype` exists) whose methods are the boxed callables from B2 | M |
| B4 | **`body-parser/lib/read.js:32` `'createZstdDecompress' in zlib`**; `safer-buffer/safer.js:12` `for (key in buffer)` | SC1090 "'in' on 'module namespace builtin:zlib' receivers"; SC1052 "for-in over typeof import('buffer')" | `expressions/relational.ts:lowerInExpression` (~1974); `lower-stmts.ts:lowerForIn` (~12427) | General | Answer from the builtin's static key table (`builtins/global-namespace-keys.ts`). Simple form: materialize builtin namespaces as frozen DYN objects | S |
| B5 | `safer-buffer/safer.js:61` `process.binding('buffer')` (in try); `depd/index.js:251` `process.emit('deprecation', …)` | SC1090 "method calls like 'process.binding' / 'process.emit'" | `lower-calls.ts:lowerCall` (~1836, final fallback) | General (small) | `process.binding` throws Node's deprecation-style error, which the try catches. `process.emit` goes to the process EventEmitter surface | S |
| B6 | `get-intrinsic/index.js:38,111,351` `$gOPD`, `:141` `$defineProperty`; `dunder-proto/get.js:17` `gOPD`; `qs/lib/utils.js:88` `defineProperty`; `safer-buffer:19,25` `Buffer`; `proxy-addr:32-33` `ipaddr` | SC1030 "the reference to 'X' above its 'var' declaration…" | `lowerer.ts:rejectUnresolvedSymbol` (~13002) | **Diagnostic bug.** The message is wrong: the reads come *after* the declarations. The real cause is that the initializer's module export was refused (A3/A4) | Report the root cause, and gate the message on the actual source position | S |
| B7 | `object-inspect:341`, `qs/lib/utils.js:348` `$match.call(…)` / `Symbol.prototype.toString.call(…)`; `get-intrinsic:155` "shared property access without a represented union receiver"; `object-inspect:520` string conversion of a union with object arms; `function-bind/implementation.js:79` `new` of a `Function()`-built bound function; `qs/lib/utils.js:356`, `qs/lib/stringify.js:248` SC2001 | various SC1090/SC2001 | `lower-calls.ts:lowerObjLitGenericMethodCall` (~10048); `lower-classes.ts:lowerNew` (~11936) | Mostly general typing gaps; function-bind uses `Function()` codegen (R1.1, code from strings) | Widen `dynConvertible`, add a dynInvoke fallback. function-bind needs a shim, or a builtin alias to `Function.prototype.bind` | M |

### C. Package JSDoc used as types (general)

The checker reads package JSDoc, and lowering trusts it. Several express packages annotate with
names that resolve to the **DOM/fetch** globals, or with loose unions:

- `finalhandler/index.js:62-63` `@param {Request} req` / `{Response} res` → `res.headersSent` becomes SC2020 "Response.headersSent in a static build" (:84, :118)
- `express/lib/utils.js:157` `@param {String|Function} val` plus `switch (val) { case true: … }` → SC1090 "switch case tests of a different type than the discriminant" (:170)
- `send/index.js` `@param {string} path`, but `decode()` returns `-1` → SC1090 "method calls like 'path.indexOf' / 'path.split'" (:418, :438)
- `express/lib/response.js:682` and `bytes/index.js:60` → SC2003 union layout mismatches
- `body-parser/lib/types/json.js:95,114,141,177` → SC1100 "passing 'unknown' values where 'SyntaxError' is expected", "'delete' on 'SyntaxError' receivers"

In the probe, stripping `@param/@returns/@type {…}` from the 93 package files removed **all** of
these. A few honest gaps underneath became visible: surplus arguments with side effects in
body-parser/raw-body, `options.isValidCharset(...)`, and `.toFixed()` in bytes.

- **Fix (general, S–M):** treat JSDoc type tags in `--npm-static` JavaScript as hints, not as lowering types. At minimum, ignore tags that resolve to DOM-only globals (`Request`, `Response`, `Headers`, …) or that conflict with the observed code. Open **#2176** (shape overlay) already "neutralizes package JSDoc type tags in overlaid files". Turning that on by default, or splitting the neutralization out of it, covers this class.
- Area: the checker host's JS handling (`frontend/program.ts` / type-mapper), plus #2176's overlay.

### D. Dynamic-object and native-surface gaps reached on request paths (mostly "deferred")

| # | Site | Diagnostic | General? | Fix | Effort |
|---|---|---|---|---|---|
| D1 | `router/lib/layer.js:229` `err.status = 400` on a `URIError`; `body-parser/lib/types/json.js:172-182` `Object.getOwnPropertyNames(error)`, `delete error[key]`, `error.stack = …`; `depd:386,395` `Error.prepareStackTrace = …`; `http-errors` `Object.defineProperty(err,…)` (:142-249) | SC1090 "assignment to non-variables" ×4, SC2020 `Object.defineProperty` ×6, `Object.getOwnPropertyNames` | General (expandos on Error instances are ubiquitous in Node) | Give Error instances a DYN property bag. `dyn.defineProperty` / `getOwnPropertyNames` on them | M |
| D2 | `express/lib/application.js:605` `server.listen.apply(server, args)`; `raw-body:238` `callback.apply(…)` | SC1090 "Function.prototype.apply on a function whose signature cannot cross the checked-value boundary" | General | dynInvoke fallback into native method surfaces with DYN argument arrays (overload by runtime arity/type) | M |
| D3 | `path-to-regexp/dist/index.js:290` `result.length = len` (only for optional `{…}` route groups) | SC1090 "writing the length of an array-typed value without native array storage" | General | Length write on DYN arrays | S |
| D4 | `express/lib/response.js:172,860` `Buffer.byteLength(chunk, encoding)` with a DYN encoding | SC2020 "Buffer.byteLength with this argument shape" | General | Accept a runtime encoding string | S |
| D5 | `http-errors/index.js:117` `inherits(HttpError, Error)` style over class constructors | SC2020 "util.inherits over a class constructor" | General | Lower `util.inherits` as `setPrototypeOf` on DYN constructors | S–M |
| D6 | `body-parser/lib/read.js:228` `zlib.createZstdDecompress` | SC2020 | Surface gap | Add the zstd stream, or keep it fenced (the default `hasZstandardSupport` probe gates it) | S/M |
| D7 | `body-parser/lib/read.js:95,140,179`, `raw-body:163,245,260,277` | SC1090 "surplus arguments with side effects" (seen after JSDoc stripping) | General | Evaluate and drop the surplus arguments | S |
| D8 | `debug/src/node.js:250,262` `util.inspect(v, this.inspectOpts)`; `:194` `util.formatWithOptions` | SC2020 "util.inspect with a non-literal options argument" | Surface gap | Runtime options object | S |
| D9 | `iconv-lite/lib/helpers/merge-exports.js:8` `dest[key] = src[key]` on a `{__proto__: null}` table | SC1090 "assignment to non-array elements" | General | DYN keyed write on a null-proto object literal | S |

### E. Runtime-only gaps: no diagnostic, found by running the binary

| # | Finding | Where it fires | Root cause | Fix | Effort |
|---|---|---|---|---|---|
| E1 | `Uncaught Error: scriptc: overriding builtin function properties is not supported [SC2020]` | `router/index.js:445` `Router.prototype[method] = …` where `Router.prototype` is a **function** and `http.METHODS` includes `BIND`, so it writes `bind`; express does the same through `mixin(app, proto)` (`app.bind`) | `packages/runtime/src/scr_json.c:scr_dyn_fn_property_fence` (~8903) reserves `call/apply/bind/constructor/…` on function objects | Allow own `bind/call/apply/constructor` on DYN function objects. Typed call sites keep the native fast path only when the callee is a statically known function with no own override; otherwise go through the property table | M |
| E2 | `Uncaught Error: Object.create with this value is not supported yet` | `new Router()` with `Router.prototype = function () {}` (`router/index.js:80`) | `scr_json.c:scr_dyn_obj_create` (~2366) accepts only OBJ/ARR/NULL/typed-ref prototypes, not FUNC | Accept callable prototypes in `Object.create` / `new` / `setPrototypeOf`. Instances inherit function members through the chain | S–M |
| E3 | `Uncaught Error: setting 'res' on a dynamic IncomingMessage is not supported yet` | `express/lib/application.js` `app.handle`: `req.res = res; res.req = req; Object.setPrototypeOf(req, this.request); Object.setPrototypeOf(res, this.response)`. Router and middleware then add `req.params`, `req.baseUrl`, `req.originalUrl`, `req.next`, `res.locals`, … | `scr_json.c:scr_dyn_handle_key_set` (~6738): native handles are boxed per box, and "expandos per BOX would break handle identity". `scr_dyn_set_prototype` refuses HANDLE receivers. `http.IncomingMessage.prototype` / `ServerResponse.prototype` have no value lowering (`express/lib/request.js:30`, `response.js:43`, SC2020 at startup) | **The core Express blocker (C1 in the plan).** Give native objects (at least `http.IncomingMessage` and `http.ServerResponse`, ideally every handle class) a per-object expando bag and a settable `[[Prototype]]`, stored in the native object, not in the box. Lookup order: native own accessors/methods → expando bag → user prototype chain → native class prototype. Also expose the native class prototypes as DYN objects, so `Object.create(http.IncomingMessage.prototype)` builds an object whose missing members fall through to the native methods when the receiver is a real handle (express's `req.get`, `res.status`, `res.json`, … call `this.setHeader`, `this.end`, `this.headers` on the reprototyped native handle) | L |
| E4 | **Silent miscompile.** In `express/lib/express.js:37` `var app = function(req, res, next) { app.handle(req, res, next); };`, `app` is lowered to the unit/undefined constant (IR: `store ptr @sc_unit_5, ptr %sc_l_app_0`, no closure function emitted). `typeof app === 'undefined'` and `mixin(app, …)` throws "undefined is not representable in the target union". **No coverage diagnostic** | `createApplication` | Unknown. Any self-reference inside the initializer triggers it (`return typeof app` does too); an empty body does not. Isolated repros (same shape, separate modules, mixin, `http.createServer(this)`, user var also named `app`) compiled correctly, so it is a whole-program interaction. **It may come from the uncommitted worktree changes; check against main.** Workaround that worked: `function app(req, res, next) {…}` | Find the root cause. Never lower a function expression to unit silently: fence it with a diagnostic | M (investigation) |
| E5 | Coverage classes `depd(namespace)` work as "deferred", but it runs at load | every `require('depd')('pkg')` at a module top level → `depd/index.js:386` `getStack()` uses the V8 stack-trace API (`Error.prepareStackTrace`, `Error.captureStackTrace`, CallSite objects) and `new Function` (`:425`) | Coverage's startup classification is syntactic (top-level statements only), not call-graph | Classify functions reachable from module init as startup. depd itself needs a package shim (see plan) | S (coverage) |
| E6 | Fences thrown inside `try` are caught like real errors: `tryRequireAsyncHooks` in raw-body and on-finished silently return `{}`, so `AsyncResource.bind` is skipped | `raw-body/index.js:309`, `on-finished/index.js:208` | By design, but a silent behavior divergence | Make fence errors uncatchable, or at least warn | S |

---

## Dependency-ordered plan (PR-sized)

### Phase 1: `require('express')` loads with no startup fence

1. **Shims and aliases for leaf packages that can't or shouldn't compile faithfully** (S, one PR). Uses the existing machinery: `packages/compiler/shims/<name>/v<major>.ts` + `frontend/package-shims.ts`, and `frontend/builtin-package-aliases.ts`.
   - `safer-buffer` → builtin alias to `buffer` (like `safe-buffer`).
   - `side-channel@1` → a Map/WeakMap shim, a trivial API. This removes get-intrinsic, object-inspect, call-bind-*, call-bound, function-bind, gopd, dunder-proto, get-proto, has-symbols, hasown, math-intrinsics, es-errors, es-object-atoms, side-channel-list/map/weakmap: **all of category B except the express-direct sites**.
   - `es-define-property` → alias to `Object.defineProperty`.
   - `depd@2` → a shim: the stack-trace API plus `new Function`.
   - Optionally `debug@4` → a shim honoring `DEBUG`. This makes phase 1 independent of A1/A3/A4 for debug, but debug's patterns recur widely, so do the general fixes too.
2. **npm-static rewrite: environment-branch fold + classic UMD/IIFE unwrap** (A3, S–M). Extend `npm-static-umd.ts` / the services rewrite list. This fixes `debug/src/index.js` (and drops browser.js, 18 diagnostics) and `ipaddr.js`.
3. **CJS whole-value exports** (A4 + A6, M). `module.exports = <any expr>` (a call result, a `var` reassigned in try/catch), quoted-key and method table entries, and non-reassigned `var` export by value. Fixes debug/node.js's `require('./common')(exports)` result, es-define-property, gopd, qs/formats, ipaddr.
4. **CJS materialized exports object** (A1 + A2 + A5, L). This is the biggest general item. Exports escape → DYN exports object; `require(x)` value of a table module → DYN namespace. Fixes express application.js/express.js (`app[method]`, `mixin(app, proto)`, `express.Router`), debug `common(exports)`, http-errors, iconv-lite, qs formats-as-value. **#2178** (re-export wrappers) overlaps for `module.exports = lib` and should land first or merge into this.
5. **Small builtin-value and namespace items needed by express directly** (subset of B2 + B4 + A8, S–M):
   - `url.parse`, `querystring.parse` and `RegExp#test` as values.
   - `'k' in zlib`, `for…in` over builtin namespaces, builtin namespaces as DYN values.
   - `return require('async_hooks')` inside a function.
   - Builtin prototypes as values for `http.IncomingMessage.prototype` / `ServerResponse.prototype` (an empty DYN placeholder is enough at this stage).
6. **JSDoc neutralization for npm JS** (C, S–M). Alternatively make #2176's neutralization independent of the overlay.
7. **Fix the E4 silent miscompile** (M). Must come before anything is trusted at runtime.
8. **Diagnostics hygiene** (B6, E5, E6, S): correct SC1030 root cause, startup classification through module-init call graphs, uncatchable fences.

After 1–8, `require('express')` and `express()` should load. In the probe, steps equivalent to 1,
2, 4 (by source patch), 5, 6 and the E4 workaround were enough to reach `app.get` and
`app.listen`, once 9–10 were also patched around.

### Phase 2: create the app, register routes, listen

9. **Function-object reserved keys** (E1, M). Own `bind/call/apply/constructor` on DYN functions (HTTP `BIND` method).
10. **Function-valued prototypes** (E2, S–M). `Router.prototype = function(){}`, then `new Router`, `Object.setPrototypeOf(fn, proto)`.
11. **`apply`/`call` into native surfaces with DYN arguments** (D2, M). `server.listen.apply(server, args)` and raw-body callbacks.

### Phase 3: serve a request (`GET /hello` → JSON, 404 through finalhandler)

12. **Extensible, re-prototypable native http objects** (E3, L). Per-object expando bag + settable `[[Prototype]]` on `IncomingMessage`/`ServerResponse` handles, native class prototypes as DYN objects, and method dispatch through the chain with the native handle as `this`. Nothing else unlocks Express's request path. The same machinery serves any Connect-style middleware.
13. **Error expandos** (D1, M). `err.status`, `Object.getOwnPropertyNames(err)`, `delete err[k]`. Router/finalhandler/body-parser error paths hit these.
14. **Response-path surface gaps found after 12** (D4, D7, D8 and whatever turns up, S each). `Buffer.byteLength(chunk, enc)` and surplus arguments. etag/fresh/statuses/encodeurl/escape-html compiled statically in coverage.
15. **body-parser JSON/urlencoded** (needed by Nest's default body parsing, M): raw-body + iconv-lite.
    - Shim iconv-lite to `TextDecoder`/`Buffer` for the common encodings, or compile its encoding tables.
    - Zlib inflate streams; zstd stays gated.
    - qs `parse` (extended urlencoded) compiles once side-channel is shimmed.
16. Optional: **#2079 extended to plain computed `require`** (A9) for `res.render` engines, and D3 (path-to-regexp optional groups).

The minimum for a working JSON app is 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14: about 13 PRs.
Two of them are L (4 and 12), and 12 is the long pole. Adding 15 covers Nest's body parsing.

## Could a few npm-static rewrites cover most of it?

Partly. Rewrites (alongside `npm-static-umd.ts`, `npm-static-rewrite-syntax.ts`,
`npm-static-cjs-exports-alias.ts`, `npm-static-cjs-exports-var.ts`) plus 3–4 package shims could
clear **most of the load-time diagnostics by count** (an estimated 70–80% of the 160):

- environment/UMD folding (A3)
- `module.exports = <expr>` → `const __x = <expr>; module.exports = __x` (A4)
- method/quoted-key table desugaring (A6)
- splitting `var app = exports = module.exports = {}` into an exports alias (only half of A1, because `app[method]` computed writes still need a real object)
- hoisting `try { var x = require() }` (A7)
- `var $call = Function.prototype.call` call-site inlining (B1)
- stripping JSDoc type tags (C)
- shims for side-channel, safer-buffer, depd and es-define-property, which remove nearly all of category B

They **cannot** cover the critical path:
- the materialized exports object for express core (A1)
- function-object reserved keys and function-valued prototypes (E1/E2)
- native req/res expandos and re-prototyping (E3)
- Error expandos (D1)
- the silent miscompile (E4)

Those need lowering and runtime work.

## Related open scriptc PRs/issues (vercel-labs/scriptc)

- **#2178** "Support CommonJS wrapper modules that re-export another module": helps A2/A5. It covers `var lib = require(...); module.exports = lib` and chains. After the A3 fold, debug's index.js becomes exactly such a wrapper. It does not cover call-result exports or exports-as-value.
- **#2079** "Resolve computed createRequire specifiers at run time": helps only A9 (express `view.js`, `res.render`) if extended to plain `require(expr)`. Not on the JSON-API critical path. Refs issue **#1777** (remaining `--npm-static=auto` refusals: namespace re-export cycle, createRequire, CJS entries not joining).
- **#2176** "shape overlay (opt-in)": neutralizes package JSDoc type tags in overlaid files, which covers category C if enabled for these packages.
- **#2175** (constructor functions → classes) and **#2220** (constant function tables, cross-module namespace members): performance for Router/Layer/Route/Negotiator/Accepts-style ES5 code. These already compile in the dynamic tier, so they are not correctness blockers.
- **#2057** (inherited `Object.prototype` members for computed dynamic reads): relevant to express/router's dynamic property reads.
- Node islands stack **#1899–#1908** (and #1684/#1685 libnode): an alternative route that runs express in embedded Node instead of natively. #1907 explicitly fixed CJS island requires for Next.js standalone. It sidesteps every item above, but it is not native compilation.
- **#2209** (legacy decorators + native NestJS acceptance): the companion NestJS effort.

## Probe patches used (scratch only, for reference)

To reach `listen()` the probe changed the following, all in the scratch copy:
- stubbed debug, side-channel, safer-buffer, qs, http-errors, iconv-lite and depd
- folded `'createZstdDecompress' in zlib`
- unwrapped ipaddr.js and turned its `ipaddr` into a `const`
- wrapped `url.parse`, `querystring.parse` and `ipaddr.isValid/parse` in functions
- `var app = {}` … `module.exports = app` in application.js
- `var req = {}` / `var res = {}` in request.js/response.js
- skipped `bind`/`constructor` in merge-descriptors and router
- `Router.prototype = {}`
- `function app(){}` in express.js
- `server.listen(args[0], args[args.length-1])`
- stripped JSDoc types

Result: `express()` → `app.get` → `app.listen` → "listening", then `setting 'res' on a dynamic
IncomingMessage is not supported yet` on the first request.

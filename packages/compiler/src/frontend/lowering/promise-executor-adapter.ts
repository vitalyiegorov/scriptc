import { keyedHelperName } from "./stable-names.js";
import * as ts from "../ts7/adapter.js";
import { varRef } from "../../ir/build.js";
import { builtinGlobalValue } from "./expressions/property-access.js";
import { checkedClassConstruction } from "./class-construction.js";
import { buildFunctionAdapter } from "./coercions/builders.js";
import { locOf } from "../program.js";
import {
  BOOL,
  DYN,
  type IrExpr,
  type IrLocal,
  type IrParam,
  type IrType,
  type SrcLoc,
  VOID,
  funcOf,
  typeKey,
} from "../../ir/ir.js";
import { newFnCtx, type Lowerer } from "./lowerer.js";

/** An executor VALUE whose parameters are checked-dynamic (a JavaScript
 * function declaration: `function run(resolve, reject) {...}; return new
 * Promise(run)`): the promise's native executor is an adapter closure that
 * receives the native (resolve, reject) pair and calls the original with
 * both boxed into the checked-dynamic tree, so the JavaScript body calls
 * them like any function value. Null when the executor's shape is not
 * adaptable (more than two parameters, a rest parameter, or a parameter
 * that neither is dyn nor already the native closure). */
export function adaptPromiseExecutor(
  lowerer: Lowerer,
  executor: IrExpr,
  inner: IrType,
  loc: SrcLoc,
  /** The executor was typed against a Promise constructor SIGNATURE
   * (`PromiseConstructorLike`): its resolve and reject are function types
   * over checked-dynamic values, which the native pair converts into. */
  signatureTyped = false,
): IrExpr | null {
  const execT = executor.type;
  if (execT.kind !== "func" || execT.rest || execT.params.length > 2) return null;
  if (!execT.params.some((p) => p.kind === "dyn" || (signatureTyped && p.kind === "func")))
    return null;
  const resolveT = funcOf(inner.kind === "void" ? [] : [inner], VOID);
  const rejectT = funcOf([{ kind: "object", className: "%Error" }], VOID);
  const native = [resolveT, rejectT];
  if (
    !execT.params.every(
      (p, i) =>
        p.kind === "dyn" ||
        typeKey(p) === typeKey(native[i]!) ||
        (signatureTyped && p.kind === "func"),
    ) ||
    !native.slice(0, execT.params.length).every((t) => lowerer.dynConvertible(t))
  )
    return null;
  const adaptT = funcOf(native, VOID);
  const key = `promise.executor:${typeKey(execT)}:${typeKey(inner)}`;
  let name = lowerer.arrHofHelpers.get(key);
  if (name === undefined) {
    name = keyedHelperName(lowerer, "%promise.executor", key);
    lowerer.arrHofHelpers.set(key, name);
    const impl = `${name}.impl`;
    const captured: IrLocal = { id: "f.0", name: "f", type: execT, mutable: false, boxed: true };
    const params: IrParam[] = [
      { localId: "resolve.0", name: "resolve", type: resolveT },
      { localId: "reject.0", name: "reject", type: rejectT },
    ];
    const ctx = newFnCtx(false, null, null, VOID);
    lowerer.fnStack.push(ctx);
    let args: IrExpr[];
    try {
      args = execT.params.map((p, i) =>
        signatureTyped && p.kind === "func"
          ? {
              kind: "call",
              callee: signatureBridge(lowerer, native[i] as IrType & { kind: "func" }, p, loc),
              args: [varRef(params[i]!.localId, native[i]!, loc)],
              type: p,
              loc,
            }
          : lowerer.coerceToExpected(varRef(params[i]!.localId, native[i]!, loc), p),
      );
    } finally {
      lowerer.fnStack.pop();
    }
    lowerer.liftedFns.push({
      name: impl,
      params,
      returnType: VOID,
      captures: [{ localId: captured.id, name: captured.name, type: execT }],
      locals: [
        captured,
        ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        ...ctx.locals,
      ],
      body: [
        {
          kind: "exprStmt",
          expr: {
            kind: "callValue",
            callee: varRef(captured.id, execT, loc),
            args,
            type: execT.ret,
            loc,
          },
          loc,
        },
      ],
      loc,
    });
    lowerer.liftedFns.push({
      name,
      params: [{ localId: captured.id, name: captured.name, type: execT }],
      returnType: adaptT,
      locals: [captured],
      body: [
        {
          kind: "return",
          value: { kind: "closure", fnName: impl, captures: [captured.id], type: adaptT, loc },
          loc,
        },
      ],
      loc,
    });
  }
  return { kind: "call", callee: name, args: [executor], type: adaptT, loc };
}

/** A native resolve or reject presented as the function type the executor's
 * signature spells over checked-dynamic values (`(value: T | PromiseLike<T>)
 * => void`, `(reason?: any) => void`): the bridge checks each incoming
 * value into the native parameter type, as a call through that signature
 * lands in the promise's own settle closure. */
function signatureBridge(
  lowerer: Lowerer,
  nativeT: IrType & { kind: "func" },
  dstT: IrType & { kind: "func" },
  loc: SrcLoc,
): string {
  const key = `promise.settle:${typeKey(nativeT)}:${typeKey(dstT)}`;
  const existing = lowerer.arrHofHelpers.get(key);
  if (existing !== undefined) return existing;
  const name = keyedHelperName(lowerer, "%promise.settle", key);
  lowerer.arrHofHelpers.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const params: IrParam[] = dstT.params.map((t, i) => ({
    localId: `a.${i}`,
    name: `a${i}`,
    type: t,
  }));
  const ctx = newFnCtx(false, null, null, VOID);
  lowerer.fnStack.push(ctx);
  let args: IrExpr[];
  try {
    args = nativeT.params.map((t, i) =>
      lowerer.coerceToExpected(varRef(`a.${i}`, params[i]!.type, loc), t),
    );
  } finally {
    lowerer.fnStack.pop();
  }
  lowerer.liftedFns.push(
    ...buildFunctionAdapter(
      name,
      nativeT,
      dstT,
      params,
      ctx.locals,
      [
        {
          kind: "exprStmt",
          expr: { kind: "callValue", callee: varRef("f.0", nativeT, loc), args, type: VOID, loc },
          loc,
        },
        { kind: "return", value: null, loc },
      ],
      loc,
    ),
  );
  return name;
}

/** `new ctor(executor)` where `ctor` is a checked-dynamic value typed by a
 * Promise constructor signature (`PromiseConstructorLike | PromiseConstructor`
 * — rxjs's configurable `config.Promise`): the value holds the Promise
 * global or a caller-supplied constructor. The Promise global builds a native
 * promise from the executor (resolve and reject adapted to the executor's
 * parameter types); any other value constructs through the checked-dynamic
 * path. The result is the thenable the signature promises, as a dynamic value.
 * Null when the site is not a one-executor construction of that signature. */
export function lowerPromiseConstructorValueNew(
  lowerer: Lowerer,
  expr: ts.NewExpression,
  callee: IrExpr,
): IrExpr | null {
  const args = expr.arguments?.nodes ?? [];
  if (args.length !== 1 || ts.isSpreadElement(args[0]!)) return null;
  const signature = lowerer.checker.getResolvedSignature(expr);
  if (signature === undefined) return null;
  const instance = lowerer.checker.getReturnTypeOfSignature(signature);
  const sym = instance.getSymbol();
  if (
    sym === undefined ||
    !["Promise", "PromiseLike"].includes(ts.symbolName(sym)) ||
    !sym.declarations.some(
      (d) => ts.isInterfaceDeclaration(d) && lowerer.isStdlibFile(ts.getSourceFileOfNode(d)),
    )
  )
    return null;
  const loc = locOf(expr);
  const targ = lowerer.checker.getTypeArguments(instance as ts.TypeReference)[0];
  const mapped = targ === undefined ? null : lowerer.mapTypeOf(targ);
  const inner: IrType = mapped ?? DYN;
  const promiseT: IrType = { kind: "promise", inner };
  const executor = lowerer.lowerExpr(args[0]!);
  if (executor.type.kind !== "func") return null;
  const adapted = adaptPromiseExecutor(lowerer, executor, inner, loc, true);
  if (adapted === null) return null;
  const calleeLocal = lowerer.declareHiddenLocal("%promiseCtor", DYN);
  const executorLocal = lowerer.declareHiddenLocal("%promiseExecutor", executor.type);
  const calleeRef = varRef(calleeLocal.id, DYN, loc);
  const executorRef = varRef(executorLocal.id, executor.type, loc);
  const isPromise: IrExpr = {
    kind: "dynScalarEq",
    left: calleeRef,
    right: builtinGlobalValue("Promise", loc)!,
    type: BOOL,
    loc,
  };
  const native: IrExpr = lowerer.coerceToExpected(
    {
      kind: "newPromise",
      executor: adaptPromiseExecutor(lowerer, executorRef, inner, loc, true)!,
      type: promiseT,
      loc,
    },
    DYN,
  );
  return {
    kind: "seqExpr",
    stmts: [
      { kind: "varDecl", localId: calleeLocal.id, init: callee, loc },
      { kind: "varDecl", localId: executorLocal.id, init: executor, loc },
    ],
    result: {
      kind: "ternary",
      cond: isPromise,
      then: native,
      else_: checkedClassConstruction(
        lowerer,
        calleeRef,
        [lowerer.coerceToExpected(executorRef, DYN)],
        loc,
      ),
      type: DYN,
      loc,
    },
    type: DYN,
    loc,
  };
}

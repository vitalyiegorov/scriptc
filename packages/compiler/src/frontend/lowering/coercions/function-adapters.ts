import { keyedHelperName } from "../stable-names.js";
import { dynUndefinedExpr } from "../../../ir/build.js";
import { buildFunctionAdapter } from "./builders.js";
import { InternalCompilerError } from "../../../errors.js";
import type { IrExpr, IrParam, IrStmt, IrType, SrcLoc } from "../../../ir/ir.js";
import {
  canAdaptDynFuncTo,
  canBoxFuncIntoDyn,
  canDynCheckTo,
  BOOL,
  DYN,
  F64,
  isUnitType,
  STRING,
  typeEquals,
  UNDEFINED_T,
} from "../../../ir/ir.js";
import { typeKey } from "../../type-mapper.js";
import { newFnCtx } from "../function-context.js";
import type { Lowerer } from "../lowerer.js";
import { maybePromiseUnionOf } from "../maybe-promise.js";

/** Wrap a zero-argument function whose array result needs an element
 * conversion. Each invocation creates a fresh converted array; the factory
 * creates a fresh closure capturing the original function. */
export function funcReturnWidthAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string | null {
  if (fromT.params.length !== 0 || toT.params.length !== 0) return null;
  if (fromT.ret.kind !== "array" || toT.ret.kind !== "array") return null;
  const mapper = lowerer.arrayWidthHelper(fromT.ret, toT.ret, loc);
  if (!mapper) return null;
  const key = `fn:${typeKey(fromT.ret.elem)}:${typeKey(toT.ret.elem)}`;
  const existing = lowerer.valueHelpers.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fn.width", key);
  lowerer.valueHelpers.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  // The returned closure's body: call the captured original, width-map.
  lowerer.liftedFns.push(
    ...buildFunctionAdapter(
      name,
      fromT,
      toT,
      [],
      [],
      [
        {
          kind: "return",
          value: {
            kind: "call",
            callee: mapper,
            args: [
              {
                kind: "callValue",
                callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
                receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
                args: [],
                type: fromT.ret,
                loc,
              },
            ],
            type: toT.ret,
            loc,
          },
          loc,
        },
      ],
      loc,
    ),
  );
  return name;
}

/** Probe mechanical value conversions without creating helpers.
 * Trap-only conversions are excluded: they cannot justify an adapter that
 * promises to accept the destination signature. */
export function coercibleValue(lowerer: Lowerer, src: IrType, dst: IrType): boolean {
  if (typeEquals(src, dst)) return true;
  if (src.kind === "object" && dst.kind === "object")
    return lowerer.isSubclassOf(src.className, dst.className);

  if (dst.kind === "dyn") return src.kind !== "dyn" && lowerer.dynConvertible(src);
  if (src.kind === "dyn") {
    // The checked-dynamic function boundary's OUT direction joins the
    // mechanical set: a dyn result landing in an adaptable func slot
    // takes dynCheck's per-target shim (coerceToExpected's funcOk rule
    // — the production/development function-choice ternary shape).
    return (
      lowerer.jsonSafe(dst) ||
      (dst.kind === "func" &&
        canAdaptDynFuncTo(
          dst,
          (id) => lowerer.shapes.get(id),
          (id) => lowerer.unions.get(id),
        ))
    );
  }
  if (dst.kind === "union") {
    if (src.kind === "union") return lowerer.unionRetagMappable(src.unionId, dst.unionId);
    if (src.kind === "void") return lowerer.armTag(dst.unionId, UNDEFINED_T) >= 0;
    if (src.kind === "promise") {
      // A maybe-promise union's promise arm accepts payload widening.
      const mp = maybePromiseUnionOf(lowerer, dst);
      if (mp) return lowerer.promisePayloadWidens(src, mp.promise);
    }
    return !isUnitType(src) && lowerer.armTag(dst.unionId, src) >= 0;
  }
  if (src.kind === "union") {
    return !isUnitType(dst) && dst.kind !== "void" && lowerer.armTag(src.unionId, dst) >= 0;
  }
  return false;
}

/** Whether all parameters and the result adapt without a trap-only path.
 * Rest signatures are excluded, except a typed-rest source in a slot with
 * fixed parameters (the rest packing adapter); extra destination
 * parameters are ignored. */
export function cleanFuncAdaptable(
  lowerer: Lowerer,
  src: IrType & { kind: "func" },
  dst: IrType & { kind: "func" },
): boolean {
  if (restPackingAdapterFits(lowerer, src, dst)) return true;
  if (restFoldAdapterFits(lowerer, src, dst)) return true;
  if (dynRestAdapterFits(lowerer, src, dst)) return true;
  if (src.rest === true || dst.rest === true) return false;
  if (src.params.length > dst.params.length) return false;
  for (let i = 0; i < src.params.length; i++) {
    if (lowerer.coercibleValue(dst.params[i]!, src.params[i]!)) continue;
    // A checked-dynamic slot parameter into the function's typed one: the
    // call checks the value into the parameter type (funcCoerceAdapter).
    if (
      dst.params[i]!.kind === "dyn" &&
      canDynCheckTo(
        src.params[i]!,
        (id) => lowerer.shapes.get(id),
        (id) => lowerer.unions.get(id),
      )
    )
      continue;
    return false;
  }
  if (dst.ret.kind === "void") return true;
  if (lowerer.coercibleValue(src.ret, dst.ret)) return true;
  return src.ret.kind === "void" && dst.ret.kind === "dyn";
}

/** Whether a typed-rest function (`(...m: T[]) => R`) can serve a slot
 * with fixed parameters (`(m: T) => void`): the slot's parameters convert
 * to the function's fixed parameters, then to the rest element type. */
export function restPackingAdapterFits(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
): boolean {
  if (fromT.rest !== true || fromT.restAbi !== "typed" || toT.rest === true) return false;
  const fixed = fromT.params.length - 1;
  const restT = fromT.params[fixed];
  if (restT?.kind !== "array") return false;
  // Fixed positions the slot does not spell must be optional ones.
  for (let i = toT.params.length; i < fixed; i++) {
    if (optionalAbsentValue(lowerer, fromT.params[i]!, restT.elem) === null) return false;
  }
  for (let i = 0; i < toT.params.length; i++) {
    if (!lowerer.coercibleValue(toT.params[i]!, i < fixed ? fromT.params[i]! : restT.elem))
      return false;
  }
  return toT.ret.kind === "void" || lowerer.coercibleValue(fromT.ret, toT.ret);
}

/** The value a parameter takes when its caller omits it: undefined, for a
 * parameter whose type holds undefined. Null for any other type. */
function optionalAbsentValue(
  lowerer: Lowerer,
  type: IrType,
  _restElem: IrType,
  loc: SrcLoc = { file: "", start: 0, end: 0 },
): IrExpr | null {
  if (type.kind === "dyn") return dynUndefinedExpr(loc);
  if (type.kind === "union" && lowerer.armTag(type.unionId, UNDEFINED_T) >= 0)
    return lowerer.wrappedUndefined(type, loc);
  return null;
}

/** The adapter for restPackingAdapterFits: forwards the fixed arguments and
 * packs the remaining ones into the rest array, as a JavaScript call of the
 * function with those arguments does. */
function restPackingAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string {
  const key = `fnrestadapt:${typeKey(fromT)}:${typeKey(toT)}`;
  const existing = lowerer.coercions.retags.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fn.adapt", key);
  lowerer.coercions.retags.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const fixed = fromT.params.length - 1;
  const restT = fromT.params[fixed] as IrType & { kind: "array" };
  const params: IrParam[] = toT.params.map((t, i) => ({
    localId: `a.${i}`,
    name: `a${i}`,
    type: t,
  }));
  const arg = (i: number, want: IrType): IrExpr =>
    lowerer.coerceToExpected(
      { kind: "varRef", localId: `a.${i}`, type: toT.params[i]!, loc },
      want,
    );
  const args: IrExpr[] = [];
  for (let i = 0; i < fixed; i++)
    args.push(
      i < toT.params.length
        ? arg(i, fromT.params[i]!)
        : optionalAbsentValue(lowerer, fromT.params[i]!, restT.elem, loc)!,
    );
  const packed: IrExpr[] = [];
  for (let i = fixed; i < toT.params.length; i++) packed.push(arg(i, restT.elem));
  args.push({ kind: "arrayLit", elems: packed, type: restT, loc });
  const call: IrExpr = {
    kind: "callValue",
    callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
    receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
    args,
    type: fromT.ret,
    loc,
  };
  const body: IrStmt[] =
    toT.ret.kind === "void"
      ? [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: null, loc },
        ]
      : [{ kind: "return", value: lowerer.coerceToExpected(call, toT.ret), loc }];
  lowerer.liftedFns.push(...buildFunctionAdapter(name, fromT, toT, params, [], body, loc));
  return name;
}

/** Whether a function with leading optional parameters before its typed
 * rest (`(data?: unknown, ...pipes: T[]) => R`) can serve a slot that is
 * only a typed rest of the same element (`(...args: T[]) => R`): the
 * slot's packed arguments feed the leading parameters first, then the
 * rest. */
export function restFoldAdapterFits(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
): boolean {
  if (fromT.rest !== true || fromT.restAbi !== "typed") return false;
  if (toT.rest !== true || toT.restAbi !== "typed" || toT.params.length !== 1) return false;
  const fixed = fromT.params.length - 1;
  if (fixed < 1) return false;
  const fromRest = fromT.params[fixed];
  const toRest = toT.params[0];
  if (fromRest?.kind !== "array" || toRest?.kind !== "array") return false;
  if (!typeEquals(fromRest.elem, toRest.elem)) return false;
  for (let i = 0; i < fixed; i++) {
    if (optionalAbsentValue(lowerer, fromT.params[i]!, toRest.elem) === null) return false;
    if (!lowerer.coercibleValue(toRest.elem, fromT.params[i]!)) return false;
  }
  return toT.ret.kind === "void" || lowerer.coercibleValue(fromT.ret, toT.ret);
}

/** The adapter for restFoldAdapterFits: the packed arguments' first
 * elements feed the leading parameters (undefined where absent), and the
 * remainder is the rest array. */
function restFoldAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string {
  const key = `fnrestfold:${typeKey(fromT)}:${typeKey(toT)}`;
  const existing = lowerer.coercions.retags.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fn.adapt", key);
  lowerer.coercions.retags.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const fixed = fromT.params.length - 1;
  const restT = fromT.params[fixed] as IrType & { kind: "array" };
  const packedT = toT.params[0] as IrType & { kind: "array" };
  const params: IrParam[] = [{ localId: "a.0", name: "a0", type: packedT }];
  const packed = (): IrExpr => ({ kind: "varRef", localId: "a.0", type: packedT, loc });
  const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
  const args: IrExpr[] = [];
  for (let i = 0; i < fixed; i++) {
    const present = lowerer.coerceToExpected(
      { kind: "arrayGet", arr: packed(), index: num(i), type: packedT.elem, loc },
      fromT.params[i]!,
    );
    args.push({
      kind: "ternary",
      cond: {
        kind: "bin",
        op: ">",
        left: {
          kind: "arrIntrinsic",
          method: "length",
          receiver: packed(),
          args: [],
          type: F64,
          loc,
        },
        right: num(i),
        type: BOOL,
        loc,
      },
      then: present,
      else_: optionalAbsentValue(lowerer, fromT.params[i]!, packedT.elem, loc)!,
      type: fromT.params[i]!,
      loc,
    });
  }
  args.push({
    kind: "arrIntrinsic",
    method: "slice",
    receiver: packed(),
    args: [num(fixed)],
    type: restT,
    loc,
  });
  const call: IrExpr = {
    kind: "callValue",
    callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
    receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
    args,
    type: fromT.ret,
    loc,
  };
  const body: IrStmt[] =
    toT.ret.kind === "void"
      ? [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: null, loc },
        ]
      : [{ kind: "return", value: lowerer.coerceToExpected(call, toT.ret), loc }];
  lowerer.liftedFns.push(...buildFunctionAdapter(name, fromT, toT, params, [], body, loc));
  return name;
}

/** Adapt a fixed-parameter function to a checked-dynamic rest signature
 * without fixed parameters (`() => {}` into mock.fn()'s `(...args: any[])
 * => undefined`): the adapter receives the hidden argument array and
 * passes its element i as parameter i, undefined when the caller passed
 * fewer arguments, as JS does. Null unless every parameter is
 * checked-dynamic, which holds a missing argument as undefined, and the
 * result is discarded or converts. */
export function dynRestAdapterFits(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
): boolean {
  if (!(toT.rest === true && toT.restAbi === undefined && toT.params.length === 0)) return false;
  // A typed rest after the fixed parameters takes the hidden array's tail
  // (`(data?: unknown, ...pipes: unknown[]) => R` into `(...args: any[])`).
  // A checked-dynamic rest after the fixed parameters takes it the same way.
  const typedRest = fromT.rest === true && fromT.restAbi === "typed";
  const dynRest = fromT.rest === true && fromT.restAbi === undefined;
  const fixedCount = typedRest ? fromT.params.length - 1 : fromT.params.length;
  if (typedRest && fromT.params[fixedCount]?.kind !== "array") return false;
  if (dynRest && fromT.argumentsAll === true) return false;
  if (dynRest) {
    if (
      !canBoxFuncIntoDyn(
        fromT,
        (id) => lowerer.shapes.get(id),
        (id) => lowerer.unions.get(id),
      )
    )
      return false;
    return toT.ret.kind === "void" || lowerer.coercibleValue(DYN, toT.ret);
  }
  if (fromT.params.slice(0, fixedCount).some((p) => p.kind !== "dyn")) return false;
  return toT.ret.kind === "void" || lowerer.coercibleValue(fromT.ret, toT.ret);
}

function funcIntoDynRestAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string | null {
  if (!dynRestAdapterFits(lowerer, fromT, toT)) return null;
  const typedRest = fromT.rest === true && fromT.restAbi === "typed";
  const dynRest = fromT.rest === true && fromT.restAbi === undefined;
  const fixedCount = typedRest ? fromT.params.length - 1 : fromT.params.length;
  const restParam = typedRest ? fromT.params[fixedCount] : dynRest ? DYN : undefined;
  const key = `fnadapt:${typeKey(fromT)}:${typeKey(toT)}`;
  const existing = lowerer.coercions.retags.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fn.adapt", key);
  lowerer.coercions.retags.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const params: IrParam[] = [{ localId: "rest.0", name: "args", type: DYN }];
  const sliced: IrExpr = {
    kind: "dynInvoke",
    recv: { kind: "varRef", localId: "rest.0", type: DYN, loc },
    method: "slice",
    calleeName: "arguments.slice",
    args: [
      {
        kind: "dynFrom",
        value: { kind: "numLit", value: fixedCount, type: F64, loc },
        type: DYN,
        loc,
      },
    ],
    type: DYN,
    loc,
  };
  const restTail =
    restParam?.kind === "array" ? lowerer.coerceToExpected(sliced, restParam) : sliced;
  // A checked-dynamic rest function applies through its boxed form, which
  // delivers JS arity: `from(...args)`.
  const call: IrExpr = dynRest
    ? {
        kind: "dynCall",
        callee: {
          kind: "dynFrom",
          value: { kind: "varRef", localId: "f.0", type: fromT, loc },
          type: DYN,
          loc,
        },
        calleeName: "value",
        args: [{ kind: "varRef", localId: "rest.0", type: DYN, loc }],
        spreads: [{ arg: 0, what: "args" }],
        type: DYN,
        loc,
      }
    : {
        kind: "callValue",
        callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
        receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
        args: [
          ...fromT.params.slice(0, fixedCount).map((_, i): IrExpr => ({
            kind: "dynKeyGet",
            value: { kind: "varRef", localId: "rest.0", type: DYN, loc },
            key: { kind: "strLit", value: String(i), type: STRING, loc },
            type: DYN,
            loc,
          })),
          ...(restParam === undefined ? [] : [restTail]),
        ],
        type: fromT.ret,
        loc,
      };
  let body: IrStmt[];
  if (toT.ret.kind === "void") {
    body = [
      { kind: "exprStmt", expr: call, loc },
      { kind: "return", value: null, loc },
    ];
  } else {
    const result = lowerer.coerceToExpected(call, toT.ret);
    if (!typeEquals(result.type, toT.ret))
      throw new InternalCompilerError("lowerer bug: probed fn-adapter return stopped coercing");
    body = [{ kind: "return", value: result, loc }];
  }
  lowerer.liftedFns.push(...buildFunctionAdapter(name, fromT, toT, params, [], body, loc));
  return name;
}

/** Adapt a function value to a destination signature, forwarding and
 * converting its arguments and result. Unsupported parameter/result pairs
 * produce checked traps when called. Rest signatures are refused, except a
 * typed-rest source in a slot with fixed parameters, which the rest
 * packing adapter serves, and a fixed-parameter function into a
 * checked-dynamic rest signature without fixed parameters
 * (funcIntoDynRestAdapter). */
export function funcCoerceAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string | null {
  if (restPackingAdapterFits(lowerer, fromT, toT))
    return restPackingAdapter(lowerer, fromT, toT, loc);
  if (restFoldAdapterFits(lowerer, fromT, toT)) return restFoldAdapter(lowerer, fromT, toT, loc);
  if (toT.rest === true && toT.restAbi === undefined && toT.params.length === 0)
    return funcIntoDynRestAdapter(lowerer, fromT, toT, loc);
  if (fromT.rest === true || toT.rest === true) return null;
  // A function with MORE parameters fits a shorter signature when the extra
  // ones are optional: the call passes undefined for them (`(data?: T) => R`
  // held by a `() => R` slot).
  const extraParams = fromT.params.slice(toT.params.length);
  const extraUndefined = (type: IrType, at: SrcLoc): IrExpr | null =>
    type.kind === "dyn"
      ? dynUndefinedExpr(at)
      : type.kind === "union" && lowerer.armTag(type.unionId, UNDEFINED_T) >= 0
        ? lowerer.wrappedUndefined(type, at)
        : null;
  if (extraParams.some((type) => extraUndefined(type, loc) === null)) return null;
  // Piece dispositions beyond coercibleValue, all CHECKER-APPROVED
  // function compatibilities (bivariant method params under the suite's
  // non-strict settings, `() => never` throwers displayed as void by
  // the type mapping, void functions into unknown/any-returning slots):
  // - strandParams: some parameter cannot convert — the assignment
  //   compiles, INVOKING the slot throws the stranded TypeError (a
  //   never-called mismatched callback is exact; divergence 38's stance
  //   extended to calls).

  // - voidRet "dyn": return native undefined after the call's effects.
  // - voidRet "strand": a void result where the slot promises a typed
  //   value — the call runs (a `never` thrower never comes back, so the
  //   trap is unreachable there), then the stranded TypeError.
  let strandParams = false;
  const narrowedParams = new Map<number, ReadonlySet<number>>();
  const partialDynParams = new Map<number, IrType>();
  for (let i = 0; i < Math.min(fromT.params.length, toT.params.length); i++) {
    const actual = toT.params[i]!;
    const expected = fromT.params[i]!;
    if (lowerer.coercibleValue(actual, expected)) continue;
    // A record argument the parameter's shape is a structural width of
    // (members missing from the argument are optional there): the
    // record width conversion.
    if (lowerer.widthLiftPlan(actual, expected)) continue;
    if (actual.kind === "union" && expected.kind === "dyn") {
      const arms =
        lowerer.unions.get(actual.unionId)?.arms.filter((arm) => lowerer.dynConvertible(arm)) ?? [];
      if (arms.length > 0) {
        partialDynParams.set(
          i,
          arms.length === 1 ? arms[0]! : { kind: "union", unionId: lowerer.unions.intern(arms) },
        );
        continue;
      }
    }
    // A stored native builtin can have a narrower supported overload
    // than its public declaration. Preserve every supported union arm
    // and reject only an invocation carrying an unsupported arm. This
    // is the union counterpart of the checked single-arm extraction.
    if (actual.kind === "union" && expected.kind === "union") {
      const source = lowerer.unions.get(actual.unionId);
      const target = lowerer.unions.get(expected.unionId);
      if (
        source &&
        target &&
        target.arms.every((arm) => lowerer.armTag(actual.unionId, arm) >= 0)
      ) {
        narrowedParams.set(
          i,
          new Set(
            source.arms.flatMap((arm, tag) =>
              lowerer.armTag(expected.unionId, arm) < 0 ? [tag] : [],
            ),
          ),
        );
        continue;
      }
    }
    // A checked-dynamic slot parameter (`unknown`) into the function's typed
    // one (`(state?: unknown) => void` holding `(state?: number) => void`, a
    // generic class erased to its unknown instantiation): the call checks the
    // value into the parameter type, as the dynamic extraction does anywhere
    // else, and throws where the value does not fit.
    if (
      actual.kind === "dyn" &&
      canDynCheckTo(
        expected,
        (id) => lowerer.shapes.get(id),
        (id) => lowerer.unions.get(id),
      )
    )
      continue;
    strandParams = true;
  }
  let voidRet: "dyn" | "strand" | null = null;
  let strandRet = false;
  if (toT.ret.kind !== "void" && !lowerer.coercibleValue(fromT.ret, toT.ret)) {
    if (fromT.ret.kind !== "void") {
      // A RESULT that cannot convert — the strandParams stance, result
      // side (the production/development function-choice ternary: the
      // untaken arm's result shape never lands in the slot's): the
      // assignment compiles, INVOKING the slot runs the function and
      // throws the stranded TypeError where its result would convert.
      strandRet = true;
    } else {
      voidRet = toT.ret.kind === "dyn" ? "dyn" : "strand";
    }
  }
  // An untyped result (a generic wrapper's `any` handed back `as F`) takes
  // the checked-dynamic extraction to the slot's result: a record checks
  // its shape, a Promise keeps its identity and checks its payload when it
  // settles.
  const checkedRet =
    strandRet &&
    fromT.ret.kind === "dyn" &&
    canDynCheckTo(
      toT.ret,
      (id) => lowerer.shapes.get(id),
      (id) => lowerer.unions.get(id),
    );
  if (checkedRet) strandRet = false;
  // A Promise result whose payload widens into the slot's (a record with
  // extra, optional or nested members, `Promise<Narrow>` into
  // `Promise<Wide>`): the result keeps its identity and converts its
  // payload when it settles (coerceToExpected's boxed-settlement rule).
  if (
    strandRet &&
    fromT.ret.kind === "promise" &&
    toT.ret.kind === "promise" &&
    lowerer.promisePayloadWidens(fromT.ret, toT.ret)
  )
    strandRet = false;
  // A record result the slot's result is a structural width of.
  if (strandRet && lowerer.widthLiftPlan(fromT.ret, toT.ret)) strandRet = false;
  const key = `fnadapt:${typeKey(fromT)}:${typeKey(toT)}`;
  const existing = lowerer.coercions.retags.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fn.adapt", key);
  lowerer.coercions.retags.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const params: IrParam[] = toT.params.map((t, i) => ({
    localId: `a.${i}`,
    name: `a${i}`,
    type: t,
  }));
  const strandThrow = (why: string): IrStmt => ({
    kind: "throw",
    value: {
      kind: "libCall",
      fn: "error.new",
      args: [{ kind: "strLit", value: why, type: STRING, loc }],
      type: { kind: "object", className: "%TypeError" },
      loc,
    },
    loc,
  });
  // The body lowers in the adapter's own function context: conversions
  // that need scratch locals (a union of record results lifted into one
  // record slot) declare them in the adapter, not in the function that
  // asked for it.
  const context = newFnCtx(false, null, null, toT.ret);
  let body: IrStmt[];
  lowerer.fnStack.push(context);
  try {
    if (strandParams) {
      body = [
        strandThrow(
          `a '${lowerer.fmt(fromT)}' function invoked through a '${lowerer.fmt(toT)}' slot (the parameter types cannot convert — the checker's loose function compatibility admitted the assignment, but the call has no exact lowering)`,
        ),
      ];
    } else {
      const args = fromT.params.map((pt, i) => {
        if (i >= toT.params.length) return extraUndefined(pt, loc)!;
        const aRef: IrExpr = { kind: "varRef", localId: `a.${i}`, type: toT.params[i]!, loc };
        const partial = partialDynParams.get(i);
        if (partial && aRef.type.kind === "union") {
          const source = lowerer.unions.get(aRef.type.unionId)!;
          const supported =
            partial.kind === "union" ? lowerer.unions.get(partial.unionId)!.arms : [partial];
          const rejected = new Set(
            source.arms.flatMap((arm, tag) =>
              supported.some((accepted) => typeEquals(accepted, arm)) ? [] : [tag],
            ),
          );
          const narrow =
            partial.kind === "union"
              ? lowerer.unionRetagHelper(aRef.type.unionId, partial.unionId, loc, rejected)
              : lowerer.narrowedArmHelper(aRef.type.unionId, partial, loc);
          if (!narrow)
            throw new InternalCompilerError(
              "lowerer bug: partial callable parameter stopped narrowing",
            );
          return lowerer.coerceToExpected(
            { kind: "call", callee: narrow, args: [aRef], type: partial, loc },
            pt,
          );
        }
        const narrowed = narrowedParams.get(i);
        const helper =
          narrowed && aRef.type.kind === "union" && pt.kind === "union"
            ? lowerer.unionRetagHelper(aRef.type.unionId, pt.unionId, loc, narrowed)
            : null;
        const converted: IrExpr = helper
          ? { kind: "call", callee: helper, args: [aRef], type: pt, loc }
          : lowerer.coerceToExpected(aRef, pt);
        if (!typeEquals(converted.type, pt))
          throw new InternalCompilerError("lowerer bug: probed fn-adapter param stopped coercing");
        return converted;
      });
      const call: IrExpr = {
        kind: "callValue",
        callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
        receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
        args,
        type: fromT.ret,
        loc,
      };
      if (toT.ret.kind === "void") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: null, loc },
        ];
      } else if (voidRet === "dyn") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          { kind: "return", value: dynUndefinedExpr(loc), loc },
        ];
      } else if (voidRet === "strand") {
        body = [
          { kind: "exprStmt", expr: call, loc },
          strandThrow(
            `a void result where the '${lowerer.fmt(toT)}' slot promises '${lowerer.fmt(toT.ret)}' (a thrower typed 'never' never reaches this; a genuinely void function has no result to hand over)`,
          ),
        ];
      } else if (strandRet) {
        body = [
          { kind: "exprStmt", expr: call, loc },
          strandThrow(
            `a '${lowerer.fmt(fromT)}' function invoked through a '${lowerer.fmt(toT)}' slot (the result cannot convert to '${lowerer.fmt(toT.ret)}' — the checker's loose function compatibility admitted the assignment, but the call has no exact lowering)`,
          ),
        ];
      } else if (checkedRet) {
        body = [
          { kind: "return", value: { kind: "dynCheck", value: call, type: toT.ret, loc }, loc },
        ];
      } else {
        const result = lowerer.coerceToExpected(call, toT.ret);
        if (!typeEquals(result.type, toT.ret))
          throw new InternalCompilerError("lowerer bug: probed fn-adapter return stopped coercing");
        body = [{ kind: "return", value: result, loc }];
      }
    }
  } finally {
    lowerer.fnStack.pop();
  }
  lowerer.liftedFns.push(
    ...buildFunctionAdapter(name, fromT, toT, params, context.locals, body, loc),
  );
  return name;
}

/** The spawnSync-runner VALUE adapter's plan — a function returning the
 * opaque spawnRes flowing into a slot whose signature returns the
 * STRUCTURAL result record tsc accepted (`defaultRunner` into a
 * `CommandRunner` param: `{ status: number | null; stdout?: string;
 * stderr?: string; error?: Error }`). Parameters must agree pairwise;
 * each target field must be one of the spawnRes reads (status, stdout,
 * stderr, error) at its exact lowered type — string fields optionally
 * undefined-armed. Null when the pair isn't this shape. Pure: callers
 * probe before interning. */
export function spawnResFnAdapterPlan(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
): { field: string; build: (r: IrExpr, loc: SrcLoc) => IrExpr }[] | null {
  if (!Array.isArray(fromT.params) || !Array.isArray(toT.params)) return null; // defensive: degenerate func types
  if (fromT.params.length !== toT.params.length) return null;
  if (!fromT.params.every((p, i) => typeEquals(p, toT.params[i]!))) return null;
  if (fromT.ret.kind !== "spawnRes" || toT.ret.kind !== "record") return null;
  const shape = lowerer.shapes.get(toT.ret.shapeId);
  if (!shape || shape.tuple || shape.indexValue) return null;
  const statusT: IrType = {
    kind: "union",
    unionId: lowerer.unions.intern([F64, { kind: "nullT" }]),
  };
  const errorT: IrType = {
    kind: "union",
    unionId: lowerer.unions.intern([{ kind: "object", className: "%Error" }, UNDEFINED_T]),
  };
  const strOptT: IrType = { kind: "union", unionId: lowerer.unions.intern([STRING, UNDEFINED_T]) };
  const plan: { field: string; build: (r: IrExpr, loc: SrcLoc) => IrExpr }[] = [];
  for (const f of shape.fields) {
    if (f.name === "status" && typeEquals(f.type, statusT)) {
      plan.push({
        field: f.name,
        build: (r, loc) => ({
          kind: "libCall",
          fn: "spawnRes.status",
          args: [r],
          type: statusT,
          loc,
        }),
      });
      continue;
    }
    if (
      (f.name === "stdout" || f.name === "stderr") &&
      (typeEquals(f.type, strOptT) || f.type.kind === "string")
    ) {
      const fn = f.name === "stdout" ? ("spawnRes.stdout" as const) : ("spawnRes.stderr" as const);
      const strTag = lowerer.armTag(strOptT.kind === "union" ? strOptT.unionId : "", STRING);
      plan.push({
        field: f.name,
        build: (r, loc) => {
          const read: IrExpr = { kind: "libCall", fn, args: [r], type: STRING, loc };
          return f.type.kind === "string"
            ? read
            : {
                kind: "unionWrap",
                unionId: (f.type as IrType & { kind: "union" }).unionId,
                tag: strTag,
                value: read,
                type: f.type,
                loc,
              };
        },
      });
      continue;
    }
    if (f.name === "error" && typeEquals(f.type, errorT)) {
      plan.push({
        field: f.name,
        build: (r, loc) => ({
          kind: "libCall",
          fn: "spawnRes.error",
          args: [r],
          type: errorT,
          loc,
        }),
      });
      continue;
    }
    return null;
  }
  return plan;
}

/** Interned `%fnval.spawnres.<n>(f)` — the runner-value adapter: a
 * fresh closure of the TARGET signature forwarding its arguments to the
 * captured function and converting the opaque spawnRes result into the
 * target's structural record (one eager read per declared field —
 * spawnResFnAdapterPlan's set). Divergence caveat: stdout/stderr read
 * as the captured text ("" when nothing was captured, e.g. stdio
 * "inherit") where Node stores null. */
export function spawnResFnAdapter(
  lowerer: Lowerer,
  fromT: IrType & { kind: "func" },
  toT: IrType & { kind: "func" },
  loc: SrcLoc,
): string | null {
  const plan = lowerer.spawnResFnAdapterPlan(fromT, toT);
  if (!plan) return null;
  if (toT.ret.kind !== "record") return null;
  const key = `fnspawn:${typeKey(fromT)}:${typeKey(toT)}`;
  const existing = lowerer.valueHelpers.get(key);
  if (existing) return existing;
  const name = keyedHelperName(lowerer, "%fnval.spawnres", key);
  lowerer.valueHelpers.set(key, name);
  lowerer.freshClosureAdapters.add(name);
  const params: IrParam[] = toT.params.map((p, i) => ({
    localId: `p${i}.0`,
    name: `p${i}`,
    type: p,
  }));
  const rRef: IrExpr = { kind: "varRef", localId: "r.0", type: fromT.ret, loc };
  lowerer.liftedFns.push(
    ...buildFunctionAdapter(
      name,
      fromT,
      toT,
      params,
      [{ id: "r.0", name: "r", type: fromT.ret, mutable: false }],
      [
        {
          kind: "varDecl",
          localId: "r.0",
          init: {
            kind: "callValue",
            callee: { kind: "varRef", localId: "f.0", type: fromT, loc },
            receiver: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc },
            args: params.map((p): IrExpr => ({
              kind: "varRef",
              localId: p.localId,
              type: p.type,
              loc,
            })),
            type: fromT.ret,
            loc,
          },
          loc,
        },
        {
          kind: "return",
          value: {
            kind: "recordLit",
            fields: plan.map((entry) => ({ name: entry.field, value: entry.build(rRef, loc) })),
            type: toT.ret,
            loc,
          },
          loc,
        },
      ],
      loc,
    ),
  );
  return name;
}

import { dynUndefinedExpr, varRef } from "../../../ir/build.js";
import {
  BOOL,
  DYN,
  STRING,
  VOID,
  typeKey,
  type IrExpr,
  type IrStmt,
  type SrcLoc,
} from "../../../ir/ir.js";
import * as ts from "../../ts7/adapter.js";
import { locOf } from "../../program.js";
import type { Lowerer } from "../lowerer.js";
import type { ClassInfo } from "../lower-classes.js";

/** Internal native Map storage; excluded from own-property enumeration. */
export const MAP_STORAGE_FIELD = "%map";

export function mapRootOf(info: ClassInfo | null | undefined): ClassInfo | null {
  for (let current = info ?? null; current; current = current.base)
    if (current.extendsMap) return current;
  return null;
}

export function mapConstructorValue(loc: SrcLoc): IrExpr {
  return {
    kind: "libCall",
    fn: "dyn.globalConstructor",
    args: [{ kind: "strLit", value: "Map", type: STRING, loc }],
    type: DYN,
    loc,
  };
}

export function mapPrototypeValue(loc: SrcLoc): IrExpr {
  return {
    kind: "dynKeyGet",
    value: mapConstructorValue(loc),
    key: { kind: "strLit", value: "prototype", type: STRING, loc },
    type: DYN,
    loc,
  };
}

export function mapSuperCall(thisRef: IrExpr, info: ClassInfo, args: IrExpr, loc: SrcLoc): IrStmt {
  return {
    kind: "fieldSet",
    obj: thisRef,
    className: info.def.name,
    field: MAP_STORAGE_FIELD,
    value: {
      kind: "libCall",
      fn: "dyn.construct",
      args: [mapConstructorValue(loc), args, { kind: "strLit", value: "Map", type: STRING, loc }],
      type: DYN,
      loc,
    },
    loc,
  };
}

const METHODS = new Set([
  "get",
  "set",
  "has",
  "delete",
  "clear",
  "entries",
  "keys",
  "values",
  "forEach",
]);

export function lowerInheritedMapMethodCall(
  lowerer: Lowerer,
  call: ts.CallExpression,
  name: string,
  receiver: IrExpr,
  intrinsic = false,
): IrExpr | null {
  if (!METHODS.has(name)) return null;
  const loc = locOf(call);
  if (call.arguments.nodes.some(ts.isSpreadElement)) return null;
  const boxed = lowerer.coerceToExpected(receiver, DYN);
  const args = call.arguments.nodes.map((arg) => lowerer.lowerExprExpecting(arg, DYN));
  const result: IrExpr = {
    kind: "dynInvoke",
    recv: intrinsic
      ? {
          kind: "dynKeyGet",
          value: mapPrototypeValue(loc),
          key: { kind: "strLit", value: name, type: STRING, loc },
          type: DYN,
          loc,
        }
      : boxed,
    method: intrinsic ? "call" : name,
    calleeName: name,
    args: intrinsic ? [boxed, ...args] : args,
    type: DYN,
    loc,
  };
  const expected = lowerer.mapTypeOf(lowerer.typeOf(call)) ?? DYN;
  // A discarded Map result still carries the native undefined value;
  // checked-dynamic results cannot be narrowed to the non-value void type.
  return expected.kind === "void" ? result : lowerer.coerceInto(call, result, expected);
}

/** Installs a borrowed-receiver -> owned-storage callback. It answers
 * undefined for unrelated objects, keeping Map internal slots separate
 * from the subclass's visible fields and prototype. */
export function mapClassStoragePrelude(lowerer: Lowerer, loc: SrcLoc): IrStmt[] {
  const classes = [...lowerer.classes.values()].filter(
    (info) => !info.def.runtime && !info.generic && mapRootOf(info),
  );
  if (classes.length === 0) return [];
  const name = "%map.classStorage";
  const value = varRef("value", DYN, loc);
  const body: IrStmt[] = classes.map((info) => {
    const root = mapRootOf(info)!;
    const type = { kind: "object" as const, className: info.def.name };
    return {
      kind: "if",
      cond: {
        kind: "libCall",
        fn: "dyn.typedRefIs",
        args: [value, { kind: "strLit", value: typeKey(type), type: STRING, loc }],
        type: BOOL,
        loc,
      },
      then: [
        {
          kind: "return",
          value: {
            kind: "fieldGet",
            obj: lowerer.upcastTo({ kind: "dynCheck", value, type, loc }, root.def.name),
            className: root.def.name,
            field: MAP_STORAGE_FIELD,
            type: DYN,
            loc,
          },
          loc,
        },
      ],
      else_: null,
      loc,
    };
  });
  body.push({ kind: "return", value: dynUndefinedExpr(loc), loc });
  lowerer.liftedFns.push({
    name,
    params: [{ localId: "value", name: "value", type: DYN }],
    returnType: DYN,
    locals: [{ id: "value", name: "value", type: DYN, mutable: false }],
    body,
    loc,
  });
  return [
    {
      kind: "exprStmt",
      expr: {
        kind: "libCall",
        fn: "map.classStorage",
        args: [
          {
            kind: "dynFrom",
            value: {
              kind: "closure",
              fnName: name,
              captures: [],
              type: { kind: "func", params: [DYN], ret: DYN },
              loc,
            },
            type: DYN,
            loc,
          },
        ],
        type: VOID,
        loc,
      },
      loc,
    },
  ];
}

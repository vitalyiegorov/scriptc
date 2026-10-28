import * as ts from "../ts7/adapter.js";
import { DYN, STRING, VOID, arrayOf, type IrExpr } from "../../ir/ir.js";
import { locOf } from "../program.js";
import type { Lowerer } from "./lowerer.js";
import { builtinNamespaceValue } from "./builtin-namespaces.js";
import { TEMPORAL_GLOBAL } from "../builtin-modules.js";

function needsReflectNamespace(lowerer: Lowerer): boolean {
  if (lowerer.reflectNamespaceNeeded === undefined) {
    let needed = false;
    for (const source of lowerer.program.getImplementationSourceFiles()) {
      if (!/\bReflect\b/.test(source.text)) continue;
      ts.walkPreorder(source, (node) => {
        if (needed) return "stop";
        if (ts.isTypeNode(node)) return "skip";
        if (ts.isIdentifier(node) && node.text === "Reflect") {
          const parent = node.parent;
          // Property names and declaration names do not read the namespace.
          if (parent?.name === node && !ts.isShorthandPropertyAssignment(parent)) return undefined;
          if (lowerer.isStdlibGlobal(node, "Reflect")) needed = true;
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
          const key = ts.isPropertyAccessExpression(node)
            ? node.name.text
            : ts.isStringLiteralLike(node.argumentExpression)
              ? node.argumentExpression.text
              : null;
          if (key === "Reflect") {
            let base = node.expression;
            while (
              ts.isParenthesizedExpression(base) ||
              ts.isAsExpression(base) ||
              ts.isTypeAssertion(base)
            )
              base = base.expression;
            if (
              lowerer.isStdlibGlobal(base, "globalThis") ||
              lowerer.isStdlibGlobal(base, "global")
            )
              needed = true;
          }
        }
        return undefined;
      });
      if (needed) break;
    }
    lowerer.reflectNamespaceNeeded = needed;
  }
  return lowerer.reflectNamespaceNeeded;
}

/** A stored global object has identity and survives module/function boundaries.
 * Known globals without a value implementation refuse at runtime; absent host
 * capabilities answer undefined. The checker supplies names, never values. */
export function lowerGlobalValue(lowerer: Lowerer, expr: ts.Expression): IrExpr {
  const loc = locOf(expr);
  // The temporal global is typed for the programs that name it (TS 7's
  // lib slice) but absent in Node 24: reads answer undefined.
  const names = lowerer.checker
    .getPropertiesOfType(lowerer.typeOf(expr))
    .map((property) => ts.symbolName(property))
    .filter((name) => name !== TEMPORAL_GLOBAL);
  const global: IrExpr = {
    kind: "libCall",
    fn: "global.native",
    // One immortal name table per program (keyed by its contents): reading
    // the global object in a hot path allocates nothing, and the runtime
    // recognizes a table it has already registered.
    args: [
      {
        kind: "templateStrings",
        key: `%globalThis.names:${names.join(",")}`,
        cooked: names,
        type: arrayOf(STRING),
        loc,
      },
    ],
    type: DYN,
    loc,
  };
  if (!needsReflectNamespace(lowerer)) return global;
  return {
    kind: "seqExpr",
    stmts: [
      {
        kind: "exprStmt",
        expr: {
          kind: "libCall",
          fn: "global.namespaceInstall",
          args: [
            { kind: "strLit", value: "Reflect", type: STRING, loc },
            builtinNamespaceValue(lowerer, "Reflect", loc)!,
          ],
          type: VOID,
          loc,
        },
        loc,
      },
    ],
    result: global,
    type: DYN,
    loc,
  };
}

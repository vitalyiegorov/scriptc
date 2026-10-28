import * as ts from "../ts7/adapter.js";
import type { IrType } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";

/** Values produced by `new Proxy(target, handler)` stay checked-dynamic, even
 * where the checker types them as a class: a typed class slot would read the
 * target's fields and call its methods directly, skipping the handler's
 * traps. The slots that can hold such a value are found from syntax:
 *   - a function whose returned value is a Proxy, a call of such a function,
 *     or a const bound to either (its result is checked-dynamic);
 *   - a const bound to such a call (a dynamic binding);
 *   - a parameter that is the target of `new Proxy(parameter, …)` (callers
 *     may pass another Proxy). */
export interface ProxyFlow {
  /** Whether a function-like declaration's result may be a Proxy. */
  isProducer(declaration: ts.Node): boolean;
  /** Whether a parameter declaration is used as a Proxy's target. */
  isTargetParameter(declaration: ts.Node): boolean;
  /** Whether a variable declaration is bound to a possible Proxy. */
  isBinding(declaration: ts.Node): boolean;
}

/** Declarations are compared by file and position: the checker hands back
 * its own node objects for a resolved signature's declaration. */
function keyOf(node: ts.Node): string {
  return `${ts.getSourceFileOfNode(node).fileName}:${node.pos}`;
}

function peel(node: ts.Expression): ts.Expression {
  let e = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertion(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e)
    )
      e = e.expression;
    else if (ts.isAwaitExpression(e)) e = e.expression;
    else return e;
  }
}

export function proxyFlowOf(lowerer: Lowerer): ProxyFlow {
  const known = lowerer.proxyFlow;
  if (known !== undefined) return known;
  const producers = new Set<string>();
  const targetParameters = new Set<string>();
  const bindings = new Set<string>();
  const flow: ProxyFlow = {
    isProducer: (node) => producers.has(keyOf(node)),
    isTargetParameter: (node) => targetParameters.has(keyOf(node)),
    isBinding: (node) => bindings.has(keyOf(node)),
  };
  lowerer.proxyFlow = flow;
  const functions: ts.FunctionLikeDeclaration[] = [];
  const proxyNews: ts.NewExpression[] = [];
  for (const sf of lowerer.program.getImplementationSourceFiles()) {
    if (sf.isDeclarationFile || !sf.text.includes("Proxy")) continue;
    ts.walkPreorder(sf, (node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      )
        functions.push(node);
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Proxy" &&
        lowerer.isStdlibGlobal(node.expression, "Proxy")
      )
        proxyNews.push(node);
      return undefined;
    });
  }
  if (proxyNews.length === 0) return flow;
  const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
    const s = lowerer.checker.getSymbolAtLocation(node);
    if (s === undefined) return undefined;
    return s.flags & ts.SymbolFlags.Alias ? lowerer.checker.getAliasedSymbol(s) : s;
  };
  const isProxyValue = (expr: ts.Expression, depth = 0): boolean => {
    const e = peel(expr);
    if (ts.isNewExpression(e))
      return proxyNews.some(
        (n) => n.pos === e.pos && ts.getSourceFileOfNode(n) === ts.getSourceFileOfNode(e),
      );
    if (ts.isCallExpression(e)) {
      const declaration = lowerer.checker.getResolvedSignature(e)?.declaration;
      return declaration !== undefined && producers.has(keyOf(declaration));
    }
    if (ts.isIdentifier(e) && depth < 4) {
      const declaration = symbolOf(e)?.valueDeclaration;
      return (
        declaration !== undefined &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined &&
        (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0 &&
        isProxyValue(declaration.initializer, depth + 1)
      );
    }
    return false;
  };
  const returnsOf = (fn: ts.FunctionLikeDeclaration): ts.Expression[] => {
    const out: ts.Expression[] = [];
    if (fn.body === undefined) return out;
    if (!ts.isBlock(fn.body)) return [fn.body as ts.Expression];
    ts.walkPreorder(fn.body, (node) => {
      if (
        node !== fn.body &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node))
      )
        return "skip";
      if (ts.isReturnStatement(node) && node.expression !== undefined) out.push(node.expression);
      return undefined;
    });
    return out;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const fn of functions) {
      if (producers.has(keyOf(fn))) continue;
      if (returnsOf(fn).some((expr) => isProxyValue(expr))) {
        producers.add(keyOf(fn));
        changed = true;
      }
    }
  }
  for (const sf of lowerer.program.getImplementationSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    ts.walkPreorder(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.name) &&
        isProxyValue(node.initializer)
      )
        bindings.add(keyOf(node));
      return undefined;
    });
  }
  for (const proxy of proxyNews) {
    const target = proxy.arguments?.nodes[0];
    if (target === undefined) continue;
    const e = peel(target);
    if (!ts.isIdentifier(e)) continue;
    const declaration = symbolOf(e)?.valueDeclaration;
    if (declaration !== undefined && ts.isParameter(declaration))
      targetParameters.add(keyOf(declaration));
  }
  return flow;
}

/** An interface made only of methods (`NestModule`, `OnModuleInit`): a
 * protocol that any object with those members satisfies. A package casts an
 * untyped value to one without checking it, and probes the members later
 * (`if (!instance.configure) return`). */
export function isProtocolRecord(lowerer: Lowerer, type: IrType | null): boolean {
  if (type?.kind !== "record") return false;
  const shape = lowerer.shapes.get(type.shapeId);
  return (
    shape !== undefined &&
    !shape.tuple &&
    shape.indexValue === undefined &&
    shape.fields.length > 0 &&
    shape.fields.every((field) => field.type.kind === "func")
  );
}

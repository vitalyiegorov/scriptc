import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { stdlibGlobalNameOf } from "./surfaces.js";
import { staticCondition } from "./static-typeof.js";

/** The string a `const` key binding evaluates to, when its whole
 * initializer is a closed, effect-free expression: string and boolean
 * literals, `&&` / `||` / `??`, `?:`, parentheses and casts, other such
 * consts, immediately-invoked arrows over those, statically decided
 * `typeof Symbol` checks, and `Symbol.observable` (absent from the Node
 * runtime; the lowering already reads it as undefined). This is how a
 * class member keyed by a module constant such as rxjs's
 * `Symbol_observable = (typeof Symbol === 'function' && Symbol.observable)
 * || '@@observable'` gets its one name: the value is the same on every
 * evaluation, so naming the member by it is exact. Null otherwise. */
export function constKeyStringOf(lowerer: Lowerer, expr: ts.Expression): string | null {
  const value = evaluate(lowerer, expr, 0);
  return typeof value === "string" ? value : null;
}

const UNKNOWN = Symbol("unknown");
type Value = string | boolean | undefined | typeof UNKNOWN;

function truthy(value: Value): boolean {
  return value !== undefined && value !== false && value !== "";
}

function evaluate(lowerer: Lowerer, expr: ts.Expression, depth: number): Value {
  if (depth > 24) return UNKNOWN;
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  )
    return evaluate(lowerer, expr.expression, depth + 1);
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(expr)) {
    if (expr.text === "undefined") return undefined;
    let symbol = lowerer.resolveValueSymbol(expr);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
      symbol = lowerer.checker.getAliasedSymbol(symbol);
    const decl = symbol?.valueDeclaration;
    if (
      decl === undefined ||
      !ts.isVariableDeclaration(decl) ||
      decl.initializer === undefined ||
      !ts.isIdentifier(decl.name) ||
      (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) === 0
    )
      return UNKNOWN;
    return evaluate(lowerer, decl.initializer, depth + 1);
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === "observable" &&
    stdlibGlobalNameOf(lowerer, expr.expression) === "Symbol"
  )
    return undefined;
  if (ts.isCallExpression(expr) && expr.arguments.nodes.length === 0) {
    let callee = expr.expression;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    if (
      (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) &&
      callee.parameters.nodes.length === 0 &&
      !callee.asteriskToken &&
      !callee.modifiers?.nodes.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      const body = callee.body;
      if (!ts.isBlock(body)) return evaluate(lowerer, body, depth + 1);
      const only = body.statements.nodes;
      if (only.length === 1 && ts.isReturnStatement(only[0]!) && only[0].expression)
        return evaluate(lowerer, only[0].expression, depth + 1);
    }
    return UNKNOWN;
  }
  if (ts.isConditionalExpression(expr)) {
    const cond = evaluate(lowerer, expr.condition, depth + 1);
    if (cond === UNKNOWN) return UNKNOWN;
    return evaluate(lowerer, truthy(cond) ? expr.whenTrue : expr.whenFalse, depth + 1);
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = evaluate(lowerer, expr.left, depth + 1);
      if (left === UNKNOWN) return UNKNOWN;
      const keep =
        op === ts.SyntaxKind.AmpersandAmpersandToken
          ? !truthy(left)
          : op === ts.SyntaxKind.BarBarToken
            ? truthy(left)
            : left !== undefined;
      return keep ? left : evaluate(lowerer, expr.right, depth + 1);
    }
    const decided = staticCondition(lowerer, expr);
    return decided === null ? UNKNOWN : decided;
  }
  return UNKNOWN;
}

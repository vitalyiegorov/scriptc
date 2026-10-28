import * as ts from "./ts7/adapter.js";

/** Canonical known property keys, shared by accessor grouping and metadata.
 * Dynamic computed keys keep their expression identity at the call site. */
export function legacyPropertyKey(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  if (!ts.isComputedPropertyName(name)) return null;
  // Parenthesized or asserted keys remain dynamic in TypeScript's legacy emitter.
  const expression = name.expression;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return String(Number(expression.text));
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    if (expression.operator === ts.SyntaxKind.MinusToken)
      return String(-Number(expression.operand.text));
    if (expression.operator === ts.SyntaxKind.PlusToken)
      return String(Number(expression.operand.text));
  }
  return null;
}

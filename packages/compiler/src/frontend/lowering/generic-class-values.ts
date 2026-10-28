import * as ts from "../ts7/adapter.js";

/** The generic class declarations the program reads as VALUES: an
 * identifier naming the class that is not the callee of a `new`, a
 * heritage clause, the base of a static member access, the right side of
 * `instanceof`, a declaration name or an import/export specifier, plus
 * `typeof C` type queries (the slot a class value fills). Only these
 * classes need the erased instantiation that the bare `typeof C` maps to;
 * a program that merely constructs and extends the class never does. */
export function genericClassesUsedAsValues(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Set<ts.Node> {
  const used = new Set<ts.Node>();
  const note = (id: ts.Identifier): void => {
    let symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isClassDeclaration(decl) && decl.typeParameters?.nodes.length) used.add(decl);
    }
  };
  for (const file of files) {
    ts.walkPreorder(file, (node) => {
      if (ts.isTypeQueryNode(node)) {
        const name = node.exprName;
        if (ts.isIdentifier(name)) note(name);
        return undefined;
      }
      if (!ts.isIdentifier(node)) return undefined;
      const parent = node.parent;
      if (parent === undefined) return undefined;
      if (
        (ts.isNewExpression(parent) && parent.expression === node) ||
        ts.isExpressionWithTypeArguments(parent) ||
        (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
          parent.right === node) ||
        ts.isClassDeclaration(parent) ||
        ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isTypeReferenceNode(parent) ||
        ts.isTypeQueryNode(parent) ||
        ts.isQualifiedName(parent)
      )
        return undefined;
      if (
        ts.isElementAccessExpression(parent) ||
        ts.isCallExpression(parent) ||
        ts.isNewExpression(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isShorthandPropertyAssignment(parent) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isBinaryExpression(parent) ||
        ts.isReturnStatement(parent) ||
        ts.isAsExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isConditionalExpression(parent) ||
        ts.isSpreadElement(parent) ||
        ts.isArrowFunction(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent)
      )
        note(node);
      return undefined;
    });
  }
  return used;
}

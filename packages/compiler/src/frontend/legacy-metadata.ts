/** Legacy design metadata is serialized from the original checker world, before
 * decorator source rewriting. In particular it follows TypeScript's syntactic
 * serialization, rather than the compiler's native type representation: inferred
 * property types erase to Object, and references to later classes retain TDZ. */
import * as ts from "./ts7/adapter.js";
import { legacyPropertyKey } from "./legacy-decorator-keys.js";

export interface LegacyMetadataOptions {
  strict?: boolean;
  strictNullChecks?: boolean;
  target?: string | number;
}

export interface LegacyMetadataEntry {
  key: "design:type" | "design:paramtypes" | "design:returntype";
  value: string;
}

function typeOnly(symbol: ts.Symbol | undefined): boolean {
  return (
    symbol?.declarations.some((declaration) => {
      for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
        if (
          (ts.isImportClause(node) ||
            ts.isImportSpecifier(node) ||
            ts.isExportSpecifier(node) ||
            ts.isImportEqualsDeclaration(node) ||
            ts.isExportDeclaration(node)) &&
          node.isTypeOnly
        )
          return true;
        if (ts.isSourceFile(node)) break;
      }
      return false;
    }) ?? false
  );
}

function unalias(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function entityText(node: ts.EntityName): string {
  return ts.isIdentifier(node) ? node.text : `${entityText(node.left)}.${node.right.text}`;
}

function checkedEntity(node: ts.EntityName): string {
  if (ts.isIdentifier(node)) return `(typeof ${node.text} !== "undefined" && ${node.text})`;
  // Every intermediate namespace property is read once, just as in tsc's
  // temporary-variable fallback. A null intermediate still throws on access.
  return `((value: any) => value === void 0 ? void 0 : value.${node.right.text})(${checkedEntity(node.left)})`;
}

/** Entries occur after user and parameter decorators, in TypeScript's order.
 * The caller supplies only groups that actually have decorators. */
export function legacyMetadataEntries(
  checker: ts.TypeChecker,
  declaration: ts.ClassLikeDeclaration | ts.ClassElement,
  container: ts.ClassLikeDeclaration,
  options: LegacyMetadataOptions = {},
): LegacyMetadataEntry[] {
  const globalConstructor = (name: "BigInt" | "Symbol"): string => {
    const target =
      typeof options.target === "string"
        ? options.target.toLowerCase()
        : ts.scriptTargetName(options.target ?? 1)?.toLowerCase();
    const year = target?.startsWith("es") ? Number(target.slice(2)) : NaN;
    const modern =
      target === "latest" ||
      target === "esnext" ||
      (name === "Symbol" ? year >= 2015 || year === 6 : year >= 2020);
    return modern ? name : `(typeof ${name} === "function" ? ${name} : Object)`;
  };
  const reference = (node: ts.TypeReferenceNode): string => {
    const symbol = checker.getSymbolAtLocation(node.typeName);
    let root = node.typeName;
    while (ts.isQualifiedName(root)) root = root.left;
    const rootSymbol = checker.getSymbolAtLocation(root);
    const erased = typeOnly(symbol) || typeOnly(rootSymbol);
    const resolved = unalias(checker, symbol);
    if (!resolved) {
      return erased
        ? "Object"
        : `((value: any) => typeof value === "function" ? value : Object)(${checkedEntity(node.typeName)})`;
    }
    const globalPromise = checker.resolveName("Promise", ts.SymbolFlags.Value);
    if (resolved === unalias(checker, globalPromise)) return "Promise";
    const valueType =
      (resolved.flags & ts.SymbolFlags.Value) !== 0
        ? checker.getTypeOfSymbolAtLocation(resolved, node)
        : undefined;
    if (
      valueType &&
      checker.getSignaturesOfType(valueType, ts.SignatureKind.Construct).length > 0
    ) {
      // A type-only class import serializes as Function, not Object.
      if (erased) return "Function";
      const later = resolved.declarations.find(
        (candidate) =>
          ts.isClassDeclaration(candidate) &&
          candidate.parent === container.parent &&
          candidate.pos >= container.end &&
          ts.getSourceFileOfNode(candidate) === ts.getSourceFileOfNode(container),
      );
      if (later && ts.isIdentifier(node.typeName)) {
        const message = `Cannot access '${node.typeName.text}' before initialization`;
        // Metadata arguments evaluate immediately. Native class values may be
        // immortal, so preserve the lexical TDZ explicitly rather than hiding
        // a later reference from the rewritten program's semantic recheck.
        return `(() => { throw new ReferenceError(${JSON.stringify(message)}); })()`;
      }
      return entityText(node.typeName);
    }
    const type = checker.getDeclaredTypeOfSymbol(resolved);
    const all = (mask: number, value: ts.Type = type): boolean => {
      if (value.isUnionType()) return ts.constituentTypes(value).every((part) => all(mask, part));
      if ((value.flags & mask) !== 0) return true;
      if ((value.flags & ts.TypeFlags.TypeParameter) !== 0) {
        const declaration = value.getSymbol()?.declarations.find(ts.isTypeParameterDeclaration);
        const constraint = declaration?.constraint
          ? checker.getTypeAtLocation(declaration.constraint)
          : value.getConstraint();
        return constraint !== undefined && constraint !== value && all(mask, constraint);
      }
      return false;
    };
    if (all(ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "Object";
    if (all(ts.TypeFlags.Void | ts.TypeFlags.Nullable | ts.TypeFlags.Never)) return "void 0";
    if (all(ts.TypeFlags.BooleanLike) || checker.isTypeAssignableTo(type, checker.getBooleanType()))
      return "Boolean";
    if (all(ts.TypeFlags.NumberLike) || checker.isTypeAssignableTo(type, checker.getNumberType()))
      return "Number";
    if (all(ts.TypeFlags.BigIntLike) || checker.isTypeAssignableTo(type, checker.getBigIntType()))
      return globalConstructor("BigInt");
    if (all(ts.TypeFlags.StringLike) || checker.isTypeAssignableTo(type, checker.getStringType()))
      return "String";
    if (checker.isTupleType(type) || checker.isArrayType(type)) return "Array";
    if (all(ts.TypeFlags.ESSymbolLike)) return globalConstructor("Symbol");
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return "Function";
    return "Object";
  };
  const constituents = (nodes: readonly ts.TypeNode[], intersection: boolean): string => {
    let result: string | undefined;
    for (let node of nodes) {
      while (ts.isParenthesizedTypeNode(node)) node = node.type;
      if (node.kind === ts.SyntaxKind.NeverKeyword) {
        if (intersection) return "void 0";
        continue;
      }
      if (node.kind === ts.SyntaxKind.UnknownKeyword) {
        if (!intersection) return "Object";
        continue;
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword) return "Object";
      if (
        !(options.strictNullChecks ?? options.strict) &&
        (node.kind === ts.SyntaxKind.UndefinedKeyword ||
          (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword))
      )
        continue;
      const next = serialize(node);
      if (next === "Object" || (result !== undefined && result !== next)) return "Object";
      result = next;
    }
    return result ?? "void 0";
  };
  const serialize = (node: ts.TypeNode | undefined): string => {
    if (!node) return "Object";
    if (ts.isParenthesizedTypeNode(node)) return serialize(node.type);
    switch (node.kind) {
      case ts.SyntaxKind.VoidKeyword:
      case ts.SyntaxKind.UndefinedKeyword:
      case ts.SyntaxKind.NeverKeyword:
        return "void 0";
      case ts.SyntaxKind.FunctionType:
      case ts.SyntaxKind.ConstructorType:
        return "Function";
      case ts.SyntaxKind.ArrayType:
      case ts.SyntaxKind.TupleType:
        return "Array";
      case ts.SyntaxKind.BooleanKeyword:
        return "Boolean";
      case ts.SyntaxKind.StringKeyword:
      case ts.SyntaxKind.TemplateLiteralType:
        return "String";
      case ts.SyntaxKind.NumberKeyword:
        return "Number";
      case ts.SyntaxKind.BigIntKeyword:
        return globalConstructor("BigInt");
      case ts.SyntaxKind.SymbolKeyword:
        return globalConstructor("Symbol");
    }
    if (ts.isTypePredicateNode(node)) return node.assertsModifier ? "void 0" : "Boolean";
    if (ts.isLiteralTypeNode(node)) {
      let literal = node.literal;
      if (ts.isPrefixUnaryExpression(literal)) literal = literal.operand;
      switch (literal.kind) {
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
          return "String";
        case ts.SyntaxKind.NumericLiteral:
          return "Number";
        case ts.SyntaxKind.BigIntLiteral:
          return globalConstructor("BigInt");
        case ts.SyntaxKind.TrueKeyword:
        case ts.SyntaxKind.FalseKeyword:
          return "Boolean";
        case ts.SyntaxKind.NullKeyword:
          return "void 0";
      }
    }
    if (ts.isTypeReferenceNode(node)) return reference(node);
    if (ts.isUnionTypeNode(node)) return constituents(node.types.nodes, false);
    if (ts.isIntersectionTypeNode(node)) return constituents(node.types.nodes, true);
    if (ts.isConditionalTypeNode(node)) return constituents([node.trueType, node.falseType], false);
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword)
      return serialize(node.type);
    return "Object";
  };
  const entries: LegacyMetadataEntry[] = [];
  const accessor =
    ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration);
  const pair = accessor
    ? container.members.nodes.filter(
        (member) =>
          (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) &&
          (() => {
            const key = legacyPropertyKey(declaration.name);
            const candidate = legacyPropertyKey(member.name);
            if (key !== null && candidate !== null) return key === candidate;
            const symbol = checker.getSymbolAtLocation(declaration.name);
            const candidateSymbol = checker.getSymbolAtLocation(member.name);
            return symbol !== undefined && candidateSymbol !== undefined
              ? symbol === candidateSymbol
              : ts.getTextOfNode(member.name) === ts.getTextOfNode(declaration.name);
          })() &&
          Boolean(member.modifiers?.nodes.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) ===
            Boolean(
              declaration.modifiers?.nodes.some((m) => m.kind === ts.SyntaxKind.StaticKeyword),
            ),
      )
    : [];
  const setter = pair.find(ts.isSetAccessorDeclaration);
  const getter = pair.find(ts.isGetAccessorDeclaration);
  if (ts.isPropertyDeclaration(declaration))
    entries.push({ key: "design:type", value: serialize(declaration.type) });
  else if (ts.isMethodDeclaration(declaration))
    entries.push({ key: "design:type", value: "Function" });
  else if (accessor)
    entries.push({
      key: "design:type",
      value: serialize(setter?.parameters.nodes[0]?.type ?? getter?.type),
    });
  const callable =
    ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)
      ? declaration.members.nodes.find(
          (member) => ts.isConstructorDeclaration(member) && member.body !== undefined,
        )
      : ts.isMethodDeclaration(declaration) || accessor
        ? declaration
        : undefined;
  if (
    callable &&
    (ts.isConstructorDeclaration(callable) ||
      ts.isMethodDeclaration(callable) ||
      ts.isGetAccessorDeclaration(callable) ||
      ts.isSetAccessorDeclaration(callable))
  ) {
    const parameters =
      ts.isGetAccessorDeclaration(callable) && setter
        ? setter.parameters.nodes
        : (callable.parameters?.nodes ?? []);
    const values = parameters
      .filter((parameter) => !(ts.isIdentifier(parameter.name) && parameter.name.text === "this"))
      .map((parameter) => {
        let type = parameter.type;
        if (parameter.dotDotDotToken) {
          // tsc peels T[] and single-argument references, not tuples.
          type =
            type && ts.isArrayTypeNode(type)
              ? type.elementType
              : type && ts.isTypeReferenceNode(type) && type.typeArguments?.nodes.length === 1
                ? type.typeArguments.nodes[0]
                : undefined;
        }
        return serialize(type);
      });
    entries.push({ key: "design:paramtypes", value: `[${values.join(", ")}]` });
  }
  if (ts.isMethodDeclaration(declaration))
    entries.push({
      key: "design:returntype",
      value: declaration.type
        ? serialize(declaration.type)
        : declaration.modifiers?.nodes.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          ? "Promise"
          : "void 0",
    });
  return entries;
}

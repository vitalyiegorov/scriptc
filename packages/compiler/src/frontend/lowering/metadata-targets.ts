import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

const TARGET_ARGUMENTS = new Map([
  ["defineMetadata", 2],
  ["getMetadata", 1],
  ["getOwnMetadata", 1],
  ["hasMetadata", 1],
  ["hasOwnMetadata", 1],
  ["deleteMetadata", 1],
  ["getMetadataKeys", 0],
  ["getOwnMetadataKeys", 0],
  ["decorate", 1],
]);

/** The real polyfill traverses constructor prototypes. Give only classes
 * flowing into metadata targets their native constructor descriptor tables;
 * ancestors participate because inherited metadata walks their identities. */
export function reflectsMetadataTarget(
  lowerer: Lowerer,
  declaration: ts.ClassLikeDeclaration,
): boolean {
  if (lowerer.metadataTargetSymbols === null) {
    const targets = new Set<ts.Symbol>();
    lowerer.metadataTargetSymbols = targets;
    const add = (type: ts.Type): void => {
      if (type.isUnionType()) {
        ts.constituentTypes(type).forEach(add);
        return;
      }
      for (const signature of lowerer.checker.getConstructSignatures(type))
        add(lowerer.checker.getReturnTypeOfSignature(signature));
      const symbol = type.getSymbol();
      if (!symbol || (symbol.flags & ts.SymbolFlags.Class) === 0 || targets.has(symbol)) return;
      targets.add(symbol);
      const instance = lowerer.checker.getDeclaredTypeOfSymbol(symbol);
      lowerer.checker.getBaseTypes(instance).forEach(add);
    };
    for (const source of lowerer.program.getImplementationSourceFiles()) {
      if (!source.text.includes("Metadata") && !source.text.includes("decorate")) continue;
      ts.walkPreorder(source, (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
          return undefined;
        const member = lowerer.stdlibGlobalMember(node.expression, "Reflect");
        const index = member === null ? undefined : TARGET_ARGUMENTS.get(member);
        const target = index === undefined ? undefined : node.arguments.nodes[index];
        if (target !== undefined) add(lowerer.typeOf(target));
        return undefined;
      });
    }
  }
  const symbol = declaration.name
    ? lowerer.checker.getSymbolAtLocation(declaration.name)
    : undefined;
  return symbol !== undefined && lowerer.metadataTargetSymbols.has(symbol);
}

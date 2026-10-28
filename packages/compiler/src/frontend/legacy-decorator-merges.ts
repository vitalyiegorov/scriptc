import * as ts from "./ts7/adapter.js";

export interface LegacyMergeEdit {
  start: number;
  end: number;
  text: string;
  render?: () => string;
}

/** Keep merged type declarations under a separate checker name. Namespace
 * values are installed as ordinary data properties at each declaration,
 * while reads and writes of exported variables use that same property. */
export function legacyDecoratorMergeEdits(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  target: string,
  fresh: () => string,
  rename: (node: ts.Identifier, value: string) => void,
  render: (node: ts.Node) => string,
): LegacyMergeEdit[] {
  if (!declaration.name) return [];
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return [];
  const edits: LegacyMergeEdit[] = [];
  const interfaces = symbol.declarations.filter(ts.isInterfaceDeclaration);
  if (interfaces.length) {
    const name = fresh();
    for (const item of interfaces)
      if (ts.getSourceFileOfNode(item) === source)
        edits.push({ start: ts.tokenStartOfNode(item.name), end: item.name.end, text: name });
  }
  const namespaces = symbol.declarations.filter(ts.isModuleDeclaration);
  if (!namespaces.length) return edits;
  const namespaceName = fresh();
  const bindingNames = (name: ts.BindingName): ts.Identifier[] => {
    if (ts.isIdentifier(name)) return [name];
    return name.elements.nodes.flatMap((element) =>
      ts.isBindingElement(element) && element.name ? bindingNames(element.name) : [],
    );
  };
  const lowerNamespace = (
    namespace: ts.ModuleDeclaration,
    value: string,
    ownSymbol: ts.Symbol | undefined,
  ): void => {
    if (!namespace.body || !ts.isModuleBlock(namespace.body)) return;
    const home = fresh();
    const variables = new Map<ts.Symbol, string>();
    const declarations = new Set<ts.Node>();
    // Every merged block shares the same exported variable bindings, including
    // references from functions declared in a later namespace block.
    for (const sibling of ownSymbol?.declarations ?? [namespace]) {
      if (!ts.isModuleDeclaration(sibling) || !sibling.body || !ts.isModuleBlock(sibling.body))
        continue;
      for (const statement of sibling.body.statements.nodes) {
        if (
          !ts.isVariableStatement(statement) ||
          !ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          continue;
        for (const variable of statement.declarationList.declarations.nodes)
          for (const identifier of bindingNames(variable.name)) {
            const variableSymbol = checker.getSymbolAtLocation(identifier);
            if (variableSymbol) variables.set(variableSymbol, `${home}.${identifier.text}`);
          }
      }
    }
    edits.push({
      start: ts.tokenStartOfNode(namespace.body) + 1,
      end: ts.tokenStartOfNode(namespace.body) + 1,
      text: `\nconst ${home}: any = ${value};\n`,
    });
    for (const statement of namespace.body.statements.nodes) {
      if (
        !ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        continue;
      const assignments: string[] = [];
      if (ts.isVariableStatement(statement)) {
        const list = statement.declarationList;
        edits.push({
          start: ts.tokenStartOfNode(list),
          end: ts.tokenStartOfNode(list) + ((list.flags & ts.NodeFlags.Const) !== 0 ? 5 : 3),
          text: "let",
        });
        for (const [index, variable] of list.declarations.nodes.entries()) {
          const published: string[] = [];
          const pattern = !ts.isIdentifier(variable.name) && variable.initializer;
          if (pattern) {
            const names = bindingNames(variable.name);
            edits.push({
              start: ts.tokenStartOfNode(statement),
              end: ts.tokenStartOfNode(statement),
              text: `export let ${names.map((name) => `${name.text}: any`).join(", ")};\n`,
            });
            edits.push({
              start: ts.tokenStartOfNode(variable.name),
              end: variable.name.end,
              text: fresh(),
            });
            for (const identifier of names) {
              const binding = identifier.parent;
              const shorthand =
                ts.isBindingElement(binding) &&
                ts.isObjectBindingPattern(binding.parent) &&
                !binding.propertyName &&
                !binding.dotDotDotToken;
              rename(
                identifier,
                `${shorthand ? `${identifier.text}: ` : ""}${home}.${identifier.text}`,
              );
            }
            edits.push({
              start: ts.tokenStartOfNode(variable.initializer!),
              end: ts.tokenStartOfNode(variable.initializer!),
              text: "",
              render() {
                return `(${render(variable.name)} = (`;
              },
            });
            edits.push({
              start: variable.initializer!.end,
              end: variable.initializer!.end,
              text: "), undefined)",
            });
          }
          edits.push(
            variable.type
              ? { start: ts.tokenStartOfNode(variable.type), end: variable.type.end, text: "any" }
              : { start: variable.name.end, end: variable.name.end, text: ": any" },
          );
          for (const identifier of bindingNames(variable.name)) {
            declarations.add(identifier);
            const variableSymbol = checker.getSymbolAtLocation(identifier);
            if (variableSymbol) variables.set(variableSymbol, `${home}.${identifier.text}`);
            if (variable.initializer && !pattern)
              published.push(`${home}.${identifier.text} = ${identifier.text};`);
          }
          const next = list.declarations.nodes[index + 1];
          if (published.length && next) {
            // Publish this declaration before evaluating the next initializer.
            // A node's full start follows its separating comma; trivia remains
            // on either side of the replacement.
            const comma = next.pos - 1;
            if (source.text[comma] !== ",") throw new Error("namespace variable separator missing");
            edits.push({
              start: comma,
              end: comma + 1,
              text: `;\n${published.join("\n")}\nexport let `,
            });
          } else assignments.push(...published);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name
      ) {
        assignments.push(`${home}.${statement.name.text} = ${statement.name.text};`);
      } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
        const child = `${home}.${statement.name.text}`;
        edits.push({
          start: ts.tokenStartOfNode(statement),
          end: ts.tokenStartOfNode(statement),
          text: `if (!${child}) ${child} = {};\n`,
        });
        lowerNamespace(statement, child, checker.getSymbolAtLocation(statement.name));
      }
      if (assignments.length)
        edits.push({
          start: statement.end,
          end: statement.end,
          text: `\n${assignments.join("\n")}\n`,
        });
    }
    const scan = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return;
      if (ts.isShorthandPropertyAssignment(node)) {
        const valueSymbol = checker.getShorthandAssignmentValueSymbol(node);
        const replacement =
          valueSymbol === ownSymbol ? home : valueSymbol ? variables.get(valueSymbol) : undefined;
        if (replacement && ts.isIdentifier(node.name))
          rename(node.name, `${node.name.text}: ${replacement}`);
        return;
      }
      if (ts.isIdentifier(node) && !declarations.has(node)) {
        const parent = node.parent;
        if (
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (parent !== undefined && parent.name === node)
        )
          return;
        const nodeSymbol = checker.getSymbolAtLocation(node);
        const replacement =
          nodeSymbol === ownSymbol ? home : nodeSymbol ? variables.get(nodeSymbol) : undefined;
        if (replacement) rename(node, replacement);
      }
      ts.forEachChild(node, scan);
    };
    scan(namespace.body);
  };
  for (const namespace of namespaces) {
    if (ts.getSourceFileOfNode(namespace) !== source || !ts.isIdentifier(namespace.name)) continue;
    edits.push({
      start: ts.tokenStartOfNode(namespace.name),
      end: namespace.name.end,
      text: namespaceName,
    });
    lowerNamespace(namespace, target, symbol);
  }
  ts.walkPreorder(source, (node) => {
    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      checker.getSymbolAtLocation(node.left) === symbol
    )
      edits.push({
        start: ts.tokenStartOfNode(node.left),
        end: node.left.end,
        text: namespaceName,
      });
  });
  return edits;
}

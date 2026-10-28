/** Legacy decorators lower to ordinary typed calls, after the original program
 * has been checked. Only decorated classes are rewritten; undecorated sources
 * retain their exact text and native representation. */
import * as ts from "./ts7/adapter.js";
import { legacyMetadataEntries, type LegacyMetadataEntry } from "./legacy-metadata.js";
import { legacyPropertyKey } from "./legacy-decorator-keys.js";
import { legacyDecoratorMergeEdits } from "./legacy-decorator-merges.js";

export interface LegacyDecoratorOptions {
  emitDecoratorMetadata?: boolean;
  strict?: boolean;
  strictNullChecks?: boolean;
  target?: string | number;
  genericSignatures?: ReadonlySet<ts.Node>;
}

/** Pin only signatures actually used by decorators, including factories
 * whose generic result contract lives in another implementation module. */
export function genericLegacyDecoratorSignatures(
  sources: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): ReadonlySet<ts.Node> {
  const signatures = new Set<ts.Node>();
  for (const source of sources) {
    if (!source.text.includes("@")) continue;
    ts.walkPreorder(source, (node) => {
      if (!ts.isDecorator(node)) return;
      for (const signature of checker.getCallSignatures(
        checker.getTypeAtLocation(node.expression),
      )) {
        const declaration = signature.declaration;
        if (
          signature.getTypeParameters().length &&
          declaration &&
          (ts.isFunctionTypeNode(declaration) || ts.isCallSignatureDeclaration(declaration))
        )
          signatures.add(declaration);
      }
    });
  }
  return signatures;
}

interface Edit {
  start: number;
  end: number;
  text: string;
  render?: () => string;
}

export interface LegacyDecoratorSource {
  text: string;
  markers: readonly string[];
  rewrittenPosition(position: number, end: boolean): number;
}

/** Bind the generated class markers to this program's AST identities. User
 * comments never opt classes into mutable prototype behavior. */
export function registerLegacyDecoratorClasses(
  source: ts.SourceFile,
  lowered: LegacyDecoratorSource,
  decoratedClasses: Set<ts.Node>,
): void {
  if (source.text !== lowered.text)
    throw new Error("legacy decorator source changed before registration");
  const positions = lowered.markers.map((marker) =>
    source.text.indexOf("class", source.text.indexOf(marker) + marker.length),
  );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
      node.name &&
      positions.some(
        (position) => position >= ts.tokenStartOfNode(node) && position < node.name!.end,
      )
    )
      decoratedClasses.add(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function decorators(node: ts.Node): ts.Decorator[] {
  return (node.modifiers?.nodes ?? []).filter((item): item is ts.Decorator => ts.isDecorator(item));
}

function decoratedClass(node: ts.ClassDeclaration): boolean {
  return (
    decorators(node).length > 0 ||
    node.members.nodes.some(
      (member) =>
        decorators(member).length > 0 ||
        ((ts.isConstructorDeclaration(member) ||
          ts.isMethodDeclaration(member) ||
          ts.isAccessor(member)) &&
          member.parameters.nodes.some((parameter) => decorators(parameter).length > 0)),
    )
  );
}

function classKeywordPosition(source: ts.SourceFile, node: ts.ClassDeclaration): number {
  let position = node.modifiers?.nodes.at(-1)?.end ?? ts.tokenStartOfNode(node);
  while (position < node.end) {
    if (/\s/.test(source.text[position]!)) position++;
    else if (source.text.startsWith("//", position)) {
      const newline = source.text.indexOf("\n", position + 2);
      position = newline < 0 ? node.end : newline + 1;
    } else if (source.text.startsWith("/*", position)) {
      position = source.text.indexOf("*/", position + 2) + 2;
    } else return position;
  }
  throw new Error("class declaration has no class keyword");
}

/** Returns null without allocating a rewritten source for the common path. */
export function lowerLegacyDecorators(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  options: LegacyDecoratorOptions = {},
): LegacyDecoratorSource | null {
  if (source.isDeclarationFile) return null;
  let genericSource = false;
  const genericSignatures = options.genericSignatures;
  if (genericSignatures)
    for (const signature of genericSignatures)
      if (ts.getSourceFileOfNode(signature) === source) {
        genericSource = true;
        break;
      }
  if (
    !source.text.includes("@") &&
    !source.text.includes("Decorator") &&
    !source.text.includes("\\u") &&
    !genericSource
  )
    return null;
  const edits: Edit[] = [];
  const markers: string[] = [];
  const identifiers = new Set<string>();
  ts.walkPreorder(source, (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
  });
  let next = 0;
  const fresh = (): string => {
    let name: string;
    do name = `__scriptc_legacy_${next++}`;
    while (source.text.includes(name) || identifiers.has(name));
    identifiers.add(name);
    return name;
  };
  const aliases = new Map<ts.ClassDeclaration, string>();
  const renames = new Map<ts.Identifier, string>();
  const text = (node: ts.Node): string => {
    const start = ts.tokenStartOfNode(node);
    const names = [...renames]
      .filter(([reference]) => ts.tokenStartOfNode(reference) >= start && reference.end <= node.end)
      .sort(([a], [b]) => a.pos - b.pos);
    let cursor = start;
    let value = "";
    for (const [reference, name] of names) {
      value += source.text.slice(cursor, ts.tokenStartOfNode(reference)) + name;
      cursor = reference.end;
    }
    return value + source.text.slice(cursor, node.end);
  };
  // Plan aliases before copying expressions. An outer class reference can
  // appear inside a nested class's decorator or computed key; those source
  // regions are copied into generated calls rather than retained verbatim.
  ts.walkPreorder(source, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name || !decoratedClass(node)) return;
    const symbol = checker.getSymbolAtLocation(node.name);
    const references: ts.Identifier[] = [];
    const scan = (child: ts.Node): void => {
      if (ts.isTypeReferenceNode(child) || ts.isTypeQueryNode(child)) return;
      if (
        ts.isIdentifier(child) &&
        child !== node.name &&
        checker.getSymbolAtLocation(child) === symbol
      )
        references.push(child);
      ts.forEachChild(child, scan);
    };
    ts.forEachChild(node, scan);
    if (!references.length) return;
    const alias = fresh();
    aliases.set(node, alias);
    for (const reference of references) renames.set(reference, alias);
  });
  let defaultId = 1;
  const defaultName = (): string => {
    while (identifiers.has(`default_${defaultId}`)) defaultId++;
    return `default_${defaultId++}`;
  };
  const erase = (node: ts.Decorator): void => {
    const start = ts.tokenStartOfNode(node);
    edits.push({
      start,
      end: node.end,
      text: source.text.slice(start, node.end).replace(/[^\r\n]/g, " "),
    });
  };
  const visit = (node: ts.Node): void => {
    if (!ts.isClassDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const classDecorators = decorators(node);
    // Overload signatures precede the implementation, which alone carries
    // the parameter decorators.
    const ctor =
      node.members.nodes.find(
        (member): member is ts.ConstructorDeclaration =>
          ts.isConstructorDeclaration(member) && member.body !== undefined,
      ) ?? node.members.nodes.find(ts.isConstructorDeclaration);
    const parameterDecorators = (
      member: ts.ClassElement,
    ): { decorator: ts.Decorator; index: number }[] => {
      if (
        !ts.isConstructorDeclaration(member) &&
        !ts.isMethodDeclaration(member) &&
        !ts.isAccessor(member)
      )
        return [];
      return member.parameters.nodes.flatMap((parameter, index) =>
        decorators(parameter).map((decorator) => ({ decorator, index })),
      );
    };
    if (
      classDecorators.length === 0 &&
      !node.members.nodes.some(
        (member) => decorators(member).length || parameterDecorators(member).length,
      )
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    const name = node.name?.text ?? defaultName();
    const keyword = classKeywordPosition(source, node);
    const marker = `/*${fresh()}*/`;
    edits.push(
      ...legacyDecoratorMergeEdits(
        source,
        checker,
        node,
        name,
        fresh,
        (node, value) => renames.set(node, value),
        text,
      ),
    );
    markers.push(marker);
    edits.push({ start: keyword, end: keyword, text: `${marker} ` });
    const statements: string[] = [];
    const keys = new Map<ts.ClassElement, string>();
    const keyCaptures: string[] = [];
    for (const member of node.members.nodes) {
      if (
        ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword)
      )
        edits.push({ start: ts.tokenStartOfNode(member), end: member.end, text: "" });
    }
    // Computed keys evaluate while the class is created, before any decorator
    // expression. Capture them there and reuse the exact property key.
    for (const member of node.members.nodes) {
      if (
        member.name &&
        ts.isComputedPropertyName(member.name) &&
        (decorators(member).length || parameterDecorators(member).length)
      ) {
        const expression = member.name.expression;
        if (
          ts.isPropertyDeclaration(member) &&
          (ts.isIdentifier(expression) ||
            ts.isStringLiteralLike(expression) ||
            ts.isNumericLiteral(expression))
        )
          continue;
        const key = fresh();
        keys.set(member, key);
        const capture =
          ts.isPropertyDeclaration(member) && ts.isPropertyAccessExpression(expression)
            ? fresh()
            : undefined;
        if (capture)
          keyCaptures.push(
            `const ${capture} = { get key(): typeof ${text(expression)} { return ${key} = ${text(expression)}; } };`,
          );
        edits.push({
          start: ts.tokenStartOfNode(member.name.expression),
          end: member.name.expression.end,
          text: capture ? `${capture}.key` : `(${key} = ${text(member.name.expression)})`,
        });
      }
    }
    if (keys.size)
      edits.push({
        start: ts.tokenStartOfNode(node),
        end: ts.tokenStartOfNode(node),
        text: `let ${[...keys.values()].map((key) => `${key}: any`).join(", ")};\n${keyCaptures.join("\n")}\n`,
      });
    const metadata = (
      declaration: ts.ClassLikeDeclaration | ts.ClassElement,
    ): LegacyMetadataEntry[] => {
      if (!options.emitDecoratorMetadata) return [];
      return legacyMetadataEntries(checker, declaration, node, options);
    };
    const emitGroup = (
      decs: ts.Decorator[],
      params: { decorator: ts.Decorator; index: number }[],
      target: string,
      key: string | null,
      descriptor: boolean,
      meta: LegacyMetadataEntry[],
    ): void => {
      const values: { name: string; index?: number; metadata?: boolean }[] = [];
      const targetName = fresh();
      // Reading the target is effect-free here, but keep it in checked
      // storage so reflection uses the shared native property table.
      const targetExpression = target;
      if (key !== null) target = targetName;
      for (const decorator of decs) {
        erase(decorator);
        const local = fresh();
        // A concrete destination instantiates generic ClassDecorator and
        // MethodDecorator signatures without turning a generic function into
        // an unpinned native function value. A property decorator receives the
        // (undefined) descriptor slot like tslib's __decorate passes it, but
        // its declared signature (target, key) has no such parameter, so the
        // slot stays optional in the pinned signature.
        const signature =
          key === null
            ? "(target: any) => any"
            : descriptor
              ? "(target: any, key: any, descriptor: any) => any"
              : "(target: any, key: any, descriptor?: any) => any";
        const generic = checker
          .getCallSignatures(checker.getTypeAtLocation(decorator.expression))
          .some((signature) => signature.getTypeParameters().length > 0);
        statements.push(
          `const ${local}: ${generic ? signature : "any"} = ${text(decorator.expression)};`,
        );
        values.push({ name: local });
      }
      for (const { decorator, index } of params) {
        erase(decorator);
        const local = fresh();
        const generic = checker
          .getCallSignatures(checker.getTypeAtLocation(decorator.expression))
          .some((signature) => signature.getTypeParameters().length > 0);
        statements.push(
          `const ${local}: ${generic ? "(target: any, key: any, index: number) => void" : "any"} = ${text(decorator.expression)};`,
        );
        values.push({ name: local, index });
      }
      for (const entry of meta) {
        const value = fresh();
        const local = fresh();
        // __metadata's arguments evaluate even without a metadata provider.
        // A forward class reference must retain its original TDZ throw.
        statements.push(`const ${value}: any = ${entry.value};`);
        statements.push(
          `const ${local}: any = typeof Reflect === "object" && typeof (Reflect as any).metadata === "function" ? (Reflect as any).metadata(${JSON.stringify(entry.key)}, ${value}) : undefined;`,
        );
        values.push({ name: local, metadata: true });
      }
      const result = fresh();
      if (key !== null) statements.push(`const ${targetName}: any = ${targetExpression};`);
      if (key === null) statements.push(`let ${result}: any = ${target};`);
      else
        statements.push(
          `let ${result}: any = ${descriptor ? `Object.getOwnPropertyDescriptor(${target}, ${key})` : "undefined"};`,
        );
      const applications: string[] = [];
      for (const value of [...values].reverse()) {
        const args =
          value.index !== undefined
            ? `${key === null ? result : target}, ${key ?? "undefined"}, ${value.index}`
            : key === null
              ? result
              : `${target}, ${key}, ${result}`;
        const call = `${value.name}(${args})`;
        const apply = value.index !== undefined ? `${call};` : `${result} = ${call} || ${result};`;
        applications.push(value.index === undefined ? `if (${value.name}) { ${apply} }` : apply);
      }
      const list = values
        .map((value) =>
          value.index === undefined
            ? value.name
            : `((target: any, key: any) => { ${value.name}(target, key, ${value.index}); })`,
        )
        .join(", ");
      statements.push(
        `if (typeof Reflect === "object" && typeof (Reflect as any).decorate === "function") { ${result} = (Reflect as any).decorate([${list}], ${target}, ${key ?? "undefined"}, ${key === null ? "undefined" : result}); } else { ${applications.join("\n")} }`,
      );
      if (key === null) statements.push(`${target} = ${result};`);
      else statements.push(`if (${result}) Object.defineProperty(${target}, ${key}, ${result});`);
    };
    // TypeScript applies all instance groups before static groups, preserving
    // declaration order within each tier. An accessor pair is one group.
    for (const isStatic of [false, true]) {
      for (const member of node.members.nodes) {
        if (ts.isConstructorDeclaration(member) || !member.name) continue;
        const memberName = member.name as ts.PropertyName;
        if (
          (ts
            .getModifiers(member)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false) !==
          isStatic
        )
          continue;
        const key =
          keys.get(member) ??
          (ts.isComputedPropertyName(member.name)
            ? text(member.name.expression)
            : JSON.stringify(legacyPropertyKey(memberName)));
        let decs = decorators(member);
        let params = parameterDecorators(member);
        if (ts.isAccessor(member)) {
          const identity = legacyPropertyKey(member.name);
          const pair =
            identity === null
              ? [member]
              : node.members.nodes.filter(
                  (other) =>
                    ts.isAccessor(other) &&
                    legacyPropertyKey(other.name) === identity &&
                    (ts
                      .getModifiers(other)
                      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ??
                      false) === isStatic,
                );
          const owner = pair.find((accessor) => decorators(accessor).length > 0);
          if (owner !== member) {
            if (!owner) for (const { decorator } of params) erase(decorator);
            continue;
          }
          decs = decorators(owner);
          params = pair.flatMap(parameterDecorators);
        }
        if (!decs.length && !params.length) continue;
        emitGroup(
          decs,
          params,
          isStatic ? name : `${name}.prototype`,
          key,
          ts.isMethodDeclaration(member) || ts.isAccessor(member),
          metadata(member),
        );
      }
    }
    const ctorParams = ctor ? parameterDecorators(ctor) : [];
    {
      const selfAlias = aliases.get(node);
      // TypeScript's legacy emit uses a named class expression and an
      // outer binding. Its synthetic self alias is rebound after decoration.
      const isDefault = ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      // The decorated binding is an untyped constructor: decorators may
      // replace or reshape the class, so instances stay `any`, but generic
      // callees such as `make<T>(cls: new () => T)` infer `any` rather than
      // the `unknown` that inference draws from a bare `any` argument.
      for (const modifier of ts.getModifiers(node) ?? []) {
        if (
          modifier.kind === ts.SyntaxKind.DefaultKeyword ||
          modifier.kind === ts.SyntaxKind.AbstractKeyword ||
          (isDefault && modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          edits.push({ start: ts.tokenStartOfNode(modifier), end: modifier.end, text: "" });
      }
      edits.push({
        start: keyword,
        end: keyword + 5,
        text: `let ${name}: { new (...args: any[]): any; [key: string]: any } = class${node.name ? "" : ` ${name}`}`,
      });
      if (node.typeParameters?.nodes.length) {
        const parameters = new Set(
          node.typeParameters.nodes.map((parameter) => checker.getSymbolAtLocation(parameter.name)),
        );
        const start = source.text.lastIndexOf("<", node.typeParameters.pos);
        const end = source.text.indexOf(">", node.typeParameters.end) + 1;
        edits.push({ start, end, text: "" });
        const eraseParameter = (child: ts.Node): void => {
          if (
            ts.isTypeReferenceNode(child) &&
            ts.isIdentifier(child.typeName) &&
            parameters.has(checker.getSymbolAtLocation(child.typeName))
          ) {
            edits.push({ start: ts.tokenStartOfNode(child), end: child.end, text: "any" });
            return;
          }
          ts.forEachChild(child, eraseParameter);
        };
        for (const member of node.members.nodes) eraseParameter(member);
        for (const clause of node.heritageClauses?.nodes ?? []) eraseParameter(clause);
      }
      if (selfAlias) {
        edits.push({
          start: ts.tokenStartOfNode(node),
          end: ts.tokenStartOfNode(node),
          text: `let ${selfAlias}: any;\n`,
        });
        edits.push({
          start: node.members.pos,
          end: node.members.pos,
          text: ` static { ${selfAlias} = this; } `,
        });
      }
      const typeParameters = node.typeParameters?.nodes.length
        ? `<${node.typeParameters.nodes.map(text).join(", ")}>`
        : "";
      const exported =
        !isDefault &&
        ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      edits.push({
        start: node.end,
        end: node.end,
        text: `;\n${exported ? "export " : ""}type ${name}${typeParameters} = InstanceType<typeof ${name}>;`,
      });
      if (classDecorators.length || ctorParams.length)
        emitGroup(classDecorators, ctorParams, name, null, false, metadata(node));
      if (selfAlias) statements.push(`${selfAlias} = ${name};`);
      if (isDefault) statements.push(`export default ${name};`);
    }
    edits.push({ start: node.end, end: node.end, text: `\n${statements.join("\n")}\n` });
    ts.forEachChild(node, visit);
  };
  visit(source);
  // The standard legacy decorator aliases are generic contracts, rather
  // than a single runtime ABI. Pin their use in this lowering world; the
  // original checker still validates their full generic promises.
  const pin = (node: ts.Node): void => {
    if (
      options.genericSignatures?.has(node) &&
      (ts.isFunctionTypeNode(node) || ts.isCallSignatureDeclaration(node))
    ) {
      const params = node.parameters.nodes.map((_, index) => `argument${index}: any`).join(", ");
      edits.push({
        start: ts.tokenStartOfNode(node),
        end: node.end,
        text: ts.isFunctionTypeNode(node) ? `((${params}) => any)` : `(${params}): any;`,
      });
      return;
    }
    if (ts.isNewExpression(node) && node.typeArguments?.nodes.length) {
      let expression = node.expression;
      for (let depth = 0; depth < 16 && ts.isIdentifier(expression); depth++) {
        let symbol = checker.getSymbolAtLocation(expression);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
          symbol = checker.getAliasedSymbol(symbol);
        const declaration = symbol?.valueDeclaration;
        if (declaration && ts.isClassDeclaration(declaration) && decoratedClass(declaration)) {
          edits.push({
            start: source.text.lastIndexOf("<", node.typeArguments.pos),
            end: source.text.indexOf(">", node.typeArguments.end) + 1,
            text: "",
          });
          break;
        }
        if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
          break;
        expression = declaration.initializer;
      }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const signatures: Record<string, string> = {
        ClassDecorator: "((target: any) => any)",
        MethodDecorator: "((target: any, key: any, descriptor: any) => any)",
        ParameterDecorator: "((target: any, key: any, index: number) => void)",
        PropertyDecorator: "((target: any, key: any) => void)",
      };
      const signature = signatures[node.typeName.text];
      const symbol = signature ? checker.getSymbolAtLocation(node.typeName) : undefined;
      if (
        signature &&
        symbol?.declarations.some((declaration) =>
          ts.getSourceFileOfNode(declaration).fileName.endsWith("lib.decorators.legacy.d.ts"),
        )
      ) {
        edits.push({ start: ts.tokenStartOfNode(node), end: node.end, text: signature });
      }
    }
    ts.forEachChild(node, pin);
  };
  pin(source);
  for (const [reference, name] of renames) {
    const start = ts.tokenStartOfNode(reference);
    if (!edits.some((edit) => edit.start <= start && edit.end >= reference.end))
      edits.push({ start, end: reference.end, text: name });
  }
  if (!edits.length) return null;
  // Insertions come first at a position; among ranges sharing a start the
  // widest wins, so a decorator erased inside an erased abstract member is
  // skipped instead of overlapping it.
  edits.sort(
    (a, b) =>
      a.start - b.start || Number(a.end > a.start) - Number(b.end > b.start) || b.end - a.end,
  );
  let cursor = 0;
  let result = "";
  const positions: { start: number; end: number; rewrittenStart: number; rewrittenEnd: number }[] =
    [];
  for (const edit of edits) {
    if (edit.start < cursor && edit.end <= cursor) continue;
    if (edit.start < cursor) throw new Error("overlapping legacy decorator source edits");
    result += source.text.slice(cursor, edit.start);
    const rewrittenStart = result.length;
    result += edit.render ? edit.render() : edit.text;
    positions.push({
      start: edit.start,
      end: edit.end,
      rewrittenStart,
      rewrittenEnd: result.length,
    });
    cursor = edit.end;
  }
  return {
    text: result + source.text.slice(cursor),
    markers,
    rewrittenPosition(position, end) {
      let delta = 0;
      for (const mapping of positions) {
        if (position < mapping.start) break;
        if (position < mapping.end) return end ? mapping.rewrittenEnd : mapping.rewrittenStart;
        delta = mapping.rewrittenEnd - mapping.end;
      }
      return position + delta;
    },
  };
}

/** Published TypeScript libraries already contain tslib calls. Register only
 * their actual imported helper targets, using checker identity rather than a
 * helper-like spelling or a source comment. */
/** A published-JS call of tslib's `__decorate` (by import identity). */
export function isTslibDecorateCall(
  checker: ts.TypeChecker,
  node: ts.Node,
): node is ts.CallExpression {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.arguments.nodes.length < 2 ||
    !/\.[cm]?jsx?$/.test(ts.getSourceFileOfNode(node).fileName)
  )
    return false;
  const helper = checker
    .getSymbolAtLocation(node.expression)
    ?.declarations.find(ts.isImportSpecifier);
  if (!helper || (helper.propertyName ?? helper.name).text !== "__decorate") return false;
  let declaration: ts.Node = helper;
  while (declaration.parent && !ts.isImportDeclaration(declaration))
    declaration = declaration.parent;
  return (
    ts.isImportDeclaration(declaration) &&
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === "tslib"
  );
}

export function registerTranspiledLegacyDecoratorClasses(
  program: ts.Program,
  classes: Set<ts.Node>,
): void {
  const checker = program.getTypeChecker();
  for (const source of program.getImplementationSourceFiles()) {
    if (!/\.[cm]?jsx?$/.test(source.fileName) || !source.text.includes("__decorate")) continue;
    ts.walkPreorder(source, (node) => {
      if (!isTslibDecorateCall(checker, node)) return;
      let target = node.arguments.nodes[1]!;
      if (ts.isPropertyAccessExpression(target) && target.name.text === "prototype")
        target = target.expression;
      if (!ts.isIdentifier(target)) return;
      let symbol = checker.getSymbolAtLocation(target);
      if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
        symbol = checker.getAliasedSymbol(symbol);
      const binding = symbol?.valueDeclaration;
      if (binding && ts.isClassDeclaration(binding)) classes.add(binding);
      else if (binding && ts.isVariableDeclaration(binding) && binding.initializer) {
        // `let C = C_1 = class C {}`: tsc's alias for a self-referencing
        // decorated class.
        let initializer = binding.initializer;
        while (
          ts.isParenthesizedExpression(initializer) ||
          (ts.isBinaryExpression(initializer) &&
            initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        )
          initializer = ts.isParenthesizedExpression(initializer)
            ? initializer.expression
            : initializer.right;
        if (ts.isClassExpression(initializer)) classes.add(initializer);
      }
    });
  }
}

/** Type-only module edges under Node's type stripping.
 *
 * Node runs TypeScript by erasing types in place, with the semantics of
 * `verbatimModuleSyntax`: `import type …` and `export type … from` vanish,
 * but `import { type A } from "./m"` and `export { type A } from "./m"`
 * keep an empty clause (`import {} from "./m"`) and still load and
 * evaluate `./m`. Only the erased forms are absent from Node's module
 * graph. */
import * as ts from "./ts7/adapter.js";
import { moduleSourceCandidates } from "./module-source-candidates.js";
import { isProvenanceSourceFile } from "./provenance-registry.js";

/** `import type …` (default, named, or namespace): erased by Node, so
 * module order, cycle detection, init calls, package selection, and the
 * startup-refusal probe must not count it (zod v4's core modules are
 * "cyclic" only through `import type * as ns` namespaces, and a
 * type-only import of a module Node cannot resolve is not a startup
 * crash). Side-effect imports and inline `type` specifiers stay real
 * edges. */
export function erasedTypeOnlyImport(stmt: ts.ImportDeclaration): boolean {
  return (
    stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    dependencyImportUsedOnlyAsType(stmt)
  );
}

/** Identifier spellings each dependency source file uses in a value
 * position (anywhere outside a type annotation, an interface or a type
 * alias; a class `extends` expression is a value). */
const valueSpellings = new Map<string, { length: number; names: ReadonlySet<string> }>();

function valueSpellingsOf(sf: ts.SourceFile): ReadonlySet<string> {
  const known = valueSpellings.get(sf.fileName);
  if (known !== undefined && known.length === sf.text.length) return known.names;
  const found = new Set<string>();
  const inTypePosition = (node: ts.Node): boolean => {
    for (let p = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isTypeNode(p)) {
        const heritage = p.parent;
        const classExtends =
          p.kind === ts.SyntaxKind.ExpressionWithTypeArguments &&
          heritage !== undefined &&
          ts.isHeritageClause(heritage) &&
          heritage.token === ts.SyntaxKind.ExtendsKeyword &&
          (ts.isClassDeclaration(heritage.parent) || ts.isClassExpression(heritage.parent));
        if (!classExtends) return true;
      }
      if (ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
    }
    return false;
  };
  ts.walkPreorder(sf, (node) => {
    if (ts.isImportDeclaration(node)) return "skip";
    if (ts.isIdentifier(node) && !inTypePosition(node)) found.add(node.text);
    return undefined;
  });
  if (sf.text.includes("@")) addDecoratorMetadataSpellings(sf, found);
  valueSpellings.set(sf.fileName, { length: sf.text.length, names: found });
  return found;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return (node.modifiers?.nodes ?? []).filter((item): item is ts.Decorator => ts.isDecorator(item));
}

/** The leftmost identifier of the entity a type annotation serializes to in
 * `design:type` / `design:paramtypes` metadata, as TypeScript's
 * emitDecoratorMetadata does: a type reference names its entity (a
 * parenthesized type or a union with one non-nullish constituent defers to
 * it); arrays, functions, literals and the rest serialize to builtins. */
function metadataEntityOf(type: ts.TypeNode | undefined): string | null {
  if (type === undefined) return null;
  if (ts.isParenthesizedTypeNode(type)) return metadataEntityOf(type.type);
  if (ts.isTypeReferenceNode(type)) {
    let name: ts.EntityName = type.typeName;
    while (ts.isQualifiedName(name)) name = name.left;
    return name.text;
  }
  if (ts.isUnionTypeNode(type)) {
    const parts = type.types.nodes.filter(
      (part) =>
        part.kind !== ts.SyntaxKind.UndefinedKeyword &&
        part.kind !== ts.SyntaxKind.NeverKeyword &&
        !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword),
    );
    return parts.length === 1 ? metadataEntityOf(parts[0]) : null;
  }
  return null;
}

/** emitDecoratorMetadata makes the types of a decorated class's constructor
 * parameters, and of its decorated members, value references to their
 * classes — the imports tsc keeps for them. */
function addDecoratorMetadataSpellings(sf: ts.SourceFile, found: Set<string>): void {
  const add = (type: ts.TypeNode | undefined): void => {
    const name = metadataEntityOf(type);
    if (name !== null) found.add(name);
  };
  ts.walkPreorder(sf, (node) => {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) return undefined;
    const hasParameterDecorators = (member: ts.Node): boolean =>
      (ts.isConstructorDeclaration(member) ||
        ts.isMethodDeclaration(member) ||
        ts.isAccessor(member)) &&
      member.parameters.nodes.some((parameter) => decoratorsOf(parameter).length > 0);
    const classDecorated = decoratorsOf(node).length > 0;
    for (const member of node.members.nodes) {
      if (ts.isConstructorDeclaration(member)) {
        if (classDecorated || hasParameterDecorators(member))
          for (const parameter of member.parameters.nodes) add(parameter.type);
        continue;
      }
      if (decoratorsOf(member).length === 0 && !hasParameterDecorators(member)) continue;
      if (ts.isMethodDeclaration(member)) {
        for (const parameter of member.parameters.nodes) add(parameter.type);
        add(member.type);
      } else if (ts.isAccessor(member)) {
        add(member.type);
        for (const parameter of member.parameters.nodes) add(parameter.type);
      } else if (ts.isPropertyDeclaration(member)) {
        add(member.type);
      }
    }
    return undefined;
  });
}

/** A dependency's own TypeScript source (a package that ships its `.ts`)
 * runs as the JavaScript its compiler emits, and that emit drops every
 * import none of whose bindings is used as a value. The dependency never
 * runs under Node's type stripping, so unlike a project file its type-only
 * uses of a module are not edges: rxjs' `types.ts` names Observable and
 * Subscription only in types, which keeps Observable, Subscriber and
 * Subscription from forming an import cycle. */
function dependencyImportUsedOnlyAsType(stmt: ts.ImportDeclaration): boolean {
  const clause = stmt.importClause;
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  const sf = ts.getSourceFileOfNode(stmt);
  if (
    sf.isDeclarationFile ||
    !/\.[cm]?ts$/.test(sf.fileName) ||
    !(sf.fileName.includes("/node_modules/") || isProvenanceSourceFile(sf.fileName))
  )
    return false;
  const bound: ts.Identifier[] = [];
  if (clause.name !== undefined) bound.push(clause.name);
  const named = clause.namedBindings;
  if (named !== undefined) {
    if (ts.isNamespaceImport(named)) bound.push(named.name);
    else
      for (const element of named.elements.nodes) if (!element.isTypeOnly) bound.push(element.name);
  }
  if (bound.length === 0) return false;
  const used = valueSpellingsOf(sf);
  return bound.every((name) => !used.has(name.text));
}

/** `import { type A, type B } from "./m"`: a real module edge that binds
 * nothing at runtime, exactly like a side-effect import. */
export function typeOnlyNamedImport(stmt: ts.ImportDeclaration): boolean {
  const clause = stmt.importClause;
  return (
    clause !== undefined &&
    clause.phaseModifier !== ts.SyntaxKind.TypeKeyword &&
    clause.name === undefined &&
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.nodes.length > 0 &&
    clause.namedBindings.elements.nodes.every((e) => e.isTypeOnly)
  );
}

/** One module reference of a program file: its specifier and whether
 * Node erases it. */
interface ModuleReference {
  spec: string;
  erased: boolean;
  kind?: "import" | "require";
}

function declarationReferencesOf(sf: ts.SourceFile): ModuleReference[] {
  const refs: ModuleReference[] = [];
  for (const stmt of sf.statements.nodes) {
    if (ts.isImportDeclaration(stmt)) {
      if (ts.isStringLiteral(stmt.moduleSpecifier))
        refs.push({ spec: stmt.moduleSpecifier.text, erased: erasedTypeOnlyImport(stmt) });
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier !== undefined && ts.isStringLiteral(stmt.moduleSpecifier))
        refs.push({ spec: stmt.moduleSpecifier.text, erased: stmt.isTypeOnly });
    } else if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteralLike(stmt.moduleReference.expression)
    ) {
      refs.push({
        spec: stmt.moduleReference.expression.text,
        erased: stmt.isTypeOnly,
        kind: "require",
      });
    }
  }
  return refs;
}

/** Every call with a leading string literal counts as a loading edge —
 * require(), import(), createRequire'd require functions, and loader
 * helpers alike. Over-counting only keeps a file in the graph. */
function callReferencesOf(program: ts.Program, sf: ts.SourceFile): ModuleReference[] {
  const refs: ModuleReference[] = [];
  for (const node of moduleSourceCandidates(program, sf).calls) {
    const arg = node.arguments.nodes[0];
    if (arg === undefined || !ts.isStringLiteralLike(arg)) continue;
    refs.push({
      spec: arg.text,
      erased: false,
      kind: node.expression.kind === ts.SyntaxKind.ImportKeyword ? "import" : "require",
    });
  }
  return refs;
}

/** The program files Node never loads because the only references that
 * reach them are erased type-only forms (directly or through other such
 * files). A file referenced by nothing at all (a program root, or a file
 * reached through a reference this walk does not model, such as an
 * `import("./m")` type query) keeps its place, as do `extraRoots` (fork
 * and worker targets). Empty when no erased reference resolves to a
 * program file — the common case pays one statement scan per file. */
export function typeOnlyReachedFiles(
  program: ts.Program,
  entry: ts.SourceFile,
  files: readonly ts.SourceFile[],
  extraRoots: () => readonly string[],
  resolveEdge: (
    from: ts.SourceFile,
    spec: string,
    resolutionKind?: "import" | "require",
  ) => ts.SourceFile | null,
): Set<ts.SourceFile> {
  const available = new Set(files);
  const declarationRefs = new Map(files.map((sf) => [sf, declarationReferencesOf(sf)] as const));
  const target = (sf: ts.SourceFile, ref: ModuleReference): ts.SourceFile | null => {
    const dep = resolveEdge(sf, ref.spec, ref.kind);
    return dep === null || dep === sf || !available.has(dep) ? null : dep;
  };
  if (
    !files.some((sf) =>
      declarationRefs.get(sf)!.some((ref) => ref.erased && target(sf, ref) !== null),
    )
  )
    return new Set();
  const valueEdges = new Map<ts.SourceFile, ts.SourceFile[]>();
  const referenced = new Set<ts.SourceFile>();
  for (const sf of files) {
    const deps: ts.SourceFile[] = [];
    valueEdges.set(sf, deps);
    for (const ref of [...declarationRefs.get(sf)!, ...callReferencesOf(program, sf)]) {
      const dep = target(sf, ref);
      if (dep === null) continue;
      referenced.add(dep);
      if (!ref.erased) deps.push(dep);
    }
  }
  const roots = files.filter((sf) => sf === entry || !referenced.has(sf));
  for (const path of extraRoots()) {
    const sf = program.getSourceFile(path);
    if (sf !== undefined && available.has(sf)) roots.push(sf);
  }
  const reached = new Set<ts.SourceFile>();
  const queue = [...roots];
  while (queue.length > 0) {
    const sf = queue.pop()!;
    if (reached.has(sf)) continue;
    reached.add(sf);
    for (const dep of valueEdges.get(sf) ?? []) if (!reached.has(dep)) queue.push(dep);
  }
  return new Set(files.filter((sf) => !reached.has(sf)));
}

/* `const { isArray } = Array`, `const { keys: getKeys, prototype } = Object`:
 * object destructuring of a builtin constructor's statics. A builtin
 * constructor is not a value of its own (`Array` read bare has no
 * lowering), but each static member the compiler already reads as a function
 * value (`const f = Array.isArray`) or as a prototype object can be bound the
 * same way through a pattern: every element is one read of that member, and
 * the binding holds the member's value. Elements the member tables do not
 * cover keep the destructuring refusal. */
import * as ts from "../ts7/adapter.js";
import { DYN, type IrExpr, type IrStmt, type IrType, type SrcLoc } from "../../ir/ir.js";
import type { Lowerer } from "./lowerer.js";
import { isJsSourceFile, locOf } from "../program.js";
import { stdlibGlobalNameOf, OBJECT_CALLABLE_VALUES } from "./surfaces.js";
import {
  lowerArrayIsArrayValue,
  lowerNumberParserValue,
  lowerObjectAssignValue,
} from "./lower-builtin-values.js";
import { lowerArrayFromValue } from "./containers/array-construction.js";

/** One bound name of a recognized pattern. */
export interface BuiltinStaticBinding {
  readonly name: ts.Identifier;
  readonly element: ts.BindingElement;
  readonly member: string;
}

const STATIC_OWNERS = new Set(["Array", "Object", "Number"]);

/** The member's value as the same read spelled `Owner.member` produces, or
 * null when no member table covers it. */
function builtinStaticMemberValue(
  lowerer: Lowerer,
  owner: string,
  member: string,
  loc: SrcLoc,
): IrExpr | null {
  const libCall = (fn: "dyn.arrayPrototype" | "dyn.objectPrototype"): IrExpr => ({
    kind: "libCall",
    fn,
    args: [],
    type: DYN,
    loc,
  });
  switch (owner) {
    case "Array":
      if (member === "isArray") return lowerArrayIsArrayValue(lowerer, loc);
      if (member === "from") return lowerArrayFromValue(lowerer, loc);
      if (member === "prototype") return libCall("dyn.arrayPrototype");
      return null;
    case "Object": {
      if (member === "prototype") return libCall("dyn.objectPrototype");
      if (member === "assign") return lowerObjectAssignValue(lowerer, loc);
      const fn = Object.hasOwn(OBJECT_CALLABLE_VALUES, member)
        ? OBJECT_CALLABLE_VALUES[member]
        : undefined;
      return fn ? lowerer.lowerNativeCallableValue(fn, `Object.${member}`, loc) : null;
    }
    case "Number":
      return member === "parseInt" || member === "parseFloat"
        ? lowerNumberParserValue(lowerer, member, loc)
        : null;
    default:
      return null;
  }
}

/** The bindings of a TypeScript `const`/`let` declaration whose pattern
 * reads only covered statics of a builtin constructor, or null when the
 * declaration is anything else (the ordinary destructuring path decides). */
export function builtinStaticDestructureBindings(
  lowerer: Lowerer,
  decl: ts.VariableDeclaration,
): BuiltinStaticBinding[] | null {
  if (
    decl.initializer === undefined ||
    !ts.isObjectBindingPattern(decl.name) ||
    isJsSourceFile(ts.getSourceFileOfNode(decl))
  )
    return null;
  let source: ts.Expression = decl.initializer;
  while (ts.isParenthesizedExpression(source)) source = source.expression;
  if (!ts.isIdentifier(source)) return null;
  const owner = stdlibGlobalNameOf(lowerer, source);
  if (owner === null || !STATIC_OWNERS.has(owner)) return null;
  const bindings: BuiltinStaticBinding[] = [];
  for (const element of decl.name.elements.nodes) {
    if (
      element.dotDotDotToken !== undefined ||
      element.initializer !== undefined ||
      element.name === undefined ||
      !ts.isIdentifier(element.name)
    )
      return null;
    const key = element.propertyName ?? element.name;
    const member = ts.isIdentifier(key) ? key.text : ts.isStringLiteral(key) ? key.text : null;
    if (member === null) return null;
    // Probe with a throwaway location: coverage must not depend on lowering.
    if (builtinStaticMemberValue(lowerer, owner, member, locOf(element)) === null) return null;
    bindings.push({ name: element.name, element, member });
  }
  return bindings.length > 0 ? bindings : null;
}

/** The storage type of one bound name: the checker's type for the name
 * (an overloaded static's erased function type included), else the type of
 * the value the member reads as. */
export function builtinStaticBindingType(
  lowerer: Lowerer,
  decl: ts.VariableDeclaration,
  binding: BuiltinStaticBinding,
): IrType {
  const value = builtinStaticValueOf(lowerer, decl, binding);
  return lowerer.memberSlotTypeOf(lowerer.typeOf(binding.name)) ?? value.type;
}

function builtinStaticValueOf(
  lowerer: Lowerer,
  decl: ts.VariableDeclaration,
  binding: BuiltinStaticBinding,
): IrExpr {
  let source = decl.initializer!;
  while (ts.isParenthesizedExpression(source)) source = source.expression;
  const owner = stdlibGlobalNameOf(lowerer, source)!;
  return builtinStaticMemberValue(lowerer, owner, binding.member, locOf(binding.element))!;
}

/** The declaration's statements: each name is initialized from its member
 * in pattern order, into its module global when one is registered, else a
 * fresh local. */
export function lowerBuiltinStaticDestructure(
  lowerer: Lowerer,
  decl: ts.VariableDeclaration,
  bindings: readonly BuiltinStaticBinding[],
  isLet: boolean,
): IrStmt[] {
  const out: IrStmt[] = [];
  for (const binding of bindings) {
    const loc = locOf(binding.name);
    const value = builtinStaticValueOf(lowerer, decl, binding);
    const symbol = lowerer.checker.getSymbolAtLocation(binding.name);
    const g = symbol ? lowerer.globalsBySymbol.get(symbol) : undefined;
    if (g !== undefined) {
      out.push({
        kind: "assign",
        localId: g.id,
        value: lowerer.coerceInto(binding.name, value, g.type),
        ...(g.tdz ? { initializes: true as const } : {}),
        loc,
      });
      continue;
    }
    const type = builtinStaticBindingType(lowerer, decl, binding);
    const local = lowerer.declareLocal(binding.name, binding.name.text, type, isLet);
    out.push({
      kind: "varDecl",
      localId: local.id,
      init: lowerer.coerceInto(binding.name, value, type),
      loc,
    });
  }
  return out;
}

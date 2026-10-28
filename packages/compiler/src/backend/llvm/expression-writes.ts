import type { IrExpr, IrFunction, IrStmt } from "../../ir/ir.js";
import { everyExprChild, everyStmtChild } from "../../ir/traverse.js";

/** The locals of `fn` that some expression can rebind while it evaluates:
 * assignment and increment expressions, and any statement nested inside an
 * expression (a sequence's assignments, declarations and catch bindings).
 * Statement-level assignments are not listed: they run between expressions,
 * after every borrowed read of the statement before them has been consumed.
 *
 * An unboxed local outside this set keeps its value, and so its reference,
 * for the whole evaluation of any one expression that reads it: no operand
 * and no callee can reach its slot (closures reach only boxes), so a runtime
 * operation that borrows its input may read the slot in place even though a
 * later statement rebinds it. Closure and class captures live in boxes and
 * are listed so nothing else treats them as unwritten. */
export function expressionWrittenLocals(fn: IrFunction): Set<string> {
  const written = new Set<string>();
  const expr = (node: IrExpr): boolean => {
    switch (node.kind) {
      case "assignExpr":
      case "incDec":
        written.add(node.localId);
        break;
      case "closure":
      case "classRef":
        for (const id of node.captures ?? []) written.add(id);
        break;
    }
    return everyExprChild(node, expr, (child) => stmt(child, true));
  };
  const stmt = (node: IrStmt, inExpression: boolean): boolean => {
    if (inExpression) {
      switch (node.kind) {
        case "assign":
        case "varDecl":
        case "forOf":
        case "rethrow":
          written.add(node.localId);
          break;
        case "tryCatch":
          if (node.catchLocalId !== null) written.add(node.catchLocalId);
          break;
      }
    }
    return everyStmtChild(node, expr, (child) => stmt(child, inExpression));
  };
  for (const node of fn.body) stmt(node, false);
  for (const capture of [...(fn.captures ?? []), ...(fn.classCaptures ?? [])])
    written.add(capture.localId);
  return written;
}

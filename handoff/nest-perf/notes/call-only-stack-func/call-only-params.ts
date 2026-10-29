import type { IrExpr, IrFunction, IrStmt } from "../../ir/ir.js";
import { everyExprChild, everyStmtChild } from "../../ir/traverse.js";

/** Untyped (dyn) parameters that a callee only ever CALLS.
 *
 * Such a parameter cannot be stored, returned, thrown, captured, compared,
 * read for a property or handed to unknown code, so the function value a
 * caller passes dies with the call: it may live in the caller's frame (a
 * stack closure under a stack function node) instead of the heap. Every
 * other use of the parameter, including any mention the walk does not
 * recognise, disqualifies it. A parameter forwarded as the direct argument
 * of another call-only parameter stays qualified.
 *
 * Only plain synchronous functions qualify: a suspended body (async,
 * generator) outlives the call that created its argument, and a function
 * with an environment is entered through a closure the caller cannot see. */
export function findCallOnlyDynParameters(
  functions: ReadonlyMap<string, IrFunction>,
): Map<string, Set<number>> {
  interface Forward {
    callee: string;
    index: number;
  }
  const candidates = new Map<string, Map<number, Forward[]>>();
  for (const fn of functions.values()) {
    if (
      fn.async ||
      fn.generator ||
      fn.captures !== undefined ||
      fn.classCaptures !== undefined ||
      fn.params.length === 0
    )
      continue;
    const locals = new Map(fn.locals.map((local) => [local.id, local]));
    const watched = new Map<string, number>();
    fn.params.forEach((param, index) => {
      const local = locals.get(param.localId);
      if (
        param.type.kind === "dyn" &&
        !param.owned &&
        param.name !== "this" &&
        local !== undefined &&
        !local.boxed &&
        !local.tdz
      )
        watched.set(param.localId, index);
    });
    if (watched.size === 0) continue;
    // One count per approved position: a node shared by two positions is
    // approved only where it stands as a callee or a forwarded argument.
    const approved = new Map<IrExpr, number>();
    const approve = (node: IrExpr): void => void approved.set(node, (approved.get(node) ?? 0) + 1);
    const bad = new Set<string>();
    const forwards = new Map<string, Forward[]>();
    let nodes = 0;
    let complete = true;
    const expr = (node: IrExpr): boolean => {
      if (++nodes > 20000) return (complete = false);
      if (node.kind === "varRef") {
        const count = approved.get(node) ?? 0;
        if (count > 0) approved.set(node, count - 1);
        else if (watched.has(node.localId)) bad.add(node.localId);
        return true;
      }
      if (
        node.kind === "dynCall" &&
        node.callee.kind === "varRef" &&
        watched.has(node.callee.localId)
      ) {
        approve(node.callee);
      } else if (node.kind === "call") {
        node.args.forEach((arg, index) => {
          if (arg.kind === "varRef" && watched.has(arg.localId)) {
            approve(arg);
            let list = forwards.get(arg.localId);
            if (!list) forwards.set(arg.localId, (list = []));
            list.push({ callee: node.callee, index });
          }
        });
      }
      return everyExprChild(node, expr, stmt);
    };
    const stmt = (node: IrStmt): boolean => {
      if (++nodes > 20000) return (complete = false);
      return everyStmtChild(node, expr, stmt);
    };
    if (!fn.body.every(stmt) || !complete) continue;
    // Every other mention of the parameter's id, anywhere in the body, is a
    // use the walk above does not understand (a read, a write, a capture).
    const mentioned = new Set<string>();
    const scan = (value: unknown, depth: number): void => {
      if (typeof value === "string") {
        if (watched.has(value)) mentioned.add(value);
      } else if (Array.isArray(value)) {
        for (const item of value) scan(item, depth);
      } else if (value !== null && typeof value === "object") {
        // Reads were judged by the walk, which sees every position.
        if ((value as { kind?: unknown }).kind === "varRef" || depth > 64) return;
        for (const [key, child] of Object.entries(value)) {
          if (key !== "loc" && key !== "type") scan(child, depth + 1);
        }
      }
    };
    scan(fn.body, 0);
    const result = new Map<number, Forward[]>();
    for (const [id, index] of watched) {
      if (!mentioned.has(id) && !bad.has(id)) result.set(index, forwards.get(id) ?? []);
    }
    if (result.size > 0) candidates.set(fn.name, result);
  }
  // A forwarded parameter must reach a call-only parameter of the callee.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, params] of candidates) {
      for (const [index, list] of params) {
        if (list.every((f) => candidates.get(f.callee)?.has(f.index) === true)) continue;
        params.delete(index);
        changed = true;
      }
      if (params.size === 0) candidates.delete(name);
    }
  }
  const out = new Map<string, Set<number>>();
  for (const [name, params] of candidates) out.set(name, new Set(params.keys()));
  return out;
}

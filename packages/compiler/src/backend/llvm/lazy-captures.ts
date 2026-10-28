import type { IrExpr, IrFunction, IrStmt } from "../../ir/ir.js";
import { everyExpr, everyStmtList } from "../../ir/traverse.js";
import { eachNodeOfKinds, type IrNodeIndex, type IrNodeKind } from "../../ir/node-index.js";

const CLOSURE_KINDS: readonly IrNodeKind[] = ["closure"];

interface CreationSite {
  owner: string;
  captures: string[];
  node: IrExpr;
}

interface CreationOrder {
  skipped: Set<string>;
  blocked: Map<IrExpr, Set<string>>;
  assigned: Set<string>;
}

/** The statement lists nested directly in `stmt`. */
function childLists(stmt: IrStmt): readonly (readonly IrStmt[])[] {
  switch (stmt.kind) {
    case "if":
      return stmt.else_ === null ? [stmt.then] : [stmt.then, stmt.else_];
    case "block":
    case "while":
    case "doWhile":
    case "for":
    case "forOf":
      return [stmt.body];
    case "switch":
      return stmt.cases.map((branch) => branch.body);
    case "tryCatch":
      return [stmt.tryBody, stmt.catchBody ?? [], stmt.finallyBody ?? []];
    default:
      return [];
  }
}

/** The local a node rebinds. Writes through the bound reference, such as a
 * field store or an array push, leave the binding unchanged. Catch bindings
 * and rethrow targets are conservatively treated as rebinding. */
function rebound(node: IrStmt | IrExpr): string | null {
  switch (node.kind) {
    case "varDecl":
    case "assign":
    case "forOf":
    case "rethrow":
    case "assignExpr":
    case "incDec":
      return node.localId;
    case "tryCatch":
      return node.catchLocalId;
    default:
      return null;
  }
}

/** A captured parameter that no code rebinds holds its entry value for the
 * whole call, so every environment may observe a box created when the first
 * closure is built instead of on function entry. Paths that never create a
 * closure then allocate no box. The proof follows each capture into nested
 * function bodies; class environments keep the eager box. */
export class LazyCaptures {
  private readonly stable = new Map<string, Set<string>>();
  private readonly once = new Map<string, Set<string>>();
  private readonly unchangedParameters = new Map<IrFunction, Set<string>>();
  /** Per function, every local rebound there or through nested captures;
   * the second map counts declarations separately (see rebindings). Each
   * body is walked once per map, so the queries stay linear in the IR. */
  private readonly rebound = new Map<IrFunction, Set<string>>();
  private readonly reboundAfterDeclaration = new Map<IrFunction, Set<string>>();
  private readonly pending = new Set<IrFunction>();
  private sites: Map<string, CreationSite[]> | null = null;
  private readonly embedded = new Map<string, Set<string>>();
  private readonly creationOrder = new Map<string, CreationOrder>();

  constructor(
    private readonly functions: ReadonlyMap<string, IrFunction>,
    /** The module's node index, read instead of walking the bodies it holds. */
    private readonly nodes?: IrNodeIndex,
  ) {}

  /** The captures of closure body `fnName` that hold one value for the
   * closure's whole life: at every creation site the captured binding is
   * a parameter that nothing rebinds (see parameters) or, through nesting,
   * such a capture of the creating closure, and nothing rebinds the
   * capture itself. The environment owns that value whenever the body
   * runs, so the body may read it without a reference of its own. */
  stableCaptures(fnName: string): Set<string> {
    const known = this.stable.get(fnName);
    if (known !== undefined) return known;
    const result = new Set<string>();
    // Capture chains follow lexical nesting and cannot cycle; the empty
    // provisional entry only bounds work on malformed input.
    this.stable.set(fnName, result);
    const fn = this.functions.get(fnName);
    const sites = this.creationSites().get(fnName);
    if (fn?.captures === undefined || fn.async || fn.generator || sites === undefined)
      return result;
    fn.captures.forEach((capture, index) => {
      for (const site of sites) {
        const owner = this.functions.get(site.owner);
        const source = site.captures[index];
        if (owner === undefined || source === undefined) return;
        if (
          !this.parameters(owner).has(source) &&
          !this.declaredOnce(owner).has(source) &&
          !this.stableCaptures(site.owner).has(source)
        )
          return;
      }
      if (this.isUnchanged(fnName, capture.localId)) result.add(capture.localId);
    });
    return result;
  }

  /** Boxed locals of `fn` (not parameters) bound by exactly one
   * declaration that nothing else rebinds, here or in nested bodies. Each
   * declaration fills a fresh box once, before any closure can capture it
   * (TDZ bindings are excluded). */
  private declaredOnce(fn: IrFunction): Set<string> {
    const known = this.once.get(fn.name);
    if (known !== undefined) return known;
    const result = new Set<string>();
    this.once.set(fn.name, result);
    if (fn.async || fn.generator) return result;
    const params = new Set(fn.params.map((p) => p.localId));
    const candidates = new Set(
      fn.locals.filter((l) => l.boxed && !l.tdz && !params.has(l.id)).map((l) => l.id),
    );
    if (candidates.size === 0) return result;
    const declarations = new Map<string, number>();
    const visit = (node: IrStmt | IrExpr): boolean => {
      if (node.kind === "varDecl" && candidates.has(node.localId))
        declarations.set(node.localId, (declarations.get(node.localId) ?? 0) + 1);
      return true;
    };
    everyStmtList(fn.body, { stmt: visit, expr: visit });
    const changed = this.rebindings(fn, candidates, true);
    for (const id of candidates) if (declarations.get(id) === 1 && !changed.has(id)) result.add(id);
    return result;
  }

  /** The captures of closure body `fnName` that every creation site can copy
   * into the closure's own allocation instead of sharing a box: captures
   * that nothing rebinds (here or in nested bodies) and whose source binding
   * already holds its final value where the closure is built. A source
   * qualifies at a site when it is an unchanged parameter, an unchanged
   * capture of the creating closure, or a once-initialized local: declared
   * once, or declared and then assigned by the very next statement of its
   * list (`var x = e` lowers that way), with nothing else writing it. Its
   * initialization must have run before the closure expression, and the
   * binding must not be a switch-case or loop-head one, whose slot can
   * outlive a skipped declaration. Async and generator bodies keep their
   * boxes, and so do closures built inside them. At most the first 32
   * captures are embedded. */
  embeddedCaptures(fnName: string): Set<string> {
    const known = this.embedded.get(fnName);
    if (known !== undefined) return known;
    const result = new Set<string>();
    this.embedded.set(fnName, result);
    const fn = this.functions.get(fnName);
    const sites = this.creationSites().get(fnName);
    if (fn?.captures === undefined || sites === undefined || fn.async || fn.generator)
      return result;
    fn.captures.forEach((capture, index) => {
      if (index >= 32 || !this.isUnchanged(fnName, capture.localId)) return;
      for (const site of sites) {
        const owner = this.functions.get(site.owner);
        const source = site.captures[index];
        if (owner === undefined || source === undefined || owner.async || owner.generator) return;
        if (
          this.parameters(owner).has(source) ||
          this.stableCaptures(site.owner).has(source) ||
          this.embeddedCaptures(site.owner).has(source)
        )
          continue;
        const order = this.orderOf(owner);
        if (order.skipped.has(source) || order.blocked.get(site.node)?.has(source) === true) return;
        if (!this.declaredOnce(owner).has(source) && !order.assigned.has(source)) return;
      }
      result.add(capture.localId);
    });
    return result;
  }

  /** The boxed locals of `fn` that need no box at all: once-initialized
   * (see embeddedCaptures), skipped by no switch case or loop head, and
   * captured only by closures that embed them (`mask` answers which
   * captures a closure body embeds) and never by a class. The function keeps
   * them in plain slots and copies the value into each closure. */
  embeddedLocals(fn: IrFunction, mask: (fnName: string) => number): Set<string> {
    const result = new Set<string>();
    // The facts are keyed by the module's own function objects.
    if (fn.async || fn.generator || this.functions.get(fn.name) !== fn) return result;
    const order = this.orderOf(fn);
    const params = new Set(fn.params.map((p) => p.localId));
    const once = this.declaredOnce(fn);
    for (const local of fn.locals)
      if (
        local.boxed &&
        !local.tdz &&
        !params.has(local.id) &&
        !order.skipped.has(local.id) &&
        (once.has(local.id) || order.assigned.has(local.id))
      )
        result.add(local.id);
    if (result.size === 0) return result;
    const captured = new Set<string>();
    const visit = (node: IrStmt | IrExpr): boolean => {
      if (node.kind === "classRef") {
        for (const id of node.captures ?? []) result.delete(id);
      } else if (node.kind === "closure") {
        const embedded = mask(node.fnName);
        node.captures.forEach((id, index) => {
          captured.add(id);
          if (index >= 32 || ((embedded >>> index) & 1) === 0) result.delete(id);
        });
      }
      return true;
    };
    everyStmtList(fn.body, { stmt: visit, expr: visit });
    // A binding no closure captures keeps whatever the lowering decided.
    for (const id of result) if (!captured.has(id)) result.delete(id);
    return result;
  }

  /** For one function, the locals whose declaration can be skipped (switch
   * cases, loop heads), the once-assigned locals (declared, then assigned
   * by the next statement of the same list, and written nowhere else, here
   * or in nested bodies) and, per closure expression, the captured locals
   * that are not yet initialized when it runs: declared (or assigned) further
   * on, or initialized by the statement whose expression contains the
   * closure. */
  private orderOf(fn: IrFunction): CreationOrder {
    const known = this.creationOrder.get(fn.name);
    if (known !== undefined) return known;
    const order: CreationOrder = { skipped: new Set(), blocked: new Map(), assigned: new Set() };
    this.creationOrder.set(fn.name, order);
    const initializers = this.assignedOnce(fn);
    for (const id of initializers.values()) order.assigned.add(id);
    const declared = new Set<string>();
    const block = (node: IrExpr, id: string): void => {
      let ids = order.blocked.get(node);
      if (!ids) order.blocked.set(node, (ids = new Set()));
      ids.add(id);
    };
    const blockInside = (init: IrExpr | null, id: string): void => {
      if (init !== null)
        everyExpr(init, {
          stmt: () => true,
          expr: (inner) => {
            if (inner.kind === "closure" && inner.captures.includes(id)) block(inner, id);
            return true;
          },
        });
    };
    const skip = (stmts: readonly IrStmt[]): void => {
      for (const child of stmts) if (child.kind === "varDecl") order.skipped.add(child.localId);
    };
    const visit = (node: IrStmt | IrExpr): boolean => {
      if (node.kind === "varDecl") {
        blockInside(node.init, node.localId);
        if (!order.assigned.has(node.localId)) declared.add(node.localId);
      } else if (node.kind === "assign" && initializers.get(node) === node.localId) {
        blockInside(node.value, node.localId);
        declared.add(node.localId);
      } else if (node.kind === "closure") {
        for (const id of node.captures) if (!declared.has(id)) block(node, id);
      } else if (node.kind === "switch") {
        for (const branch of node.cases) skip(branch.body);
      } else if (node.kind === "for") {
        skip(node.init?.kind === "block" ? node.init.body : node.init ? [node.init] : []);
      }
      return true;
    };
    everyStmtList(fn.body, { stmt: visit, expr: visit });
    return order;
  }

  /** The `assign` statements that initialize a once-assigned local (see
   * orderOf), mapped to that local. */
  private assignedOnce(fn: IrFunction): Map<IrStmt, string> {
    const result = new Map<IrStmt, string>();
    if (fn.async || fn.generator) return result;
    const params = new Set(fn.params.map((p) => p.localId));
    const candidates = new Set(
      fn.locals.filter((l) => l.boxed && !l.tdz && !params.has(l.id)).map((l) => l.id),
    );
    if (candidates.size === 0) return result;
    const declarations = new Map<string, number>();
    const assignments = new Map<string, number>();
    const elsewhere = new Set<string>();
    const visit = (node: IrStmt | IrExpr): boolean => {
      if (node.kind === "varDecl") {
        if (candidates.has(node.localId))
          declarations.set(node.localId, (declarations.get(node.localId) ?? 0) + 1);
      } else if (node.kind === "assign") {
        assignments.set(node.localId, (assignments.get(node.localId) ?? 0) + 1);
      } else {
        const target = rebound(node);
        if (target !== null) elsewhere.add(target);
        if (node.kind === "classRef") {
          for (const id of node.captures ?? []) elsewhere.add(id);
        } else if (node.kind === "closure") {
          const callee = this.functions.get(node.fnName);
          node.captures.forEach((id, index) => {
            const capture = callee?.captures?.[index];
            if (!capture || !this.isUnchanged(node.fnName, capture.localId)) elsewhere.add(id);
          });
        }
      }
      return true;
    };
    everyStmtList(fn.body, { stmt: visit, expr: visit });
    const scan = (list: readonly IrStmt[]): void => {
      list.forEach((stmt, index) => {
        const next = list[index + 1];
        if (
          stmt.kind === "varDecl" &&
          next?.kind === "assign" &&
          next.localId === stmt.localId &&
          next.initializes !== true &&
          candidates.has(stmt.localId) &&
          declarations.get(stmt.localId) === 1 &&
          assignments.get(stmt.localId) === 1 &&
          !elsewhere.has(stmt.localId)
        )
          result.set(next, stmt.localId);
        for (const child of childLists(stmt)) scan(child);
      });
    };
    scan(fn.body);
    return result;
  }

  private creationSites(): Map<string, CreationSite[]> {
    if (this.sites !== null) return this.sites;
    const sites = new Map<string, CreationSite[]>();
    const scan = this.nodes?.scan(CLOSURE_KINDS);
    for (const fn of this.functions.values()) {
      eachNodeOfKinds(fn, scan, (node) => {
        if (node.kind === "closure") {
          let list = sites.get(node.fnName);
          if (!list) sites.set(node.fnName, (list = []));
          list.push({ owner: fn.name, captures: node.captures, node });
        }
      });
    }
    this.sites = sites;
    return sites;
  }

  parameters(fn: IrFunction): ReadonlySet<string> {
    const known = this.unchangedParameters.get(fn);
    if (known !== undefined) return known;
    const result = new Set<string>();
    this.unchangedParameters.set(fn, result);
    if (fn.async || fn.generator) return result;
    const locals = new Map(fn.locals.map((local) => [local.id, local]));
    for (const param of fn.params) {
      const local = locals.get(param.localId);
      if (local?.boxed && !local.tdz) result.add(param.localId);
    }
    if (result.size === 0) return result;
    for (const id of this.rebindings(fn, result)) result.delete(id);
    return result;
  }

  /** The subset of `ids` rebound in `fn` or in any function that captures
   * one of them, directly or through further nesting. */
  private rebindings(
    fn: IrFunction,
    ids: ReadonlySet<string>,
    declarationsBind = false,
  ): Set<string> {
    const all = this.reboundIn(fn, declarationsBind);
    const changed = new Set<string>();
    for (const id of ids) if (all.has(id)) changed.add(id);
    return changed;
  }

  /** Every local rebound in `fn` or, through the closures it creates, in
   * any function that captures it, directly or through further nesting.
   * With `declarationsBind`, declarations are counted separately. */
  private reboundIn(fn: IrFunction, declarationsBind: boolean): ReadonlySet<string> {
    const memo = declarationsBind ? this.reboundAfterDeclaration : this.rebound;
    const known = memo.get(fn);
    if (known !== undefined) return known;
    const changed = new Set<string>();
    // Capture chains follow lexical nesting and cannot cycle; on malformed
    // input a function reached again while its walk is pending reports
    // every capture as rebound (see isUnchanged).
    if (!declarationsBind) this.pending.add(fn);
    const nested: { target: string; local: string; source: string }[] = [];
    const visit = (node: IrStmt | IrExpr): boolean => {
      const target = declarationsBind && node.kind === "varDecl" ? null : rebound(node);
      if (target !== null) changed.add(target);
      if (node.kind === "classRef") {
        for (const id of node.captures ?? []) changed.add(id);
      } else if (node.kind === "closure") {
        const callee = this.functions.get(node.fnName);
        node.captures.forEach((id, index) => {
          const capture = callee?.captures?.[index];
          if (!capture) changed.add(id);
          else nested.push({ target: node.fnName, local: capture.localId, source: id });
        });
      }
      return true;
    };
    everyStmtList(fn.body, { stmt: visit, expr: visit });
    for (const edge of nested) {
      if (!changed.has(edge.source) && !this.isUnchanged(edge.target, edge.local))
        changed.add(edge.source);
    }
    if (!declarationsBind) this.pending.delete(fn);
    memo.set(fn, changed);
    return changed;
  }

  private isUnchanged(fnName: string, localId: string): boolean {
    const fn = this.functions.get(fnName);
    if (fn === undefined || this.pending.has(fn)) return false;
    return !this.reboundIn(fn, false).has(localId);
  }
}

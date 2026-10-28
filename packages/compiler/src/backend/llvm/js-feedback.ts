/* Type-feedback recording of an instrumented build (`--profile-generate`).
 *
 * Every dynamic-tier property site (the inline-cache helpers, dynInvoke's
 * method read) and every dyn call gets a stable site id, and the code at
 * the site tells the runtime recorder (scr_js_object.c, scr_pgo_prop and
 * scr_pgo_call) what it is about to operate on. The recorder writes the
 * distinct receiver shapes, the entry each lookup hits and the callee
 * functions per site when the program exits (`<profile>.jsfb`).
 *
 * A site id is `function|label|n`: the IR function's name, the site's
 * operation (`get:key`, `set:key`, `keyed`, `invoke:method`, `call:name`)
 * and the site's position among the function's sites with that label, in
 * traversal order. It depends on the IR alone, so the instrumented build
 * and the build that uses its profile derive the same ids for the same
 * program, and a site that changed simply has no entry. */
import type { IrExpr, IrFunction, IrModule } from "../../ir/ir.js";
import type { JsIcSites } from "../../ir/js-ic.js";
import { everyStmtList } from "../../ir/traverse.js";

export type PgoKind = "get" | "set" | "keyed" | "method" | "call";

export const PGO_KIND_CODE: Record<Exclude<PgoKind, "call">, number> = {
  get: 0,
  set: 1,
  keyed: 2,
  method: 3,
};

/** The label of an expression that is a feedback site, or null. */
export function feedbackLabel(sites: JsIcSites, e: IrExpr): string | null {
  switch (e.kind) {
    case "call": {
      const site = sites.site(e.callee);
      if (site === null) return null;
      return site.kind === "keyed" ? "keyed" : `${site.kind}:${site.key}`;
    }
    case "dynInvoke":
      return `invoke:${e.method}`;
    case "dynCall":
      return `call:${e.calleeName}`;
    default:
      return null;
  }
}

/** Site ids of a module's functions, computed lazily per function. */
export class FeedbackSiteIds {
  private readonly fns: ReadonlyMap<string, IrFunction>;
  private readonly ids = new Map<string, Map<IrExpr, string>>();

  constructor(
    mod: Pick<IrModule, "functions">,
    private readonly sites: JsIcSites,
  ) {
    this.fns = new Map(mod.functions.map((fn) => [fn.name, fn]));
  }

  idOf(fnName: string, e: IrExpr): string | null {
    let ids = this.ids.get(fnName);
    if (ids === undefined) {
      ids = new Map();
      const fn = this.fns.get(fnName);
      if (fn !== undefined) {
        const seen = new Map<string, number>();
        everyStmtList(fn.body, {
          stmt: () => true,
          expr: (x) => {
            const label = feedbackLabel(this.sites, x);
            if (label !== null) {
              const n = seen.get(label) ?? 0;
              seen.set(label, n + 1);
              ids!.set(x, `${fnName}|${label}|${n}`);
            }
            return true;
          },
        });
      }
      this.ids.set(fnName, ids);
    }
    return ids.get(e) ?? null;
  }
}

/** The module-level definition of the recorder's output path. */
export function feedbackPathDefinition(pattern: string): string {
  const bytes = Buffer.from(`${pattern}\0`, "utf8");
  const text = [...bytes]
    .map((b) =>
      b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c
        ? String.fromCharCode(b)
        : `\\${b.toString(16).padStart(2, "0").toUpperCase()}`,
    )
    .join("");
  return `@scr_pgo_out_path = constant [${bytes.length} x i8] c"${text}"`;
}

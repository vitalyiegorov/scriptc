import type { IrExpr, IrFunction } from "../../ir/ir.js";
import { typeKey } from "../../ir/ir.js";
import { mangleFnClosure } from "../mangle.js";
import { findCallOnlyDynParameters } from "./call-only-params.js";
import { DYN_KIND } from "./dyn.js";
import type { LlValue, LlvmEmitterContext } from "./expr-context.js";

/** Room for a function node: sizeof(ScrDyn) (checked by a static assertion
 * in scr_dyn.h) plus a collector header in front of it. */
const NODE_BYTES = 176;
const NODE_OFFSET = 16;

/** A function value passed to a parameter its callee only calls lives and
 * dies with the call (call-only-params.ts): the closure sits in the
 * caller's frame (StackCallbacks) under an immortal function node in the
 * same frame, so the call allocates, refcounts and frees nothing.
 * Immortal means retains and releases of the node are no-ops. */
export class StackFuncNodes {
  private readonly parameters: ReadonlyMap<string, ReadonlySet<number>>;
  private remaining = 0;

  constructor(functions: ReadonlyMap<string, IrFunction>) {
    this.parameters = process.env.TMP_NO_STACK_FUNC
      ? new Map()
      : findCallOnlyDynParameters(functions);
  }

  reset(enabled: boolean): void {
    this.remaining = enabled ? 16 : 0;
  }

  emit(host: LlvmEmitterContext, callee: string, index: number, arg: IrExpr): LlValue | null {
    if (
      this.remaining === 0 ||
      host.sizeType !== "i64" ||
      arg.kind !== "dynFrom" ||
      arg.liveRef ||
      arg.fnLength !== undefined ||
      !this.parameters.get(callee)?.has(index)
    )
      return null;
    const value = arg.value;
    if (value.kind !== "closure" || value.type.kind !== "func" || value.adapts) return null;
    const target = host.fnByName.get(value.fnName);
    if (!target || target.async || target.generator) return null;
    const B = host.B;
    let closure: string;
    if (target.captures === undefined) {
      // A declared function: the interned immortal closure, nothing to build.
      host.fnValues.add(value.fnName);
      closure = `@${mangleFnClosure(value.fnName)}`;
    } else {
      const built = host.stackCallbacks.emit(host, value);
      if (!built) return null;
      closure = built.name;
    }
    this.remaining--;
    const mem = B.slot();
    B.entryAllocas.push(`${mem} = alloca [${NODE_BYTES} x i8], align 16`);
    B.line(`store [${NODE_BYTES} x i8] zeroinitializer, ptr ${mem}`);
    const node = B.tmp();
    B.line(`${node} = getelementptr inbounds i8, ptr ${mem}, i64 ${NODE_OFFSET}`);
    // ScrDyn: rc @0, kind @8, v.fn.{clo, thunk, sig, name, arity} @16..48.
    const field = (offset: number, type: string, v: string): void => {
      const p = B.tmp();
      B.line(`${p} = getelementptr inbounds i8, ptr ${node}, i64 ${offset}`);
      B.line(`store ${type} ${v}, ptr ${p}`);
    };
    const func = value.type;
    const name = arg.fnName !== undefined && arg.fnName !== "" ? host.cstr(arg.fnName) : "null";
    field(0, "i64", "-1");
    field(8, "i32", String(DYN_KIND.FUNC));
    field(16, "ptr", closure);
    field(24, "ptr", `@${host.dyn.dynFuncThunkHelper(func)}`);
    field(32, "ptr", host.cstr(typeKey(func)));
    field(40, "ptr", name);
    field(48, "i32", String(func.params.length - (func.restAbi === "typed" ? 1 : 0)));
    return { name: node, type: arg.type };
  }
}

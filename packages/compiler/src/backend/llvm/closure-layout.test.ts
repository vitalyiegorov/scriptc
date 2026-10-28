import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CLOSURE_FIELD, closureTypeDef, immortalClosureInit } from "./closure-layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const header = readFileSync(join(here, "../../../../runtime/src/scr_dyn.h"), "utf8");

/** The C field behind each LLVM field index. */
const C_NAME: Record<keyof typeof CLOSURE_FIELD, string> = {
  rc: "rc",
  kind: "dyn_kind",
  flags: "dyn_flags",
  self: "dyn_self",
  thunk: "dyn_thunk",
  sig: "dyn_sig",
  name: "dyn_name",
  arity: "dyn_arity",
  classObj: "dyn_class_obj",
  message: "dyn_message",
  fn: "fn",
  ncaps: "ncaps",
  props: "props",
  prototype: "dyn_prototype",
  symbolProperties: "dyn_symbol_properties",
  symbolKeys: "dyn_symbol_keys",
  identity: "identity",
  fnBorrowed: "fn_borrowed",
  functionKind: "function_kind",
  identityLength: "identity_length",
  embedded: "embedded",
};

/** Byte offsets (and the size) of the LLVM type for a target, under the
 * natural alignment of its data layout (i64 aligned to 8, as on wasm32). */
function layoutOf(sizeType: string): { offsets: number[]; size: number } {
  const ptr = sizeType === "i64" ? 8 : 4;
  const body = /\{(.*)\}/.exec(closureTypeDef(sizeType))![1]!;
  const sizeOf = (t: string): number => (t === "ptr" ? ptr : t === "i64" ? 8 : t === "i32" ? 4 : NaN);
  const offsets: number[] = [];
  let at = 0;
  let align = 1;
  for (const raw of body.split(",")) {
    const t = raw.trim();
    const n = sizeOf(t);
    expect(Number.isNaN(n), `unknown LLVM field type ${t}`).toBe(false);
    const a = t === "i64" ? 8 : n;
    at = Math.ceil(at / a) * a;
    offsets.push(at);
    at += n;
    align = Math.max(align, a);
  }
  return { offsets, size: Math.ceil(at / align) * align };
}

/** The offsets scr_dyn.h asserts for the C struct, per pointer width. */
function cOffsets(branch: "64" | "32"): { fields: Map<string, number>; size: number } {
  const start = header.indexOf("#if UINTPTR_MAX == UINT64_MAX\n_Static_assert(offsetof(ScrClosure, rc)");
  expect(start).toBeGreaterThan(0);
  const elseAt = header.indexOf("\n#else\n", start);
  const endAt = header.indexOf("\n#endif", elseAt);
  const text = branch === "64" ? header.slice(start, elseAt) : header.slice(elseAt, endAt);
  const fields = new Map<string, number>();
  for (const m of text.matchAll(/offsetof\(ScrClosure, (\w+)\) == (\d+)/g)) fields.set(m[1]!, Number(m[2]));
  const size = /sizeof\(ScrClosure\) == (\d+)/.exec(text);
  expect(size).not.toBeNull();
  return { fields, size: Number(size![1]) };
}

describe("emitted %ScrClosure matches the C layout", () => {
  for (const [bits, sizeType] of [
    ["64", "i64"],
    ["32", "i32"],
  ] as const) {
    test(`${bits}-bit field offsets and size`, () => {
      const llvm = layoutOf(sizeType);
      const c = cOffsets(bits);
      for (const [key, index] of Object.entries(CLOSURE_FIELD)) {
        const cName = C_NAME[key as keyof typeof CLOSURE_FIELD];
        expect(c.fields.has(cName), `scr_dyn.h asserts ${cName}`).toBe(true);
        expect(llvm.offsets[index], `${key} (${cName})`).toBe(c.fields.get(cName));
      }
      // The caps[] tail starts where the LLVM struct ends.
      expect(llvm.size).toBe(c.fields.get("caps"));
      expect(llvm.size).toBe(c.size);
      expect(llvm.offsets.length).toBe(Object.keys(CLOSURE_FIELD).length);
    });
  }

  test("the ScrDyn-compatible head keeps the offsets FUNC readers use", () => {
    const l = layoutOf("i64").offsets;
    expect(l[CLOSURE_FIELD.rc]).toBe(0);
    expect(l[CLOSURE_FIELD.kind]).toBe(8);
    expect(l[CLOSURE_FIELD.self]).toBe(16); // v.fn.clo
    expect(l[CLOSURE_FIELD.sig]).toBe(32); // v.fn.sig, read by emitted dyn-to-function casts
    expect(l[CLOSURE_FIELD.prototype]).toBe(96);
  });

  test("the immortal initializer has one value per field", () => {
    for (const sizeType of ["i64", "i32"]) {
      const init = immortalClosureInit(sizeType, { fn: "@f", functionKind: 2, fnBorrowed: "null" });
      expect(init.slice(1, -1).split(",").length).toBe(Object.keys(CLOSURE_FIELD).length);
    }
  });
});

/**
 * The LLVM mirror of the runtime's ScrClosure (packages/runtime/src/scr_closure.h).
 *
 * A closure IS its dynamic function value: its first fields are a ScrDyn
 * header of kind SCR_DYN_FUNC (scr_dyn.h asserts every offset), followed by
 * the closure's own fields and the caps[] tail. Emitted code reaches a field
 * only through CLOSURE_FIELD so the struct has one definition here; the unit
 * test (closure-layout.test.ts) computes the byte offsets of this type for
 * both pointer widths and compares them with the `_Static_assert`ed offsets
 * in the C headers.
 *
 * Field order (64-bit byte offsets in brackets):
 *   rc[0] kind[8] flags[12] self[16] thunk[24] sig[32] name[40] arity[48]
 *   class_obj[56] message[64] fn[72] ncaps[80] props[88] prototype[96]
 *   symbol_properties[104] symbol_keys[112] identity[120] fn_borrowed[128]
 *   function_kind[136] identity_length[140] embedded[144] caps[152]
 * On wasm32 `flags` is an i64 so that `self` keeps the 8-aligned offset
 * ScrDyn's payload union has there.
 */

export const CLOSURE_FIELD = {
  rc: 0,
  kind: 1,
  flags: 2,
  self: 3,
  thunk: 4,
  sig: 5,
  name: 6,
  arity: 7,
  classObj: 8,
  message: 9,
  fn: 10,
  ncaps: 11,
  props: 12,
  prototype: 13,
  symbolProperties: 14,
  symbolKeys: 15,
  identity: 16,
  fnBorrowed: 17,
  functionKind: 18,
  identityLength: 19,
  embedded: 20,
} as const;

/** The `%ScrClosure` type definition for a target whose size type is
 * `sizeType` (`i64` or `i32`). */
export function closureTypeDef(sizeType: string): string {
  const flags = sizeType === "i64" ? "i32" : "i64";
  return `%ScrClosure = type { ${sizeType}, i32, ${flags}, ptr, ptr, ptr, ptr, i32, ptr, ptr, ptr, ${sizeType}, ptr, ptr, ptr, ptr, ptr, ptr, i32, i32, i32 }`;
}

/** The initializer of an interned immortal closure: rc -1, boxing header
 * empty (dyn_self null), no props, no identity. */
export function immortalClosureInit(
  sizeType: string,
  fields: { fn: string; functionKind: number; fnBorrowed: string },
): string {
  const flags = sizeType === "i64" ? "i32 0" : "i64 0";
  return (
    `{ ${sizeType} -1, i32 0, ${flags}, ptr null, ptr null, ptr null, ptr null, i32 0, ptr null, ptr null, ` +
    `ptr ${fields.fn}, ${sizeType} 0, ptr null, ptr null, ptr null, ptr null, ptr null, ptr ${fields.fnBorrowed}, ` +
    `i32 ${fields.functionKind}, i32 0, i32 0 }`
  );
}

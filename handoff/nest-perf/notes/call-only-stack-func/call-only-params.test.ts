import { expect, test } from "vitest";
import { DYN, VOID, type IrExpr, type IrFunction, type IrStmt } from "../../ir/ir.js";
import { findCallOnlyDynParameters } from "./call-only-params.js";

const loc = { file: "call-only.js", start: 0, end: 0 };
const ref = (localId: string): IrExpr => ({ kind: "varRef", localId, type: DYN, loc });
const stmt = (expr: IrExpr): IrStmt => ({ kind: "exprStmt", expr, loc });
const invoke = (localId: string, args: IrExpr[] = []): IrExpr => ({
  kind: "dynCall",
  callee: ref(localId),
  calleeName: localId.split(".")[0]!,
  args,
  type: DYN,
  loc,
});
const callTo = (callee: string, args: IrExpr[]): IrExpr => ({
  kind: "call",
  callee,
  args,
  type: VOID,
  loc,
});

function fn(name: string, body: IrStmt[], extra: Partial<IrFunction> = {}): IrFunction {
  return {
    name,
    params: [{ localId: "cb.0", name: "cb", type: DYN }],
    returnType: VOID,
    locals: [{ id: "cb.0", name: "cb", type: DYN, mutable: true }],
    body,
    loc,
    ...extra,
  };
}
const analyze = (...functions: IrFunction[]) =>
  findCallOnlyDynParameters(new Map(functions.map((f) => [f.name, f])));

test("a parameter that is only called is call-only", () => {
  const facts = analyze(fn("run", [stmt(invoke("cb.0")), stmt(invoke("cb.0", [ref("cb.0")]))]));
  // The second statement passes the callee as an argument: not call-only.
  expect(facts.has("run")).toBe(false);
  expect(analyze(fn("run", [stmt(invoke("cb.0")), stmt(invoke("cb.0"))])).get("run")).toEqual(
    new Set([0]),
  );
});

test("storing, returning, throwing and reading the parameter disqualify it", () => {
  const uses: IrStmt[] = [
    { kind: "return", value: ref("cb.0"), loc },
    { kind: "throw", value: ref("cb.0"), loc },
    { kind: "assign", localId: "cb.0", value: ref("cb.0"), loc },
    stmt({ kind: "libCall", fn: "dyn.typeof", args: [ref("cb.0")], type: DYN, loc }),
    stmt(callTo("unknown", [ref("cb.0")])),
  ];
  for (const use of uses) {
    expect(analyze(fn("run", [stmt(invoke("cb.0")), use])).has("run")).toBe(false);
  }
});

test("a capture by a closure disqualifies the parameter", () => {
  const closure = stmt({
    kind: "closure",
    fnName: "inner",
    captures: ["cb.0"],
    type: { kind: "func", params: [], ret: VOID },
    loc,
  });
  expect(analyze(fn("run", [stmt(invoke("cb.0")), closure])).has("run")).toBe(false);
  const boxed = fn("run", [stmt(invoke("cb.0"))], {
    locals: [{ id: "cb.0", name: "cb", type: DYN, mutable: true, boxed: true }],
  });
  expect(analyze(boxed).has("run")).toBe(false);
});

test("suspending and environment-carrying bodies never qualify", () => {
  const body = [stmt(invoke("cb.0"))];
  expect(analyze(fn("a", body, { async: true })).has("a")).toBe(false);
  expect(analyze(fn("b", body, { captures: [] })).has("b")).toBe(false);
  expect(
    analyze(
      fn("c", body, { params: [{ localId: "cb.0", name: "cb", type: DYN, owned: true }] }),
    ).has("c"),
  ).toBe(false);
});

test("forwarding keeps the parameter call-only only through call-only parameters", () => {
  const sink = fn("sink", [stmt(invoke("cb.0"))]);
  const keeper = fn("keeper", [{ kind: "return", value: ref("cb.0"), loc }]);
  const through = fn("through", [stmt(callTo("sink", [ref("cb.0")]))]);
  const leak = fn("leak", [stmt(callTo("keeper", [ref("cb.0")]))]);
  const facts = analyze(sink, keeper, through, leak);
  expect(facts.get("through")).toEqual(new Set([0]));
  expect(facts.has("leak")).toBe(false);
  expect(facts.has("keeper")).toBe(false);
});

test("a node shared by two positions is judged at each position", () => {
  const shared = ref("cb.0");
  const call: IrExpr = {
    kind: "dynCall",
    callee: shared,
    calleeName: "cb",
    args: [shared],
    type: DYN,
    loc,
  };
  expect(analyze(fn("run", [stmt(call)])).has("run")).toBe(false);
});

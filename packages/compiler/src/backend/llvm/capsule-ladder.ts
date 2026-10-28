/* A class table's chain of capsule-key tests (`if (typedRefIs(v, "object:A")) …;
 * if (typedRefIs(v, "object:B")) …;` — `%dyn.class.properties` has one per
 * compiled class) costs a few instructions per class it skips. A capsule's
 * key can only equal a key of the same length, so the chain is emitted as a
 * switch on the capsule's key length that enters, for each length, the
 * original tests of that length in their original order. The IR is
 * unchanged: only the emission of the run differs. */
import type { IrExpr, IrStmt } from "../../ir/ir.js";
import type { LlEmitter } from "./emitter.js";
import { DYN_KIND } from "./dyn.js";

/** ScrDyn.v.typed_ref.type_key_len: the low 27 bits of its bit-field word. */
const TYPE_KEY_LEN_MASK = (1 << 27) - 1;
/** Shorter chains cost less than the switch. */
const MIN_RUN = 12;

interface LadderEntry {
  stmt: IrStmt & { kind: "if" };
  length: number;
}

/** The capsule-key test a condition cannot be true without, evaluated before
 * anything else in it: the test itself, or the left of a `test && more`
 * (the subclass-instance entries of a table: `key(Parent) && instanceof
 * Child`). */
function leadingKeyTest(c: IrExpr): (IrExpr & { kind: "libCall" }) | null {
  if (c.kind === "libCall") return c.fn === "dyn.typedRefIs" ? c : null;
  if (c.kind === "ternary" && c.else_.kind === "boolLit" && c.else_.value === false)
    return leadingKeyTest(c.cond);
  if (c.kind === "logical" && c.op === "&&") return leadingKeyTest(c.left);
  return null;
}

function ladderEntry(s: IrStmt, local: string | null): { local: string; length: number } | null {
  if (s.kind !== "if" || s.else_ !== null) return null;
  const test = leadingKeyTest(s.cond);
  if (test === null) return null;
  const [value, key] = test.args;
  if (value?.kind !== "varRef" || key?.kind !== "strLit") return null;
  if (local !== null && value.localId !== local) return null;
  return { local: value.localId, length: Buffer.byteLength(key.value, "utf8") };
}

/** Whether a branch body can change `local` (an assignment, an update, or a
 * closure capturing it): then the rest of the chain would see another key. */
function mayRebind(node: unknown, local: string): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => mayRebind(n, local));
  const rec = node as Record<string, unknown>;
  if (rec["localId"] === local && rec["kind"] !== "varRef") return true;
  const captures = rec["captures"];
  if (Array.isArray(captures) && captures.includes(local)) return true;
  for (const v of Object.values(rec)) if (mayRebind(v, local)) return true;
  return false;
}

function findRun(
  stmts: readonly IrStmt[],
  start: number,
): { local: string; entries: LadderEntry[] } | null {
  const first = ladderEntry(stmts[start]!, null);
  if (first === null) return null;
  const entries: LadderEntry[] = [];
  for (let i = start; i < stmts.length; i++) {
    const s = stmts[i]!;
    const e = ladderEntry(s, first.local);
    if (e === null || mayRebind((s as IrStmt & { kind: "if" }).then, first.local)) break;
    entries.push({ stmt: s as IrStmt & { kind: "if" }, length: e.length });
  }
  return entries.length >= MIN_RUN ? { local: first.local, entries } : null;
}

/** Emits the capsule-test chain starting at `stmts[start]` as a length
 * switch; answers the index after the chain, or null when none starts
 * there. */
export function emitCapsuleLadder(
  emitter: LlEmitter,
  stmts: readonly IrStmt[],
  start: number,
): number | null {
  const run = findRun(stmts, start);
  if (run === null) return null;
  const B = emitter.B;
  const first = leadingKeyTest(run.entries[0]!.stmt.cond)!;
  const receiver = emitter.emitReadReceiver(first.args[0]!);
  const done = B.newLabel("ladder.done");
  const inspect = B.newLabel("ladder.inspect");
  const capsule = B.newLabel("ladder.capsule");
  const present = B.tmp();
  B.line(`${present} = icmp ne ptr ${receiver.name}, null`);
  B.condBr(present, inspect, done);
  B.startBlock(inspect);
  const typed = B.tmp();
  B.line(`${typed} = icmp eq i32 ${emitter.dynKind(receiver.name)}, ${DYN_KIND.TYPED_REF}`);
  B.condBr(typed, capsule, done);
  B.startBlock(capsule);
  const lenSlot = B.tmp(),
    lenWord = B.tmp(),
    len = B.tmp();
  B.line(
    `${lenSlot} = getelementptr inbounds i8, ptr ${receiver.name}, i64 ${emitter.abiOffset(88, 52)} ; ->v.typed_ref.type_key_len`,
  );
  B.line(`${lenWord} = load i32, ptr ${lenSlot}`);
  B.line(`${len} = and i32 ${lenWord}, ${TYPE_KEY_LEN_MASK}`);
  const buckets = new Map<number, { label: string; entries: LadderEntry[] }>();
  for (const entry of run.entries) {
    let bucket = buckets.get(entry.length);
    if (bucket === undefined) {
      bucket = { label: B.newLabel("ladder.len"), entries: [] };
      buckets.set(entry.length, bucket);
    }
    bucket.entries.push(entry);
  }
  const cases = [...buckets].map(([length, b]) => `i32 ${length}, label %${b.label}`);
  B.terminate(`switch i32 ${len}, label %${done} [ ${cases.join(" ")} ]`);
  for (const bucket of buckets.values()) {
    B.startBlock(bucket.label);
    for (const entry of bucket.entries) {
      if (B.isTerminated()) break;
      emitter.emitStmt(entry.stmt);
    }
    if (!B.isTerminated()) B.br(done);
  }
  B.startBlock(done);
  return start + run.entries.length;
}

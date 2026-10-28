import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../src/index.js";
import { emitLlvmModule } from "../src/backend/llvm/emitter.js";
import {
  feedbackInputs,
  feedbackWaysFor,
  jsFeedbackSidecar,
  mergeJsFeedback,
  parseJsFeedback,
  siteWays,
  type JsFeedback,
} from "../src/backend/js-feedback-profile.js";

const SOURCE = `
function dyn(v) { return v; }
function read(o) { return o.x; }
function write(o, v) { o.x = v; }
function call(o) { return o.m(); }
function apply(f) { return f(1); }
var o = dyn({ x: 1, n: 0, m: function () { return 2; } });
write(o, 3);
console.log(read(o), call(o), apply(function (a) { return a; }));
`;

async function irOf(dir: string) {
  const entry = join(dir, "main.js");
  const outPath = join(dir, "main.ir.json");
  await writeFile(entry, SOURCE);
  const result = await compile(entry, { outDir: dir, outPath, outputKind: "ir" });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
  return deserializeModule(await readFile(outPath, "utf8"));
}

function body(llvm: string, name: string): string {
  const match = llvm.match(
    new RegExp(
      `define internal [^\\n]+ @sc_(?:b)?f_${name}(?:\\.i32)?\\([^\\n]*\\) #0 \\{([\\s\\S]*?)\\n\\}`,
    ),
  );
  expect(match, `${name} LLVM function`).not.toBeNull();
  return match![1]!;
}

const shapeTests = (text: string): number => (text.match(/icmp eq ptr %t\d+, %t\d+/g) ?? []).length;

test("an instrumented build reports every dynamic-tier property site and dyn call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-jsfb-"));
  try {
    const mod = await irOf(dir);
    const plain = emitLlvmModule(mod);
    expect(plain).not.toContain("scr_pgo_");
    const llvm = emitLlvmModule(mod, { feedbackPath: "/tmp/p/%p.jsfb" });
    expect(llvm).toContain('@scr_pgo_out_path = constant [15 x i8] c"/tmp/p/%p.jsfb\\00"');
    expect(body(llvm, "read")).toMatch(
      /call void @scr_pgo_prop\(ptr @[^,]+, i32 0, ptr %t\d+, ptr @[^,]+, i64 1\)/,
    );
    expect(body(llvm, "write")).toMatch(/call void @scr_pgo_prop\(ptr @[^,]+, i32 1,/);
    expect(body(llvm, "call")).toMatch(/call void @scr_pgo_prop\(ptr @[^,]+, i32 3,/);
    expect(body(llvm, "call")).toContain("@scr_pgo_call(");
    expect(body(llvm, "apply")).toContain("@scr_pgo_call(");
    // Site ids come from the IR alone: two emissions agree.
    const ids = (text: string) =>
      [...text.matchAll(/c"([^"]*\|(?:get|set|invoke|call)[^"]*)\\00"/g)].map((m) => m[1]);
    expect(ids(emitLlvmModule(mod, { feedbackPath: "/tmp/q" }))).toEqual(ids(llvm));
    expect(ids(llvm).some((i) => i!.endsWith("|get:x|0"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a profile's inline ways apply to its sites; a stale profile changes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-jsfb-use-"));
  try {
    const mod = await irOf(dir);
    const base = emitLlvmModule(mod);
    const instrumented = emitLlvmModule(mod, { feedbackPath: "/tmp/p" });
    const id = [...instrumented.matchAll(/c"([^"]*\|get:x\|0)\\00"/g)][0]![1]!;
    const wide = emitLlvmModule(mod, { feedbackWays: { [id]: 3 } });
    expect(shapeTests(body(wide, "read"))).toBeGreaterThan(shapeTests(body(base, "read")));
    expect(body(wide, "write")).toBe(body(base, "write"));
    // Sites of a program that has since changed: the module is unchanged.
    const stale = emitLlvmModule(mod, {
      feedbackWays: { "gone|get:x|0": 4, [id.replace("get:x", "get:y")]: 4, [`${id}#c`]: 4 },
    });
    expect(stale).toBe(base);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const obj = (count: number, keys: string[]) => ({ count, recv: "obj", keys, hit: "own:0" });
const doc = (...sites: JsFeedback["sites"]): JsFeedback => ({ version: 1, sites });

test("feedback documents parse strictly and drop malformed sites", () => {
  expect(() => parseJsFeedback("not json", "f")).toThrow("not a JS feedback profile");
  expect(() => parseJsFeedback('{"version":2,"sites":[]}', "f")).toThrow("version 1");
  const parsed = parseJsFeedback(
    JSON.stringify({
      version: 1,
      sites: [
        { id: "a", count: 1, other: 0, obs: [{ count: 1 }] },
        { id: 7, count: 1, other: 0, obs: [] },
        { id: "b", count: -1, other: 0, obs: [] },
        { id: "c", count: 1, other: 0, obs: [{ count: "x" }] },
      ],
    }),
    "f",
  );
  expect(parsed.sites.map((s) => s.id)).toEqual(["a"]);
});

test("merging sums counts, joins equal receivers and caps distinct ones", () => {
  const a = doc({ id: "s", count: 3, other: 0, obs: [obj(3, ["x"])] });
  const b = doc(
    { id: "s", count: 2, other: 1, obs: [obj(1, ["x"]), obj(1, ["x", "y"])] },
    { id: "t", count: 1, other: 0, obs: [{ count: 1, callee: "func", name: "f", fn: "0x1" }] },
  );
  const c = doc({
    id: "t",
    count: 1,
    other: 0,
    obs: [{ count: 1, callee: "func", name: "f", fn: "0x2" }],
  });
  const merged = mergeJsFeedback([a, b, c]);
  const s = merged.sites.find((x) => x.id === "s")!;
  expect(s).toMatchObject({ count: 5, other: 1 });
  expect(s.obs.map((o) => o.count)).toEqual([4, 1]);
  expect(merged.sites.find((x) => x.id === "t")!.obs).toHaveLength(1);
  const many = mergeJsFeedback([
    doc({
      id: "m",
      count: 10,
      other: 0,
      obs: Array.from({ length: 10 }, (_, i) => obj(1, [`k${i}`])),
    }),
  ]);
  expect(many.sites[0]!.obs).toHaveLength(8);
  expect(many.sites[0]!.other).toBe(2);
});

test("only sites with 2 to 4 object receivers get extra inline ways", () => {
  const ways = siteWays(
    doc(
      { id: "mono", count: 5, other: 0, obs: [obj(5, ["a"])] },
      { id: "poly", count: 6, other: 0, obs: [obj(3, ["a"]), obj(3, ["a", "b"])] },
      { id: "five", count: 5, other: 0, obs: [1, 2, 3, 4, 5].map((i) => obj(1, [`k${i}`])) },
      { id: "mega", count: 9, other: 3, obs: [obj(3, ["a"]), obj(3, ["b"])] },
      {
        id: "fns",
        count: 4,
        other: 0,
        obs: [
          { count: 2, recv: "func" },
          { count: 2, recv: "kind4" },
        ],
      },
      { id: "call#c", count: 4, other: 0, obs: [obj(2, ["a"]), obj(2, ["b"])] },
    ),
  );
  expect(ways).toEqual({ poly: 2 });
});

test("merge inputs pair each raw profile with its feedback sidecar", () => {
  const present = new Set(["/p/1.jsfb", "/p/m.profdata.jsfb"]);
  const split = feedbackInputs(
    ["/p/1.profraw", "/p/2.profraw", "/p/m.profdata", "/p/extra.jsfb"],
    (path) => present.has(path),
  );
  expect(split.llvm).toEqual(["/p/1.profraw", "/p/2.profraw", "/p/m.profdata"]);
  expect(split.feedback).toEqual(["/p/1.jsfb", "/p/m.profdata.jsfb", "/p/extra.jsfb"]);
  expect(jsFeedbackSidecar("/x/app.profdata")).toBe("/x/app.profdata.jsfb");
});

test("an unreadable or malformed sidecar is ignored as a whole", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-jsfb-side-"));
  try {
    const profile = join(dir, "app.profdata");
    expect(feedbackWaysFor(profile)).toBeUndefined();
    await writeFile(`${profile}.jsfb`, "{broken");
    expect(feedbackWaysFor(profile)).toBeUndefined();
    await writeFile(
      `${profile}.jsfb`,
      JSON.stringify(
        doc({ id: "p|get:x|0", count: 2, other: 0, obs: [obj(1, ["a"]), obj(1, ["a", "b"])] }),
      ),
    );
    expect(feedbackWaysFor(profile)).toEqual({ "p|get:x|0": 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

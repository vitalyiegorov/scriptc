// An `any` value stored in a binding annotated with a non-nullish type, which
// the code then tests for absence: the binding holds the undefined the lookup
// returned (Nest's `const metadata: Record<..> = Reflect.getMetadata(...)`).
interface Param {
  index: number;
  pipes: string[];
}
const store = new Map<string, any>([["run", { a: { index: 0, pipes: ["x", "y"] }, b: { index: 1, pipes: [] } }]]);
function lookup(key: string): any {
  return store.get(key);
}
function pipesOf(method: string): string[] {
  const metadata: Record<string, Param> = lookup(method);
  if (!metadata) {
    return [];
  }
  return Object.values(metadata).map((item) => item.pipes).flat(1);
}
console.log(pipesOf("run").join(","), pipesOf("missing").length);
function label(method: string): string {
  const entry: Record<string, Param> = lookup(method);
  return entry ? "has " + String(Object.keys(entry).length) : "none";
}
console.log(label("run"), label("none"));
function count(method: string): number {
  const entry: { a: Param } = lookup(method);
  if (entry === undefined) return -1;
  return entry.a.index;
}
console.log(count("run"), count("nope"));

// A function carrying properties (Object.assign(fn, {...}), the chalk shape)
// that enters the untyped world is still a function: typeof answers
// "function", it is callable, and its properties stay readable.
const g = Object.assign((x: number) => x + 1, { tag: "g", count: 2 });
function show(label: string, v: unknown): void {
  console.log(label, typeof v, (v as any).tag, (v as any).count, (v as any)(1));
}
show("g", g);
const d: any = g;
console.log(typeof d, d.tag, d.count, d(5));
console.log(Object.keys(d).join());
const boxed: unknown[] = [g, 1, "s"];
console.log(boxed.map((v) => typeof v).join());
const holder: { fn: unknown } = { fn: g };
console.log(typeof holder.fn, g(10));

// Closures copy the value of a captured binding that nothing writes after
// the closure exists, and share a box for every binding that is written.
// Each case pins one edge: mutation after capture, per-iteration bindings,
// forward (TDZ) captures, nested and sibling closures, generators, async
// functions, try/finally, cycles and every captured value kind.

class Tag {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

function kinds(n: number, flag: boolean, text: string, list: number[], tag: Tag, fn: () => number) {
  const get = () => `${n}|${flag}|${text}|${list.join(",")}|${tag.name}|${fn()}`;
  list.push(99);
  tag.name += "!";
  return get;
}
console.log("kinds", kinds(7, true, "t", [1, 2], new Tag("a"), () => 5)());

function mutatedAfter(): void {
  let count = 0;
  const read = () => count;
  const bump = () => {
    count++;
  };
  bump();
  bump();
  count += 10;
  console.log("mutated", read(), count);
  let late = 1;
  const readLate = () => late;
  late = 2;
  console.log("assigned after capture", readLate());
}
mutatedAfter();

function paramRebound(p: number, q: number): () => number {
  const f = () => p * 100 + q;
  p = p + 1;
  return f;
}
console.log("param rebound", paramRebound(1, 2)());

function loops(): void {
  const fns: (() => string)[] = [];
  for (let i = 0; i < 3; i++) {
    const sq = i * i;
    const label = "s" + i;
    fns.push(() => label + "=" + sq);
  }
  for (const w of ["x", "yy"]) {
    const len = w.length;
    fns.push(() => w + len);
  }
  let k = 0;
  while (k < 3) {
    const cur = k;
    fns.push(() => "w" + cur);
    k++;
  }
  console.log("loops", fns.map((f) => f()).join(" "));
  const shared: (() => number)[] = [];
  for (let i = 0; i < 3; i++) shared.push(() => i);
  console.log("loop head", shared.map((f) => f()).join(","));
}
loops();

function tdz(): void {
  const early = () => later;
  try {
    early();
  } catch (e) {
    console.log("tdz", (e as Error).name);
  }
  const later = 42;
  console.log("after init", early());
  const selfRef = (n: number): number => (n <= 1 ? 1 : n * selfRef(n - 1));
  console.log("self", selfRef(5));
  const useHoisted = () => hoisted(2);
  function hoisted(x: number): number {
    return x + base;
  }
  const base = 40;
  console.log("hoisted", useHoisted());
}
tdz();

function nested(): void {
  const a = 3;
  let b = 4;
  const outer = () => {
    const inner = () => a + b;
    const inner2 = () => a * 2;
    return inner() + inner2();
  };
  b = 10;
  console.log("nested", outer());
  const mk = (x: number) => () => () => x + a;
  console.log("curried", mk(1)()(), mk(5)()());
}
nested();

function siblings(): void {
  // One closure body created from two sites: one binding is written, so the
  // body must read a shared box at both.
  let v = 1;
  const w = 2;
  const make = (x: number) => () => x + 100;
  const c1 = make(v);
  v = 5;
  const c2 = make(w);
  const reader = () => v;
  console.log("siblings", c1(), c2(), reader());
}
siblings();

function* gen(start: number): Generator<number> {
  const step = 2;
  const add = (x: number) => x + step + start;
  for (let i = 0; i < 3; i++) yield add(i);
}
console.log("gen", [...gen(10)].join(","));

async function asyncCase(seed: number): Promise<string> {
  const factor = 3;
  const calc = (n: number) => n * factor + seed;
  await Promise.resolve();
  return `async ${calc(2)} ${calc(3)}`;
}

function tryFinally(): string {
  const log: string[] = [];
  const tag = "T";
  try {
    const f = () => tag + log.length;
    log.push(f());
    throw new Error("x");
  } catch (e) {
    const g = () => tag + (e as Error).message;
    log.push(g());
  } finally {
    const h = () => tag + "fin";
    log.push(h());
  }
  return log.join(",");
}
console.log("try", tryFinally());

function cycles(): void {
  for (let i = 0; i < 200; i++) {
    const holder: { fn?: () => number } = {};
    const n = i;
    holder.fn = () => n + (holder.fn ? 1 : 0);
    if (i === 199) console.log("cycle", holder.fn());
  }
  const o = { v: 1 };
  const getter = () => o.v;
  o.v = 2;
  console.log("object", getter());
}
cycles();

function identity(): void {
  function top(): number {
    return 1;
  }
  const fa = top;
  const fb = top;
  const holder = { m: top };
  console.log("identity", fa === fb, holder.m === top, fa === holder.m);
  const k = 7;
  const closure = () => k;
  const same = closure;
  console.log("closure identity", closure === same, (() => k) === (() => k));
}
identity();

asyncCase(1).then((s) => console.log(s));

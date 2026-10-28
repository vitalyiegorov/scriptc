// A union of a class, structural protocol interfaces (PromiseLike,
// AsyncIterable, ArrayLike, a user interface) and Iterable<T> holds each
// value by identity and answers kind tests exactly as JavaScript does.
class Source<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
}
interface Interop<T> {
  [Symbol.iterator]?: never;
  interop(): Source<T>;
}
type Input<T> =
  | Source<T>
  | Interop<T>
  | AsyncIterable<T>
  | PromiseLike<T>
  | ArrayLike<T>
  | Iterable<T>;

function kind<T>(x: Input<T>): string {
  if (x instanceof Source) return "source:" + String(x.v);
  if (x && typeof (x as any).interop === "function") return "interop";
  if (x && typeof (x as any).length === "number" && typeof x !== "string") return "arraylike";
  if (x && typeof (x as any).then === "function") return "promise";
  if (x && typeof (x as any)[Symbol.asyncIterator] === "function") return "async";
  if (x && typeof (x as any)[Symbol.iterator] === "function") return "iter";
  return "other";
}

function* gen() {
  yield 1;
  yield 2;
}
async function* agen() {
  yield 3;
}

console.log(kind(new Source(3)));
console.log(kind({ interop: () => new Source(1) }));
console.log(kind([1, 2]));
console.log(kind(Promise.resolve(1)));
console.log(kind(new Set([1])));
console.log(kind({ length: 1, 0: "a" }));

function sum(x: Input<number>): number {
  if (x instanceof Source) return x.v;
  let s = 0;
  if (typeof (x as any)[Symbol.iterator] === "function") for (const v of x as Iterable<number>) s += v;
  return s;
}
const arr = [1, 2, 3];
const set = new Set([4, 5]);
const held: Input<number> = arr;
arr.push(10);
console.log(sum(held), sum(arr), sum(set), sum(gen()), sum(new Source(7)));
const holder: Input<number>[] = [arr, set, new Source(1)];
arr.push(1000);
set.add(100);
console.log(holder.map(sum).join(","));
console.log(holder[0] === arr, holder[1] === set);

async function drain(x: AsyncIterable<number>): Promise<number> {
  let s = 0;
  for await (const v of x) s += v;
  return s;
}
async function main() {
  console.log(await drain(agen()));
  console.log(await drain({ async *[Symbol.asyncIterator]() { yield 5; yield 6; } }));
}
main();

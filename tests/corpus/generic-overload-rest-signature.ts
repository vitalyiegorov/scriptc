// A call that selects a rest-parameter overload of a generic function
// (RxJS `of`: scheduler overloads plus `...values: A`) monomorphizes the
// implementation; calls under different type arguments stay apart.
class Sched { now(): number { return 5; } }
class Box<T> {
  readonly items: T[];
  constructor(items: T[]) { this.items = items; }
  each(fn: (v: T) => void): void { for (const v of this.items) fn(v); }
}
function make(value: null): Box<null>;
function make<A extends readonly unknown[]>(...valuesAndScheduler: [...A, Sched]): Box<A[number]>;
function make(): Box<never>;
function make<T>(value: T): Box<T>;
function make<A extends readonly unknown[]>(...values: A): Box<A[number]>;
function make<T>(...args: Array<T | Sched>): Box<T> {
  const last = args[args.length - 1];
  const hasSched = last instanceof Sched;
  return new Box<T>((hasSched ? args.slice(0, -1) : args) as T[]);
}
const out: string[] = [];
make("deferred").each((v) => out.push(v.toUpperCase()));
make(1).each((v) => out.push(String(v + 1)));
make(1, 2, 3).each((v) => out.push(String(v * 2)));
make("a", "b").each((v) => out.push(v + v));
make(1, 2, new Sched()).each((v) => out.push("s" + (v + 100)));
console.log(out.join(","));

interface Sched { now(): number; schedule(x: number): string }
class RealSched implements Sched {
  now() { return 7; }
  schedule(x: number) { return "r" + x; }
}
function isSched(v: unknown): v is Sched { return !!v && typeof (v as any).schedule === "function"; }
function last<T>(arr: T[]): T | undefined { return arr[arr.length - 1]; }
function popSched(args: unknown[]): Sched | undefined {
  return isSched(last(args)) ? (args.pop() as Sched) : undefined;
}
function of(sched: Sched): unknown[];
function of<T>(value: T): T[];
function of<T>(...args: Array<T | Sched>): T[] {
  const s = popSched(args);
  console.log(s ? s.schedule(s.now()) : "none", args.length);
  if (args.length > 0) args.push(args[0]);
  return args as T[];
}
function count<T>(...a: (T | Sched)[]): number { return a.length; }
const sch: Sched = { now: () => 5, schedule: (x) => "s" + x };
console.log(of("v"));
console.log(of(sch));
console.log(of(new RealSched()));
console.log(of({ message: "hi" }));
const strs = ["a", "b"];
console.log(count<string>(...strs), count<string>(...strs, sch), count(1, 2, new RealSched()));

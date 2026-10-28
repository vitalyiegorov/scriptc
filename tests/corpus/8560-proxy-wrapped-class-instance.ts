// A class instance wrapped in a Proxy whose get trap wraps methods, returned
// from functions typed as the class: calls go through the trap, with the
// instance as `this`.
class Counter {
  count = 0;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  inc(by: number): number {
    this.count += by;
    return this.count;
  }
  describe(): string {
    return this.label + ":" + this.count;
  }
  self(): this {
    return this;
  }
}
const log: string[] = [];
function wrap(target: any): any {
  return new Proxy(target, {
    get: (receiver: Record<string, any>, prop: string) => {
      const value = receiver[prop];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        log.push("call " + prop);
        return value.apply(receiver, args);
      };
    },
  });
}
function create<T>(instance: T): T {
  return wrap(instance);
}
function makeCounter(label: string): Counter {
  return create<Counter>(new Counter(label));
}
const counter = makeCounter("c");
console.log(counter.inc(2), counter.inc(3), counter.describe());
console.log(counter.count, counter.label);
const again = counter.self();
console.log(again instanceof Counter, again.count);
console.log(log.join(","));

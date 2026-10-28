// An override may take a function (or other checked) type where an abstract
// base method declares `any` (Nest's AbstractHttpAdapter.setNotFoundHandler
// over a Function parameter): calls through the base, the subclass and a
// further subclass reach the right body.
type Handler = (value: number) => number;

abstract class Adapter {
  abstract setHandler(handler: any, prefix?: string): any;
  abstract setCount(count: any): any;
}

class Impl extends Adapter {
  handler: Handler | null = null;
  count = 0;
  setHandler(handler: Handler, prefix?: string): any {
    this.handler = handler;
    return prefix ?? "none";
  }
  setCount(count: number): any {
    this.count = count;
    return this.count * 2;
  }
}

class Sub extends Impl {
  setCount(count: number): any {
    return super.setCount(count) + 1;
  }
}

for (const adapter of [new Impl(), new Sub()] as Adapter[]) {
  console.log(adapter.setHandler((value: number) => value * 2, "api"));
  console.log(adapter.setHandler((value: number) => value + 1));
  console.log(adapter.setCount(5));
  console.log((adapter as Impl).handler!(21), (adapter as Impl).count);
}
const direct = new Sub();
direct.setHandler((value: number) => value - 1, "direct");
console.log(direct.handler!(10));

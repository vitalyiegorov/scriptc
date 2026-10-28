// Function values and interface methods whose parameters are spelled `any`
// or `any[]` (rxjs's `Operator.call(subscriber, source: any)` and
// `toArray`'s `(arr: any[], value: any) => any[]` reducer): the parameter
// is a checked-dynamic slot, so the types are compilable members.
class Sink {
  seen: number[] = [];
  unsubscribe(): void {
    console.log("unsubscribed after", this.seen.length);
  }
}

type Teardown = Sink | (() => void) | void;

interface Operator<T, R> {
  call(sink: Sink, source: any): Teardown;
}

class Stream<T> {
  operator: Operator<any, T> | undefined;
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
}

const stream = new Stream<number>("numbers");
console.log(stream.operator === undefined);
stream.operator = {
  call(sink: Sink, source: any): Teardown {
    sink.seen.push(typeof source === "number" ? source : -1);
    return sink;
  },
};
const sink = new Sink();
const first = stream.operator.call(sink, 41);
stream.operator.call(sink, "text");
console.log(sink.seen, first === sink);
sink.unsubscribe();

const arrReducer = (arr: any[], value: any) => (arr.push(value), arr);
const collected = arrReducer([], 1);
arrReducer(collected, "two");
arrReducer(collected, { three: 3 });
console.log(collected, collected.length);

const describe: (label: any, items: any[]) => string = (label, items) =>
  `${String(label)}:${items.length}`;
console.log(describe("a", collected), describe(7, []));

const fixed = (value: any, pad: any[]): any[] => (pad.push(value), pad);
console.log(fixed("x", ["y"]));

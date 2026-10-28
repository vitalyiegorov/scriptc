// A class method keyed by a module constant whose initializer is a closed
// expression (rxjs's `Symbol_observable`): the constant evaluates to one
// string, so the method is a plain member under that name. Typed as
// `string | symbol`, the key reaches the checker as an index signature.
export {};

declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}

const interopKey: string | symbol = (() =>
  (typeof Symbol === "function" && Symbol.observable) || "@@observable")();

class Source<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  [interopKey](): Source<T> {
    return this;
  }
  get(): T {
    return this.value;
  }
}

function isInterop(x: any): boolean {
  return typeof x[interopKey] === "function";
}

const s = new Source<number>(5);
console.log(s.get());
console.log(typeof (s as any)[interopKey]);
console.log((s as any)[interopKey]() === s);
console.log(isInterop(s), isInterop({}), isInterop({ "@@observable": () => 1 }));
console.log(String(interopKey));
const words = new Source<string>("w");
console.log(words.get(), isInterop(words));

function wrap<T>(value: T): Source<T> {
  return new Source<T>(value);
}
function unwrap<T>(source: Source<T>): T {
  return source.get();
}
console.log(unwrap(wrap(7)), unwrap(wrap("seven")));
console.log(isInterop(wrap(true)));

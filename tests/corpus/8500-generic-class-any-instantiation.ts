// A generic class instantiated at `any` (an uninferred `new Box()` or an
// explicit `Box<any>`) is the checked-dynamic instantiation: members are
// usable and values of any type flow through, exactly as in JavaScript.
declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}
const key: string | symbol = (() =>
  (typeof Symbol === "function" && Symbol.observable) || "@@observable")();

class Source<T> {
  sink?: (value: T) => void;
  [key](): Source<T> {
    return this;
  }
}
class Subject<T> extends Source<T> {
  count = 0;
  next(value: T): void {
    this.count++;
    if (this.sink) this.sink(value);
  }
}
class Replay<T> extends Subject<T> {
  size = 3;
  buffer: T[] = [];
  next(value: T): void {
    this.buffer.push(value);
    if (this.buffer.length > this.size) this.buffer.shift();
    super.next(value);
  }
}

class Holder {
  registry: Replay<any> = new Replay();
}

// Members of a value typed at `Replay<any>` are reached through the
// checked-dynamic tree (the untyped consumer a JavaScript caller is).
const holder = new Holder();
const untyped: any = holder;
const seen: unknown[] = [];
untyped.registry.sink = (value: unknown) => seen.push(value);
untyped.registry.next(1);
untyped.registry.next("two");
untyped.registry.next({ three: 3 });
untyped.registry.next(4);
untyped.registry.next(5);
console.log(untyped.registry.count, untyped.registry.buffer.length, seen.length);
console.log(untyped.registry.buffer);
console.log(holder.registry instanceof Source, typeof untyped.registry["@@observable"]);

const loose: Subject<any> = new Subject();
const looseUntyped: any = loose;
looseUntyped.next([1, 2]);
console.log(looseUntyped.count);

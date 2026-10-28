// A generic arrow stored in a slot with a non-generic signature lowers once
// with its type parameter erased (as JavaScript runs it). Constructing a
// generic class from the erased parameter (`new Box<T>(v)`, rxjs's
// `Observable.create`) builds the instantiation over `unknown`.
export {};

class Box<T> {
  value: T | undefined;
  constructor(value?: T) {
    this.value = value;
  }
  get(): T | undefined {
    return this.value;
  }
  static create: (...args: any[]) => any = <T>(value?: T) => {
    return new Box<T>(value);
  };
}

const wrap: (value: unknown) => unknown = <T>(value: T) => {
  return new Box<T>(value);
};

const made = wrap(41) as Box<unknown>;
console.log(made instanceof Box, made.get());
const text = wrap("text") as Box<unknown>;
console.log(text.get());
console.log(new Box<number>(1).get());

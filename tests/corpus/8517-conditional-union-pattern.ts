// A conditional type whose `extends` pattern is a union of generic
// references (`O extends Input<infer T>`) resolves against the member the
// argument matches; one that resolves to `any` is a checked-dynamic slot.
class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
}
type Input<T> = Box<T> | T[] | Promise<T>;
type Observed<O> = O extends Input<infer T> ? T : never;

function unwrap<O extends Input<any>, R>(
  input: O,
  selector?: (inner: Observed<O>, index: number) => R,
): R | Observed<O> | undefined {
  const inner = (Array.isArray(input) ? input[0] : (input as any).v) as Observed<O>;
  return selector ? selector(inner, 0) : inner;
}

console.log(unwrap(new Box("boxed")));
console.log(unwrap([4, 5], (n, i) => n * 2 + i));
console.log(unwrap(new Box("q"), (s) => s.toUpperCase()));
const anyBox: Box<any> = new Box(1 as any);
console.log(unwrap(anyBox));
console.log(unwrap(anyBox, (x) => String(x) + "!"));

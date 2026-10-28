// `super.m` read as a value is the base prototype's method (unbound: it
// takes the receiver of the call it ends up in), and a generic method read
// through an untyped value is the function the untyped body would run.
class Base<T> {
  tag = "base";
  _next(value: T): void {
    console.log(this.tag, "base next", value);
  }
  lift<R>(operator: (v: T) => R): number {
    return operator.length;
  }
}
class Derived<T> extends Base<T> {
  constructor(custom?: (v: T) => void) {
    super();
    this.tag = "derived";
    this._next = custom
      ? function (this: Derived<T>, value: T) {
          console.log(this.tag, "custom next", value);
        }
      : super._next;
  }
}
new Derived<number>()._next(1);
new Derived<number>((v) => {})._next(2);
function probe(source: any): string {
  return typeof source?.lift === "function" ? "has lift" : "no lift";
}
console.log(probe(new Derived<string>()), probe({}), probe(null), probe(new Base<number>()));

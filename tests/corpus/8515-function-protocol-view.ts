// A structural type made only of Function.prototype members (`call`) is
// satisfied by function values and by objects with such a method; each
// value stays itself.
class Sub {
  name = "sub";
}
interface Operator<T, R> {
  call(subscriber: Sub, source: any): void;
}
class Ob<T> {
  operator: Operator<any, T> | undefined;
  source: Ob<any> | undefined;
  lift<R>(operator?: Operator<T, R>): Ob<R> {
    const o = new Ob<R>();
    o.source = this;
    o.operator = operator;
    return o;
  }
  run(s: Sub): void {
    const { operator, source } = this;
    if (operator) operator.call(s, source);
    else console.log("no operator");
  }
}
class Doubler {
  call(subscriber: Sub, source: any): void {
    console.log("doubler", subscriber.name, source === undefined);
  }
}
const a = new Ob<number>();
const b = a.lift(function (this: Sub, src: any) {
  console.log("op", this.name, src === a);
});
b.run(new Sub());
a.run(new Sub());
a.lift(new Doubler()).run(new Sub());

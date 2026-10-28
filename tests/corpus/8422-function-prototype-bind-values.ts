// Function.prototype.bind/call/apply stored as values (rxjs's Subscriber binds
// through `const _bind = Function.prototype.bind`): a binding of the prototype
// member calls through the runtime's own function members with Node's receiver
// and partial-argument semantics.
const _bind = Function.prototype.bind;
const _call = Function.prototype.call;
function bind<Fn extends (...args: any[]) => any>(fn: Fn, thisArg: any): Fn {
  return _bind.call(fn, thisArg);
}
class Counter {
  n = 10;
  add(x: number, y: number): number { return this.n + x + y; }
  show(): string { return 'n=' + this.n; }
}
const c = new Counter();
const boundAdd = bind(c.add, c);
console.log(boundAdd(1, 2));
const boundShow = bind(c.show, c);
console.log(boundShow());
const holder = { n: 5, get() { return this.n; } };
const g = bind(holder.get, { n: 99 });
console.log(g(), holder.get());
function greet(this: { who: string }, greeting: string, punct: string): string { return greeting + ', ' + this.who + punct; }
const partial = _bind.call(greet, { who: 'world' }, 'hello');
console.log(partial('!'));
console.log(_call.call(greet, { who: 'you' }, 'hi', '?'));
const plain = bind((a: number, b: number) => a * b, null);
console.log(plain(6, 7));
console.log(typeof bind(c.show, c));
const _apply = Function.prototype.apply;
function sum3(a: number, b: number, c: number): number { return a + b + c; }
console.log(_apply.call(sum3, null, [1, 2, 3]));

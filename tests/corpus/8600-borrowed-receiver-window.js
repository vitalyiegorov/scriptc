// @ts-nocheck
// The receiver window of a method call: the callee's `this` stays valid for
// the whole call even when the callee drops the caller's own references.

const holder = {
  obj: {
    name: 'inner',
    drop() {
      holder.obj = null;
      return this.name + ':' + this.name.length;
    },
  },
};
console.log(holder.obj.drop(), holder.obj);

let local = { n: 1, bump() { local = { n: 100 }; return this.n + 1; } };
console.log(local.bump(), local.n);

function makeCounter() {
  return { count: 0, inc() { this.count++; return this; } };
}
console.log(makeCounter().inc().inc().inc().count);

function whoAmI() { return this; }
const a = { whoAmI };
const b = { whoAmI, inner: { whoAmI } };
console.log(a.whoAmI() === a, b.whoAmI() === b, b.inner.whoAmI() === b.inner, b.inner.whoAmI() === b);

const kept = [];
const collector = {
  tag: 'collector',
  remember() { kept.push(this); return kept.length; },
};
collector.remember();
collector.remember();
console.log(kept.length, kept[0] === collector, kept[1].tag);

function callee(x, y) { return [this.id, x, y]; }
const ctx = { id: 'ctx' };
console.log(callee.call(ctx, 1, 2), callee.apply(ctx, [3, 4]), callee.bind(ctx, 5)(6));

const arrowHolder = {
  v: 7,
  make() { return () => this.v; },
  later() { return [1, 2].map((x) => this.v + x); },
};
const arrow = arrowHolder.make();
arrowHolder.v = 8;
console.log(arrow(), arrowHolder.later());

const accessor = {
  _v: 3,
  get v() { return this._v * 2; },
  set v(x) { this._v = x; },
};
accessor.v = 21;
console.log(accessor.v, Object.getOwnPropertyDescriptor(accessor, 'v').get.call({ _v: 4 }));

function outer() {
  const inner = { who: 'inner', f() { return this.who; } };
  const first = this && this.who;
  const second = inner.f();
  const third = this && this.who;
  return [first, second, third];
}
console.log(outer.call({ who: 'outer' }), outer.call(undefined));

const proto = { greet() { return 'hi ' + this.name; } };
const child = Object.create(proto);
child.name = 'child';
console.log(child.greet(), proto.greet.call({ name: 'other' }));

class Shape {
  constructor(n) { this.n = n; }
  area() { return this.n * this.n; }
  describe() { return `${this.constructor.name}:${this.area()}`; }
}
class Square extends Shape {
  area() { return super.area() + 1; }
}
console.log(new Shape(3).describe(), new Square(3).describe());

let nested = 0;
const chain = {
  depth: 0,
  go(n) { this.depth++; return n === 0 ? this.depth : this.go(n - 1); },
};
nested = chain.go(5);
console.log(nested, chain.depth);

import { EventEmitter } from 'node:events';
const em = new EventEmitter();
let heard = 0;
em.on('ping', function (v) { heard += v; });
em.once('pong', function () { heard += 10; });
em.emit('ping', 1);
em.emit('pong');
em.emit('pong');
console.log(heard);

// @ts-nocheck
// instanceof over ordinary constructors, prototype links changed at run
// time, and the values the check refuses.

function A() {}
function B() {}
B.prototype = Object.create(A.prototype);
B.prototype.constructor = B;
class C extends B {}
const c = new C();
console.log(c instanceof C, c instanceof Object, c instanceof Function);
console.log(new B() instanceof C, new A() instanceof B);

const early = new A();
A.prototype = {};
console.log(early instanceof A, new A() instanceof A);

function P() {}
const p = new P();
Object.setPrototypeOf(P.prototype, null);
console.log(p instanceof P, p instanceof Object);
const proto2 = { tag: 2 };
Object.setPrototypeOf(P.prototype, proto2);
function Q() {}
Q.prototype = proto2;
console.log(p instanceof P, p instanceof Q);

const nullProto = Object.create(null);
console.log(nullProto instanceof Object, Object.create({}) instanceof Object);
console.log([] instanceof Array, [] instanceof Object, (() => 1) instanceof Function, A instanceof Function);
console.log(new Error('x') instanceof Error, new TypeError('y') instanceof Error, new Error('z') instanceof TypeError);
console.log(1 instanceof Number, 'a' instanceof String, null instanceof Object, undefined instanceof Object);

function Even() {}
Object.defineProperty(Even, Symbol.hasInstance, { value: (n) => n % 2 === 0 });
console.log(2 instanceof Even, 3 instanceof Even);


function refusals() {
  const results = [];
  for (const rhs of [{}, 1, () => 1, 'str', null, undefined]) {
    try {
      results.push(c instanceof rhs);
    } catch (e) {
      results.push(e.constructor.name);
    }
  }
  return results;
}
console.log(refusals());

function Weird() {}
Weird.prototype = 5;
try {
  console.log({} instanceof Weird);
} catch (e) {
  console.log(e.constructor.name);
}

class Base {}
class Mid extends Base {}
class Leaf extends Mid {}
const leaf = new Leaf();
console.log([Base, Mid, Leaf, Array, Map].map((K) => leaf instanceof K));
const instances = [];
for (let i = 0; i < 5; i++) instances.push(i % 2 ? new Leaf() : new Mid());
console.log(instances.map((x) => [x instanceof Leaf, x instanceof Mid, x instanceof Base]).join('|'));

let swap = function Swap() {};
const s1 = new swap();
swap.prototype = Object.create(swap.prototype);
const s2 = new swap();
console.log(s1 instanceof swap, s2 instanceof swap);

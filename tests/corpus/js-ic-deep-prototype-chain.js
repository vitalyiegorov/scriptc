// Property sites of untyped code over receivers whose prototype chain has
// several links (a class with base classes): reads of inherited members,
// absent keys and constructor stores stay correct when the chain changes
// between executions of one site.
'use strict';

class A {
  constructor() { this.closed = false; this.log = []; }
  ping() { return 'A.ping'; }
  get kind() { return 'A'; }
}
class B extends A {
  constructor() { super(); this.stopped = false; }
  pong() { return 'B.pong'; }
}
class C extends B {
  constructor() {
    super();
    this.ping = () => 'C.own.ping';
    this.pong2 = this.pong;
  }
}

function readPing(o) { return o.ping(); }
function readPong(o) { return o.pong(); }
function readKind(o) { return o.kind; }
function readMissing(o) { return o.nothing; }
function readValue(o) { return o.value; }
function addTag(o, v) { o.tag = v; return o; }

const out = [];
for (let i = 0; i < 6; i++) {
  const b = new B();
  const c = new C();
  out.push(readPing(b), readPing(c), readPong(b), readPong(c), readKind(b), readKind(c));
  out.push(readMissing(b), readMissing(c), addTag(b, i).tag, addTag(c, i * 2).tag);
  out.push(Object.keys(b).join(), Object.keys(c).join());
}
console.log(out.join('|'));

// A method added or replaced on a base prototype after the sites cached.
A.prototype.ping = function () { return 'A.ping2'; };
B.prototype.pong = function () { return 'B.pong2'; };
const b2 = new B();
console.log(readPing(b2), readPong(b2), readPong(new C()));

// A key that appears on a middle link of the chain later.
B.prototype.nothing = 'now there';
console.log(readMissing(new B()), readMissing(new C()));
delete B.prototype.nothing;
console.log(readMissing(new B()), readMissing(new C()));

// An accessor installed on a base prototype shadows the added own field.
for (let i = 0; i < 4; i++) console.log(Object.keys(addTag(new B(), i)).join());
let seen = [];
Object.defineProperty(A.prototype, 'tag', { set(v) { seen.push(v); }, get() { return 'via setter'; }, configurable: true });
const t = addTag(new B(), 7);
console.log(seen.join(), Object.keys(t).join(), t.tag);
delete A.prototype.tag;
console.log(Object.keys(addTag(new B(), 8)).join());

// A read-only data property on a base prototype blocks the add (strict mode).
Object.defineProperty(A.prototype, 'tag', { value: 'frozen', writable: false, configurable: true });
try { addTag(new B(), 9); console.log('no throw'); } catch (e) { console.log(e instanceof TypeError); }
delete A.prototype.tag;

// A writable data property on the chain is shadowed by an own property.
A.prototype.tag = 'proto tag';
const shadow = addTag(new B(), 'own');
console.log(shadow.tag, A.prototype.tag, Object.keys(shadow).join());
for (let i = 0; i < 4; i++) addTag(new B(), i);
console.log(addTag(new C(), 'c').tag, A.prototype.tag);
delete A.prototype.tag;

// Re-parenting a prototype link after caching.
const mid = Object.create(A.prototype);
mid.value = 'mid';
const leaf = Object.create(mid);
for (let i = 0; i < 4; i++) readValue(leaf);
console.log(readValue(leaf));
Object.setPrototypeOf(mid, { value: 'other' });
console.log(readValue(leaf));
Object.setPrototypeOf(leaf, B.prototype);
console.log(readValue(leaf), readPing(leaf));

// Sealed and non-extensible receivers never take the cached add.
const sealed = Object.preventExtensions(new B());
try { addTag(sealed, 1); console.log('added'); } catch (e) { console.log(e instanceof TypeError); }
console.log(Object.keys(sealed).join());

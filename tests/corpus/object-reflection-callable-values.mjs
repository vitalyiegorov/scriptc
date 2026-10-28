const set = Object.setPrototypeOf;
const get = Object.getPrototypeOf;
const define = Object.defineProperty;
const descriptor = Object.getOwnPropertyDescriptor;
const extensible = Object.isExtensible;
const parent = { inherited: 'prototype' };
const value = { own: 'value' };
console.log(set === Object.setPrototypeOf, get === Object.getPrototypeOf);
console.log(set(value, parent) === value, get(value) === parent, value.inherited);
console.log(extensible(value), extensible(1), extensible(null));
console.log(define(value, 'hidden', { value: 42, configurable: true }) === value);
console.log(descriptor(value, 'hidden').value, descriptor(value, 'hidden').enumerable);
console.log(Object.keys(value).join(','));
console.log(set(value, null) === value, get(value) === null);
console.log(set(1, parent));
for (const [target, prototype] of [[null, parent], [{}, 1]]) {
  try { set(target, prototype); } catch (error) { console.log(error.name); }
}
const original = {};
const derived = {};
set(derived, original);
try { set(original, derived); } catch (error) { console.log(error.name); }
function Base() {}
function Derived() {}
console.log(set(Derived, Base) === Derived, get(Derived) === Base);

const parent = JSON.parse('{"value": 1}');
const child = Object.create(parent);
console.log(child.value, Object.keys(child).length, Object.hasOwn(child, 'value'), 'value' in child);
console.log(child.propertyIsEnumerable('value'), parent.propertyIsEnumerable('value'));
parent.value = 2;
console.log(child.value);
child.value = 3;
console.log(child.value, parent.value, Object.hasOwn(child, 'value'));
const grandchild = Object.create(child);
console.log(grandchild.value);
Object.defineProperty(parent, 'inherited', { get: function() { return this.value + 1; }, enumerable: true });
console.log(grandchild.inherited, Object.keys(grandchild).length);
console.log(grandchild.propertyIsEnumerable('inherited'), parent.propertyIsEnumerable('inherited'));
console.log(Object.getOwnPropertyNames(grandchild).length, Object.getOwnPropertyDescriptor(grandchild, 'value'));
console.log(Object.getPrototypeOf(child) === parent, Object.getPrototypeOf(grandchild) === child);
const inheritedKeys = [];
for (const key in grandchild) inheritedKeys.push(key);
console.log(inheritedKeys.join(','));
Object.defineProperty(child, 'value', { value: 5, enumerable: false, writable: true, configurable: true });
const shadowedKeys = [];
for (const key in grandchild) shadowedKeys.push(key);
console.log(grandchild.value, shadowedKeys.join(','));
const replacement = JSON.parse('{"replacement": 8}');
Object.setPrototypeOf(grandchild, replacement);
console.log(Object.getPrototypeOf(grandchild) === replacement, grandchild.replacement, 'value' in grandchild);
const descriptors = JSON.parse('{"own":{"value":11,"enumerable":true,"writable":true}}');
const described = Object.create(replacement, descriptors);
console.log(described.own, described.replacement, Object.keys(described).join(','));
const locked = JSON.parse('{"first":1,"second":2}');
console.log(Object.isExtensible(locked), Object.isSealed(locked), Object.isFrozen(locked));
Object.preventExtensions(locked);
console.log(Object.isExtensible(locked), Object.isSealed(locked), Object.isFrozen(locked));
try { locked.third = 3; } catch (error) { console.log(error.name); }
console.log(Object.hasOwn(locked, 'third'));
const sealed = JSON.parse('{"first":1}');
Object.seal(sealed);
console.log(Object.isSealed(sealed), Object.isFrozen(sealed), Object.getOwnPropertyDescriptor(sealed, 'first').configurable);
sealed.first = 4;
console.log(sealed.first);
const frozen = JSON.parse('{"first":1}');
Object.freeze(frozen);
console.log(Object.isSealed(frozen), Object.isFrozen(frozen), Object.getOwnPropertyDescriptor(frozen, 'first').writable);
try { frozen.first = 4; } catch (error) { console.log(error.name); }
console.log(frozen.first);
// Literal prototype setters retain inherited reads while defining own fields.
const trace = [];
const literalParent = {
  /** @param {number} value */
  set own(value) { trace.push('setter:' + value); },
  inherited: 9,
};
const literalChild = {
  before: (trace.push('before'), 1),
  __proto__: (trace.push('prototype'), literalParent),
  own: (trace.push('own'), 2),
  after: (trace.push('after'), 3),
};
console.log(trace.join(','), literalChild.inherited, literalChild.own);
console.log(Object.getPrototypeOf(literalChild) === literalParent, Object.keys(literalChild).join(','));
for (const primitive of [undefined, true, 1, 'ignored']) {
  const ignored = { __proto__: primitive, value: 5 };
  console.log(Object.getPrototypeOf(ignored) === Object.prototype, Object.hasOwn(ignored, '__proto__'), ignored.value);
}
const arrayPrototype = [];
const arrayChild = { __proto__: arrayPrototype };
console.log(Object.getPrototypeOf(arrayChild) === arrayPrototype, arrayChild instanceof Array, Array.isArray(arrayChild));
function callablePrototype() {}
const callableChild = { __proto__: callablePrototype };
console.log(Object.getPrototypeOf(callableChild) === callablePrototype, typeof callableChild);
const nativeRecord = { count: 1 };
console.log(Object.isExtensible(nativeRecord), Object.isSealed(nativeRecord));
Object.freeze(nativeRecord);
console.log(Object.isExtensible(nativeRecord), Object.isSealed(nativeRecord));

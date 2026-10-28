class Base { base() {} get accessor() { return 1; } }
class Controller extends Base { constructor() { super(); } hello() {} world() {} }
function methodNames(instance) {
  let prototype = Reflect.getPrototypeOf(instance);
  const result = [];
  do {
    for (const property of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (descriptor.get || descriptor.set || property === 'constructor' || typeof prototype[property] !== 'function') continue;
      result.push(property);
    }
  } while ((prototype = Reflect.getPrototypeOf(prototype)) && prototype !== Object.prototype);
  return result.join(',');
}
console.log(methodNames(new Controller()));
console.log(Reflect.getPrototypeOf(Base.prototype) === Object.prototype);
try { Reflect.getPrototypeOf(1); } catch (error) { console.log(error.name, error.message); }

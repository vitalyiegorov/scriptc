class Base {}
class Reflector extends Base { get(key) { return key; } }
class Plain {}
function chain(target) {
  const names = [];
  for (let current = target; current && current !== Function.prototype; current = Object.getPrototypeOf(current))
    names.push(current.name);
  return names.join('>');
}
console.log(chain(Reflector), chain(Plain), chain(Base));
console.log(Object.getPrototypeOf(Reflector) === Base, Object.getPrototypeOf(Plain) === Function.prototype);

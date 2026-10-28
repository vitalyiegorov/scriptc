import { isMap } from 'node:util/types';
class Container extends Map {
  id = 'native';
  label() { return this.id + ':' + this.size; }
}
const map = new Container([['a', 1]]);
console.log(map.id, map.get('a'), map.size, map.label());
console.log(map.set('b', 2) === map);
console.log([...map.keys()].join(','));
console.log([...map.values()].join(','));
console.log(map instanceof Map, map instanceof Container);
console.log(Object.getPrototypeOf(map) === Container.prototype);
console.log(Object.getPrototypeOf(Container.prototype) === Map.prototype);
console.log(Object.getPrototypeOf(Container) === Map);
console.log(Object.keys(map).join(','));
console.log(map.delete('a'), map.has('a'), map.size);
const objectKey = { id: 'key' };
const symbolKey = Symbol('key');
map.set(objectKey, 3);
map.set(symbolKey, 4);
console.log(map.get(objectKey), map.get(symbolKey));
const seen = [];
map.forEach((value, key, receiver) => {
  seen.push(String(value));
  console.log(receiver === map, receiver.id);
});
console.log(seen.join(','));
console.log(Map.prototype.get.call(map, objectKey));
console.log(Map.prototype.set.call(map, 'borrowed', 5) === map);
class Derived extends Container {
  constructor(entries) { super(entries); this.extra = 'child'; }
}
const child = new Derived([['child', 7]]);
console.log(child.get('child'), child.id, child.extra, child instanceof Map, child instanceof Container);
console.log(Object.getPrototypeOf(child) === Derived.prototype);
console.log(Object.keys(child).join(','));
child.clear();
console.log(child.size);
try { Map.prototype.get.call({}, 'a'); } catch (error) { console.log(error instanceof TypeError); }
class OverrideGet extends Map {
  get(key) { return super.get(key) + 1; }
}
const override = new OverrideGet([['answer', 41]]);
console.log(override.get('answer'), Map.prototype.get.call(override, 'answer'));
console.log(Map.prototype[Symbol.iterator] === Map.prototype.entries);
console.log(map[Symbol.iterator] === Map.prototype.entries);
console.log(JSON.stringify([...map]));
console.log(isMap(map), isMap(child), isMap({}));
const walked = [];
for (const [key, value] of map) walked.push(String(value));
console.log(walked.join(','));

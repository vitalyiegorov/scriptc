// Object destructuring of a builtin constructor's statics, the way rxjs binds
// `const { isArray } = Array` and `const { getPrototypeOf, prototype:
// objectProto, keys: getKeys } = Object`: each name holds the same function
// (or prototype object) the member reads as, at module scope and in a
// function, including the overloaded `Object.keys`.
const { isArray } = Array;
const { getPrototypeOf, prototype: objectProto, keys: getKeys, assign, values, entries } = Object;
const { parseInt: toInt } = Number;
const { from } = Array;

function argsOrArgArray<T>(args: (T | T[])[]): T[] {
  return args.length === 1 && isArray(args[0]) ? args[0] : (args as T[]);
}
console.log(argsOrArgArray<number>([[1, 2, 3]]), argsOrArgArray<number>([4, 5]), argsOrArgArray<string>(['a']));

function pick(first: unknown): string {
  if (isArray(first)) return 'array';
  if (first && typeof first === 'object' && getPrototypeOf(first) === objectProto) return getKeys(first).join('|');
  return 'other';
}
console.log(pick([1]), pick({ a: 1, b: 2 }), pick(3), pick(null));
console.log(assign({ a: 1 }, { b: 2 }), values({ x: 1, y: 2 }), entries({ z: 3 }));
console.log(toInt('42px'), from('abc'));
console.log(getPrototypeOf([]) === Array.prototype, getPrototypeOf({}) === objectProto);
function inner2(x: unknown): string {
  const { isArray: ia } = Array;
  const { keys: ks } = Object;
  return ia(x) ? 'array' : ks(x as object).join();
}
console.log(inner2([1]), inner2({ p: 1, q: 2 }));

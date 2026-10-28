// The feature-detection idiom for Symbol.iterator (rxjs's getSymbolIterator): the
// `typeof Symbol !== 'function' || !Symbol.iterator` guard is decided at compile
// time (Symbol is always a function and well-known symbols are truthy), so the
// string-fallback arm never needs a `symbol` slot.
export function getSymbolIterator(): symbol {
  if (typeof Symbol !== 'function' || !Symbol.iterator) {
    return '@@iterator' as any;
  }
  return Symbol.iterator;
}
export const iterator = getSymbolIterator();
console.log(typeof iterator, iterator === Symbol.iterator, iterator.toString());
const arr = [4, 5];
const it = (arr as any)[iterator]();
console.log(it.next(), typeof (arr as any)[iterator]);
function isIterable(input: any): boolean { return typeof input?.[iterator] === "function"; }
console.log(isIterable(arr), isIterable("s"), isIterable(5), isIterable({}));

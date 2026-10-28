// A generic helper over `T[]` instantiated with a class-protocol union
// (rxjs's `arrRemove(teardowns, item)` over `Subscription | Unsubscribable`
// lists): the array is one checked-dynamic value, and `indexOf` and `splice`
// compare by identity (SameValueZero for NaN, strict equality otherwise),
// remove in place and leave the list unchanged when the item is absent.
interface Unsub { unsubscribe(): void }
class Sub implements Unsub {
  id: number; constructor(id: number) { this.id = id; }
  unsubscribe() { console.log("unsub", this.id); }
}
function arrRemove<T>(arr: T[] | undefined | null, item: T) {
  if (arr) {
    const index = arr.indexOf(item);
    0 <= index && arr.splice(index, 1);
  }
}
const a = new Sub(1), b = new Sub(2);
const list: (Sub | Unsub)[] = [a, b];
arrRemove(list, b);
console.log(list.length, list[0] === a);
const mixed: unknown[] = [1, "x", a, NaN, null, undefined];
arrRemove(mixed, "x");
arrRemove(mixed, NaN);
arrRemove(mixed, undefined);
arrRemove(mixed, a);
arrRemove(mixed, {});
console.log(mixed);
console.log(mixed.indexOf(null), mixed.includes(NaN), mixed.lastIndexOf(1), mixed.includes(1));
arrRemove(null, 1);

function removeAll<T>(arr: T[] | undefined | null, item: T): number {
  let removed = 0;
  if (arr) {
    let index: number;
    while ((index = arr.indexOf(item)) >= 0) {
      arr.splice(index, 1);
      removed++;
    }
  }
  return removed;
}
const c = new Sub(3);
const list2: (Sub | Unsub)[] = [a, c, b, c, c];
console.log(removeAll(list2, c), list2.length, list2[0] === a, list2[1] === b);
console.log(removeAll(list2, c), removeAll(undefined, c), removeAll(null, c));
console.log(list2.includes(b), list2.lastIndexOf(a), list2.indexOf(c));

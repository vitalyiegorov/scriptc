// A union of a class, a structural interface and a closure keeps the class
// instance and the closure in their own representations.
interface Unsubscribable {
  unsubscribe(): void;
}
class Sub implements Unsubscribable {
  closed = false;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  unsubscribe(): void {
    this.closed = true;
    console.log('Sub.unsubscribe', this.name);
  }
}
class SubSub extends Sub {
  unsubscribe(): void {
    console.log('SubSub first');
    super.unsubscribe();
  }
}
class Other implements Unsubscribable {
  unsubscribe(): void {
    console.log('Other.unsubscribe');
  }
}
type Teardown = Sub | Unsubscribable | (() => void) | void;

const finalizers: Exclude<Teardown, void>[] = [];
function add(t: Teardown): void {
  if (t) finalizers.push(t);
}
function kind(t: Teardown): string {
  if (t instanceof Sub) return t instanceof SubSub ? 'subsub' : 'sub';
  if (typeof t === 'function') return 'function';
  if (t === undefined) return 'undefined';
  if (t instanceof Other) return 'other';
  return 'structural';
}
function run(t: Exclude<Teardown, void>): void {
  if (t instanceof Sub) t.unsubscribe();
  else if (typeof t === 'function') t();
  else t.unsubscribe();
}
function runChecked(t: Teardown): void {
  if (t && 'unsubscribe' in t && typeof t.unsubscribe === 'function') t.unsubscribe();
  else if (typeof t === 'function') t();
  else console.log('nothing');
}

const a = new Sub('a');
const sub2 = new SubSub('subsub');
const other = new Other();
const plain = { unsubscribe: () => console.log('plain.unsubscribe') };
const fn = () => console.log('fn');

const inputs: Teardown[] = [a, sub2, other, plain, fn, undefined];
for (const t of inputs) {
  add(t);
  console.log(kind(t));
}
console.log(finalizers.length);
// identity survives the trip through the union array
console.log(finalizers[0] === a, finalizers[1] === sub2, finalizers[2] === other, finalizers[3] === plain, finalizers[4] === fn);
console.log(finalizers.indexOf(a), finalizers.indexOf(sub2), finalizers.indexOf(other), finalizers.indexOf(plain), finalizers.indexOf(fn));
console.log(finalizers.includes(other), finalizers.includes(new Other()));
for (const f of finalizers) run(f);
for (const f of finalizers) runChecked(f);
runChecked(undefined);
console.log(a.closed, sub2.closed);

// values from an untyped source classify the same way
function fromAny(v: any): Teardown {
  return v;
}
const seen: Teardown[] = [fromAny(a), fromAny(fn), fromAny(other), fromAny(plain), fromAny(undefined), fromAny(sub2)];
console.log(seen.map(kind).join(','));
console.log(seen[0] === a, seen[1] === fn, seen[2] === other, seen[3] === plain, seen[5] === sub2);
const foreign: any = { unsubscribe() { console.log('foreign'); } };
const viaAny = fromAny(foreign);
console.log(kind(viaAny), viaAny === foreign);
run(viaAny as Exclude<Teardown, void>);

// removal by identity
function remove(arr: Exclude<Teardown, void>[], item: Exclude<Teardown, void>): void {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}
remove(finalizers, other);
remove(finalizers, plain);
remove(finalizers, fn);
console.log(finalizers.length, finalizers.indexOf(other));

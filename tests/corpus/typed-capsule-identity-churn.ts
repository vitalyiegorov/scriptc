// A class instance that crosses into an `any` slot again and again keeps one
// dyn identity while it lives, whether its earlier crossing was dropped,
// parked or evicted by many other crossings.
class Item {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  next(): number {
    return this.id + 1;
  }
}

function same(a: any, b: any): boolean {
  return a === b;
}
function pass(a: any): any {
  return a;
}
function id(a: any): number {
  return a.id;
}

const items: Item[] = [];
for (let i = 0; i < 400; i++) items.push(new Item(i));

// Each object crosses, the crossing is dropped, and it crosses again.
let agree = 0;
for (let round = 0; round < 3; round++) {
  for (const item of items) {
    const first = pass(item);
    if (same(first, pass(item))) agree++;
    if (id(item) === item.id) agree++;
  }
}
console.log(agree);

// Two crossings held together are the same value, and distinct objects are not.
const held = pass(items[7]);
for (let i = 0; i < 300; i++) pass(items[i]);
console.log(same(held, pass(items[7])), same(held, pass(items[8])), held === pass(items[7]));
console.log(held instanceof Item, (held as Item).next());

// The identity serves as a Map key and a Set member.
const seen = new Map<any, number>();
for (const item of items) seen.set(pass(item), item.id);
let hits = 0;
for (const item of items) if (seen.get(pass(item)) === item.id) hits++;
console.log(seen.size, hits);

// A property set through one crossing is read through another.
const target = items[11];
const view: any = pass(target);
view.extra = 'marked';
for (let i = 100; i < 380; i++) pass(items[i]);
console.log(pass(target).extra, id(target));

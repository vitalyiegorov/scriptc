// A capsule outlives every typed reference to its object: the object must
// stay readable through the capsule, and an object whose last typed reference
// went while its crossing was parked must not be reached through a stale
// capsule by a different object that reuses its memory.
class Box {
  tag: string;
  n: number;
  constructor(tag: string, n: number) {
    this.tag = tag;
    this.n = n;
  }
}

function pass(a: any): any {
  return a;
}

function makeHeld(i: number): any {
  const b = new Box('held' + i, i);
  return pass(b);
}

const held: any[] = [];
for (let i = 0; i < 10; i++) held.push(makeHeld(i));
console.log(held.map((h) => h.tag + ':' + h.n).join(','));

// Short-lived objects cross and die; new ones of the same size are built
// right after, which would reuse the memory of any freed object.
let checks = 0;
for (let i = 0; i < 2000; i++) {
  const temp = new Box('temp' + i, i);
  const crossed = pass(temp);
  if (crossed.n !== i || crossed.tag !== 'temp' + i) throw new Error('stale ' + i);
  const other = new Box('next' + i, -i);
  const crossedOther = pass(other);
  if (crossedOther === crossed) throw new Error('aliased ' + i);
  if (crossedOther.n !== -i) throw new Error('stale other ' + i);
  checks++;
}
console.log(checks);

// The held capsules still describe their own objects after the churn.
console.log(held.map((h, i) => h.n === i && h instanceof Box).every(Boolean));
held.length = 0;
for (let i = 0; i < 300; i++) pass(new Box('after', i));
console.log('done');

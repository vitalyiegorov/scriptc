// A cycle that runs through a capsule: an object held by an `any` field of
// itself, and a ring of objects holding each other through `any` fields.
// Crossings that were cached before the cycle formed must not keep it alive
// or dangle once it is collected.
class Node {
  peer: any = null;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

function pass(a: any): any {
  return a;
}

let total = 0;
for (let round = 0; round < 50; round++) {
  const self = new Node('self' + round);
  pass(self);
  self.peer = self;
  total += pass(self.peer).label.length;

  const ring: Node[] = [];
  for (let i = 0; i < 5; i++) ring.push(new Node('r' + i));
  for (let i = 0; i < 5; i++) {
    pass(ring[i]);
    ring[i].peer = ring[(i + 1) % 5];
  }
  let at: any = ring[0];
  for (let i = 0; i < 12; i++) at = at.peer;
  total += at.label.length;
}
console.log(total);

// Churn enough crossings to evict anything parked, then walk a live cycle.
const a = new Node('a');
const b = new Node('b');
a.peer = b;
b.peer = a;
for (let i = 0; i < 500; i++) pass(new Node('x' + i));
console.log(a.peer.peer.peer.label, pass(a).peer.label, pass(b).peer.peer.label);

// Dropping a very long chain of dynamic objects, arrays and closures must not overflow the
// stack, and pooled nodes must come back clean when their storage is reused.
function chain(n) {
  let head = null;
  for (let i = 0; i < n; i++) head = { next: head, i, fn: () => i };
  return head;
}
function nest(n) {
  let a = [];
  for (let i = 0; i < n; i++) a = [a, { v: i }];
  return a;
}
let total = 0;
for (let round = 0; round < 4; round++) {
  let c = chain(150000);
  total += c.i;
  c = null;
  let n = nest(100000);
  total += n.length;
  n = null;
  // Reuse freed nodes with different shapes and key sets.
  const reused = [];
  for (let i = 0; i < 2000; i++) {
    const o = JSON.parse(i % 2 ? `{"a":${i},"b":${i + 1}}` : `{"x":${i},"y":${i + 1},"z":${i + 2},"w":${i + 3},"v":${i + 4}}`);
    if (i % 5 === 0) delete o[i % 2 ? "a" : "x"];
    reused.push(o);
  }
  for (const o of reused) total += Object.keys(o).join("").length + Object.values(o).length;
}
console.log("total", total);

const keep = { self: null, list: [] };
keep.self = keep;
for (let i = 0; i < 1000; i++) keep.list.push({ back: keep, i });
console.log(keep.list.length, keep.list[999].back === keep, Object.keys(keep));

// @ts-nocheck
// Locals that statements rebind, read by expressions that run runtime
// operations over them: the operation sees the value current when it
// started, and the replaced value is released only afterwards.

function rebind() {
  let x = JSON.parse('{"a":[1,2,3],"s":"str"}');
  const out = [];
  out.push(x.a.length);
  x = x.a;
  out.push(x.length, x[1]);
  x = JSON.parse('{"deep":{"k":"v"}}');
  x = x.deep;
  out.push(x.k);
  return out;
}
console.log(rebind());

function listWalk() {
  let list = null;
  for (let i = 0; i < 5; i++) list = JSON.parse(JSON.stringify({ v: i, next: list }));
  let total = 0;
  let cur = list;
  while (cur) {
    total += cur.v;
    cur = cur.next;
  }
  return total;
}
console.log(listWalk());

const sink = [];
function keep(v) { sink.push(v); return v; }
function selfRebind() {
  let v = JSON.parse('{"n":1}');
  for (let i = 0; i < 4; i++) v = keep(JSON.parse(JSON.stringify({ n: v.n + 1, prev: v.n })));
  return [v.n, sink.length, sink[0].n];
}
console.log(selfRebind());

function closureRebind() {
  let g = function () { return 1; };
  for (let i = 0; i < 4; i++) {
    const prev = g;
    g = function () { return prev() + 1; };
  }
  let f = function (a) { return a + 1; };
  let r = f(1);
  f = function (a) { return a * 10; };
  r += f(2);
  return [g(), r];
}
console.log(closureRebind());

function assignInsideExpression() {
  let y = JSON.parse('{"a":1}');
  const first = y.a + (y = JSON.parse('{"a":2}')).a;
  const second = [y.a, (y = JSON.parse('{"a":5}'), y.a), y.a];
  let n = JSON.parse('5');
  const third = [n++, n, ++n, n];
  return [first, second, third];
}
console.log(assignInsideExpression());

function catchRebind() {
  let e = JSON.parse('{"tag":"before"}');
  const seen = [e.tag];
  try {
    throw new Error('boom');
  } catch (err) {
    e = JSON.parse('{"tag":"after"}');
    seen.push(e.tag, err.message);
  }
  return seen;
}
console.log(catchRebind());

function* gen() {
  let v = JSON.parse('{"i":0}');
  while (v.i < 3) {
    const got = yield v.i;
    v = JSON.parse(JSON.stringify({ i: v.i + 1 + (got || 0) }));
  }
  return v.i;
}
const it = gen();
console.log(it.next().value, it.next(0).value, it.next(1).value, it.next(0).done);

async function asyncRebind() {
  let v = JSON.parse('{"a":1}');
  const pair = [v.a, await Promise.resolve(2), (v = JSON.parse('{"a":3}'), v.a), v.a];
  v = await Promise.resolve(JSON.parse('{"a":9}'));
  return [pair, v.a];
}
asyncRebind().then((r) => console.log(r));

function swapPair() {
  let p = JSON.parse('{"x":1}');
  let q = JSON.parse('{"x":2}');
  for (let i = 0; i < 3; i++) {
    const t = p;
    p = q;
    q = t;
  }
  return [p.x, q.x];
}
console.log(swapPair());


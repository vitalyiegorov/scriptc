// A function value passed to an untyped parameter its callee only calls may
// live in the caller's frame. Every other use of the parameter (stored in a
// field or global, returned, thrown, captured by a closure that escapes,
// awaited, compared, read for a property, handed to unknown code) must keep
// the heap value alive past the call.
'use strict';

const log = [];
const keep = [];
let held = null;

function callOnce(cb) { cb(); }
function callTwice(cb, x) { cb(x); return cb(x + 1); }
function viaForward(cb) { callOnce(cb); }
function viaForward2(cb) { viaForward(cb); }
function guarded(flag, cb) { if (flag) cb(); return flag; }
function tryCall(cb) {
  try { cb(); } catch (e) { return 'caught:' + e.message; } finally { log.push('finally'); }
  return 'ok';
}

// Escapes
function storeGlobal(cb) { held = cb; }
function storeField(box, cb) { box.cb = cb; }
function storeArray(cb) { keep.push(cb); }
function returnIt(cb) { return cb; }
function captureIt(cb) { return function () { return cb(); }; }
function forwardEscape(cb) { storeGlobal(cb); }
function forwardEscape2(cb) { forwardEscape(cb); }
function callThenStore(cb) { cb(); held = cb; }
function toUnknown(cb, sink) { sink(cb); }
function mapWith(cb) { return [1, 2, 3].map((x) => cb(x)); }
function timerWith(cb) { setTimeout(cb, 0); }
function thrower(cb) { throw cb; }
function compare(cb, other) { return cb === other; }
function props(cb) { return typeof cb + ':' + cb.length; }
function applyIt(cb) { return cb.call(null, 5); }
function argsObject(cb) { const a = arguments; cb(); return a; }
async function awaitIt(cb) { await null; return cb(); }
function* gen(cb) { yield cb(); yield cb(); }
function selfInvoke(cb, depth) { if (depth > 0) return selfInvoke(function () { return cb() + 1; }, depth - 1); return cb(); }

// 1. plain call-only with captures
let counter = 0;
function bump(by) {
  const label = 'bump' + by;
  callOnce(function () { counter += by; log.push(label); });
}
bump(2); bump(3);
console.log('counter', counter, log.join(','));

// 2. multiple calls, return value, parameters
const base = 10;
console.log('twice', callTwice(function (n) { return n * base; }, 4));

// 3. forwarding chains
let chained = 0;
viaForward(function () { chained += 1; });
viaForward2(function () { chained += 10; });
console.log('chained', chained);

// 4. conditional and loop
let hits = 0;
for (let i = 0; i < 5; i++) guarded(i % 2 === 0, function () { hits += i; });
console.log('hits', hits);

// 5. throwing callbacks unwind through the frame-resident closure
let thrown = 'none';
const payload = { tag: 'payload' };
console.log(tryCall(function () { throw new Error('boom ' + payload.tag); }));
try { callOnce(function () { throw new RangeError('range ' + base); }); } catch (e) { thrown = e.name + '/' + e.message; }
console.log('thrown', thrown, log.length);

// 6. declared functions as callbacks
function declared() { log.push('declared'); }
callOnce(declared);
callOnce(declared);
console.log('declared', log.filter((x) => x === 'declared').length);

// 7. escapes keep working after the creating frame is gone
function makeEscapes() {
  const secret = { n: 41 };
  storeGlobal(function () { return secret.n + 1; });
  const box = {};
  storeField(box, function () { return secret.n + 2; });
  storeArray(function () { return secret.n + 3; });
  const got = returnIt(function () { return secret.n + 4; });
  const wrapped = captureIt(function () { return secret.n + 5; });
  forwardEscape2(function () { return secret.n + 6; });
  const afterForward = held();
  callThenStore(function () { secret.n += 100; });
  return { held1: afterForward, box, got, wrapped };
}
const esc = makeEscapes();
console.log('escapes', esc.box.cb(), keep[0](), esc.got(), esc.wrapped(), held());

// 8. unknown callees
const seen = [];
toUnknown(function () { return 'sunk'; }, (f) => seen.push(f));
console.log('sink', seen[0]());
console.log('map', mapWith(function (x) { return x * 2; }).join(','));
timerWith(function () { console.log('timer fired'); });

// 9. thrown function value
try { thrower(function () { return 'thrown fn'; }); } catch (f) { console.log('rethrown', f()); }

// 10. identity, properties, call/apply, arguments
const same = function () {};
console.log('compare', compare(same, same), compare(function () {}, same));
console.log('props', props(function (a, b) { return a + b; }));
console.log('apply', applyIt(function (x) { return x + 1; }));
console.log('arguments', argsObject(function () { return 1; }).length);

// 11. async and generator callees outlive the call
awaitIt(function () { return 'awaited'; }).then((v) => console.log('async', v));
const g = gen(function () { return 'gen'; });
console.log('gen', g.next().value, g.next().value);

// 12. recursion builds nested callbacks
console.log('selfInvoke', selfInvoke(function () { return 0; }, 3));

// 13. closure created inside the callback that escapes
const made = [];
callOnce(function () { const inner = base + 1; made.push(function () { return inner + counter; }); });
callOnce(function () { const inner = base + 2; made.push(function () { return inner + counter; }); });
console.log('made', made[0](), made[1]());

// 14. mutable captured state shared between a callback and its creator
let shared = 0;
callTwice(function (n) { shared += n; return shared; }, 5);
shared += 100;
callOnce(function () { shared += 1000; });
console.log('shared', shared);

setTimeout(() => console.log('late held', typeof held, keep.length, log.length), 5);

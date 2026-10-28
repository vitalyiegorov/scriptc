// A function is one object however often it is read: top-level functions,
// methods read off a class or its prototype and class constructors compare
// equal across reads, share properties and a prototype, and a function read
// from several containers is the same value everywhere.
function top(a) {
  return a + 1;
}
function other() {}
function third() {}
class Box {
  m() {
    return "m";
  }
  static s() {
    return "s";
  }
}

const byName = new Map([["f", top]]);
const holders = [{ f: top }, { f: top }, [top], byName];
const againMap = new Map([["g", third]]);
const again = [{ g: third }, [third], againMap];
console.log("same through containers", holders[0].f === holders[1].f, holders[2][0] === top, byName.get("f") === top);
console.log("distinct", top === other, holders[0].f === other);
console.log("method reads", Box.prototype.m === Box.prototype.m, new Box().m === new Box().m, Box.s === Box.s);
console.log("class reads", Box === Box, [Box][0] === Box);

top.tag = "t";
holders[1].f.count = 2;
console.log("shared properties", holders[0].f.tag, top.count, Object.keys(top).join(","));

const proto = { hello: "hi" };
Object.setPrototypeOf(third, proto);
console.log("shared prototype", again[1][0].hello, Object.getPrototypeOf(againMap.get("g")) === proto);

const sym = Symbol("s");
holders[0].f[sym] = 7;
console.log("symbol property", top[sym], holders[1].f[sym]);

const unbound = Box.prototype.m;
console.log("unbound method", unbound === Box.prototype.m, unbound.call(null), typeof unbound);
console.log("name and length", top.name, top.length, Box.s.name, Box.name, other.length);

const seen = new Set();
for (let i = 0; i < 5; i++) {
  seen.add(holders[i % 2].f);
  seen.add([top][0]);
}
console.log("set of reads", seen.size);

function mk() {
  return () => top;
}
const get = mk();
console.log("returned", get() === get(), get() === top, [get(), get()].every((f) => f === top));
console.log("bind", top.bind(null) === top.bind(null), typeof top.bind(null));
console.log("call", top(1), top.call(null, 2), top.apply(null, [3]));

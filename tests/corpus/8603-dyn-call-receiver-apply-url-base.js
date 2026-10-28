// Dynamic-tier calls with a receiver window, Function.prototype.apply over
// dense and array-like argument lists, the `new URL(path, base)` base
// that repeats, alternates and fails, and a class check across many subclasses.
function describe(label, value) {
  console.log(label, JSON.stringify(value));
}

// --- method calls: the receiver is `this` for the call and restored after ---
const counter = {
  n: 0,
  bump(by) {
    this.n += by;
    return this;
  },
  who() {
    return this === counter;
  },
};
describe("bump", counter.bump(2).bump(3).n);
describe("who", counter.who());
const detached = counter.who;
try {
  describe("detached", detached());
} catch (e) {
  describe("detached-throws", e instanceof TypeError);
}
const wrapper = { inner: { f() { return this === wrapper.inner; } } };
describe("nested-this", wrapper.inner.f());
try {
  const missing = { };
  missing.nope();
} catch (e) {
  describe("missing", e instanceof TypeError);
}
describe("call", counter.bump.call({ n: 10 }, 5).n);
describe("call-missing-this", (function () { return typeof this; }).call(undefined));

// --- apply: dense arrays and array-likes ---
function sum() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i] === undefined ? 100 : arguments[i];
  return total + ":" + arguments.length;
}
describe("dense", sum.apply(null, [1, 2, 3]));
describe("empty", sum.apply(null, []));
describe("undef-args", sum.apply(null));
describe("array-like", sum.apply(null, { length: 3, 0: 4, 1: 5, 2: 6 }));
describe("reflect", Reflect.apply(sum, null, [5, 5]));
try {
  sum.apply(null, 5);
} catch (e) {
  describe("apply-primitive", e instanceof TypeError);
}
function thisOf() { return this === counter; }
describe("apply-this", thisOf.apply(counter, [1]));

// --- URL bases ---
const paths = ["/a", "b/c", "/d?x=1#f", "../e", "//other.example/f"];
for (const base of ["http://localhost", "http://localhost", "https://example.com:8443/dir/file", "http://localhost"]) {
  describe("base " + base, paths.map((p) => new URL(p, base).href));
}
try {
  new URL("/x", "not a base");
} catch (e) {
  describe("bad-base", e.code);
}
describe("after-bad", new URL("/y", "https://example.com:8443/dir/file").href);
describe("absolute", new URL("ftp://h/p", "http://localhost").href);
describe("same-scheme", new URL("http:rel", "http://localhost/dir/").href);
const mutated = new URL("/m", "http://localhost");
mutated.pathname = "/changed";
mutated.host = "elsewhere:81";
describe("mutated", mutated.href);
describe("fresh", new URL("/m", "http://localhost").href);
describe("ordered", ["http://localhost", "http://localhost/", "http://localhost:80"].map((b) => new URL("p", b).href));

// --- a class with many subclasses checked through an untyped slot ---
class Shape { area() { return 0; } }
class Circle extends Shape { area() { return 3; } }
class Square extends Shape { area() { return 4; } }
class Tri extends Shape { area() { return 2; } }
class Hex extends Shape { area() { return 6; } }
class Other { area() { return -1; } }
const items = [new Shape(), new Circle(), new Square(), new Tri(), new Hex(), new Other(), null, undefined, 3, "s", {}, []];
describe("instanceof", items.map((x) => x instanceof Shape));
describe("areas", items.map((x) => (x instanceof Shape ? x.area() : null)));
describe("sub", items.map((x) => x instanceof Circle || x instanceof Hex));

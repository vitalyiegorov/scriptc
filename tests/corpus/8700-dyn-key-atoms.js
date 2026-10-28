// Property keys are interned while short and few; the rest stay counted. Both kinds must
// behave identically through object reuse, deletion, enumeration and teardown.
function make(n, prefix) {
  const o = {};
  for (let i = 0; i < n; i++) o[prefix + i] = i;
  return o;
}

// Far more distinct short spellings than any intern table keeps, so late keys are counted keys.
let total = 0;
for (let round = 0; round < 3; round++) {
  for (let batch = 0; batch < 40; batch++) {
    const o = make(600, "k" + batch + "_");
    total += Object.keys(o).length;
    total += o["k" + batch + "_599"];
    delete o["k" + batch + "_1"];
    total += Object.keys(o).length;
  }
}
console.log("distinct", total);

// Long keys bypass interning.
const long = "L".repeat(100);
const a = {};
a[long + "a"] = 1;
a[long + "b"] = 2;
a.short = 3;
const b = { short: 4 };
b[long + "a"] = 5;
console.log(Object.keys(a).map((k) => k.length), a[long + "a"], b[long + "a"], b.short);

// Pooled objects keep and reuse their keys; mixed atom and counted keys per object.
function row(i) {
  const r = { id: i, name: "n" + i, tags: ["a", "b"] };
  r["extra_" + (i % 7) + "_" + "x".repeat(70)] = i * 2;
  r["dyn" + i] = i;
  if (i % 3 === 0) delete r.name;
  return r;
}
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const r = row(i);
  sum += r.id + (r.name ? r.name.length : 0) + Object.keys(r).length;
  const copy = JSON.parse(JSON.stringify(r));
  sum += Object.entries(copy).length;
  const spread = { ...r, id: -i };
  sum += spread.id;
}
console.log("sum", sum);

// Same spelling built independently is the same property.
const x = {};
const y = {};
const key = ["pr", "op"].join("");
x[key] = 1;
y.prop = 2;
console.log(x.prop, y[key], Object.keys(x)[0] === Object.keys(y)[0], key in x);

// Order, accessors and symbols are untouched.
const z = { b: 1, a: 2, 10: "ten", 2: "two" };
Object.defineProperty(z, "g", { get() { return this.a + this.b; }, enumerable: true });
console.log(Object.keys(z), z.g, JSON.stringify(z));

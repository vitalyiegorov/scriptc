// Symbol basics: every Symbol() call is a fresh identity (equal
// descriptions are still distinct symbols), a symbol equals exactly
// itself, toString() is "Symbol(desc)", .description distinguishes
// absent from empty, and every symbol is truthy.
const a: symbol = Symbol("alpha");
const b: symbol = Symbol("alpha");
const anon: symbol = Symbol();
const empty: symbol = Symbol("");

console.log(typeof a);
console.log(a === b);
console.log(a === a);
console.log(a !== b);
console.log(a.toString());
console.log(anon.toString());
console.log(empty.toString());
console.log(a.description ?? "(absent)");
console.log(anon.description ?? "(absent)");
console.log(empty.description === "" ? "empty-string" : "not-empty");
if (a) console.log("truthy");
if (anon) console.log("anon-truthy");

// valueOf is the identity read.
console.log(a.valueOf() === a);

// Symbols captured by closures keep their identity.
const make = (s: symbol) => () => s;
const get = make(a);
console.log(get() === a);
console.log(get() === b);

// A declaration augmentation does not install a proposed runtime symbol.
declare global { interface SymbolConstructor { readonly observable: symbol; } }
const observableKey = (typeof Symbol === "function" && Symbol.observable) || "@@observable";
console.log(observableKey, typeof Symbol.observable);
export {};

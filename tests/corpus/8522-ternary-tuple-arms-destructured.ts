// Tuple literal arms of a nested ternary build as the checker's joined tuple, and a
// binding narrowed to undefined fills an `undefined` tuple slot (Nest's ConsoleLogger
// `[context, opts] = isString(x) ? [x, o] : o ? [undefined, o] : [x?.context, x]`).
interface Opts {
  context?: string;
  json?: boolean;
}
function h3(v?: string | Opts, o?: Opts) {
  const [a, b] = o ? [undefined, o] : typeof v === "string" ? [v, o] : [v?.context, v];
  return [a, b?.context];
}
function q1(value?: string, other?: Opts) {
  const [a, b] = other ? [undefined, other] : [value, other];
  return [a, b?.context];
}
function f(o?: Opts) {
  if (!o) {
    const pair: [string | undefined, undefined] = ["x", o];
    return pair;
  }
  return ["y", undefined] as [string | undefined, undefined];
}
console.log(h3("s"), h3({ context: "e" }), h3(undefined, { context: "f" }), h3());
console.log(q1("s", { context: "o" }), q1("s"), f(), f({ context: "c" }));

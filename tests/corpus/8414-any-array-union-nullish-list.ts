// A lazily created `any[]` list (`let errors: any[] | undefined`, rxjs's
// Subscription.unsubscribe): the union of an `any[]` and undefined is one
// checked-dynamic slot, `errors ?? []` builds a dynamic empty list that later
// pushes can grow, and spreads of it rebuild the list.
class MultiError extends Error {
  errors: any[];
  constructor(errors: any[]) { super("multi"); this.errors = errors; this.name = "MultiError"; }
}
function run(fns: (() => void)[]): void {
  let errors: any[] | undefined;
  for (const fn of fns) {
    try { fn(); } catch (err) {
      errors = errors ?? [];
      if (err instanceof MultiError) {
        errors = [...errors, ...err.errors];
      } else {
        errors.push(err);
      }
    }
  }
  if (errors) {
    throw new MultiError(errors);
  }
}
try {
  run([() => { throw new Error("a"); }, () => {}, () => { throw "b"; }]);
} catch (e) {
  console.log((e as MultiError).errors.length, (e as MultiError).errors[1]);
}
run([() => {}]);
console.log("done");

let a: any[] | undefined;
a = a ?? [];
a.push({ x: 1 });
console.log(a);
function lazy(x?: any[]): any[] {
  const r = x ?? [];
  r.push(1);
  return r;
}
console.log(lazy(), lazy(["z"]));

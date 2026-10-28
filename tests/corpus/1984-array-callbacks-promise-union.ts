// Array callbacks over `boolean | Promise<boolean>` elements. That union has
// no layout with an undefined arm, so a callback reads each element directly.
type Settled = boolean | Promise<boolean>;

function isPromise(value: unknown): value is Promise<boolean> {
  return typeof value === "object" && value !== null && typeof (value as any).then === "function";
}

function summarize(values: Settled[], keep: (v: Settled) => boolean): number[] {
  const counts: number[] = [];
  let seen = 0;
  values.forEach((v) => {
    if (isPromise(v)) seen++;
  });
  counts.push(seen);
  counts.push(values.map((v) => (v instanceof Promise ? 1 : 0)).length);
  counts.push(values.filter(keep).length);
  counts.push(values.find(keep) === undefined ? 0 : 1);
  counts.push(values.every(keep) ? 1 : 0);
  counts.push(values.some(keep) ? 1 : 0);
  counts.push(values.findIndex(keep));
  counts.push(values.reduce((acc, v) => acc + (isPromise(v) ? 1 : 0), 0));
  return counts;
}

const mixed: Settled[] = [true, Promise.resolve(false), false];
console.log(summarize(mixed, (v) => v === true).join(","));
console.log(summarize(mixed, isPromise).join(","));
console.log(mixed.some((v: Settled) => isPromise(v)));

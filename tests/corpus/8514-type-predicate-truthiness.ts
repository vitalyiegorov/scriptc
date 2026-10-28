// A type-predicate function is consumed by truthiness, and an `any`
// operand (`value && f(value.x)`) may yield a falsy non-boolean: the
// predicate answers that operand's truthiness.
function isFunction(value: any): value is (...args: any[]) => any {
  return typeof value === "function";
}
function isScheduler(value: any): value is { schedule: () => void } {
  return value && isFunction(value.schedule);
}
const inputs: any[] = [null, undefined, 0, "", { schedule() {} }, { schedule: 1 }, 5];
for (const input of inputs) {
  if (isScheduler(input)) console.log("scheduler");
  else console.log("not a scheduler");
}

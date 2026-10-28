// .toString() on a union of strings and builtin Error classes (rxjs's
// UnsubscriptionError message lists `(Error | string)[]`): strings answer
// themselves and Errors answer Error.prototype.toString, with no narrowing.
function describe(errors: (Error | string)[]): string {
  return errors.map((err, i) => `${i + 1}) ${err.toString()}`).join('\n  ');
}
console.log(describe(['a', new Error('b'), new TypeError('c')]));
const u: Error | string = Math.random() > 2 ? 'x' : new RangeError('r');
console.log(u.toString());

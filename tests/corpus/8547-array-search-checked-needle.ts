// An array search whose needle is an assertion over an untyped value: strict
// equality never converts, so a value of another kind is simply not found
// (Nest's `providersKeys.includes(provider.provide as string)`).
const keys: string[] = ["APP_GUARD", "APP_PIPE"];
const numbers: number[] = [1, 2, 3];
class Token {}
const values: any[] = ["APP_PIPE", Token, Symbol.for("s"), 2, "other", undefined, null, { a: 1 }];
for (const value of values) {
  console.log(
    keys.includes(value as string),
    keys.indexOf(value as string),
    numbers.includes(value as number),
    numbers.indexOf(value as number),
  );
}

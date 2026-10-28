// A numeric enum's reverse mapping through a runtime index, and a
// `string | number` key that reads either direction.
enum Method {
  GET = 0,
  POST,
  ALL = 4,
}
const values: Method[] = [Method.ALL, Method.GET, Method.POST];
for (const value of values) console.log(value, Method[value]);
const label = (method: string | number): string => `{${Method[method as number]}}`;
console.log(label(4), label(1));
let i = 0;
i += 1;
console.log(Method[i]);
// An index no member carries answers undefined, as in Node.
let miss = 8;
miss += 1;
console.log(Method[miss], Method[miss] ?? "none", Method[miss] === undefined);

// `Array.from(untypedArray, mapper)`: the mapper sees each element and its
// index, and the result is the mapped array.
const registry: Record<string, any> = { deps: [{ token: "a", optional: true }, "b", { token: "c" }] };
const list: any = registry["deps"];
const optional: number[] = [];
const tokens = Array.from(list, (item: any, index: number) => {
  if (typeof item !== "object") return item;
  if (item.optional) optional.push(index);
  return item.token;
});
console.log(tokens.join(","), optional.join(","));
const lengths: number[] = Array.from(list as any[], (item) => String(item).length);
console.log(lengths.length);

import { Resolver, argumentsLength, exchange, contexts, creators, describeMethod, loggers, names, pipeLengths, methodName, methodNames, extractors, newables, reflect, resolveAll } from "asserted";

console.log(resolveAll([1, 0, 1]).join("\n"));
console.log(new Resolver().resolve([1, 2, 3]).join("\n"));
console.log(argumentsLength(["a", "b"], { a: { index: 2 }, b: { index: 0 } }), argumentsLength([], {}));
console.log(
  exchange(["a", "custom"], { a: { index: 1, data: "d" }, custom: { index: 2, data: "e", factory: (v: string) => v + "!" } }).join(","),
);
console.log(extractors(["p", "q"], 10).map((e) => e.key + e.extract({ n: 1 }, "r")).join(","));
console.log(reflect(["a", "n", "s"]).join(","));
console.log(newables().join(","));
console.log(creators().join(","));
console.log(contexts());
console.log(methodNames([4, 0, 1]).join(","));
console.log(methodName(1), methodName(2));
console.log(describeMethod("/p", 4), describeMethod("/q", "POST"), describeMethod("/r", 1));
console.log(loggers().join(","));
console.log((await names()).join(","));
console.log(await pipeLengths());

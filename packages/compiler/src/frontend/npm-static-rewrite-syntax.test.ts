import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { rewriteBundlerCjsExports } from "./npm-static-rewrite.js";

const source = readFileSync(
  new URL(
    "../../../../tests/corpus/npm-cjs-annotated-runtime-exports/node_modules/callback-exports/index.cjs",
    import.meta.url,
  ),
  "utf8",
);
const probe = `
const value = module.exports;
console.log(typeof value.add, value.self() === value, value.missing === undefined);
console.log(value.add(4), value.total, value.add(3), value.total);
console.log(Object.keys(value).join(','), value[Symbol.for('callback-exports')]);
value.extra = 11;
console.log(value.self().extra);
`;
function run(text: string) {
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "--eval", text], {
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("annotated callback exports retain their actual object, descriptors, symbols and mutations", () => {
  const result = rewriteBundlerCjsExports(source, "/pkg/index.cjs");
  expect(typeof result).toBe("string");
  const transformed = result as string;
  const oracle = run(source + probe);
  expect(oracle.status).toBe(0);
  expect(run(transformed + probe)).toEqual(oracle);
  expect(transformed.indexOf("factory(")).toBe(source.indexOf("factory("));
  expect(transformed.indexOf("exports.add =")).toBe(source.indexOf("exports.add ="));
  expect(transformed).not.toContain("__scriptc_any");
});

test("callback export annotations do not require a particular bundler helper", () => {
  const plain = source.replace(/^.*Object\.defineProperty.*$/m, "");
  const result = rewriteBundlerCjsExports(plain, "/pkg/index.cjs");
  expect(typeof result).toBe("string");
  expect(run(result + probe)).toEqual(run(plain + probe));
});

test.each([
  ["replaced object", source.replace("factory(module.exports)", "factory(module.exports = {})")],
  ["shadowed module", source.replace("function (factory)", "function (module)")],
  ["bare exports", source.replace("factory(module.exports)", "factory(exports)")],
  ["deleted object", source.replace("factory(module.exports)", "factory(delete module.exports)")],
])("does not materialize an annotated %s outside the closed-object subset", (_name, text) => {
  const result = rewriteBundlerCjsExports(text, "/pkg/index.cjs");
  expect(typeof result === "string" ? result : "").not.toContain("function __scget");
});

// "?." on a receiver the checker narrowed past more arms than the stored union's undefined
// (a type-guard false branch over `string | Options | undefined`).
interface Opts { context?: string; json?: boolean }
const isString = (val: any): val is string => typeof val === "string";
function a(value: string | Opts): string | undefined {
  return isString(value) ? value : value.context;
}
function b(value?: string | Opts): string | undefined {
  return typeof value === "string" ? value : value?.context;
}
function c(value?: string | Opts): string | undefined {
  if (isString(value)) return value;
  return value?.context;
}
console.log(a("s"), a({ context: "c" }), b("s"), b(), c({ context: "x" }));

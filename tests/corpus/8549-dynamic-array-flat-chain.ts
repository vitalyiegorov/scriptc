// An array whose element type is a union of an untyped class value and an
// interface lives in the checked-dynamic tree: map, flat and forEach run on it.
interface Type<T = any> extends Function { new (...args: any[]): T; }
interface PipeTransform { transform(value: any): any }
interface ParamMeta { index: number; data: unknown; pipes: Array<Type<PipeTransform> | PipeTransform> }
class Upper implements PipeTransform { transform(v: any) { return String(v).toUpperCase(); } }
class Trim { transform(v: any) { return String(v).trim(); } }
function lookup(): any { return { a: { index: 0, data: 1, pipes: [Upper, new Upper()] }, b: { index: 1, data: 2, pipes: [Trim] } }; }
function run(): string[] {
  const metadata: Record<string, ParamMeta> = lookup();
  const out: string[] = [];
  const params = Object.values(metadata);
  params
    .map(item => item.pipes)
    .flat(1)
    .forEach(injectable => out.push(typeof injectable === "function" ? "class" : "instance"));
  return out;
}
console.log(run().join(","));

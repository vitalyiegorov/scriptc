// @tsc-legacy-decorators
import { Service, Remote, Models } from "./dependency.js";
import type { Shape, Alias, TypeOnlyClass } from "./dependency.js";

declare global {
  namespace Reflect {
    function metadata(key: string, value: any): (target: any, property?: string | symbol) => void;
    function getMetadata(key: string, target: any, property?: string | symbol): any;
  }
}
const records: any[] = [];
Reflect.metadata = (key: string, value: any) => (target: any, property?: string | symbol): void => {
  records.push({ key, value, target, property });
};
Reflect.getMetadata = (key: string, target: any, property?: string | symbol): any => {
  for (let current: any = target; current !== null; current = Object.getPrototypeOf(current)) {
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (record.key === key && record.target === current && record.property === property) return record.value;
    }
  }
  return undefined;
};
function dec(...args: any[]): void {}
@dec class Base {
  @dec label: string = "base";
  constructor(public service: Service, shape: Shape, alias: Alias, only: TypeOnlyClass) {}
  @dec method(count: number, dependency: Service): Promise<string> { return Promise.resolve("ok"); }
  @dec get current(): Service { return this.service; }
  set current(value: Service) { this.service = value; }
}
class Derived extends Base {}
const params: any[] = Reflect.getMetadata("design:paramtypes", Base);
console.log(params.map((type: any) => type.name).join(","));
console.log(params[0] === Service, params[1] === Object);
console.log(Reflect.getMetadata("design:paramtypes", Derived) === params);
console.log(Reflect.getMetadata("design:type", Base.prototype, "label") === String);
console.log(Reflect.getMetadata("design:type", Base.prototype, "method") === Function);
console.log(Reflect.getMetadata("design:returntype", Base.prototype, "method") === Promise);
const methodParams: any[] = Reflect.getMetadata("design:paramtypes", Base.prototype, "method");
console.log(methodParams[0] === Number, methodParams[1] === Service);
console.log(Reflect.getMetadata("design:type", Base.prototype, "current") === Service);
const setterParams: any[] = Reflect.getMetadata("design:paramtypes", Base.prototype, "current");
console.log(setterParams.length, setterParams[0] === Service);
console.log(Reflect.getMetadata("design:type", Derived.prototype, "label") === String);
class MixedAccessors {
  @dec get mixed(): number { return 1; }
  set "mixed"(value: number) {}
}
console.log(Reflect.getMetadata("design:type", MixedAccessors.prototype, "mixed") === Number);
console.log(Reflect.getMetadata("design:paramtypes", MixedAccessors.prototype, "mixed")[0] === Number);
try {
  @dec class ForwardTarget { constructor(dependency: Later) {} }
  class Later {}
  console.log("no forward throw");
} catch (error) { console.log((error as Error).name); }
enum Numeric { A, B = -1 }
enum Text { A = "a" }
enum Mixed { A = 1, B = "b" }
const enum Inline { A = 1 }
type Id = string;
type Brand = string & { __brand: "id" };
class Types {
  @dec enums(numeric: Numeric, text: Text, mixed: Mixed, inline: Inline, remote: Remote): void {}
  @dec names(qualified: Models.Inner, imported: import("./dependency.js").Service, alias: Id, brand: Brand): void {}
  @dec others(big: bigint, template: `id-${number}`, items: readonly string[], nullable: Service | undefined, optional?: Service): void {}
  @dec async load(first: Service, ...rest: number[]) { return first; }
  @dec check(value: unknown): value is string { return true; }
  @dec untyped() {}
  @dec patterns({ a }: { a: number }, [b]: number[], c = 3) { return a + b + c; }
}
for (const key of ["enums", "names", "others", "load", "patterns"]) {
  const types: any[] = Reflect.getMetadata("design:paramtypes", Types.prototype, key);
  console.log(key, types.map((type: any) => type.name).join(","));
}
console.log(new Types().patterns({ a: 1 }, [2]), Reflect.getMetadata("design:returntype", Types.prototype, "load").name, Reflect.getMetadata("design:returntype", Types.prototype, "check").name, Reflect.getMetadata("design:returntype", Types.prototype, "untyped"));

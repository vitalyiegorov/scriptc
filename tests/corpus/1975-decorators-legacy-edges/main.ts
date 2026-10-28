// @tsc-legacy-decorators
import Anonymous from "./anonymous.js";
import { tag } from "./factory.js";
const observedKey: unique symbol = Symbol("once");
@tag() class Tagged {}
console.log((Tagged as any).custom);
const events: string[] = [];
function key(label: string): string { events.push(`key:${label}`); return label; }
function member(label: string): MethodDecorator {
  events.push(`factory:${label}`);
  return (target, property, descriptor) => {
    events.push(`apply:${label}:${String(property)}`);
    if (descriptor.value) {
      const original: any = descriptor.value;
      descriptor.value = function (this: any, ...args: any[]) { return original.apply(this, args) + 1; } as any;
    }
  };
}
function klass<T extends Function>(target: T): void { events.push(`class:${target.name}`); }
@klass /* class keyword in a comment */ class Generic<T extends object> {
  constructor(public value: T) {}
  read(): T { return this.value; }
}
class Computed {
  value = 4;
  @member("computed") [key("run")](input: number) { return this.value + input; }
}
function make(input: number): number {
  @klass class Nested { value = input; @member("nested") read() { return this.value; } }
  return new Nested().read();
}
class Replacement { value = "replacement"; }
let original: any;
function replace<T extends Function>(target: T): T { original = target; return Replacement as any; }
@replace class Rebound { value = "original"; static self() { return Rebound; } }
console.log(new Anonymous().value, new Generic<{ count: number }>({ count: 7 }).read().count);
const computed: any = new Computed();
console.log(computed.run(2));
console.log(make(3), make(8));
console.log(new Rebound().value, original.self() === Rebound, Rebound === (Replacement as any));
console.log(events.join("|"));

@klass class Merged {}
namespace Merged {
  export let count = 1;
  export const snapshot = Merged.count;
  export function increment() { count++; }
}
Merged.increment();
(Merged as any).count = 9;
console.log(Merged.count, Merged.snapshot, Object.getOwnPropertyDescriptor(Merged, "count")!.value);
interface InterfaceTarget { value: number; }
@klass class InterfaceTarget { value = 8; }
@klass abstract class AbstractTarget { abstract read(): number; }
class ConcreteTarget extends AbstractTarget { read() { return 12; } }
console.log(new InterfaceTarget().value, new ConcreteTarget().read());
class GenericBase<T> { value!: T; }
@klass class GenericChild<T> extends GenericBase<T> {
  identity<U extends T>(value: U): U { return value; }
}
console.log(new GenericChild<number>().identity(13), new GenericChild<number>() instanceof GenericBase);
const fieldKey = Symbol("field");
class ComputedFields { @fieldDecorator [fieldKey] = 14; @fieldDecorator ["label"]!: string; }
function fieldDecorator(...args: any[]): void { console.log("field-key", String(args[1]), args.length); }
const computedFields: any = new ComputedFields();
console.log(computedFields[fieldKey], computedFields.label);
@klass class ParentTarget {
  value = 3;
  constructor(initial: number = 3) { this.value = initial; }
  @member("inherited") read() { return this.value; }
  get amount() { return this.value; }
  set amount(value: number) { this.value = value; }
  static kind() { return "parent"; }
}
@klass class ChildTarget extends ParentTarget {
  read() { return super.read() + 1; }
  get amount() { return super.amount + 2; }
  set amount(value: number) { super.amount = value - 2; }
  static kind() { return super.kind() + ":child"; }
}
const child = new ChildTarget();
child.amount = 10;
console.log(child.read(), child.amount, ChildTarget.kind(), new ChildTarget(20).read());
const accessorEvents: string[] = [];
function getterDecorator(...args: any[]): void { accessorEvents.push("getter"); args[2].get = () => 42; }
function setterParameter(...args: any[]): void { accessorEvents.push("parameter"); }
class PairedTarget { @getterDecorator get paired() { return 1; } set "paired"(@setterParameter value: number) {} }
console.log(accessorEvents.join(","), new PairedTarget().paired);
let nextAccessorKey = 0;
function accessorKey(): string { return `key${nextAccessorKey++}`; }
class DynamicAccessors { @getterDecorator get [accessorKey()]() { return 2; } set [accessorKey()](@setterParameter value: number) {} }
console.log(accessorEvents.join(","), Object.getOwnPropertyNames(DynamicAccessors.prototype).join(","));
const reflectCalls: number[] = [];
(Reflect as any).decorate = function (...args: any[]): any { reflectCalls.push(args.length); return args[1]; };
@klass class ReflectTarget {}
console.log(reflectCalls.join(","));
let keyReads = 0;
const observedKeys = { get field(): typeof observedKey { keyReads++; return observedKey; } };
class ObservedField { @fieldDecorator [observedKeys.field] = 15; }
console.log(new ObservedField()[observedKey], keyReads);
@klass class MultiNamespace {}
namespace MultiNamespace {
  export const x = 1, y = MultiNamespace.x;
  export let { left, right = left } = { left: 2, right: undefined as number | undefined };
}
console.log(MultiNamespace.x, MultiNamespace.y, MultiNamespace.left, MultiNamespace.right);
@klass class SplitNamespace {}
namespace SplitNamespace { export let value = 1; }
namespace SplitNamespace { export function read() { return value; } }
SplitNamespace.value = 2;
console.log(SplitNamespace.read());
class ParenthesizedAccessors { @getterDecorator get [("parenthesized")]() { return 2; } set parenthesized(@setterParameter value: number) {} }
console.log(accessorEvents.join(","), new ParenthesizedAccessors().parenthesized);
// Fields use define semantics (ES2022): uninitialized decorated fields are own properties and shadow
// prototype accessors a decorator installs; abstract and declare fields still run their decorators.
delete (Reflect as any).decorate;
const fieldLog: string[] = [];
function trackField(target: any, key: string): void { fieldLog.push(`${target.constructor.name}.${key}`); }
function lazyField(target: any, key: string): any { return { get() { return `lazy:${key}`; }, configurable: true }; }
class FieldEntity {
  @trackField id!: number;
  @trackField name?: string;
  @trackField count = 1;
  @lazyField relation!: string;
  constructor(public tag: string) { fieldLog.push(`ctor:${this.count}`); this.id = 7; }
}
const fieldEntity = new FieldEntity("t");
console.log(Object.keys(fieldEntity).join(","), fieldEntity.name, fieldEntity.relation);
abstract class FieldBase {
  @trackField abstract table: string;
  @trackField declare kind: string;
  constructor() { this.kind = "k"; }
}
class FieldUsers extends FieldBase { table = "users"; }
console.log(Object.keys(new FieldUsers()).join(","), fieldLog.join("|"));
// Decorator arguments evaluate after the class body: they read its statics and the class binding.
const staticRefs: string[] = [];
function maxItems(limit: number): PropertyDecorator { return (target, key) => { staticRefs.push(`${String(key)}<=${limit}`); }; }
function injectClass(type: any): ParameterDecorator { return () => { staticRefs.push(`inject:${type === StaticRefs}`); }; }
function sealedClass(target: any): void { staticRefs.push(`sealed:${target.label}`); }
@sealedClass
class StaticRefs {
  static readonly LIMIT = 20;
  static label = `${StaticRefs.name}:${StaticRefs.LIMIT}`;
  #secret = 3;
  @maxItems(StaticRefs.LIMIT) items: number[] = [];
  constructor(@injectClass(StaticRefs) readonly id: number) {}
  copy(): StaticRefs { return new StaticRefs(this.id + this.#secret); }
}
console.log(new StaticRefs(1).copy().id, staticRefs.join(","));

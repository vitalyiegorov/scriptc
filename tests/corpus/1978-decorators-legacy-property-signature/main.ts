// @tsc-legacy-decorators
// Property decorators declared with the two-argument shape used by libraries
// such as class-transformer, and decorator factories returning them.
const registry: string[] = [];
function Type(factory: () => unknown) {
  return (target: object, propertyName: string | symbol): void => {
    registry.push(`${target.constructor.name}.${String(propertyName)}:${typeof factory()}`);
  };
}
function Exposed(target: object, propertyName: string | symbol): void {
  registry.push(`exposed ${target.constructor.name}.${String(propertyName)}`);
}
function Tag(name: string): (target: object, propertyName: string | symbol) => void {
  return function (target, propertyName) {
    registry.push(`${name}:${String(propertyName)}`);
  };
}

// A generic (target, key) decorator: the lowering pins it to a concrete signature.
function Generic(label: string): <T extends object>(target: T, propertyName: string | symbol) => void {
  return (target, propertyName) => { registry.push(`generic:${label}:${String(propertyName)}`); };
}

class Event {
  @Generic("g") tagged = 1;
  @Type(() => Date) when!: Date;
  @Exposed @Tag("a") name = "launch";
  @Tag("static") static kind = "event";
  @Tag("accessor") get label(): string { return this.name; }
}

// A decorated class passed to a generic callee keeps its instance type.
function make<T>(cls: new () => T): T { return new cls(); }
const event = make(Event);
console.log(event.name, event.label, Event.kind);
console.log(registry.join("\n"));

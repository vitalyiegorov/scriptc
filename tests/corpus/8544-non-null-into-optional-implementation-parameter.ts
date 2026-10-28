// A `!` argument passed to an overload that requires the value, where the
// implementation signature makes it optional: `!` has no runtime effect, so
// the callee sees the undefined (Nest's `addProvider(provider, subtype!)`).
class Registry {
  private entries: string[] = [];
  add(name: string): string;
  add(name: string, subtype: string): string;
  add(name: string, subtype?: string): string {
    const label = subtype === undefined ? name : name + ":" + subtype;
    this.entries.push(label);
    return label;
  }
  list(): string {
    return this.entries.join(",");
  }
}
class Container {
  private registry = new Registry();
  register(name: string, subtype?: string): string {
    return this.registry.add(name, subtype!);
  }
  list(): string {
    return this.registry.list();
  }
}
const container = new Container();
console.log(container.register("a"));
console.log(container.register("b", "x"));
console.log(container.list());
function describe(value: string | null | undefined): string;
function describe(value: string | null | undefined, extra: number): string;
function describe(value: string | null | undefined, extra?: number): string {
  return String(value) + "/" + String(extra);
}
function wrap(value: string | undefined, extra?: number): string {
  return describe(value!, extra!);
}
console.log(wrap(undefined), wrap("q", 3));

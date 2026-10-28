// @transform-types
// A local class that captures outer variables, extends an abstract base whose
// constructor differs, and is returned through a `Type<T>` constructor slot
// must be constructible and callable through that slot.
interface Type<T> extends Function {
  new (...args: any[]): T;
}
abstract class Ref {
  protected scope: string;
  protected depth: number;
  constructor(scope: string, depth: number) {
    this.scope = scope;
    this.depth = depth;
  }
  abstract get(token: string): string;
  describe(): string {
    return "ref " + this.scope + " " + this.depth;
  }
}
class Container {
  private label = "box";
  private count = 0;
  makeType(): Type<Ref> {
    const self = this;
    return class extends Ref {
      constructor() {
        super(self.label, self.count++);
      }
      get(token: string): string {
        return token + "@" + self.label + self.count;
      }
      describe(): string {
        return "derived " + super.describe() + " " + self.count;
      }
    };
  }
}
class Plain extends Ref {
  get(token: string): string {
    return token + "!" + this.depth;
  }
}
const c = new Container();
const T1 = c.makeType();
const a = new T1();
const b = new T1();
console.log(a.describe(), a.get("x"));
console.log(b.describe(), b.get("y"));
console.log(a instanceof Ref, a instanceof T1, b instanceof T1);
const slots: Type<Ref>[] = [T1, Plain, c.makeType()];
for (const slot of slots) {
  const args: any[] = ["s", 7];
  const made = new slot(...args);
  console.log(made.describe(), made.get("k"));
}
const T2: Type<Ref> = Plain;
console.log(new T2("x", 3).describe());

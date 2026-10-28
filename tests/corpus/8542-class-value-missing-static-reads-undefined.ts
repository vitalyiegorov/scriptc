// @transform-types
// Reading a name no class declares off an untyped value that is a class
// constructor answers undefined, like any object without that property.
class Svc { static tag = "svc"; }
class Plain {}
class Derived extends Svc { static own = 5; }
class Derived2 extends Plain {}
class WithMethod {
  static tag = "wm";
  static make(): string {
    return "made";
  }
}
class DerivedMethod extends WithMethod {}
const items: any[] = [Svc, Plain, Derived, Derived2, WithMethod, DerivedMethod, { provide: "tok", useValue: 1 }, JSON.parse('{"provide":"j"}')];
for (const p of items) {
  console.log(p.provide, p.tag, p.own, p.name);
}
function isCustom(provider: any): boolean { return provider && provider.provide !== undefined; }
console.log(items.map(isCustom).join());

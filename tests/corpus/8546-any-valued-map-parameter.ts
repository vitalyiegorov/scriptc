// @transform-types
// A collection parameter typed with an `any` value (`Map<K, any>`) binds to the
// map each caller holds, whatever its element type, and forwards it on.
class Wrapper {
  constructor(readonly name: string) {}
}
class Hub {
  private readonly providers = new Map<unknown, Wrapper>();
  private readonly injectables = new Map<unknown, Wrapper>();
  addProvider(token: string): void {
    this.fill(token, this.providers);
  }
  addInjectable(token: string): void {
    this.fill(token, this.injectables);
  }
  private fill(token: string, collection: Map<unknown, any>): void {
    this.store(token, collection);
  }
  private store(token: string, collection: Map<unknown, Wrapper>): void {
    collection.set(token, new Wrapper("w:" + token));
  }
  describe(): string {
    return [...this.providers.keys()].join(",") + "|" + [...this.injectables.values()].map((w) => w.name).join(",");
  }
}
const hub = new Hub();
hub.addProvider("a");
hub.addInjectable("b");
hub.addProvider("c");
console.log(hub.describe());

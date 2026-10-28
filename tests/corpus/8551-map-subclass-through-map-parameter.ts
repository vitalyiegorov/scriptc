// @transform-types
// A class extending Map<string, V> flows into Map<string, V> parameters (also as
// a default value) and spreads its values (Nest's ModulesContainer).
class Mod { constructor(readonly id: string) {} }
class Mods extends Map<string, Mod> {
  getById(id: string): Mod | undefined {
    return Array.from(this.values()).find((m) => m.id === id);
  }
}
class Loader<T extends object = object> {
  constructor(protected readonly tag: T, private readonly container: Mods) {}
  names(modules: Map<string, Mod> = this.container): string[] {
    return [...modules.values()].map((m) => m.id);
  }
  async all(modules: Map<string, Mod> = this.container): Promise<number> {
    const rows = await Promise.all([...modules.values()].map(async (m) => m.id.length));
    return rows.reduce((a, b) => a + b, 0);
  }
}
const mods = new Mods();
mods.set("a", new Mod("alpha"));
mods.set("b", new Mod("beta"));
const loader = new Loader({}, mods);
console.log(loader.names().join(","), mods.getById("b")?.id);
loader.all().then((n) => console.log(n));
const plain = new Map<string, Mod>([["z", new Mod("zeta")]]);
console.log(loader.names(plain).join(","));

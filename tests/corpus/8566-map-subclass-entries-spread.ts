// @transform-types
// Spreading the entries of a Map reached through a Map subclass slot into a
// tuple array.
class Mod { constructor(readonly id: string) {} }
class Mods extends Map<string, Mod> {}
function ids(modules: Map<string, Mod>): string {
  const entries: [string, Mod][] = [...modules.entries()];
  return entries.map(([key, mod]) => key + "=" + mod.id).join(",");
}
const mods = new Mods();
mods.set("a", new Mod("alpha"));
mods.set("b", new Mod("beta"));
console.log(ids(mods));
console.log(ids(new Map([["z", new Mod("zeta")]])));

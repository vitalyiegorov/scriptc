export type Tag = <T extends Function>(target: T) => T | void;
export function tag(): Tag {
  return (target) => { Object.defineProperty(target, "custom", { value: "generic-factory" }); };
}

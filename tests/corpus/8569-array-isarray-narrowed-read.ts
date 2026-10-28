// Array.isArray over a flow-narrowed read of a typed array parameter.
function enabled(levels: string[] | undefined, target: string): boolean {
  if (!levels || (Array.isArray(levels) && levels?.length === 0)) return false;
  return levels.includes(target);
}
console.log(enabled(undefined, "a"), enabled([], "a"), enabled(["a", "b"], "b"), enabled(["a"], "z"));

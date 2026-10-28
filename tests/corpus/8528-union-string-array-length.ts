interface Meta {
  path?: string | string[];
}
function pick(meta: Meta): string | string[] {
  const p = meta.path;
  return p && p.length ? p : '/';
}
function len(v: string | string[] | number[]): number {
  return v.length;
}
console.log(pick({ path: 'a' }), pick({ path: ['b', 'c'] }), pick({ path: '' }), pick({ path: [] }), pick({}));
console.log(len('abc'), len(['x']), len([1, 2, 3]), len(''));
const u: string | string[] | undefined = Math.random() > 2 ? 'x' : ['q', 'r'];
console.log(u?.length, u && u.length);

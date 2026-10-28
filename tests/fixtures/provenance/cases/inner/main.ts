import { Source, innerFrom, kind, switchEach } from "inner";
import type { Readable } from "inner";

const out: unknown[] = [];
const emit = (v: unknown) => {
  out.push(v);
};
const src = new Source<number>((e) => {
  e(1);
  e(2);
});
console.log(innerFrom(src) === src);
const readable: Readable<string> = { read: () => "read" };
innerFrom(readable).subscribe(emit);
innerFrom([10, 20]).subscribe(emit);
innerFrom(new Set(["a", "b"])).subscribe(emit);
innerFrom(Promise.resolve("p")).subscribe(emit);
switchEach(
  [1, 2, 3],
  (n) => (n === 1 ? src : n === 2 ? [n, n * 2] : Promise.resolve(n * 100)),
  emit,
);
await Promise.resolve();
await Promise.resolve();
console.log(JSON.stringify(out));
// A `void` type argument still maps the iterable arm of the input union.
function* nothing(): Generator<void> {}
console.log(kind<void>(Promise.resolve()), kind<void>([]), kind<void>(nothing()));

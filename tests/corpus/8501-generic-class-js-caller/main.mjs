import { Rep, Sub } from "./lib.ts";
export class H {
  s = new Rep();
  t = new Sub();
  set a(/** @type {number} */ v) { this.s.next(); this.s.complete(); this.t.next(5); this.t.complete(); }
}
const h = new H();
h.a = 1;
console.log(h.s.n, h.t.n, h.s.closed);

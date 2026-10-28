export class Obs<T> {
  src?: Obs<any>;
  subscribe(f: (v: T) => void): void { console.log("subscribe"); }
}
export class Sub<T> extends Obs<T> {
  n = 0;
  closed = false;
  next(v?: T): void { this.n++; console.log("next", v); }
  complete(): void { this.closed = true; console.log("complete"); }
}
export class Rep<T> extends Sub<T> {
  buf: T[] = [];
  size: number;
  constructor(size: number = Infinity) { super(); this.size = size; }
  override next(v?: T): void { if (v !== undefined) this.buf.push(v); super.next(v); }
}

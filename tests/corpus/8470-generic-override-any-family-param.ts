// An override declaring a generic class instantiation (`Sink<T>`) over a
// base method declaring `Sink<any>`: same JavaScript value, the override's
// narrower parameter and a narrowed union member return.
class Sink<T> {
  last: T | undefined = undefined;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  put(v: T): void {
    this.last = v;
  }
}

class Teardown {
  done = false;
  stop(): void {
    this.done = true;
  }
}

type Logic = Teardown | (() => void) | void;

class Base<T> {
  protected sub(s: Sink<any>): Logic {
    return undefined;
  }
  run(s: Sink<T>): Logic {
    return this.sub(s);
  }
}

class Derived<T> extends Base<T> {
  protected sub(s: Sink<T>): Teardown {
    console.log("sub", s.name, s.last);
    return new Teardown();
  }
}

const d = new Derived<number>();
const s = new Sink<number>("a");
s.put(5);
console.log(d.run(s) !== undefined);
const b: Base<number> = d;
console.log(b.run(s) !== undefined);

const u = new Derived<unknown>();
const us = new Sink<unknown>("u");
us.put("x");
console.log(u.run(us) !== undefined);

const plain = new Base<string>();
const ps = new Sink<string>("p");
console.log(plain.run(ps) === undefined);

// A function whose parameter is narrower than an optional `(err: any) => void`
// member (a Promise executor's reject into a Partial<Observer> field) is
// adapted when stored in the union-typed slot, checking the argument per call.
interface Observer<T> {
  next: (value: T) => void;
  error: (err: any) => void;
  complete: () => void;
}
class Safe<T> {
  o: Partial<Observer<T>>;
  constructor(o: Partial<Observer<T>>) {
    this.o = o;
  }
  fire(v: T) { this.o.next?.(v); }
  fail(e: any) { this.o.error?.(e); }
}
function first<T, D>(src: T[], d?: D): Promise<T | D> {
  return new Promise<T | D>((resolve, reject) => {
    const s = new Safe<T>({
      next: (v) => { resolve(v); },
      error: reject,
      complete: () => { reject(new Error("empty")); },
    });
    if (src.length) s.fire(src[0]!); else s.fail(new Error("none"));
  });
}
first<string, unknown>(["a"]).then((v) => console.log(v));
first<string, unknown>([]).catch((e) => console.log("err", e.message));

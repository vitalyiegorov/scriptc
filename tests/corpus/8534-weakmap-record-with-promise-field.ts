interface Ctx<T> {
  instance: T;
  isResolved?: boolean;
  donePromise?: Promise<unknown>;
}
class Holder<T> {
  private readonly values = new WeakMap<object, Ctx<T>>();
  set(key: object, value: Ctx<T>): void {
    this.values.set(key, value);
  }
  get(key: object): Ctx<T> | undefined {
    return this.values.get(key);
  }
}
const h = new Holder<string>();
const k = {};
const pending: Promise<unknown> = Promise.resolve(1);
const ctx: Ctx<string> = { instance: 'a', isResolved: true, donePromise: pending };
h.set(k, ctx);
const back = h.get(k)!;
console.log(back.instance, back.isResolved, back === ctx);
ctx.instance = 'b';
console.log(h.get(k)!.instance);
back.donePromise!.then((v) => console.log('done', v));

// A Promise constructor held as a value (rxjs's configurable
// `config.Promise`): `PromiseConstructorLike | undefined` in a record
// member, the global `Promise` stored in and read back from it, and
// `new ctor(executor)` through the stored value. The Promise global
// builds a native promise whose resolve and reject follow the executor's
// signature; a caller-supplied constructor is built through. Settlement,
// rejection, an executor that throws, identity and `instanceof` follow Node.
interface GlobalConfig {
  Promise: PromiseConstructorLike | undefined;
}
const config: GlobalConfig = { Promise: undefined };

class Source<T> {
  values: T[];
  fail?: Error;
  constructor(values: T[], fail?: Error) {
    this.values = values;
    this.fail = fail;
  }
  forEach(next: (value: T) => void, promiseCtor?: PromiseConstructorLike): Promise<void> {
    promiseCtor = getPromiseCtor(promiseCtor);
    return new promiseCtor<void>((resolve, reject) => {
      try {
        for (const v of this.values) next(v);
      } catch (err) {
        reject(err);
        return;
      }
      if (this.fail) reject(this.fail);
      else resolve();
    }) as Promise<void>;
  }
  toPromise(promiseCtor?: PromiseConstructorLike): Promise<T | undefined> {
    promiseCtor = getPromiseCtor(promiseCtor);
    return new promiseCtor((resolve, reject) => {
      let value: T | undefined;
      for (const v of this.values) value = v;
      if (this.fail) reject(this.fail);
      else resolve(value);
    }) as Promise<T | undefined>;
  }
}

function getPromiseCtor(promiseCtor: PromiseConstructorLike | undefined) {
  return promiseCtor ?? config.Promise ?? Promise;
}

async function main() {
  const s = new Source([1, 2, 3]);
  const seen: number[] = [];
  await s.forEach((v) => seen.push(v));
  console.log(seen, await s.toPromise());
  const bad = new Source(["a"], new Error("boom"));
  try {
    await bad.forEach(() => {});
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  try {
    await bad.toPromise();
  } catch (e) {
    console.log("caught2", (e as Error).message);
  }
  try {
    await s.forEach(() => {
      throw new Error("in next");
    });
  } catch (e) {
    console.log("caught3", (e as Error).message);
  }
  config.Promise = Promise;
  console.log(await new Source(["x", "y"]).toPromise(config.Promise));
  console.log(config.Promise === Promise, typeof config.Promise);
  console.log(new Source<number>([]).forEach(() => {}) instanceof Promise);
}

class Lazy<T> {
  value: T | undefined;
  done = false;
  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void,
    ) => void,
  ) {
    executor(
      (v) => {
        this.value = v as T;
        this.done = true;
      },
      () => {},
    );
  }
  then(): void {}
}

function build(ctor: PromiseConstructorLike): PromiseLike<number> {
  return new ctor<number>((resolve) => resolve(41));
}
const lazy = build(Lazy as unknown as PromiseConstructorLike);
console.log(lazy instanceof Lazy, (lazy as unknown as Lazy<unknown>).done, (lazy as unknown as Lazy<unknown>).value);
const native = build(Promise);
console.log(native instanceof Promise, native instanceof Lazy);
async function settled() {
  console.log("awaited", await build(Promise));
}
main().then(settled);

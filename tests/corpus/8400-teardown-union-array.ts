// A class, an interface it implements, and a function type in one union
// (rxjs' `TeardownLogic`): a field holding an array of the union, narrowing
// by `instanceof` and `typeof`, identity removal, and teardown of every arm.
interface Unsubscribable {
  unsubscribe(): void;
}

class Subscription implements Unsubscribable {
  closed = false;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  unsubscribe(): void {
    if (!this.closed) {
      this.closed = true;
      console.log("unsubscribe", this.name);
    }
  }
}

type TeardownLogic = Subscription | Unsubscribable | (() => void) | void;

class Holder {
  private teardowns: Exclude<TeardownLogic, void>[] | null = null;
  add(teardown: TeardownLogic): void {
    if (!teardown) return;
    if (teardown instanceof Subscription && teardown.closed) {
      console.log("skip closed", teardown.name);
      return;
    }
    if (this.teardowns === null) this.teardowns = [teardown];
    else this.teardowns.push(teardown);
  }
  remove(teardown: Exclude<TeardownLogic, void>): void {
    const list = this.teardowns;
    if (list) {
      const index = list.indexOf(teardown);
      if (index >= 0) list.splice(index, 1);
    }
  }
  get size(): number {
    return this.teardowns === null ? -1 : this.teardowns.length;
  }
  run(): void {
    const list = this.teardowns;
    this.teardowns = null;
    if (!list) return;
    for (const teardown of list) {
      if (typeof teardown === "function") teardown();
      else if (teardown instanceof Subscription) {
        console.log("sub", teardown.name, teardown.closed);
        teardown.unsubscribe();
      }
      else teardown.unsubscribe();
    }
  }
}

const a = new Subscription("a");
const b = new Subscription("b");
const fn = (): void => console.log("fn");
const holder = new Holder();
console.log(holder.size);
holder.add(a);
holder.add(fn);
holder.add({ unsubscribe: () => console.log("literal") });
holder.add(b);
holder.add(undefined);
console.log(holder.size);
holder.remove(b);
holder.remove(fn);
console.log(holder.size);
b.unsubscribe();
holder.add(b);
holder.run();
console.log(holder.size, a.closed, b.closed);

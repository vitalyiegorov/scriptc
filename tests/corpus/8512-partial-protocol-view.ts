// A class implementing an interface passes where `Partial<Interface> | function`
// is expected: the Partial view is the same live protocol, so the instance
// keeps its identity and its methods run on it.
interface Observer<T> {
  next: (value: T) => void;
  error: (err: any) => void;
  complete: () => void;
}
class Base { closed = false; unsubscribe() { this.closed = true; } }
class Sub<T> extends Base implements Observer<T> {
  next(v: T): void { console.log("next", v); }
  error(e: any): void { console.log("error", e); }
  complete(): void { console.log("complete"); }
}
class Obs<T> {
  subscribe(o?: Partial<Observer<T>> | ((value: T) => void) | null): void {
    if (typeof o === "function") o(2 as any);
    else if (o) { o.next?.(1 as any); o.complete?.(); }
  }
}
const s = new Sub<number>();
new Obs<number>().subscribe(s);
new Obs<number>().subscribe({ next: (v) => console.log("lit", v) });
new Obs<number>().subscribe((v) => console.log("fn", v));

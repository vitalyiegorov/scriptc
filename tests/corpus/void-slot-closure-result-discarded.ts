// A closure whose inferred result is a number but whose contextual slot
// returns void is adapted: the result is discarded, not trapped.
interface Observer<T> { next: (value: T) => void; error: (e: unknown) => void; complete: () => void }
class Obs<T> {
  private readonly run: (o: Observer<T>) => void;
  constructor(run: (o: Observer<T>) => void) { this.run = run; }
  subscribe(o?: Partial<Observer<T>> | ((value: T) => void)): void {
    const full: Observer<T> =
      typeof o === "function"
        ? { next: o, error: () => {}, complete: () => {} }
        : { next: (v) => o?.next?.(v), error: (e) => o?.error?.(e), complete: () => o?.complete?.() };
    this.run(full);
  }
}
function of<T>(...values: T[]): Obs<T> {
  return new Obs<T>((o) => { for (const v of values) o.next(v); o.complete(); });
}
const got: number[] = [];
of(1, 2, 3).subscribe({ next: (v) => got.push(v) });
of(4).subscribe((v) => got.push(v));
const lit = { next: (v: number) => got.push(v * 10) };
const asObserver: Partial<Observer<number>> = lit;
asObserver.next?.(5);
const slots: Partial<Observer<number>>[] = [lit, { next: (v) => got.push(v + 100) }];
for (const s of slots) s.next?.(6);
of(7, 8).subscribe({ next: (v) => got.push(v), complete: () => got.push(0) });
console.log(got.join(","));

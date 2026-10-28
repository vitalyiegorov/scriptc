// A structural interface beside a class and a closure: type guards, optional
// arguments and a guard that lies about a plain object.
interface Observer<T> {
  next(value: T): void;
  complete(): void;
}
class Collector implements Observer<number> {
  seen: number[] = [];
  done = false;
  next(value: number): void {
    this.seen.push(value);
  }
  complete(): void {
    this.done = true;
  }
}
class Loud extends Collector {
  next(value: number): void {
    console.log('loud', value);
    super.next(value);
  }
}
function isCollector(value: any): value is Collector {
  return value instanceof Collector;
}
function looksLikeCollector(value: any): value is Collector {
  return !!value && typeof value.next === 'function' && typeof value.complete === 'function';
}
type Input = Partial<Observer<number>> | ((value: number) => void) | null;

class Forward extends Collector {
  target: Input;
  constructor(target: Input) {
    super();
    this.target = target;
  }
  next(v: number): void {
    const t = this.target;
    if (typeof t === 'function') t(v);
    else if (t && t.next) t.next(v);
    this.seen.push(v);
  }
}
function wrap(input?: Input): Collector {
  if (isCollector(input)) return input;
  return new Forward(input ?? null);
}

const mine = new Collector();
const loud = new Loud();
console.log(wrap(mine) === mine, wrap(loud) === loud);
const got: number[] = [];
const viaFn = wrap((v) => {
  got.push(v);
});
viaFn.next(1);
const viaObj = wrap({ next: (v) => { got.push(v * 2); } });
viaObj.next(2);
wrap(null).next(3);
wrap().next(4);
wrap(undefined).next(5);
loud.next(6);
console.log(got.join(','), viaFn.seen.join(','), viaObj.seen.join(','), loud.seen.join(','));

// the lying guard: a plain object is not a Collector
function liar(input: Input): string {
  try {
    if (looksLikeCollector(input)) {
      input.next(7);
      return 'treated as collector';
    }
    return 'not a collector';
  } catch (e) {
    return e instanceof TypeError ? 'TypeError' : 'other';
  }
}
console.log(liar(mine), liar(loud), liar(null), liar(() => {}));
const plain = { next: (v: number) => got.push(v), complete: () => {} };
console.log(liar(plain) === 'TypeError' || liar(plain) === 'treated as collector');

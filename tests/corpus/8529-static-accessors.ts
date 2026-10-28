const Mode = { Random: 'random', Deterministic: 'deterministic' } as const;
type Mode = (typeof Mode)[keyof typeof Mode];
class Factory {
  private static _mode: Mode = Mode.Random;
  static log: string[] = [];

  static set mode(value: Mode) {
    Factory.log.push('set ' + value);
    this._mode = value;
  }

  static get mode(): Mode {
    return this._mode;
  }

  static get(key = ''): string {
    return this._mode === Mode.Deterministic ? 'det:' + key : 'rnd';
  }
}

class Counter {
  static count = 0;
  static get next(): number {
    return ++Counter.count;
  }
  static set reset(to: number) {
    Counter.count = to;
  }
  static get doubled(): number {
    return this.count * 2;
  }
}

console.log(Factory.get('a'));
Factory.mode = Mode.Deterministic;
console.log(Factory.get('a'), Factory.mode);
Factory.mode = Mode.Random;
console.log(Factory.get('b'), Factory.log.join(','));
console.log(Counter.next, Counter.next, Counter.doubled);
Counter.reset = 10;
console.log(Counter.next, Counter.doubled);

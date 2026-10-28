class R {
  m(): number {
    return 1;
  }
  add(a: number, b: number): number {
    return a + b;
  }
}

class S extends R {
  override m(): number {
    return 2;
  }

  probe(): number {
    // `super.m` read as a value is the base method, unbound and unaffected by the override.
    const f = super.m;
    return f();
  }

  sum(values: number[]): number {
    const add = super.add;
    return values.reduce((total, value) => add(total, value), 0);
  }
}

const s = new S();
console.log(s.probe(), s.m(), s.sum([1, 2, 3]));

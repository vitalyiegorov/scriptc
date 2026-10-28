class VBase {
  m<T>(x: T): string {
    return `b:${String(x)}`;
  }
}

class VLeaf extends VBase {
  m<T>(x: T): string {
    return `l:${String(x)}`;
  }
}

class VTwig extends VLeaf {}

function throughBase(r: VBase): string {
  return r.m(1);
}

function throughBaseWith<T>(r: VBase, value: T): string {
  return r.m(value);
}

console.log(throughBase(new VLeaf()), throughBase(new VBase()), throughBase(new VTwig()));
console.log(throughBaseWith(new VLeaf(), 'x'), throughBaseWith(new VBase(), [1, 2]));
console.log(new VBase().m('s'), new VLeaf().m(true));

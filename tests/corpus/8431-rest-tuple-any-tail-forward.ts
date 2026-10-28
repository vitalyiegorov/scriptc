// A forwarding `(...args)` whose rest type is a tuple ending in an any tail
// ([handler, ...args: any[]], rxjs's immediateProvider), spread into a callee
// chosen by `||`.
const Imm = {
  setImmediate(cb: () => void, ...args: any[]): number { cb(); return 1; },
  clearImmediate(h: number) {},
};
const { setImmediate: si, clearImmediate: ci } = Imm;
type SetImmediateFunction = (handler: () => void, ...args: any[]) => number;
interface IP { setImmediate: SetImmediateFunction; delegate: { setImmediate: SetImmediateFunction } | undefined }
const ip: IP = {
  setImmediate(...args) {
    const { delegate } = ip;
    return (delegate?.setImmediate || si)(...args);
  },
  delegate: undefined,
};
console.log(ip.setImmediate(() => console.log("a"), 1, 2));
ip.delegate = { setImmediate: (h, ...r) => { console.log("deleg", r); h(); return 7; } };
console.log(ip.setImmediate(() => console.log("b"), 1, 2));

// A callee with FEWER parameters (rxjs's Immediate.setImmediate(cb)) joins the
// variadic slot through `||`: the surplus arguments are ignored.
const Imm2 = {
  setImmediate(cb: () => void): number {
    cb();
    return 3;
  },
};
const { setImmediate: si2 } = Imm2;
const ip2: IP = {
  setImmediate(...args) {
    const { delegate } = ip2;
    return (delegate?.setImmediate || si2)(...args);
  },
  delegate: undefined,
};
console.log(ip2.setImmediate(() => console.log("c"), 1, 2));

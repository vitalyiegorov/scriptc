// Timer calls with spread trailing arguments, optional delays, and the
// timer globals read as function values (rxjs's timeoutProvider shape).
interface Provider {
  setTimeout: (handler: () => void, timeout?: number, ...args: any[]) => unknown;
  clearTimeout: (handle: any) => void;
  delegate: { clearTimeout: (handle: any) => void } | undefined;
}

const provider: Provider = {
  setTimeout(handler: () => void, timeout?: number, ...args) {
    return setTimeout(handler, timeout, ...args);
  },
  clearTimeout(handle) {
    const { delegate } = provider;
    return (delegate?.clearTimeout || clearTimeout)(handle as any);
  },
  delegate: undefined,
};

const cb: any = (a: number, b: string, c: number) => console.log("cb", a, b, c);
provider.setTimeout(cb, 20, 1, "x", 3);

// The spread array is copied when the timer is set.
const rest: any[] = [10, "y"];
setTimeout(cb, 40, ...rest, 7);
rest.push(99);
setImmediate(cb, ...[5, "z", 6]);
const iv = setInterval(
  (...a: any[]) => {
    console.log("interval", a);
    clearInterval(iv);
  },
  80,
  ...rest,
);

// Cleared through the function value on both paths.
const h = setTimeout(() => console.log("cleared timer must not run"), 120);
provider.clearTimeout(h);
let delegated = 0;
provider.delegate = { clearTimeout: () => delegated++ };
provider.clearTimeout(h);
console.log("delegated", delegated);
const clearer = clearInterval;
const iv2 = setInterval(() => console.log("cleared interval must not run"), 120);
clearer(iv2);
const imm = setImmediate(() => console.log("cleared immediate must not run"));
provider.delegate = undefined;
(provider.delegate || clearImmediate)(imm as any);

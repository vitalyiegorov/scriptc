import _stringify from './lib.cjs';

// CommonJS interop: the module's function carries a `default` member.
const stringify = ((_stringify as any).default ?? _stringify) as unknown as (value: any) => string;
console.log(stringify({ a: 1, b: [1, 2] }));
console.log(typeof (_stringify as any).stable, (_stringify as any).missing);

// A JSDoc-optional parameter bound to an object pattern with a whole-pattern default.

/**
 * @param {string} name
 * @param {{ prefix?: string, count?: number }} [options]
 */
function describe(name, { prefix = '>', count = 1 } = {}) {
  return `${prefix.repeat(count)} ${name}`;
}

console.log(describe('plain'));
console.log(describe('undefined', undefined));
console.log(describe('partial', { count: 3 }));
console.log(describe('full', { prefix: '#', count: 2 }));

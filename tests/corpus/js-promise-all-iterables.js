// Promise.all over iterables other than arrays.

class Wrapper {
  constructor(items) {
    this.items = items;
  }
  map(fn) {
    return new Wrapper(this.items.map(fn));
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

function* entries() {
  yield Promise.resolve('a');
  yield 'b';
}

async function main() {
  const wrapped = new Wrapper([1, 2, 3]).map(async (n) => n * 2);
  console.log(await Promise.all(wrapped));
  console.log(await Promise.all(new Set([Promise.resolve(1), 2])));
  console.log(await Promise.all(entries()));
  const empty = new Wrapper([]).map(async () => {
    throw new Error('never runs');
  });
  console.log(await Promise.all(empty));
  try {
    await Promise.all(new Wrapper([1]).map(async () => {
      throw new Error('rejected');
    }));
  } catch (error) {
    console.log('caught', error.message);
  }
}

main();

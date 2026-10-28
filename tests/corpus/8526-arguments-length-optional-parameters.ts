type Token = string | { name: string };

function inject(token?: Token): (target: object, key: string) => void {
  const hasArguments = arguments.length > 0;
  return (target, key) => {
    console.log(key, token === undefined ? 'none' : typeof token, hasArguments);
  };
}

function count(a: number, b?: number, c = 3): number {
  return arguments.length * 100 + a + (b ?? 0) + c;
}

let calls = 0;
const next = (): number => ++calls;

inject()({}, 'a');
inject('x')({}, 'b');
inject(undefined)({}, 'c');
console.log(count(1), count(1, 2), count(1, 2, 3), count(next(), next()));
console.log(count(count(1), count(1, 2, 3)));

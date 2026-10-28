type Dec = (target: object, key: string, index: number) => void;
type Factory<D, O> = (data: D, ctx: number) => O;

function make<D = any, O = any>(
  factory: Factory<D, O>,
  extras: Dec[] = [],
): (...dataOrPipes: (string | D | { n: number })[]) => Dec {
  const tag = 'p' + extras.length;
  return (
      data?,
      ...pipes: (string | D | { n: number })[]
    ): Dec =>
    (target, key, index) => {
      console.log(tag, key, index, data, pipes.length);
      extras.forEach((fn) => fn(target, key, index));
    };
}

const A = make<string, number>((d, c) => d.length + c);
A('x', 'y')({}, 'm', 1);
const B = make((d: unknown, c: number) => c);
B()({}, 'm', 2);

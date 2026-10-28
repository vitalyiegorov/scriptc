// A function whose trailing parameters are optional fits a slot with fewer
// parameters; calls through the slot pass undefined for the extras (Nest's
// `Request: () => ParameterDecorator = createRouteParamDecorator(...)`).
type Decorator = (target: string) => string;

function create(prefix: string): (data?: string, extra?: number) => Decorator {
  return (data, extra) => (target) => `${prefix}:${data ?? "none"}:${extra ?? 0}:${target}`;
}

const Plain: () => Decorator = create("plain");
const Single: (data?: string) => Decorator = create("single");
const anyData: (data?: any) => Decorator = create("any");

console.log(Plain()("a"), Single()("b"), Single("d")("c"), anyData(undefined)("e"));

function run(factory: () => Decorator): string {
  return factory()("run");
}
console.log(run(create("run")), run(() => (target) => target.toUpperCase()));

// The same with a trailing rest parameter (`createParamDecorator`'s result).
function createRest(prefix: string): (data?: string, ...pipes: string[]) => Decorator {
  return (data, ...pipes) => (target) => `${prefix}:${data ?? "none"}:${pipes.join("+")}:${target}`;
}
const Rest: () => Decorator = createRest("rest");
const RestOne: (data?: string) => Decorator = createRest("rest1");
console.log(Rest()("r"), RestOne("d")("s"), RestOne()("t"));

// @tsc-legacy-decorators
// Constructor parameter properties carrying parameter decorators, as in
// dependency-injection containers.
const injected: string[] = [];
class Token { constructor(readonly id: string) {} }
const ENGINE = new Token("engine");
const WHEELS = new Token("wheels");
function inject(token: Token): ParameterDecorator {
  return (target, key, index) => {
    injected.push(`${typeof target}:${String(key)}:${index}:${token.id}`);
  };
}
function optional(target: object, key: string | symbol | undefined, index: number): void {
  injected.push(`optional ${index}`);
}

class Engine { readonly power = 90; }
class Car {
  constructor(
    @inject(ENGINE) private readonly engine: Engine,
    @inject(WHEELS) @optional public wheels: number,
    plain: string,
    @inject(ENGINE) protected name?: string,
  ) {}
  describe(): string { return `${this.engine.power} ${this.wheels} ${this.name}`; }
}

// A container-style factory infers the instance type of a decorated class.
function build<T>(cls: new (...args: any[]) => T, ...args: unknown[]): T { return new cls(...args); }
const car = build(Car, new Engine(), 4, "x", "n");
console.log(car.describe(), car.wheels);
console.log(injected.join("\n"));

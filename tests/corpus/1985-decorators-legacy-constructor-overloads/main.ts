// @tsc-legacy-decorators
// A class with constructor overload signatures carries its parameter
// decorators on the implementation (Nest's ConsoleLogger).
const optional: number[] = [];
function Optional(): (target: object, key: string | symbol | undefined, index: number) => void {
  return (_target, _key, index) => {
    optional.push(index);
  };
}
function Tag(label: string): (target: object) => void {
  return () => {
    console.log("class decorated", label);
  };
}

@Tag("logger")
class Logger {
  readonly context: string | undefined;
  readonly level: number;
  constructor();
  constructor(context: string);
  constructor(level: number);
  constructor(context: string, level: number);
  constructor(
    @Optional() contextOrLevel?: string | number,
    @Optional() level?: number,
  ) {
    this.context = typeof contextOrLevel === "string" ? contextOrLevel : undefined;
    this.level = typeof contextOrLevel === "number" ? contextOrLevel : (level ?? 0);
  }
}

for (const logger of [new Logger(), new Logger("app"), new Logger(3), new Logger("app", 2)]) {
  console.log(logger.context, logger.level);
}
console.log(optional.sort().join(","));

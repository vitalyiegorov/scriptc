// @tsc-legacy-decorators
import "reflect-metadata";
import { Logger, type Clock } from "./services.js";

const names = (types: any): string => types.map((type: any) => type.name).join(",");
const tokens = new Map<string, string>();
function Inject(token: string): ParameterDecorator {
  return (target: any, key, index) => { tokens.set(`${key === undefined ? target.name : String(key)}:${index}`, token); };
}
const seen: string[] = [];
function Injectable(): ClassDecorator {
  return (target: any) => { seen.push(`${target.name}:${names(Reflect.getMetadata("design:paramtypes", target))}`); };
}
const registry = new Map<string, any>([["clock", { now: () => 42 }]]);
function resolve(type: any): any {
  const params: any[] = Reflect.getMetadata("design:paramtypes", type);
  const args: any[] = params.map((param: any, index: number) => {
    const token = tokens.get(`${type.name}:${index}`);
    return token === undefined ? new param() : registry.get(token);
  });
  return new type(...args);
}

@Injectable()
class Service {
  constructor(private readonly logger: Logger, @Inject("clock") readonly clock: Clock) {}
  run(): string { return this.logger.log(`t=${this.clock.now()}`); }
}
console.log(seen.join("|"));
console.log(resolve(Service).run());

class OnlyParams {
  constructor(@Inject("clock") clock: Clock, count = 5, label?: string, ...rest: number[]) {}
  undecorated(value: string): void {}
  plain = 1;
  @Reflect.metadata("custom", "value") marked(value: string, flag: boolean): number { return 0; }
  static create(@Inject("factory") factory: Logger): void {}
}
console.log(names(Reflect.getMetadata("design:paramtypes", OnlyParams)));
console.log(tokens.get("OnlyParams:0"), tokens.get("create:0"));
console.log(Reflect.getMetadataKeys(OnlyParams.prototype, "undecorated").length, Reflect.hasMetadata("design:type", OnlyParams.prototype, "plain"));
console.log(Reflect.getMetadataKeys(OnlyParams.prototype, "marked").join(","));
console.log(names(Reflect.getMetadata("design:paramtypes", OnlyParams.prototype, "marked")), Reflect.getMetadata("design:returntype", OnlyParams.prototype, "marked").name);

@Injectable()
abstract class Repository {
  constructor(readonly logger: Logger) {}
}
@Injectable()
class Overloaded extends Repository {
  constructor(value: string);
  constructor(value: number, logger: Logger);
  constructor(value: string | number, logger: Logger = new Logger()) { super(logger); }
}
class Inherited extends Overloaded {}
console.log(seen.slice(1).join("|"));
console.log(Reflect.getMetadata("design:paramtypes", Inherited) === Reflect.getMetadata("design:paramtypes", Overloaded));
console.log(Reflect.getOwnMetadata("design:paramtypes", Inherited) === undefined);
const baseTarget = {};
const derivedTarget = Object.create(baseTarget);
Reflect.defineMetadata("base", 1, baseTarget);
Reflect.defineMetadata("own", 2, derivedTarget);
console.log(Reflect.getMetadata("base", derivedTarget), Reflect.getOwnMetadata("base", derivedTarget), Reflect.getMetadataKeys(derivedTarget).join(","));
console.log(Reflect.deleteMetadata("own", derivedTarget), Reflect.hasOwnMetadata("own", derivedTarget), Reflect.hasMetadata("base", derivedTarget));

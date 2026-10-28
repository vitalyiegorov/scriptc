// `this.field = options.list!` hands the field the optional property's
// undefined: `!` checks nothing.
interface Options {
  exclude?: string[];
  prefix?: string;
}
class Config {
  options: Options = {};
  getOptions(): Options {
    return this.options;
  }
}
class Extractor {
  private readonly excluded: string[];
  constructor(config: Config) {
    this.excluded = config.getOptions().exclude!;
  }
  describe(): string {
    return Array.isArray(this.excluded) ? "list:" + this.excluded.join("+") : "none";
  }
}
const config = new Config();
console.log(new Extractor(config).describe());
config.options.exclude = ["a", "b"];
console.log(new Extractor(config).describe());

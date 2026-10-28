// A union-typed field no code assigned (strictPropertyInitialization off) reads
// as undefined, like in JavaScript.
type Versioning = { type: "uri"; prefix?: string } | { type: "header"; header: string };
class Config {
  private versioning: Versioning;
  setVersioning(v: Versioning): void {
    this.versioning = v;
  }
  getVersioning(): Versioning | undefined {
    return this.versioning;
  }
}
class Reader {
  private readonly config?: Versioning;
  constructor(source: Config) {
    this.config = source.getVersioning();
  }
  describe(): string {
    return this.config === undefined ? "unversioned" : this.config.type;
  }
}
const config = new Config();
console.log(new Reader(config).describe(), config.getVersioning() === undefined);
config.setVersioning({ type: "header", header: "x-v" });
console.log(new Reader(config).describe(), config.getVersioning()?.type);

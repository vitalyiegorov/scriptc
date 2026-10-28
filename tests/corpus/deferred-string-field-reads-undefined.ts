// A string field no code has assigned yet reads as undefined (never "");
// presence tests, strict equality and typeof all see the undefined, and a
// later assignment replaces it.
class Context {
  private moduleContext!: string;
  constructor() {
    this.probe();
  }
  probe(): void {
    console.log("typeof", typeof this.moduleContext);
    console.log("=== undefined", this.moduleContext === undefined);
    console.log("!", !this.moduleContext);
    console.log("??", this.moduleContext ?? "dflt");
    console.log("||", this.moduleContext || "dflt");
  }
  lookup(modules: Map<string, number>): number | undefined {
    if (!this.moduleContext) {
      return undefined;
    }
    return modules.get(this.moduleContext);
  }
  create(module: string): void {
    this.moduleContext = module;
  }
}

const ctx = new Context();
const modules = new Map([["app", 7]]);
console.log("lookup before", ctx.lookup(modules));
ctx.create("app");
ctx.probe();
console.log("lookup after", ctx.lookup(modules));
ctx.create("");
console.log("empty typeof", typeof (ctx as unknown as { moduleContext: string }).moduleContext);

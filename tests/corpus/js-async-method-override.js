// JavaScript async methods overridden by JavaScript subclasses (Nest's
// prepareClose/dispose): calls through the base class dispatch virtually
// and still enter each async body through its spawn wrapper.
class Context {
  constructor(name) { this.name = name; this.log = []; }
  async close() {
    await this.prepareClose();
    await this.dispose();
    this.log.push('closed');
    return this.log.join(',');
  }
  async prepareClose() { return Promise.resolve(); }
  async dispose() { await null; this.log.push('base dispose'); }
}
class Application extends Context {
  async prepareClose() { this.log.push('stop server'); }
  async dispose() {
    await super.dispose();
    this.log.push('app dispose');
  }
}
class Eager extends Context {
  prepareClose() { this.log.push('eager'); return Promise.resolve(); }
}
async function main() {
  for (const context of [new Context('ctx'), new Application('app'), new Eager('eager')])
    console.log(context.name, await context.close());
}
main();

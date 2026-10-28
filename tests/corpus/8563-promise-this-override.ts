// `Promise<this>` overridden in a subclass: the slot keeps the inherited
// payload, and the subclass body still returns itself.
class Context<T> {
  ready = false;
  options?: T;
  async init(): Promise<this> {
    this.ready = true;
    return this;
  }
}
class App extends Context<{ port: number }> {
  tag = "app";
  public async init(): Promise<this> {
    if (this.ready) return this;
    await super.init();
    this.tag = "initialized";
    return this;
  }
}
async function main(): Promise<void> {
  const app = new App();
  const again = await app.init();
  console.log(again.tag, again.ready, again === app);
  const ctx: Context<{ port: number }> = app;
  console.log((await ctx.init()) === app);
}
main();

// Optional-chained and void-promise catch: `p?.catch(() => undefined)`.
class C {
  p?: Promise<void>;
  async run(): Promise<void> {
    await this.p?.catch(() => undefined);
    console.log("a");
    const q: Promise<number> = Promise.reject(new Error("x"));
    console.log(await q.catch(() => 7));
    const v: Promise<void> = Promise.reject(new Error("y"));
    await v.catch(() => undefined);
    console.log("b");
  }
}
const c = new C();
c.run().then(() => { c.p = Promise.reject(new Error("z")); return c.run(); });

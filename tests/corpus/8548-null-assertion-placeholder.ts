// `null!` and `undefined!` are placeholders for a required field: the
// assertion changes the type, never the value.
interface Wrapper {
  token: string;
  instance: object;
  count?: number;
}
class Holder {
  readonly wrapper: Wrapper;
  constructor(token: string) {
    this.wrapper = { token, instance: null!, count: undefined! };
  }
  filled(): boolean {
    return this.wrapper.instance !== null;
  }
}
const holder = new Holder("t");
console.log(holder.wrapper.token, holder.filled(), holder.wrapper.instance, holder.wrapper.count);
function make(options: Partial<Wrapper>): string {
  return String(options.instance) + "/" + String(options.count);
}
console.log(make({ instance: null!, count: undefined! }));

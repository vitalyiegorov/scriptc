// A value typed at a generic class's top instantiation (`Box<any>`,
// `Box<unknown>`) holds an instance of any instantiation: members
// dispatch on the instance's own class, and a conditional over two
// instantiations types as the top one.
class Base {
  tag = "base";
}
class Box<T> extends Base {
  value: T;
  count = 0;
  constructor(v: T) {
    super();
    this.value = v;
  }
  get(): T {
    return this.value;
  }
  put(v: T): void {
    this.value = v;
    this.count++;
  }
}
class Loud<T> extends Box<T> {
  get(): T {
    console.log("loud get");
    return super.get();
  }
}
function show(b: Box<any>) {
  console.log(b.tag, b.count);
  console.log(b.get());
  b.put(b.get());
  console.log(b.value, b instanceof Box);
  b.count = 7;
  console.log(b.count);
}
show(new Box(1));
show(new Box("s"));
show(new Loud(true));

function pick(flag: boolean, o: Box<unknown>): Box<unknown> {
  const chosen = flag ? o : new Loud<string>("fresh");
  chosen.put(chosen.get());
  return chosen;
}
console.log(pick(true, new Box<number>(5)).get());
console.log(pick(false, new Box<number>(5)).get());

function peek(x: unknown) {
  if (x instanceof Box) return x.value;
  return "not a box";
}
console.log(peek(new Box(41)), peek(new Loud("loud")), peek({}));

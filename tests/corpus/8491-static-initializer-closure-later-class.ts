// A static field initialized with a closure over a class declared later in the
// module: creating the closure does not read the class, calling it does.
class Node0 {
  tag = "base";
  static create: (tag: string) => Node0 = (tag: string): Node0 => {
    return new Leaf(tag);
  };
  lift(): Node0 {
    return new Leaf("lifted");
  }
}
class Leaf extends Node0 {
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
}
console.log(Node0.create("a").tag, new Node0().lift().tag, Node0.create("b") instanceof Leaf);

// @transform-types
// A nested function declaration with a defaulted parameter, called through its
// binding with and without the argument (Nest's TopologyTree.walk).
class Node1 {
  children = new Set<Node1>();
  constructor(readonly value: string) {}
}
class Tree {
  private root: Node1;
  constructor() {
    this.root = new Node1("root");
    const a = new Node1("a");
    a.children.add(new Node1("b"));
    this.root.children.add(a);
  }
  walk(callback: (value: string, depth: number) => void) {
    function walkNode(node: Node1, depth = 1) {
      callback(node.value, depth);
      node.children.forEach((child) => walkNode(child, depth + 1));
    }
    walkNode(this.root);
  }
}
const lines: string[] = [];
new Tree().walk((value, depth) => lines.push(value + depth));
console.log(lines.join(","));

// `return this.state.items!`: the assertion has no runtime effect, so a
// method whose callers never read the result hands them the field's undefined.
interface State {
  items?: string[];
  label?: string;
}
class Store {
  private state: State = {};
  getItems(): string[] {
    return this.state.items!;
  }
  getLabel(): string {
    return this.state.label!;
  }
  fill(items: string[], label: string): void {
    this.state.items = items;
    this.state.label = label;
  }
}
const store = new Store();
store.getItems();
store.getLabel();
console.log(store.getItems() === undefined, store.getLabel() === undefined);
store.fill(["a", "b"], "ab");
console.log(store.getItems().join("+"), String(store.getLabel()));

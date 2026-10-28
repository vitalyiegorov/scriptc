class Container extends Map<string, number> {
  [Symbol.iterator](): MapIterator<[string, number]> {
    return super[Symbol.iterator]();
  }
}
new Container();

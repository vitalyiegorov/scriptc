class Container extends Map<string, number> {
  set(key: string, value: number): this {
    return super.set(key, value);
  }
}
new Container([['value', 1]]);

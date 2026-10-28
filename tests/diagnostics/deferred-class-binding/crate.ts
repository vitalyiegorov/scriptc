export class Crate {
  readonly label: string;
  contents: MapIterator<string> | undefined;
  constructor(label: string) {
    this.label = label;
    this.contents = undefined;
  }
}

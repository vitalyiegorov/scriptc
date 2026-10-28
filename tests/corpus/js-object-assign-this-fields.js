const DEFAULT = 0;
function scopeOf(options) { return options.marked ? 2 : undefined; }
class Wrapper {
  name;
  scope = DEFAULT;
  isAlias = false;
  level = 0;
  constructor(metadata = {}) {
    this.initialize(metadata);
  }
  initialize(metadata) {
    const { instance, ...partial } = metadata;
    Object.assign(this, partial);
    this.instance = instance;
  }
  get transient() { return this.scope === 2; }
}
const plain = new Wrapper({ name: 'plain', scope: scopeOf({}), instance: null });
const marked = new Wrapper({ name: 'marked', scope: scopeOf({ marked: true }), isAlias: 'yes' });
console.log(plain.name, plain.scope, plain.transient, plain.isAlias, plain.level);
console.log(marked.name, marked.scope, marked.transient, marked.isAlias, Object.keys(marked).join(','));

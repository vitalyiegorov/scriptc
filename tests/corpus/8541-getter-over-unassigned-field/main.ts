// A getter that returns a field no code path assigned yet: the caller sees
// the undefined Node produces (truthiness, nullish default, equality) while
// the declared type stays `string`.
class Registry {
  private _token: string;
  private _label: string;
  name: string;
  constructor(name: string) {
    this.name = name;
    this._label = "label:" + name;
  }
  get token(): string {
    return this._token;
  }
  set token(token: string) {
    this._token = token;
  }
  get label(): string {
    return this._label;
  }
  key(): string {
    const prefix = "M_";
    const key = this.token ? (this.token.includes(":") ? this.token.split(":")[1] : this.token) : this.name;
    return prefix + key;
  }
}
const r = new Registry("alpha");
console.log(r.key(), r.token === undefined, r.token ?? "none", r.label);
r.token = "mod:beta";
console.log(r.key(), r.token === undefined, r.token ?? "none", r.token.length);
r.token = "gamma";
console.log(r.key(), r.token);
const s = new Registry("delta");
console.log(typeof s.token, !s.token);
try {
  console.log(s.token.length);
} catch (e) {
  console.log(e instanceof TypeError);
}

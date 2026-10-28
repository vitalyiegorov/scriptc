class Source {
  constructor(subscribe) {
    this.tag = 7;
    if (subscribe) this._subscribe = subscribe;
  }
  _subscribe(out) { out.push(1); return 100; }
  run(out) { return this._subscribe(out); }
}
class Subject extends Source {
  _subscribe(out) { out.push(2); return 200; }
}
const arrow = (out) => { out.push(10); return 10; };
const usesThis = function (out) { out.push(this.tag); return this.tag * 2; };
function go(label, o) {
  const out = [];
  const r = o.run(out);
  console.log(label, r, out.join(','), Object.hasOwn(o, '_subscribe'), '_subscribe' in o, Object.keys(o).join('|'));
}
const plain = new Source();
const own = new Source(arrow);
const bound = new Source(usesThis);
const sub = new Subject();
const subOwn = new Subject(arrow);
go('plain', plain); go('own', own); go('this', bound); go('sub', sub); go('subOwn', subOwn);
console.log(Object.keys(own).sort().join(), own._subscribe === arrow, plain._subscribe === Source.prototype._subscribe);
delete own._subscribe; delete subOwn._subscribe; delete bound._subscribe;
go('own-deleted', own); go('subOwn-deleted', subOwn); go('bound-deleted', bound);
plain._subscribe = (out) => { out.push(30); return 30; };
go('plain-assigned', plain);
plain._subscribe = (out) => { out.push(31); return 31; };
go('plain-reassigned', plain);
delete plain._subscribe;
go('plain-deleted', plain);
sub._subscribe = usesThis;
go('sub-assigned', sub);
const undef = new Source();
undef._subscribe = undefined;
console.log(Object.hasOwn(undef, '_subscribe'));
try { undef.run([]); } catch (error) { console.log(error.name); }

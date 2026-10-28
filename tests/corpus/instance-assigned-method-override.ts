// A constructor assigns a function over a prototype method, in a class
// that has subclasses overriding the same method.
type Sink = { out: number[] };

class Source {
  tag = 7;
  constructor(subscribe?: (this: Source, s: Sink) => number) {
    if (subscribe) this._subscribe = subscribe;
  }
  _subscribe(s: Sink): number {
    s.out.push(1);
    return 100;
  }
  run(s: Sink): number {
    return this._subscribe(s);
  }
}
class Subject extends Source {
  _subscribe(s: Sink): number {
    s.out.push(2);
    return 200;
  }
}
class Plain extends Source {}

function sink(): Sink {
  return { out: [] };
}
function go(label: string, o: Source): void {
  const s = sink();
  const r = o.run(s);
  console.log(label, r, s.out.join(","), Object.prototype.hasOwnProperty.call(o, "_subscribe"));
}

const arrow = (s: Sink): number => {
  s.out.push(10);
  return 10;
};
const usesThis = function (this: Source, s: Sink): number {
  s.out.push(this.tag);
  return this.tag * 2;
};

const plain = new Source();
const own = new Source(arrow);
const bound = new Source(usesThis);
const sub = new Subject();
const subOwn = new Subject(arrow);
const inherited = new Plain();
const inheritedOwn = new Plain(usesThis);

go("plain", plain);
go("own", own);
go("this", bound);
go("sub", sub);
go("subOwn", subOwn);
go("inherited", inherited);
go("inheritedOwn", inheritedOwn);

// Reading the member as a value, with and without an own property.
const read = (o: Source): string => typeof o._subscribe;
console.log(read(plain), read(own), own._subscribe === arrow);

// Own-property reflection.
console.log(Object.keys(own), Object.keys(plain), Object.keys(bound).length);
console.log(Object.hasOwn(own, "_subscribe"), Object.hasOwn(plain, "_subscribe"));

// Assignment from outside the class, then again over an own property.
plain._subscribe = (s: Sink): number => {
  s.out.push(30);
  return 30;
};
go("plain-assigned", plain);
plain._subscribe = (s: Sink): number => {
  s.out.push(31);
  return 31;
};
go("plain-reassigned", plain);
sub._subscribe = usesThis;
go("sub-assigned", sub);
console.log(Object.keys(plain), Object.keys(sub));

// The own function is read before it is called, and survives a copy of the instance.
const again = new Source(arrow);
const fn = again._subscribe;
const s2 = sink();
console.log(fn.call(again, s2), s2.out.join(","));

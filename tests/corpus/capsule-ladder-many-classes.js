// A program with many compiled classes reaches a property bag through a class
// table of capsule-key tests; same-length keys share one chain.
'use strict';
class A {
  constructor(v) {
    this.aValue = v + 0;
    if (v % 2) this.cb = (x) => x + 0;
  }
  who() { return 'A'; }
}
class Bb extends A {
  constructor(v) {
    super(v);
    this.bbValue = v + 1;
    if (v % 2) this.cb = (x) => x + 1;
  }
  who() { return 'Bb'; }
}
class Cc extends Bb {
  constructor(v) {
    super(v);
    this.ccValue = v + 2;
    if (v % 2) this.cb = (x) => x + 2;
  }
  who() { return 'Cc'; }
}
class Dd extends Cc {
  constructor(v) {
    super(v);
    this.ddValue = v + 3;
    if (v % 2) this.cb = (x) => x + 3;
  }
  who() { return 'Dd'; }
}
class Eee {
  constructor(v) {
    this.eeeValue = v + 4;
    if (v % 2) this.cb = (x) => x + 4;
  }
  who() { return 'Eee'; }
}
class Fff extends Eee {
  constructor(v) {
    super(v);
    this.fffValue = v + 5;
    if (v % 2) this.cb = (x) => x + 5;
  }
  who() { return 'Fff'; }
}
class Gggg extends Fff {
  constructor(v) {
    super(v);
    this.ggggValue = v + 6;
    if (v % 2) this.cb = (x) => x + 6;
  }
  who() { return 'Gggg'; }
}
class Hhhh extends Gggg {
  constructor(v) {
    super(v);
    this.hhhhValue = v + 7;
    if (v % 2) this.cb = (x) => x + 7;
  }
  who() { return 'Hhhh'; }
}
class Iiiii {
  constructor(v) {
    this.iiiiiValue = v + 8;
    if (v % 2) this.cb = (x) => x + 8;
  }
  who() { return 'Iiiii'; }
}
class Jjjjj extends Iiiii {
  constructor(v) {
    super(v);
    this.jjjjjValue = v + 9;
    if (v % 2) this.cb = (x) => x + 9;
  }
  who() { return 'Jjjjj'; }
}
class Kk extends Jjjjj {
  constructor(v) {
    super(v);
    this.kkValue = v + 10;
    if (v % 2) this.cb = (x) => x + 10;
  }
  who() { return 'Kk'; }
}
class Ll extends Kk {
  constructor(v) {
    super(v);
    this.llValue = v + 11;
    if (v % 2) this.cb = (x) => x + 11;
  }
  who() { return 'Ll'; }
}
class Mmm {
  constructor(v) {
    this.mmmValue = v + 12;
    if (v % 2) this.cb = (x) => x + 12;
  }
  who() { return 'Mmm'; }
}
class Nnn extends Mmm {
  constructor(v) {
    super(v);
    this.nnnValue = v + 13;
    if (v % 2) this.cb = (x) => x + 13;
  }
  who() { return 'Nnn'; }
}
class Oooo extends Nnn {
  constructor(v) {
    super(v);
    this.ooooValue = v + 14;
    if (v % 2) this.cb = (x) => x + 14;
  }
  who() { return 'Oooo'; }
}
class Pppp extends Oooo {
  constructor(v) {
    super(v);
    this.ppppValue = v + 15;
    if (v % 2) this.cb = (x) => x + 15;
  }
  who() { return 'Pppp'; }
}
class Qqqqq {
  constructor(v) {
    this.qqqqqValue = v + 16;
    if (v % 2) this.cb = (x) => x + 16;
  }
  who() { return 'Qqqqq'; }
}
class Rrrrr extends Qqqqq {
  constructor(v) {
    super(v);
    this.rrrrrValue = v + 17;
    if (v % 2) this.cb = (x) => x + 17;
  }
  who() { return 'Rrrrr'; }
}
class Ss extends Rrrrr {
  constructor(v) {
    super(v);
    this.ssValue = v + 18;
    if (v % 2) this.cb = (x) => x + 18;
  }
  who() { return 'Ss'; }
}
class Tt extends Ss {
  constructor(v) {
    super(v);
    this.ttValue = v + 19;
    if (v % 2) this.cb = (x) => x + 19;
  }
  who() { return 'Tt'; }
}

function touch(o, i) {
  o['dyn' + i] = i * 3;
  o.late = function () { return i; };
  return Object.keys(o).join(',') + '|' + o.late() + '|' + o['dyn' + i] + '|' + o.who();
}
const objs = [];
for (let round = 0; round < 3; round++) {
  objs.push(new A(round + 0));
  objs.push(new Bb(round + 1));
  objs.push(new Cc(round + 2));
  objs.push(new Dd(round + 3));
  objs.push(new Eee(round + 4));
  objs.push(new Fff(round + 5));
  objs.push(new Gggg(round + 6));
  objs.push(new Hhhh(round + 7));
  objs.push(new Iiiii(round + 8));
  objs.push(new Jjjjj(round + 9));
  objs.push(new Kk(round + 10));
  objs.push(new Ll(round + 11));
  objs.push(new Mmm(round + 12));
  objs.push(new Nnn(round + 13));
  objs.push(new Oooo(round + 14));
  objs.push(new Pppp(round + 15));
  objs.push(new Qqqqq(round + 16));
  objs.push(new Rrrrr(round + 17));
  objs.push(new Ss(round + 18));
  objs.push(new Tt(round + 19));
}
objs.forEach((o, i) => console.log(touch(o, i)));
for (const o of objs) {
  console.log(o.constructor.name, o instanceof Object, typeof o.cb, Object.getOwnPropertyNames(o).length);
}

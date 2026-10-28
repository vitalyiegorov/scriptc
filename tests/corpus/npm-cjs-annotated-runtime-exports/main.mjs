import value, { add, self, missing, total } from 'callback-exports';
import again from 'callback-exports';
console.log(value === again, self() === value, typeof add, missing === undefined, total);
console.log(add(4), value.total, value.add(3), value.total, total);
console.log(Object.keys(value).join(','), value[Symbol.for('callback-exports')]);
value.extra = 11;
console.log(self().extra, self() === again);

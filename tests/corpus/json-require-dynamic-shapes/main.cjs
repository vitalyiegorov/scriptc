const value = require('./data.json');
const shared = require('./shared.cjs');
console.log(value === shared, value.none === null, Object.keys(value.empty).length);
console.log(JSON.stringify(value));
value.empty.updated = 42;
console.log(shared.empty.updated);
console.log(Object.keys(value.nested.empty).length);
console.log(Array.isArray(value.mixed), JSON.stringify(value.mixed));

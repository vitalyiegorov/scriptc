import 'reflect-metadata';

class Base {
  method(): string { return 'base'; }
}
class Child extends Base {}
const symbolKey = Symbol('metadata');
const objectKey = { key: 'metadata' };

Reflect.defineMetadata('inherited', 'class base', Base);
Reflect.defineMetadata('shared', 'base shared', Base);
Reflect.defineMetadata('shared', 'child shared', Child);
Reflect.defineMetadata('own', 'class child', Child);
console.log(Reflect.getMetadata('inherited', Child));
console.log(Reflect.hasMetadata('inherited', Child), Reflect.hasOwnMetadata('inherited', Child));
console.log(Reflect.getOwnMetadata('shared', Child));
console.log(Reflect.getOwnMetadataKeys(Child).join(','));
console.log(Reflect.getMetadataKeys(Child).join(','));

Reflect.defineMetadata(symbolKey, 'symbol value', Base.prototype, 'method');
Reflect.defineMetadata(objectKey, 'object value', Base.prototype, 'method');
Reflect.defineMetadata('type', 'method type', Base.prototype, 'method');
console.log(Reflect.getMetadata(symbolKey, Child.prototype, 'method'));
console.log(Reflect.getMetadata(objectKey, Child.prototype, 'method'));
console.log(Reflect.getOwnMetadataKeys(Base.prototype, 'method')[0] === symbolKey);
console.log(Reflect.getOwnMetadataKeys(Base.prototype, 'method')[1] === objectKey);
console.log(Reflect.getOwnMetadataKeys(Child.prototype, 'method').length);
console.log(Reflect.getMetadata('type', Child.prototype, 'method'));

Reflect.defineMetadata('function', 'function target', Base.prototype.method);
console.log(Base.prototype.method === Child.prototype.method);
console.log(Reflect.getMetadata('function', Child.prototype.method));
console.log(Reflect.getMetadata('function', Base.prototype, 'method') === undefined);
console.log(Reflect.deleteMetadata('shared', Child));
console.log(Reflect.getMetadata('shared', Child));
console.log(Reflect.deleteMetadata('shared', Child));
console.log(Reflect.deleteMetadata(objectKey, Base.prototype, 'method'));
console.log(Reflect.hasMetadata(objectKey, Child.prototype, 'method'));
console.log(Reflect.getOwnMetadataKeys(Base.prototype, 'method').length);

class Inspector {
  constructor(graph) { this.graph = graph; }
  inspect(x) { return this.graph + x; }
  register() { return 'real'; }
}
const noop = () => {};
const Noop = new Proxy(Inspector.prototype, { get: () => noop });
console.log(typeof Noop.inspect, Noop.inspect(1), typeof Noop.missing);
const view = new Proxy(Inspector.prototype, {});
console.log(typeof view.inspect, view.register === Inspector.prototype.register, 'inspect' in view);
console.log(view.inspect.call(new Inspector(2), 3), new Inspector(4).inspect(5));

// Instances as targets (Nest's exception and adapter proxies): traps
// receive the native instance, and trapless reads and `in` see the
// prototype's compiled members, also through a proxied Proxy.
class Context {
  constructor(name) { this.name = name; this.ready = false; }
  get(token) { return token + ':' + this.name; }
  async init() { this.ready = true; return this; }
}
class Application extends Context {
  get label() { return 'app ' + this.name; }
  listen() { return 'listening ' + this.name; }
}
class Adapter {
  listen() { return 'adapter'; }
  getType() { return 'express'; }
}
function exceptionProxy(target) {
  const trap = (receiver, prop) => {
    if (!(prop in receiver)) return undefined;
    if (typeof receiver[prop] === 'function') return (...args) => receiver[prop](...args);
    return receiver[prop];
  };
  return new Proxy(target, { get: trap, set: trap });
}
function adapterProxy(app, adapter) {
  const proxy = new Proxy(app, {
    get: (receiver, prop) => {
      if (!(prop in receiver) && prop in adapter) return (...args) => adapter[prop](...args);
      if (typeof receiver[prop] === 'function')
        return (...args) => { const result = receiver[prop](...args); return result instanceof Application ? proxy : result; };
      return receiver[prop];
    },
  });
  return proxy;
}
const context = exceptionProxy(new Context('ctx'));
console.log(context.get('a'), context.ready, context.missing, 'get' in context);
const app = adapterProxy(exceptionProxy(new Application('web')), new Adapter());
console.log(app.listen(), app.getType(), app.label, app.get('b'), 'listen' in app, 'getType' in app);
context.init().then((value) => console.log(value === context, value.ready));
const bare = new Proxy(new Proxy(new Application('bare'), {}), {});
console.log(typeof bare.listen, bare.listen(), bare.label, bare.name, 'init' in bare, 'nope' in bare);

// A base class whose method is read as a value somewhere (so the program
// observes the name) and whose generic subclass assigns methods onto
// `this` (rxjs' Subscription and OperatorSubscriber<T>): calls through the
// base-typed field must find the inherited method on the subclass instance.
function arrRemove<T>(arr: T[] | undefined | null, item: T) {
  if (arr) {
    const index = arr.indexOf(item);
    0 <= index && arr.splice(index, 1);
  }
}
interface Unsubscribable { unsubscribe(): void }
type TeardownLogic = Subscription | Unsubscribable | (() => void) | void;
function isFunction(value: any): value is (...args: any[]) => any { return typeof value === "function"; }
class Subscription implements Unsubscribable {
  public closed = false;
  private _parentage: Subscription[] | Subscription | null = null;
  private _finalizers: Exclude<TeardownLogic, void>[] | null = null;
  private initialTeardown?: () => void;
  constructor(initialTeardown?: () => void) {
    this.initialTeardown = initialTeardown;
  }
  unsubscribe(): void {
    if (!this.closed) {
      this.closed = true;
      const { _parentage } = this;
      if (_parentage) {
        this._parentage = null;
        if (Array.isArray(_parentage)) {
          for (const parent of _parentage) parent.remove(this);
        } else {
          _parentage.remove(this);
        }
      }
      const { initialTeardown } = this;
      if (isFunction(initialTeardown)) initialTeardown();
      const { _finalizers } = this;
      if (_finalizers) {
        this._finalizers = null;
        for (const f of _finalizers) {
          if (isFunction(f)) f(); else f.unsubscribe();
        }
      }
    }
  }
  add(teardown: TeardownLogic): void {
    if (teardown && teardown !== this) {
      if (this.closed) {
        if (isFunction(teardown)) teardown(); else teardown.unsubscribe();
      } else {
        if (teardown instanceof Subscription) {
          if (teardown.closed || teardown._hasParent(this)) return;
          teardown._addParent(this);
        }
        (this._finalizers = this._finalizers ?? []).push(teardown);
      }
    }
  }
  private _hasParent(parent: Subscription) {
    const { _parentage } = this;
    return _parentage === parent || (Array.isArray(_parentage) && _parentage.includes(parent));
  }
  private _addParent(parent: Subscription) {
    const { _parentage } = this;
    this._parentage = Array.isArray(_parentage) ? (_parentage.push(parent), _parentage) : _parentage ? [_parentage, parent] : parent;
  }
  private _removeParent(parent: Subscription) {
    const { _parentage } = this;
    if (_parentage === parent) this._parentage = null;
    else if (Array.isArray(_parentage)) arrRemove(_parentage, parent);
  }
  remove(teardown: Exclude<TeardownLogic, void>): void {
    const { _finalizers } = this;
    _finalizers && arrRemove(_finalizers, teardown);
    if (teardown instanceof Subscription) teardown._removeParent(this);
  }
  count(): number { return this._finalizers ? this._finalizers.length : 0; }
}
class Subscriber<T> extends Subscription {
  isStopped = false;
  protected destination: Subscriber<any> | null;
  constructor(destination?: Subscriber<any>) {
    super();
    this.destination = destination ?? null;
    if (destination) destination.add(this);
  }
  next(v: T): void { if (!this.isStopped) this._next(v); }
  protected _next(v: T): void { console.log("base next", v); }
}
class OperatorSubscriber<T> extends Subscriber<T> {
  private onFinalize?: () => void;
  constructor(destination: Subscriber<any>, onNext?: (v: T) => void, onFinalize?: () => void) {
    super(destination);
    this.onFinalize = onFinalize;
    this._next = onNext
      ? function (this: OperatorSubscriber<T>, v: T) { onNext(v); }
      : super._next;
  }
  unsubscribe() {
    const { closed } = this;
    super.unsubscribe();
    !closed && this.onFinalize?.();
  }
}
const root = new Subscriber<number>();
const parent = new OperatorSubscriber<number>(root, (v) => console.log("parent", v));
const kid = new OperatorSubscriber<number>(parent, (v) => console.log("kid", v), () => console.log("fin"));
console.log(parent.count(), root.count());
kid.next(1);
kid.unsubscribe();
console.log(parent.count(), root.count());
const kid2 = new OperatorSubscriber<string>(parent, (v) => console.log("kid2", v));
const kid3 = new OperatorSubscriber<string>(kid2);
kid3.unsubscribe();
console.log(kid2.count(), parent.count());
parent.unsubscribe();
console.log(parent.closed, kid2.closed, root.count());
const probe: any = parent;
console.log(typeof probe.remove, typeof probe._removeParent);
const bag: any = { remove: 1 };
bag.remove = () => console.log("own");

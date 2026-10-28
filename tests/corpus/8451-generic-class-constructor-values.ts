// A generic class passed around as a value (rxjs's schedulers take
// `typeof Action` and build `new this.actionCtor<T>(this, work)`): the bare
// `typeof Action` slot holds the class itself, subclasses of the generic
// class (including one that extends a scheduler built on the slot) fill it,
// and construction through the slot builds the subclass instance whatever
// type argument the call site spells. Calls, `instanceof` and field reads
// on the built instances follow Node.
class Subscription {
  closed = false;
  unsubscribe() { this.closed = true; }
}
class Scheduler0 {}
class Action<T> extends Subscription {
  constructor(scheduler: Scheduler0, work: (state?: T) => void) {
    super();
  }
  schedule(state?: T, delay: number = 0): Subscription {
    return this;
  }
}
class AsyncAction<T> extends Action<T> {
  scheduler: Scheduler0;
  work: (state?: T) => void;
  constructor(scheduler: Scheduler0, work: (state?: T) => void) {
    super(scheduler, work);
    this.scheduler = scheduler;
    this.work = work;
  }
  schedule(state?: T, delay: number = 0): Subscription {
    console.log("async schedule", state, delay);
    this.work(state);
    return this;
  }
}
class Scheduler extends Scheduler0 {
  actionCtor: typeof Action;
  constructor(actionCtor: typeof Action) {
    super();
    this.actionCtor = actionCtor;
  }
  schedule<T>(work: (state?: T) => void, delay: number = 0, state?: T): Subscription {
    return new this.actionCtor<T>(this, work).schedule(state, delay);
  }
}
const s = new Scheduler(AsyncAction);
s.schedule((x?: number) => console.log("work", x), 5, 42);
s.schedule((x?: string) => console.log("work", x), 6, "hi");
const t = new Scheduler(Action);
console.log(t.schedule((x?: number) => console.log("never", x), 5, 1) instanceof Action);

class QueueAction<T> extends AsyncAction<T> {
  schedule(state?: T, delay: number = 0): Subscription {
    console.log("queue schedule", state, delay);
    this.work(state);
    return this;
  }
}
class QueueScheduler extends Scheduler {
  runs = 0;
  constructor(actionCtor: typeof Action) {
    super(actionCtor);
  }
  schedule<T>(work: (state?: T) => void, delay: number = 0, state?: T): Subscription {
    this.runs++;
    return super.schedule(work, delay, state);
  }
}
const q = new QueueScheduler(QueueAction);
const sub = q.schedule((x?: boolean) => console.log("flag", x), 0, true);
q.schedule((x?: number[]) => console.log("list", x), 1, [1, 2]);
console.log(sub instanceof QueueAction, sub instanceof AsyncAction, sub instanceof Action, q.runs);
console.log(sub instanceof Subscription, sub.closed);
sub.unsubscribe();
console.log(sub.closed);

const ctors: (typeof Action)[] = [Action, AsyncAction, QueueAction];
for (const ctor of ctors) {
  const made = new ctor<unknown>(new Scheduler0(), () => {});
  console.log(made instanceof QueueAction, made instanceof AsyncAction, made instanceof Action);
}

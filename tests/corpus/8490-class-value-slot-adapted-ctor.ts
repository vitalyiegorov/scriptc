// @transform-types
// A derived class value flowing into a base class-value slot when the derived
// constructor's parameters are subclasses of the base's: construction through
// the slot converts the arguments to the derived constructor's own types.
class Scheduler {
  name: string;
  constructor(name: string) { this.name = name; }
}
class AsyncScheduler extends Scheduler {
  runs = 0;
}
class Action {
  scheduler: Scheduler;
  work: (n: number) => number;
  constructor(scheduler: Scheduler, work: (n: number) => number) { this.scheduler = scheduler; this.work = work; }
  run(n: number): number { return this.work(n); }
}
class AsyncAction extends Action {
  as: AsyncScheduler;
  constructor(scheduler: AsyncScheduler, work: (n: number) => number) {
    super(scheduler, work);
    this.as = scheduler;
    scheduler.runs++;
  }
  run(n: number): number { return super.run(n) + 100 * this.as.runs; }
}
class Holder {
  ctor: typeof Action;
  constructor(ctor: typeof Action) { this.ctor = ctor; }
  make(s: Scheduler, work: (n: number) => number): Action { return new this.ctor(s, work); }
}
const h = new Holder(AsyncAction);
const as = new AsyncScheduler("a");
const act = h.make(as, (n) => n * 2);
console.log(act instanceof AsyncAction, act.run(4), as.runs);
const plain = new Holder(Action).make(new Scheduler("p"), (n) => n + 1);
console.log(plain instanceof AsyncAction, plain.run(4));
const second = new AsyncScheduler("b");
const viaBase: typeof Action = AsyncAction;
const again = new viaBase(second, (n) => n - 1);
console.log(again instanceof AsyncAction, again.run(10), second.runs);
console.log(h.make(second, (n) => n).run(1), second.runs);

// A subclass narrowing an inherited parameter property and an overridden
// method's parameter to a subclass type.
class Queue {
  size = 0;
}
class DelayQueue extends Queue {
  delay = 7;
}
class Task {
  protected queue: Queue;
  constructor(queue: Queue) {
    this.queue = queue;
  }
  describe(q: Queue): string {
    return "task " + q.size;
  }
  queueSize(): number {
    return this.queue.size;
  }
}
class DelayTask extends Task {
  constructor(protected queue: DelayQueue) {
    super(queue);
    queue.size += 2;
  }
  describe(q: DelayQueue): string {
    return "delay " + q.delay + " " + q.size;
  }
}
const dq = new DelayQueue();
const dt: Task = new DelayTask(dq);
console.log(dt.describe(dq), dt.queueSize(), dq.size);

// @transform-types
// An override narrowing a parameter to a subclass still receives base-class
// values through the base signature: reads on the actual object answer
// undefined where it lacks the subclass's properties, as in JS; nothing aborts.
class Queue { size = 0; }
class DelayQueue extends Queue { delay = 7; label(): string { return "L" + this.delay; } }
function twice(n: number): number { return n * 2; }
function show(q: Queue): string { return "q" + q.size; }
class Task {
  run(q: Queue, k: number): string { return "task " + q.size + k; }
}
class DelayTask extends Task {
  run(q: DelayQueue, k: number): string {
    const d = q.delay;
    q.delay = d + 1;
    return show(q) + " " + twice(q.delay) + " " + q.label() + " " + (q.delay > 3) + " " + k + String(d);
  }
}
const t: Task = new DelayTask();
for (const q of [new Queue(), new DelayQueue()]) {
  try { console.log(t.run(q, 3)); } catch (e) { console.log("threw", e instanceof TypeError); }
}

class Task2 {
  describe(q: Queue): string { return "task " + q.size; }
  calc(q: Queue): number { return q.size; }
}
class DelayTask2 extends Task2 {
  describe(q: DelayQueue): string { return "delay " + q.delay + " " + q.size; }
  calc(q: DelayQueue): number { return q.delay + q.size + 1; }
}
const t2: Task2 = new DelayTask2();
console.log(t2.describe(new Queue()));
console.log(t2.describe(new DelayQueue()));
console.log(t2.calc(new Queue()));
console.log(t2.calc(new DelayQueue()));

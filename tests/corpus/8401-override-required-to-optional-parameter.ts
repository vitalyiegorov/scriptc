// A subclass may make a required parameter of an inherited method optional
// (rxjs' AnimationFrameScheduler.flush(action?) over AsyncScheduler.flush(action)),
// and widen a parameter's type; calls through the base type, the subclass
// type, and a further subclass reach the right body.
class Action {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}

class Scheduler {
  log: string[] = [];
  flush(action: Action): void {
    this.log.push("base:" + action.id);
  }
  describe(value: number): string {
    return "base-" + value;
  }
}

class FrameScheduler extends Scheduler {
  flush(action?: Action): void {
    this.log.push(action ? "frame:" + action.id : "frame:none");
  }
  describe(value: number | string): string {
    return "frame-" + value;
  }
}

class SlowFrameScheduler extends FrameScheduler {
  flush(action?: Action): void {
    this.log.push("slow>" + (action ? action.id : "none"));
    super.flush(action);
  }
}

const schedulers: Scheduler[] = [new Scheduler(), new FrameScheduler(), new SlowFrameScheduler()];
for (const scheduler of schedulers) {
  scheduler.flush(new Action(1));
  console.log(scheduler.describe(7));
  console.log(scheduler.log.join(","));
}

const frame = new FrameScheduler();
frame.flush(new Action(2));
console.log(frame.describe("s"), frame.log.join(","));

const slow = new SlowFrameScheduler();
slow.flush();
slow.flush(new Action(3));
console.log(slow.log.join(","));

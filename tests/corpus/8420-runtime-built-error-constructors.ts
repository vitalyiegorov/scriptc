// Error constructors built at run time by a factory (rxjs's
// createErrorClass): a const typed by an interface with a construct
// signature holds a constructor function whose prototype inherits from
// Error.prototype. `new` through the const, instanceof against it and
// against Error, thrown and caught values, and the instance fields all
// follow Node.
function createErrorClass<T>(createImpl: (_super: any) => any): T {
  const _super = (instance: any) => {
    Error.call(instance);
    instance.stack = new Error().stack;
  };
  const ctorFunc = createImpl(_super);
  ctorFunc.prototype = Object.create(Error.prototype);
  ctorFunc.prototype.constructor = ctorFunc;
  return ctorFunc;
}

interface EmptyError extends Error {}
interface EmptyErrorCtor {
  new (): EmptyError;
}
const EmptyError: EmptyErrorCtor = createErrorClass(
  (_super) =>
    function EmptyErrorImpl(this: any) {
      _super(this);
      this.name = "EmptyError";
      this.message = "no elements in sequence";
    },
);

interface UnsubscriptionError extends Error {
  readonly errors: any[];
}
interface UnsubscriptionErrorCtor {
  new (errors: any[]): UnsubscriptionError;
}
const UnsubscriptionError: UnsubscriptionErrorCtor = createErrorClass(
  (_super) =>
    function UnsubscriptionErrorImpl(this: any, errors: (Error | string)[]) {
      _super(this);
      this.message = errors ? `${errors.length} errors occurred during unsubscription` : "";
      this.name = "UnsubscriptionError";
      this.errors = errors;
    },
);

interface TimeoutError<T = unknown> extends Error {
  info: T | null;
}
interface TimeoutErrorCtor {
  new <T = unknown>(info?: T): TimeoutError<T>;
}
const TimeoutError: TimeoutErrorCtor = createErrorClass(
  (_super) =>
    function TimeoutErrorImpl(this: any, info: any = null) {
      _super(this);
      this.message = "Timeout has occurred";
      this.name = "TimeoutError";
      this.info = info;
    },
);

const empty = new EmptyError();
console.log(empty.name, empty.message, empty instanceof Error, empty instanceof EmptyError);
console.log(empty instanceof UnsubscriptionError, typeof empty.stack, String(empty));

function reject(reason?: any): void {
  console.log("rejected", reason instanceof EmptyError, reason instanceof Error, reason.message);
}
reject(new EmptyError());

function fail(): never {
  throw new EmptyError();
}
try {
  fail();
} catch (e: any) {
  console.log(e instanceof EmptyError, e instanceof Error, e.name, e.message);
}

try {
  throw new UnsubscriptionError(["a", new Error("b").message]);
} catch (e) {
  console.log(e instanceof UnsubscriptionError ? e.errors : [e]);
  if (e instanceof UnsubscriptionError) console.log(e.message, e.errors.length);
}

const timeout = new TimeoutError({ seen: 3 });
console.log(timeout.name, timeout.message, timeout.info, timeout instanceof TimeoutError);
console.log(new TimeoutError().info, new TimeoutError() instanceof EmptyError);

const values: unknown[] = [new EmptyError(), new Error("plain"), new TimeoutError(), "text"];
console.log(values.map((v) => v instanceof EmptyError), values.map((v) => v instanceof Error));
console.log(Object.keys(new UnsubscriptionError(["x"])), Object.prototype.toString.call(empty));

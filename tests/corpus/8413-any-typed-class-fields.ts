// @transform-types
// Class fields and parameter properties typed `any` hold checked-dynamic
// values (rxjs's Notification keeps its `error?: any` as a parameter
// property). Reads feed property access, calls and arithmetic like any
// other `any` expression, and the declared overloads stay callable.
interface NextNotification<T> {
  kind: "N";
  value: T;
}
interface ErrorNotification {
  kind: "E";
  error: any;
}
interface CompleteNotification {
  kind: "C";
}

class Notification<T> {
  readonly hasValue: boolean;
  payload: any;
  extra?: any;

  constructor(kind: "N", value?: T);
  constructor(kind: "E", value: undefined, error: any);
  constructor(kind: "C");
  constructor(
    public readonly kind: "N" | "E" | "C",
    public readonly value?: T,
    public readonly error?: any,
  ) {
    this.hasValue = kind === "N";
    this.payload = kind === "E" ? error : value;
  }

  do(next: (value: T) => void, error: (err: any) => void, complete: () => void): void;
  do(next: (value: T) => void, error: (err: any) => void): void;
  do(next: (value: T) => void): void;
  do(
    nextHandler: (value: T) => void,
    errorHandler?: (err: any) => void,
    completeHandler?: () => void,
  ): void {
    const { kind, value, error } = this;
    return kind === "N"
      ? nextHandler?.(value!)
      : kind === "E"
        ? errorHandler?.(error)
        : completeHandler?.();
  }

  static createNext<T>(value: T) {
    return new Notification("N", value) as Notification<T> & NextNotification<T>;
  }
  static createError(err?: any) {
    return new Notification("E", undefined, err) as Notification<never> & ErrorNotification;
  }
  static createComplete(): Notification<never> & CompleteNotification {
    return new Notification("C") as Notification<never> & CompleteNotification;
  }
}

const next = Notification.createNext(3);
next.do((v) => console.log("next", v));
Notification.createError({ code: 7 }).do(
  () => {},
  (e) => console.log("error", e.code + 1),
);
Notification.createComplete().do(
  () => {},
  () => {},
  () => console.log("complete"),
);
console.log(next.kind, next.value, next.hasValue, next.payload, next.error, next.extra);
next.extra = "later";
next.payload = next.payload + 1;
console.log(next.extra, next.payload);

const failed = Notification.createError(["a", "b"]);
console.log(failed.error.length, failed.payload[1], failed.hasValue);

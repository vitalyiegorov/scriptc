// @tsc-legacy-decorators
// A method decorator read from a static field of the class it decorates
// (Nest's `@Logger.WrapBuffer`): the static initializer runs before the
// member decorators apply.
class Logger {
  private static isBufferAttached = false;
  private static logBuffer: { methodRef: () => void; args: unknown[] }[] = [];
  private static WrapBuffer: MethodDecorator = (target, propertyKey, descriptor: TypedPropertyDescriptor<any>) => {
    const originalFn = descriptor.value;
    descriptor.value = function (this: any, ...args: unknown[]) {
      if (Logger.isBufferAttached) {
        Logger.logBuffer.push({ methodRef: () => originalFn.call(this, ...args), args });
        return;
      }
      return originalFn.call(this, ...args);
    };
  };
  static attach(on: boolean): void {
    Logger.isBufferAttached = on;
  }
  static flush(): void {
    for (const entry of Logger.logBuffer) entry.methodRef();
    Logger.logBuffer = [];
  }
  constructor(private readonly context: string) {}
  @Logger.WrapBuffer
  log(message: string): void {
    console.log(`[${this.context}] ${message}`);
  }
  @Logger.WrapBuffer
  warn(message: string, extra?: string): void {
    console.log(`[${this.context}] warn ${message} ${extra ?? "-"}`);
  }
}
const logger = new Logger("app");
logger.log("direct");
Logger.attach(true);
logger.log("buffered");
logger.warn("buffered too", "x");
console.log("before flush");
Logger.attach(false);
Logger.flush();
logger.warn("after");

// @tsc-legacy-decorators
const events: string[] = [];
function method(label: string): MethodDecorator {
  events.push(`evaluate:${label}`);
  return (target, key, descriptor) => {
    events.push(`apply:${label}:${String(key)}`);
    const original: any = descriptor.value;
    if (original) {
      descriptor.value = function (this: any, ...args: any[]) {
        return original.apply(this, args) + 10;
      } as any;
    } else {
      const getter: any = descriptor.get!;
      descriptor.get = function (this: any) { return getter.call(this) + 20; };
    }
  };
}
function field(label: string): PropertyDecorator {
  events.push(`evaluate:${label}`);
  return (target, key) => { events.push(`field:${label}:${String(key)}`); };
}
function parameter(label: string): ParameterDecorator {
  events.push(`evaluate:${label}`);
  return (target, key, index) => { events.push(`parameter:${label}:${String(key)}:${index}`); };
}
function klass(label: string): ClassDecorator {
  events.push(`evaluate:${label}`);
  return (target) => { events.push(`class:${label}:${target.name}`); };
}
@klass("outer")
@klass("inner")
class Service {
  static ready = "ready";
  static { events.push("static"); }
  @field("instance-field") value = 2;
  @field("static-field") static label = "service";
  constructor(@parameter("ctor-first") first: number, @parameter("ctor-last") last: string) {
    this.value = first + last.length;
  }
  @method("outer-method")
  @method("inner-method")
  run(@parameter("method-first") input: number, @parameter("method-last") ignored: string) {
    return this.value + input + ignored.length;
  }
  @method("static-method") static count() { return 3; }
  @method("accessor") get doubled() { return this.value * 2; }
  set doubled(value: number) { this.value = value / 2; }
}
const service = new Service(4, "ok");
console.log(events.join("|"));
console.log(service.run(1, "x"), Service.count(), service.doubled);
service.doubled = 30;
console.log(service.value, service.doubled, Service.label, Service.ready);
const proto: any = Service.prototype;
const descriptor = Object.getOwnPropertyDescriptor(proto, "run")!;
console.log(descriptor.enumerable, descriptor.configurable, descriptor.writable, typeof descriptor.value);

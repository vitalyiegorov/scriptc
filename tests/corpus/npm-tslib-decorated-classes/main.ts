// tsc's published-package class output: `let C = C_1 = class C {}` aliases,
// and method decorators replacing prototype and static methods through
// tslib's __decorate descriptors.
import { Logger, Module, moduleName } from "decorated-lib";

new Logger("ctx").log("direct");
Logger.log("direct");
Logger.attachBuffer();
new Logger("ctx").log("buffered");
Logger.log("buffered");
console.log("flushing");
Logger.flush();
console.log(Module.register("m").module === Module, moduleName());

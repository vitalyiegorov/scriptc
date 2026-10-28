// A JavaScript base method documented as `@returns {Promise<this>}` and an
// unannotated async override that also resolves with `this` (Nest's
// NestApplicationContext.init and NestApplication.init), called through
// untyped receivers.
import { run } from "fluent-init";

await run("one");

// A CommonJS module's factory constructs an ES5 class whose `var` binding is
// assigned further down (rxjs's createOperatorSubscriber), called once the
// module has assigned it.
import { run } from "es5-subscriber";

run("destination");

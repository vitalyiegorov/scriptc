import { Mode } from "./barrel.js";
import { Mode as Direct } from "./value.js";
import { Mode as Star } from "./star.js";
console.log(Mode === Direct, Mode.ACTIVE, Mode[Mode.ACTIVE]);
console.log(Star === Direct, Star.ACTIVE);

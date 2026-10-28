// A package function instantiated with a string: `in` on the primitive
// throws Node's TypeError, and a typeof guard skips it.
import { Param, hasLength } from "param-options";

const name: string = process.argv.length > 99 ? "unused" : "id";
console.log(Param(name), Param(""));
try {
  console.log(hasLength(name));
} catch (error) {
  console.log((error as Error).name, (error as Error).message);
}

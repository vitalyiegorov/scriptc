import { Holder, ok, weak } from "fencepkg";

console.log(ok());
try {
  weak();
  console.log("no throw");
} catch (e) {
  console.log(e instanceof Error);
}
try {
  new Holder().weak();
  console.log("no throw");
} catch (e) {
  console.log(e instanceof Error);
}
console.log(new Holder().get());

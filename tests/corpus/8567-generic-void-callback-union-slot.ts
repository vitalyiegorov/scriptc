// A callback whose parameter is the instantiation's `void` flows into an
// optional `() => void` slot: the call passes undefined for the surplus
// parameter, as JavaScript does.
function subscribe<T>(onNext?: (value: T) => void, onDone?: () => void): (x: T) => void {
  return (x) => {
    onNext?.(x);
    onDone?.();
  };
}
function tap<T>(next?: (value: T) => void): (x: T) => void {
  return subscribe(
    (value) => {
      next?.(value);
    },
    () => {
      console.log("done");
    },
  );
}
const f = tap<void>((v) => console.log("next", v));
f(undefined);
const g = tap<number>((v) => console.log("next", v + 1));
g(41);

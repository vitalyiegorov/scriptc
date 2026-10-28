import { defer, lastValueFrom, of } from "genshare";

async function main(): Promise<void> {
  // One shared generic instance would convert 'deferred' and 1 alike.
  console.log(await lastValueFrom(defer(() => of("deferred"))));
  console.log(await lastValueFrom(of(1)));
  console.log(await lastValueFrom(defer(() => of(true))));
  const got: number[] = [];
  of(1, 2, 3).subscribe({ next: (v) => got.push(v) });
  of("x", "y").subscribe({ next: (v) => got.push(v.length) });
  console.log(got.join(","));
}
main();

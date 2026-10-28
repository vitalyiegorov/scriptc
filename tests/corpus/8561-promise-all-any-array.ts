// Promise.all over an array of Promise<any>: the combined value is any[].
function hooks(items: unknown[]): Promise<any>[] {
  return items.map(async (item) => (item as { run(): number }).run());
}
async function main(): Promise<void> {
  const items = [{ run: () => 1 }, { run: () => 2 }];
  const results = await Promise.all(hooks(items));
  console.log(results.length, results[0], results[1]);
  await Promise.all(hooks([]));
  console.log("done");
}
main();

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { tscLegacyDecoratorsOracleEntry } from "./jsx-oracle.js";

test("legacy decorator oracles use checked imported design types and invalidate on dependency edits", () => {
  const root = mkdtempSync(join(tmpdir(), "scriptc-decorator-oracle-"));
  const cache = mkdtempSync(join(tmpdir(), "scriptc-decorator-oracle-cache-"));
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(root, "tsconfig.json"),
      '{"compilerOptions":{"experimentalDecorators":true,"emitDecoratorMetadata":true}}',
    );
    const dependency = join(root, "types.ts");
    writeFileSync(
      dependency,
      "export class Service {}\nexport interface Shape { value: string }\n",
    );
    const entry = join(root, "main.ts");
    writeFileSync(
      entry,
      `import { Service, Shape } from "./types.js";
const reflection = Reflect as typeof Reflect & { metadata(key: string, value: unknown[]): ClassDecorator };
reflection.metadata = (key, values) => () => { console.log(key, values.map((value: any) => value.name).join(",")); };
function decorate(target: any) {}
@decorate
class Example { constructor(service: Service, shape: Shape) {} }
new Example(new Service(), { value: "ok" });
`,
    );
    const first = tscLegacyDecoratorsOracleEntry(entry, cache);
    expect(readFileSync(first, "utf8")).toContain(
      '__metadata("design:paramtypes", [Service, Object])',
    );
    expect(execFileSync(process.execPath, [first], { encoding: "utf8" })).toBe(
      "design:paramtypes Service,Object\n",
    );
    expect(tscLegacyDecoratorsOracleEntry(entry, cache)).toBe(first);
    writeFileSync(
      dependency,
      "export class Service { value = 1 }\nexport interface Shape { value: string }\n",
    );
    const second = tscLegacyDecoratorsOracleEntry(entry, cache);
    expect(dirname(second)).not.toBe(dirname(first));
    expect(execFileSync(process.execPath, [second], { encoding: "utf8" })).toBe(
      "design:paramtypes Service,Object\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

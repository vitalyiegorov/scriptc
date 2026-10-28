import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const root = join(import.meta.dirname, "../..");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

test("DateTimeFormat names unsupported locale, option, and method boundaries", async () => {
  const outDir = join(
    root,
    "node_modules/.cache/scriptc-tests",
    `intl-refusals${sanitize ? "-san" : ""}`,
  );
  mkdirSync(outDir, { recursive: true });
  const result = await compile(join(root, "tests/fixtures/intl-date-time-format/refusals.mjs"), {
    outPath: join(outDir, "program"),
    outDir,
    backend: "llvm",
    sanitize,
  });
  if (!result.ok)
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const { stdout, stderr } = await execFileAsync(result.binaryPath, [], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(stdout).toBe(
    "locale true\nmonth true\ncalendar true\nnumbering true\nzone true\nprofile true\nweekday true\nstyle true\nparts true\nprimitive true\n",
  );
  expect(stderr).toBe("");
}, 120_000);

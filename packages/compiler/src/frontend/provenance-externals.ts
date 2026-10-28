import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { provenanceSources } from "./provenance-registry.js";

/* The bare packages a provenance source tree imports, and the exact files
 * the checker must resolve them to.
 *
 * The cached source tree has no node_modules, so the tsconfig "paths" fall
 * back to the project's install. A wildcard mapping resolves a package
 * through its directory (package.json "main"/"types"), which ignores
 * "exports": a dual package (`uid`: main dist/index.js, import
 * dist/index.mjs) then types one file while the module order compiles
 * another. An exact mapping per imported specifier, answered by the same
 * resolver the module order uses, keeps both worlds on one file. */

const SKIPPED_DIRS = new Set(["node_modules", "test", "tests", "__tests__", "e2e", ".git"]);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\s]+)\1/g;

const scanned = new Map<string, readonly string[]>();

function listSources(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) listSources(join(dir, entry.name), out);
    } else if (/\.[cm]?tsx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

/** The bare specifiers (package names with subpaths) a source tree imports. */
function bareSpecifiersOf(dir: string): readonly string[] {
  const hit = scanned.get(dir);
  if (hit !== undefined) return hit;
  const files: string[] = [];
  listSources(dir, files);
  const found = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(SPECIFIER)) {
      const spec = match[2]!;
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) continue;
      if (spec.startsWith("node:")) continue;
      found.add(spec);
    }
  }
  const list = [...found].sort();
  scanned.set(dir, list);
  return list;
}

/** Exact "paths" entries for every external package the registered source
 * trees import. `resolve(fromFile, specifier)` answers the checker-world
 * file (the module order's resolver). */
export function provenanceExternalPaths(
  resolve: (fromFile: string, specifier: string) => string | null,
  skip: (specifier: string) => boolean,
): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  const sources = provenanceSources();
  if (sources === null) return paths;
  for (const pkg of sources.packages) {
    if (pkg.installedDir === undefined || pkg.installedDir === pkg.dir) continue;
    const anchor = join(pkg.dir, "package.json");
    for (const spec of bareSpecifiersOf(pkg.dir)) {
      if (paths[spec] !== undefined || skip(spec)) continue;
      const file = resolve(anchor, spec);
      if (file !== null) paths[spec] = [file];
    }
  }
  return paths;
}

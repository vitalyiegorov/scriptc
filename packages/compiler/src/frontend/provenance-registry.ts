import { dirname } from "node:path";
export interface ProvenancePackageSource {
  /** Package name ("cookie"). */
  name: string;
  /** The INSTALLED published version the attestation was fetched for. */
  version: string;
  /** The version field of the source tree's package.json, when it
   * disagrees with `version` (release tooling that bumps at publish —
   * babel's shape). Informational; the differential is the real check. */
  sourceVersion?: string;
  /** The attested source repository (https URL). */
  repo: string;
  /** The attested gitCommit digest — the content address of the cached
   * source tree. */
  commit: string;
  /** Absolute path of the package's directory inside the cached source
   * tree (== the tree root except in monorepos). */
  dir: string;
  /** The installed package's directory: bare imports inside the source
   * tree resolve from here, where the project's node_modules is. */
  installedDir?: string;
  /** specifier → absolute mapped source file ("cookie" → …/src/index.ts). */
  entries: Record<string, string>;
}

export interface ProvenanceSources {
  /** Successfully source-mapped packages, driver-import order. */
  packages: ProvenancePackageSource[];

  notes: string[];
}

interface RegistryState {
  bySpecifier: Map<string, string>;
  packageDirs: string[];
  sources: ProvenanceSources;
}

let state: RegistryState | null = null;

/** Installs the resolved provenance sources for the current compile.
 * Passing null (or an empty set) clears the registry. */
export function setProvenanceSources(sources: ProvenanceSources | null): void {
  if (sources === null || sources.packages.length === 0) {
    state = sources === null ? null : { bySpecifier: new Map(), packageDirs: [], sources };
    return;
  }
  const bySpecifier = new Map<string, string>();
  const packageDirs: string[] = [];
  for (const pkg of sources.packages) {
    packageDirs.push(pkg.dir.endsWith("/") ? pkg.dir : `${pkg.dir}/`);
    for (const [spec, file] of Object.entries(pkg.entries)) {
      bySpecifier.set(spec, file);
    }
  }
  state = { bySpecifier, packageDirs, sources };
}

/** The active sources (for reports), or null when the flag is off. */
export function provenanceSources(): ProvenanceSources | null {
  return state?.sources ?? null;
}

/** The mapped source entry for a bare specifier, or null. */
export function provenanceEntryFor(specifier: string): string | null {
  return state?.bySpecifier.get(specifier) ?? null;
}

/** True when any provenance package is registered. */
export function provenanceActive(): boolean {
  return state !== null && state.bySpecifier.size > 0;
}

/** True when `fileName` lives inside a registered package's source tree —
 * the gate for the third-party-source policies (the pure-annotated
 * dead-const elision, the per-file statement attribution). */
export function isProvenanceSourceFile(fileName: string): boolean {
  if (state === null) return false;
  for (const dir of state.packageDirs) {
    if (fileName.startsWith(dir)) return true;
  }
  return false;
}

/** The directory bare imports of `fileName` resolve from: the installed
 * package's for a provenance source file (the cached source tree has no
 * node_modules), else the file's own. */
export function resolutionDirOf(fileName: string): string {
  if (state !== null) {
    for (const pkg of state.sources.packages) {
      const dir = pkg.dir.endsWith("/") ? pkg.dir : `${pkg.dir}/`;
      if (pkg.installedDir !== undefined && fileName.startsWith(dir)) return pkg.installedDir;
    }
  }
  return dirname(fileName);
}

/** tsconfig "paths" for the registered entries — loadProgram feeds these
 * to tsgo so the checker resolves registered bare specifiers to the same
 * source files the preflight resolver answers. */
export function provenancePaths(): Record<string, string[]> | null {
  if (state === null || state.bySpecifier.size === 0) return null;
  const paths: Record<string, string[]> = {};
  for (const [spec, file] of state.bySpecifier) paths[spec] = [file];
  // The cached source tree has no node_modules: its other bare imports
  // resolve from the project's installed packages, as they do at runtime.
  const roots = new Set<string>();
  for (const pkg of state.sources.packages) {
    if (pkg.installedDir === undefined || pkg.installedDir === pkg.dir) continue;
    roots.add(dirname(pkg.name.startsWith("@") ? dirname(pkg.installedDir) : pkg.installedDir));
  }
  if (roots.size > 0) paths["*"] = [...roots].map((root) => `${root}/*`);
  return paths;
}

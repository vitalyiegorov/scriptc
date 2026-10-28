/** JS-level type feedback of a training run (`--profile-generate`).
 *
 * An instrumented executable records, per dynamic-tier property site and
 * dyn call, the receiver shapes (as ordered key lists), the entry each
 * lookup hit and the callee functions (scr_js_object.c, scr_pgo_prop /
 * scr_pgo_call) and writes them next to its LLVM profile as `<stem>.jsfb`.
 * `scriptc merge-profiles` merges those files into `<out>.jsfb`, which
 * `--profile-use <out>` reads. Site ids come from llvm/js-feedback.ts. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Distinct receivers or callees kept per site; more are counted as `other`. */
export const FEEDBACK_OBS_MAX = 8;

export interface FeedbackObservation {
  count: number;
  /** The recorder's description of the receiver or callee, verbatim. */
  [field: string]: unknown;
}

export interface FeedbackSite {
  id: string;
  count: number;
  other: number;
  obs: FeedbackObservation[];
}

export interface JsFeedback {
  version: 1;
  sites: FeedbackSite[];
}

/** The sidecar of an LLVM profile (or of a raw profile pattern's file). */
export function jsFeedbackSidecar(profilePath: string): string {
  return profilePath.endsWith(".profraw")
    ? profilePath.replace(/\.profraw$/, ".jsfb")
    : `${profilePath}.jsfb`;
}

/** Parses a feedback document; malformed ones are refused with a message
 * naming `source`. Sites with a malformed record are dropped, never
 * guessed at. */
export function parseJsFeedback(text: string, source: string): JsFeedback {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not a JS feedback profile`);
  }
  const root = doc as { version?: unknown; sites?: unknown } | null;
  if (root === null || typeof root !== "object" || root.version !== 1 || !Array.isArray(root.sites))
    throw new Error(`${source} is not a version 1 JS feedback profile`);
  const sites: FeedbackSite[] = [];
  for (const raw of root.sites as unknown[]) {
    const s = raw as Partial<FeedbackSite> | null;
    if (
      s === null ||
      typeof s !== "object" ||
      typeof s.id !== "string" ||
      !isCount(s.count) ||
      !isCount(s.other) ||
      !Array.isArray(s.obs) ||
      !s.obs.every((o) => typeof o === "object" && o !== null && isCount(o.count))
    )
      continue;
    sites.push({ id: s.id, count: s.count, other: s.other, obs: s.obs });
  }
  return { version: 1, sites };
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function readJsFeedback(path: string): JsFeedback {
  return parseJsFeedback(readFileSync(path, "utf8"), path);
}

const observationKey = (o: FeedbackObservation): string => {
  // `fn` is a code address of the training run, different in every run.
  const { count: _count, fn: _fn, ...rest } = o;
  return JSON.stringify(rest);
};

/** Sums feedback documents: counts add, equal observations merge, and a
 * site past FEEDBACK_OBS_MAX distinct observations counts the rest as other. */
export function mergeJsFeedback(inputs: readonly JsFeedback[]): JsFeedback {
  const sites = new Map<string, FeedbackSite & { keys: Map<string, FeedbackObservation> }>();
  for (const input of inputs) {
    for (const s of input.sites) {
      let m = sites.get(s.id);
      if (m === undefined) {
        m = { id: s.id, count: 0, other: 0, obs: [], keys: new Map() };
        sites.set(s.id, m);
      }
      m.count += s.count;
      m.other += s.other;
      for (const o of s.obs) {
        const key = observationKey(o);
        const have = m.keys.get(key);
        if (have !== undefined) have.count += o.count;
        else if (m.obs.length < FEEDBACK_OBS_MAX) {
          const copy = { ...o };
          m.keys.set(key, copy);
          m.obs.push(copy);
        } else m.other += o.count;
      }
    }
  }
  return {
    version: 1,
    sites: [...sites.values()].map(({ id, count, other, obs }) => ({ id, count, other, obs })),
  };
}

export function writeJsFeedback(path: string, feedback: JsFeedback): void {
  writeFileSync(path, `${JSON.stringify(feedback)}\n`);
}

/** Feedback files that go with the merge inputs: explicit `.jsfb` inputs,
 * and the sidecar of every other input that has one. */
export function feedbackInputs(
  inputs: readonly string[],
  exists: (path: string) => boolean,
): { llvm: string[]; feedback: string[] } {
  const llvm: string[] = [];
  const feedback: string[] = [];
  for (const input of inputs) {
    if (input.endsWith(".jsfb")) {
      feedback.push(input);
      continue;
    }
    llvm.push(input);
    const sidecar = jsFeedbackSidecar(input);
    if (exists(sidecar)) feedback.push(sidecar);
  }
  return { llvm, feedback: [...new Set(feedback)] };
}

/** Cache entries a site tests inline (at most the cache's four ways). */
export const FEEDBACK_MAX_WAYS = 4;

/** The sites whose training run saw 2 to 4 receiver shapes and nothing else
 * of note, with the number of shapes: those sites test that many cache
 * entries inline instead of one. A site that saw a megamorphic spread (more
 * receivers than fit the record), mostly non-object receivers, or a single
 * shape keeps the default. Property sites only; callee records and
 * malformed records are skipped, so a stale or foreign profile can name a
 * site that does not exist (nothing happens) but never changes what a
 * site means: the ways only choose how much of the cache the code tests
 * before the probe, and every miss takes the same path as without them. */
export function siteWays(feedback: JsFeedback): Record<string, number> {
  const ways: Record<string, number> = {};
  for (const site of feedback.sites) {
    if (site.id.endsWith("#c") || site.other > 0) continue;
    const shaped = site.obs.filter((o) => o["recv"] === "obj");
    const shapedCount = shaped.reduce((sum, o) => sum + o.count, 0);
    if (shaped.length < 2 || shaped.length > FEEDBACK_MAX_WAYS) continue;
    if (shapedCount * 10 < site.count * 9) continue;
    ways[site.id] = shaped.length;
  }
  return ways;
}

/** The bytes of the feedback that goes with an indexed profile, or null. */
export function profileSidecarBytes(profilePath: string): Buffer | null {
  const sidecar = jsFeedbackSidecar(profilePath);
  try {
    return existsSync(sidecar) ? readFileSync(sidecar) : null;
  } catch {
    return null;
  }
}

/** The inline ways the feedback of `--profile-use <profilePath>` selects,
 * or undefined without usable feedback. An unreadable or malformed sidecar
 * is ignored as a whole: the build then has the LLVM profile alone. */
export function feedbackWaysFor(
  profilePath: string | undefined,
): Record<string, number> | undefined {
  if (profilePath === undefined) return undefined;
  const bytes = profileSidecarBytes(profilePath);
  if (bytes === null) return undefined;
  try {
    const ways = siteWays(parseJsFeedback(bytes.toString("utf8"), jsFeedbackSidecar(profilePath)));
    return Object.keys(ways).length === 0 ? undefined : ways;
  } catch {
    return undefined;
  }
}

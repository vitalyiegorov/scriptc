/** Runtime event counters (packages/runtime/src/scr_stats.h): compile-time
 * opt-in with SCRIPTC_RUNTIME_STATS=1. The executable then links a runtime
 * built from source with SCR_STATS instead of the precompiled pack, and it
 * dumps its counters as a JSON line on SIGUSR2 and at exit. Unset, nothing
 * the compiler emits or links changes. */
export function runtimeStatsRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SCRIPTC_RUNTIME_STATS"] === "1";
}

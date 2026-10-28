// Opt-in: SCRIPTC_PROVENANCE_SOURCES=1 compiles dependencies that ship TypeScript sources (rxjs) from them.
export async function applyProvenanceSources(compiler, entry) {
  if (process.env.SCRIPTC_PROVENANCE_SOURCES !== '1') return;
  const sources = await compiler.resolveProvenanceSources(entry);
  compiler.setProvenanceSources(sources);
}

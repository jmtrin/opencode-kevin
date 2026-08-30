// K21-005 — Source deletion sync helper
// Detects memories from a source that have disappeared from the source's current fetch.
// The source of truth is fingerprints: a memory whose fingerprint is no longer in the
// fetched set is a candidate for archival + tombstone.
// File-level meta_json diff (plan §4.3) is not present in v2.0's IdleSync — this layer
// diffs at fingerprint granularity, which is source-agnostic and cross-file safe.
// Cross-source protection is enforced by the caller: only memories with matching source
// are considered deletions.

export interface DeletedInfo {
  source: string;
  fingerprint: string;
  // file is optional for backward compat with spec's file-centric shape;
  // we carry it when the caller tracked per-file provenance, otherwise empty.
  file?: string;
}

/**
 * Pure diff: fingerprints present in prev but absent from current.
 * Both sets are expected to be non-null; empty sets return [].
 * Malformed inputs (null, non-Set) return [] never throw.
 */
export function collectDeletions(
  prevFingerprints: Set<string> | string[] | null | undefined,
  currentFingerprints: Set<string> | string[] | null | undefined,
  source: string,
): DeletedInfo[] {
  if (!prevFingerprints || !currentFingerprints) return [];
  const prev = prevFingerprints instanceof Set ? prevFingerprints : new Set(prevFingerprints);
  const curr = currentFingerprints instanceof Set ? currentFingerprints : new Set(currentFingerprints);
  const out: DeletedInfo[] = [];
  for (const fp of prev) {
    if (typeof fp !== "string" || fp.length === 0) continue;
    if (!curr.has(fp)) {
      out.push({ source, fingerprint: fp });
    }
  }
  return out;
}

/**
 * Variant that parses memory_sources.meta_json shape if present.
 * Expected shape: {"files":{"path":{"mtime":123,"size":456}}} or legacy null/string.
 * For v2.1, meta_json may be absent (no per-file tracking yet) — returns [] gracefully.
 * Kept for spec compatibility (plan §4.3 collectDeletions(prevMetaJson, currentFiles)).
 */
export function collectDeletionsFromMeta(
  prevMetaJson: string | null,
  currentFiles: Set<string>,
  source: string,
  fingerprintByFile?: Map<string, string>,
): DeletedInfo[] {
  if (!prevMetaJson) return [];
  try {
    const parsed = JSON.parse(prevMetaJson) as { files?: Record<string, unknown> };
    if (!parsed || typeof parsed.files !== "object" || parsed.files === null) return [];
    const out: DeletedInfo[] = [];
    for (const file of Object.keys(parsed.files)) {
      if (!currentFiles.has(file)) {
        const fp = fingerprintByFile?.get(file) ?? file;
        out.push({ source, file, fingerprint: fp });
      }
    }
    return out;
  } catch {
    return [];
  }
}

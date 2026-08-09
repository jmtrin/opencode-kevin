// v0.4.0 (K4-010) — shared two-sided confidence formula.
//
// Confidence is derived from both positive evidence (confirmed fixes) and
// negative evidence (recurrences): recurrence of the same fingerprint
// DEMOTES a pattern's confidence, so that a "causal pattern" with a
// history of recurring failures stops being presented as reliable.
//
//	confidence = clamp(0.5 + 0.1 * evidenceCount - 0.15 * recurrenceCount, 0.05, 0.95)
//
// Used by `MemoryService.promoteToPattern`, `MemoryService.mapRow` and
// `kevin_why` — keep the formula here, never inline it again.

export const CONFIDENCE_MIN = 0.05;
export const CONFIDENCE_MAX = 0.95;
export const CONFIDENCE_BASE = 0.5;
export const EVIDENCE_STEP = 0.1;
export const RECURRENCE_PENALTY = 0.15;

export function computeConfidence(
	evidenceCount: number,
	recurrenceCount: number,
): number {
	const raw =
		CONFIDENCE_BASE +
		EVIDENCE_STEP * evidenceCount -
		RECURRENCE_PENALTY * recurrenceCount;
	return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, raw));
}

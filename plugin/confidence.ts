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
//
// v0.5.0 (K5-010 / plan §5.3, D5-02) — human feedback joins the formula as
// a second, independent evidence axis. Steps are deliberately SMALLER than
// the causal steps: feedback is sparse, one-sided, and judgemental, while
// evidence_count counts confirmed, reproducible fixes. A single negative
// verdict (0.1) can offset one confirmed fix (0.1), but cannot alone sink
// a well-evidenced pattern — the causal evidence must agree (plan §5.3,
// "feedback cannot override causal evidence, only nudge it").

export const CONFIDENCE_MIN = 0.05;
export const CONFIDENCE_MAX = 0.95;
export const CONFIDENCE_BASE = 0.5;
export const EVIDENCE_STEP = 0.1;
export const RECURRENCE_PENALTY = 0.15;
export const FEEDBACK_POSITIVE_STEP = 0.05;
export const FEEDBACK_NEGATIVE_STEP = 0.1;

export function computeConfidence(
	evidenceCount: number,
	recurrenceCount: number,
	positiveFeedback = 0,
	negativeFeedback = 0,
): number {
	const raw =
		CONFIDENCE_BASE +
		EVIDENCE_STEP * evidenceCount -
		RECURRENCE_PENALTY * recurrenceCount +
		FEEDBACK_POSITIVE_STEP * positiveFeedback -
		FEEDBACK_NEGATIVE_STEP * negativeFeedback;
	return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, raw));
}

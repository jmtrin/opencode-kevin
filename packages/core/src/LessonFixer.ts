/**
 * v0.4.0 (K4-014) — Deterministic fix capture (plan §5.4 / D4-07).
 *
 * Zero-cost "Fixed by:" raw material from local data: when CausalChain
 * links a success to a failing fingerprint, the linked tool_call's
 * `args_summary` becomes a deterministic fix string stored in
 * `memories.fix_args`. The default promotion path is pure local data —
 * no LLM calls (principle 14).
 */

/** Max length of the `args_summary` embedded in a fix_args string. */
export const FIX_ARGS_TRUNCATE = 120;

export interface LinkedToolCall {
	tool: string;
	args_summary: string | null;
}

/**
 * `"bash" with args "npm i -g rg"` style. Returns null when the linked
 * call carries no args_summary (nothing to say).
 */
export function extractFixArgs(call: LinkedToolCall): string | null {
	const raw = call.args_summary?.trim();
	if (!raw) return null;
	const truncated =
		raw.length > FIX_ARGS_TRUNCATE
			? `${raw.slice(0, FIX_ARGS_TRUNCATE)}…`
			: raw;
	return `${call.tool} with args "${truncated}"`;
}

export interface EnrichInput {
	lesson: string;
	fixArgs: string | null;
	originalError: string | null;
}

/**
 * Opt-in LLM phrasing hook (K4-015): receives the lesson, the
 * deterministic fix_args and the original error; returns a one-line
 * `Fix:` phrasing, or null to fall back to the deterministic text.
 * May be async; never runs on the failure hot path.
 */
export type EnrichFn = (input: EnrichInput) => Promise<string | null>;

export interface PatternLike {
	content: string;
	fixArgs: string | null;
}

/** Deterministic `Fixed by: {fix_args}` line (or "" when there is none). */
export function deterministicFixLine(pattern: PatternLike): string {
	return pattern.fixArgs ? `Fixed by: ${pattern.fixArgs}` : "";
}

/**
 * Promotion-time fix phrasing. Default path returns the deterministic
 * `Fixed by: {fix_args}` line (or "" when there is none). When an
 * `enrichFn` is supplied and returns a phrase, that phrase wins.
 */
export async function enrichAtPromotion(
	pattern: PatternLike,
	enrichFn?: EnrichFn,
): Promise<string> {
	if (enrichFn) {
		const phrased = await enrichFn({
			lesson: pattern.content,
			fixArgs: pattern.fixArgs,
			originalError: null,
		});
		if (phrased) return phrased;
	}
	return deterministicFixLine(pattern);
}

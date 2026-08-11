import type { DispatchedLesson } from "./Reflector.js";
import { SUGGESTIONS } from "./Reflector.js";

/**
 * v0.4.0 (K4-003/K4-004 / plan §5.1) — QualityGate.
 *
 * Pure, NO-LLM predicates deciding whether a lesson is worth injecting into
 * the model's prompt. Principle 11: never inject noise.
 *
 * - `evaluate` — classifies a lesson (rescued errorType, non-generic
 *   suggestion, isActionable, strength).
 * - `rescueErrorType` — a dispatched code overrides the coarse
 *   `errorType` (e.g. `'unknown'` → `'TS2304'`), fixing the defect where
 *   lessons said "fails with unknown" even when the Reflector DID identify
 *   the error code.
 * - `canInject` — per-session + per-fingerprint admission rules (K4-004).
 */

/** The v0.1.x fallback suggestions. A lesson whose suggestion is one of these
 * (and has no dispatched code) carries no actionable information. */
export const GENERIC_SUGGESTIONS: ReadonlySet<string> = new Set(
	Object.values(SUGGESTIONS),
);

export function isGenericSuggestion(suggestion: string): boolean {
	return GENERIC_SUGGESTIONS.has(suggestion);
}

export interface LessonQuality {
	/** Rescued errorType: the dispatched code when one matched, else the
	 * coarse errorType (may be `'unknown'`). */
	errorType: string;
	/** The lesson's suggestion text (rule-produced or generic fallback). */
	suggestion: string;
	/** True when the lesson carries actionable information: a dispatched
	 * code exists OR the suggestion is not one of the generic fallbacks. */
	isActionable: boolean;
	/** `strong` when a code matched or the rescued errorType is not
	 * `'unknown'`; `weak` otherwise. */
	strength: "strong" | "weak";
}

export interface QualityLesson {
	errorType: string;
	suggestion: string;
}

export interface InjectionContext {
	/** Memory ids already injected in the current session. */
	seenThisSession: Set<string>;
	/** Failing tool_calls count for this fingerprint in the current session
	 * (0 = never recurred after injection). */
	recurrenceCount: number;
}

/**
 * v0.5.0 (K5-006 / plan §5.2, D5-04) — the reason a memory was rejected
 * (or admitted). Every rejection reason maps 1:1 to an
 * `injections_blocked_*` counter; a silent boolean is an unmeasurable
 * policy (principle 16).
 */
export type GateReason =
	| "ok"
	| "seen_this_session"
	| "ignored"
	| "not_active"
	| "recurrence"
	| "weak";

export interface GateVerdict {
	readonly allowed: boolean;
	readonly reason: GateReason;
}

export const QualityGate = {
	/**
	 * A dispatched code always overrides the coarse errorType for display:
	 * `'unknown'` + `TS2304` → `'TS2304'`.
	 */
	rescueErrorType(
		dispatch: DispatchedLesson | null,
		errorType: string,
	): string {
		if (dispatch?.code) return dispatch.code;
		return errorType;
	},

	/** Classify a lesson per §5.1 rule 1 (rescue) and the generic ban. */
	evaluate(
		lesson: QualityLesson,
		dispatch: DispatchedLesson | null,
		errorType: string,
	): LessonQuality {
		const rescued = this.rescueErrorType(dispatch, errorType);
		const generic = isGenericSuggestion(lesson.suggestion);
		// §5.1 rule 2: the generic ban applies only when there is no
		// dispatched code — a matched code always makes the lesson
		// actionable (the lesson then carries a "Likely cause" hint).
		const isActionable = !generic || dispatch?.code != null;
		const strength =
			dispatch?.code != null || rescued !== "unknown" ? "strong" : "weak";
		return {
			errorType: rescued,
			suggestion: lesson.suggestion,
			isActionable,
			strength,
		};
	},

	/**
	 * v0.4.0 (K4-004 / plan §5.1 rules 2-4) — admission gate evaluated at
	 * injection time. A lesson is injectable only when:
	 *
	 * 1. its memory id was not already injected this session (seen-set),
	 * 2. its memory is not `stale`,
	 * 3. its fingerprint has not recurred since injection (`recurrenceCount
	 *    === 0` — a lesson that failed to prevent the error leaves the
	 *    prompt),
	 * 4. it is actionable AND strong — weak lessons with generic suggestions
	 *    are never injected (unless `qualityGateEnabled = false` for debug,
	 *    K4-023).
	 *
	 * v0.5.0 (K5-006 / plan §5.2, D5-04) — the boolean form is a thin
	 * wrapper over `canInjectVerdict`; the reason is never discarded by
	 * callers that use the verdict form.
	 */
	canInject(
		memory: {
			id: string;
			status?: string;
			strength?: "strong" | "weak";
			isActionable?: boolean;
		},
		ctx: InjectionContext,
		qualityGateEnabled = true,
	): boolean {
		return this.canInjectVerdict(memory, ctx, qualityGateEnabled).allowed;
	},

	/**
	 * v0.5.0 (K5-006 / plan §5.2, D5-04) — the verdict form of `canInject`.
	 * Branch order preserves the v0.4.0 sequence with `ignored` inserted
	 * second:
	 *
	 * 1. seen this session            → `seen_this_session`
	 * 2. `memory.ignored === true`    → `ignored`
	 * 3. status !== 'active'          → `not_active`
	 * 4. recurrence in session        → `recurrence`
	 * 5. weak / not actionable        → `weak` (skipped entirely when
	 *    `qualityGateEnabled === false` — the debug flag bypasses the
	 *    quality check only, never the seen/ignored/status/recurrence bans)
	 *
	 * `ignored` is a human verdict (D5-07) and is enforced even in debug
	 * mode: the flag excludes a memory from retrieval entirely, so the gate
	 * is only ever asked about it defensively.
	 */
	canInjectVerdict(
		memory: {
			id: string;
			status?: string;
			strength?: "strong" | "weak";
			isActionable?: boolean;
			ignored?: boolean;
		},
		ctx: InjectionContext,
		qualityGateEnabled = true,
	): GateVerdict {
		if (ctx.seenThisSession.has(memory.id)) {
			return { allowed: false, reason: "seen_this_session" };
		}
		if (memory.ignored === true) {
			return { allowed: false, reason: "ignored" };
		}
		if (memory.status !== undefined && memory.status !== "active") {
			return { allowed: false, reason: "not_active" };
		}
		if (ctx.recurrenceCount > 0) {
			return { allowed: false, reason: "recurrence" };
		}
		if (!memory.isActionable || memory.strength === "weak") {
			if (qualityGateEnabled) {
				return { allowed: false, reason: "weak" };
			}
			// K4-023 debug mode: weak lessons are admitted but must be
			// flagged by the caller (ContextInjector adds the marker).
		}
		return { allowed: true, reason: "ok" };
	},
};

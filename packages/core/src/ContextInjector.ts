import type { InjectionLedger } from "./InjectionLedger.js";
import type { Memory, MemoryService } from "./MemoryService.js";
import {
	type GateReason,
	type GateVerdict,
	QualityGate,
} from "./QualityGate.js";
import type { MemoryBlockItem } from "./memory-format.js";
import { formatMemories, formatMemorySnippets } from "./memory-format.js";
import { type MetricKey, type Metrics, estimateTokens } from "./metrics.js";
import { STOP_WORDS } from "./query-tokenizer.js";

export const QUALITY_GATE_SETTING = "quality_gate_enabled";

export const SNIPPET_INJECTION_SETTING = "lesson_snippet_injection";

/**
 * v0.6.0 (K6-023 / plan §5.8) — the effective pre-prompt budget shared by
 * `ContextInjector.prePromptCap()` and `kevin_audit`'s channels block
 * (budget_tokens). Single source of truth for the K6-021 clamp:
 * default 400 when the raw value is missing/non-numeric, clamped to
 * [0, 4000]; 0 means "push off".
 */
export function effectivePrePromptCap(raw: string | undefined): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 400;
	return Math.min(4000, Math.max(0, Math.round(n)));
}

export interface ChatMessage {
	role: string;
	content: string;
}

export interface SystemTransformInput {
	sessionID?: string;
	messages: ChatMessage[];
}

export interface SystemTransformOutput {
	system: string[];
}

export interface CompactingInput {
	sessionID: string;
	messages: ChatMessage[];
}

export interface CompactingOutput {
	context: string[];
}

// v0.5.0 (K5-014 / plan §8.10, D5-08) — the structured result of the
// read-only `plan()` pipeline: what WOULD be injected, item by item, with
// the gate verdict for every candidate. `kevin_trace` (K5-015) feeds on it.
export interface InjectionPlanItem {
	id: string;
	type: string;
	decision: "admitted" | "blocked";
	/** Gate reason when blocked; null for admitted items. */
	reason?: GateReason;
	/** Estimated tokens this memory would contribute to the block. */
	tokens: number;
}

export interface InjectionPlan {
	query: string;
	tag: "context" | "memory";
	cap: number;
	would_inject: boolean;
	/** Estimated tokens of the block that WOULD be produced (0 when
	 * nothing would be injected). */
	total_tokens: number;
	admitted: InjectionPlanItem[];
	blocked: InjectionPlanItem[];
}

// v0.4.0 default pre-prompt budget. v0.5.0 (K5-017 / plan §8.11, D5-11):
// kept as the compile-time fallback, but the EFFECTIVE cap is read at call
// time from the `pre_prompt_budget_tokens` setting. v0.6.0 (K6-021 / plan
// §5.8): the setting's default becomes "400" and the lower clamp bound
// drops to 0 (off) — the confound fix in K5-005 showed a large share of
// injections are `inconclusive`, and the roadmap's kill criterion K1
// requires "off" to be a reachable, supported configuration.
const SYSTEM_TRANSFORM_TOKENS = 900;
const COMPACTING_TOKENS = 2000;

// v0.5.0 (K5-007 / plan §8.10, D5-04) — every rejection reason maps 1:1 to
// an `injections_blocked_*` counter (principle 16: a rejection you did not
// count did not happen). Single lookup + null-check at the call site; the
// `ok` reason admits and must never increment anything.
const BLOCKED_METRIC: Record<GateReason, MetricKey | null> = {
	ok: null,
	// v0.6.0 (K6-022 / plan §5.8) — sixth reason, sixth counter.
	low_confidence: "injections_blocked_confidence",
	seen_this_session: "injections_blocked_seen",
	ignored: "injections_blocked_ignored",
	not_active: "injections_blocked_stale",
	recurrence: "injections_blocked_recurrence",
	weak: "injections_blocked_weak",
};

function isWordChar(ch: string): boolean {
	return /[a-z0-9áéíóúüñ]/i.test(ch);
}

/**
 * BUG-005 — extract the lesson's `Suggestion:` text (first line after the
 * marker) when present. Returns null for agent-saved notes that carry no
 * suggestion payload. Also matches the truncated snippet-style lesson
 * bodies used by older tests.
 */
function extractSuggestionText(content: string): string | null {
	const m = content.match(/\nSuggestion:\s*([^\n]+)/);
	return m ? m[1].trim() : null;
}

/**
 * BUG-005 — extract the `fails with X` slot of a lesson. For lessons
 * without a dispatched code this equals the coarse errorType that
 * `QualityGate.evaluate` needs for the strength classification.
 */
function extractFailsWithErrorType(content: string): string | null {
	const m = content.match(/\bfails with ([^:]+):/i);
	return m ? m[1].trim() : null;
}

export class ContextInjector {
	private lastRecurrenceCount = 0;
	/** v0.4.0 (K4-016) — session that produced the last recurrence set. */
	private lastRecurredSession: string | null = null;
	/** v0.4.0 (K4-017) — per-session seen-set (plan §5.1 rule 3). */
	private readonly seenBySession = new Map<string, Set<string>>();

	constructor(
		private memoryService: MemoryService,
		private metrics: Metrics | null = null,
		private ledger: InjectionLedger | null = null,
	) {}

	/**
	 * v0.4.0 (K4-017) — reset the per-session seen-set when a session is
	 * created (plan §5.1 rule 3). Wired from the `session.created` event.
	 */
	onSessionCreated(sessionId: string): void {
		this.seenBySession.delete(sessionId);
	}

	/**
	 * v0.3.0 (K3-020) — notify the injector that the negative feedback half
	 * fired N times in the last session.idle. The next system.transform or
	 * compacting hook will prepend a HITL suggestion block.
	 * v0.4.0 (K4-016) — the session id enables the concrete suggestion:
	 * the most-recurred fingerprint's pattern + its fix_args.
	 */
	setRecurrences(count: number, sessionId?: string): void {
		this.lastRecurrenceCount = count;
		this.lastRecurredSession = sessionId ?? null;
	}

	/**
	 * v0.4.0 (K4-016) — generate a CONCRETE HITL suggestion block when
	 * recurrences occurred (plan §5.5): names the most-recurred pattern,
	 * its exact recurrence count, observed fix_args and confidence. The
	 * AGENTS.md draft line derives from the lesson's `Suggestion:` text —
	 * never a canned string, and never the anonymous "the same error
	 * pattern" without naming the pattern and count.
	 *
	 * BUG-012 — emits AT MOST ONCE per session: calling it resets the
	 * pending recurrence signal, so whichever hook (system.transform or
	 * compacting) runs first in a session consumes the block. Documented
	 * behavior; wire index.ts to match.
	 */
	generateSuggestion(): string {
		const count = this.lastRecurrenceCount;
		const sessionId = this.lastRecurredSession;
		this.lastRecurrenceCount = 0;
		this.lastRecurredSession = null;
		if (count === 0) return "";

		const recurrences =
			this.ledger?.recurrencesFor(sessionId ?? "") ?? new Map<string, number>();
		let topFp: string | null = null;
		let topCount = 0;
		for (const [fp, n] of recurrences) {
			if (n > topCount) {
				topFp = fp;
				topCount = n;
			}
		}
		const pattern = topFp
			? this.memoryService.getByFingerprint(topFp, "pattern")
			: null;

		// No pattern memory for the recurred fingerprint (or no ledger): a
		// short fallback that still names the count.
		if (!pattern) {
			return `<kevin-suggestion>
An error pattern recurred ${count} time(s) this session.
Consider adding a convention to AGENTS.md.
</kevin-suggestion>`;
		}

		const summary = pattern.content
			.split("\n")[0]
			.replace(/^Causal pattern:\s*/, "")
			.trim();
		const pct =
			pattern.confidence != null ? Math.round(pattern.confidence * 100) : 0;
		const evidence = pattern.evidenceCount ?? 0;
		const fixLine = pattern.fixArgs
			? `Observed fix: ${pattern.fixArgs} (${evidence} confirmed fix${
					evidence === 1 ? "" : "es"
				}, confidence ${pct}%).`
			: "";

		return `<kevin-suggestion>
The error pattern "${summary}" recurred ${topCount} time(s) this session.
${fixLine}
Consider adding this convention to AGENTS.md:
- ${this.agentsDraftLine(pattern)}
</kevin-suggestion>`;
	}

	/**
	 * v0.4.0 (K4-016) — the AGENTS.md draft line derives from the lesson's
	 * `Suggestion:` text (kept verbatim in the pattern's `Original:` block).
	 */
	private agentsDraftLine(pattern: Memory): string {
		const m = pattern.content.match(/\nSuggestion: ([^\n]+)/);
		if (m) return m[1].trim();
		return `${pattern.content
			.split("\n")[0]
			.replace(/^Causal pattern:\s*/, "")
			.trim()} recurred — document the fix in AGENTS.md`;
	}

	/**
	 * v0.2.0 (K2-024): origin-aware ranking at injection time is delegated
	 * to `MemoryService.getRelevant()` (K2-023, D2-13). The injector does
	 * NOT re-rank on its own — it consumes the already-ranked slice and
	 * applies the conditional-budget guard for opt-out (`protect: false`)
	 * callers. Plan §B6.5: "apply the same multiplier as
	 * MemoryService.recall so reflector lessons outrank agent-saved notes
	 * at injection time" — satisfied transitively via the getRelevant call.
	 *
	 * v0.4.0 (K4-017): after retrieval, every memory is filtered through
	 * `QualityGate.canInject` (session seen-set + recurrence + strength),
	 * and each admitted memory is recorded in the `InjectionLedger`
	 * (plan §5.2 — one row per injected memory).
	 *
	 * v0.5.0 (K5-014 / plan §8.10) — the pipeline is decomposed into
	 * `fetchSlice` (ranked retrieval + budget overflow) + `evaluate`
	 * (pure gate verdicts) + this orchestrator, so the read-only `plan()`
	 * can mirror it without any side effect (D5-08).
	 */
	private inject(
		query: string,
		tag: "context" | "memory",
		cap: number,
		metricKey: "tokens_injected_pre_prompt" | "tokens_injected_compacting",
		sessionId: string,
		// v0.5.0 (K5-007 / plan §8.10, D5-08) — dry-run mode (kevin_trace)
		// must never move a counter, not even the injections_blocked_* ones.
		dryRun = false,
	): string {
		const memories = this.fetchSlice(query, cap, tag);
		if (memories.length === 0) return "";
		const admitted = this.admit(memories, sessionId, dryRun);
		if (admitted.length === 0) return "";
		const block = this.format(admitted, tag);
		this.recordInjections(admitted, sessionId, tag, block);
		this.metrics?.incr(metricKey, estimateTokens(block));
		return block;
	}

	/**
	 * v0.5.0 (K5-014 / plan §8.10) — the ranked-retrieval stage shared by
	 * `inject` and `plan`. With `dry = true` it is a strict read:
	 *
	 *  - the probe fetch never bumps (BUG-016), like the live path;
	 *  - the overflow retry ALSO fetches with `bump: false` (the live path
	 *    lets the retry fetch bump once — that is the only difference);
	 *  - the no-retry bump is skipped.
	 *
	 * This is what lets `plan()` predict the EXACT slice the live path
	 * would inject without mutating a single relevance score.
	 */
	private fetchSlice(
		query: string,
		cap: number,
		tag: "context" | "memory",
		dry = false,
	): Memory[] {
		let memories = this.memoryService.getRelevant({
			query,
			maxTokens: cap,
			bump: false,
		});
		if (memories.length === 0) return [];
		const firstBlock = this.format(memories, tag);
		const aggregateTokens = estimateTokens(firstBlock);
		const firstRowProtect = (memories[0] as unknown as MemoryBlockItem)
			?.protect;
		const noProtectAboveTheFold = firstRowProtect === false;
		if (aggregateTokens > 0.8 * cap && noProtectAboveTheFold) {
			// Retry = a single fetch with the adjusted budget, ranked by
			// the original scores (the probe never mutated them) — the
			// equivalent of one getRelevant call with maxTokens=lowerCap.
			const lowerCap = Math.max(1, Math.round(0.8 * cap));
			memories = this.memoryService.getRelevant({
				query,
				maxTokens: lowerCap,
				bump: dry ? false : undefined,
			});
		} else if (!dry) {
			// No retry: the probe slice IS the injected slice — bump it
			// exactly once here.
			this.memoryService.bumpRelevance(memories.map((m) => m.id));
		}
		return memories;
	}

	/**
	 * v0.5.0 (K5-014 / plan §8.10, D5-08) — PUBLIC read-only prediction of
	 * what `inject` WOULD do for a query: same retrieval, same gate, zero
	 * side effects. Never moves a counter, never writes the seen-set, never
	 * bumps relevance, never records ledger rows. `kevin_trace` (K5-015)
	 * surfaces this to the agent; tests freeze the clock + settings around
	 * it.
	 */
	plan(
		query: string,
		options: {
			tag?: "context" | "memory";
			cap?: number;
			sessionId?: string;
		} = {},
	): InjectionPlan {
		const tag = options.tag ?? "context";
		const cap =
			options.cap ??
			(tag === "memory" ? COMPACTING_TOKENS : this.prePromptCap());
		const sessionId = options.sessionId ?? "";
		const memories = this.fetchSlice(query, cap, tag, true);
		const { verdicts } = this.evaluate(memories, sessionId);
		const admitted: InjectionPlanItem[] = [];
		const blocked: InjectionPlanItem[] = [];
		const admittedMemories: Memory[] = [];
		for (const v of verdicts) {
			const base = {
				id: v.memory.id,
				type: v.memory.type,
				tokens: estimateTokens(v.memory.content),
			};
			if (v.allowed) {
				admitted.push({ ...base, decision: "admitted" as const });
				admittedMemories.push(v.memory);
			} else {
				blocked.push({
					...base,
					decision: "blocked" as const,
					reason: v.reason,
				});
			}
		}
		const wouldInject = admitted.length > 0;
		const totalTokens = wouldInject
			? estimateTokens(this.format(admittedMemories, tag))
			: 0;
		return {
			query,
			tag,
			cap,
			would_inject: wouldInject,
			total_tokens: totalTokens,
			admitted,
			blocked,
		};
	}

	/**
	 * v0.5.0 (K5-014 / plan §8.10) — PURE gate evaluation shared by `admit`
	 * (live path) and `plan` (read-only path): returns the verdict for every
	 * candidate plus the seen-set as it WOULD look afterwards. Never writes
	 * state — the caller decides whether to persist.
	 */
	private evaluate(
		memories: Memory[],
		sessionId: string,
	): {
		verdicts: Array<GateVerdict & { memory: Memory }>;
		seen: Set<string>;
	} {
		const qualityGateEnabled =
			this.memoryService.getSetting(QUALITY_GATE_SETTING, "1") === "1";
		// v0.6.0 (K6-022 / plan §5.8) — the floor is read ONCE per
		// plan/inject call (this method is the shared gate evaluation),
		// never per memory. A non-numeric setting degrades to undefined,
		// which disables the branch for every memory this call.
		const rawFloor = this.memoryService.getSetting(
			"injection_confidence_floor",
			"0.6",
		);
		const floor = Number(rawFloor);
		const confidenceFloor = Number.isFinite(floor) ? floor : undefined;
		const seen = new Set(this.seenBySession.get(sessionId) ?? []);
		const recurrences =
			this.ledger?.postInjectionRecurrencesFor(sessionId) ??
			new Map<string, number>();
		const verdicts: Array<GateVerdict & { memory: Memory }> = [];
		for (const m of memories) {
			const q = this.lessonQuality(m);
			const verdict = QualityGate.canInjectVerdict(
				{
					id: m.id,
					status: m.status ?? undefined,
					strength: q.strength,
					isActionable: q.isActionable,
					// v0.5.0 (K5-009) — the `ignored` flag is now a first-class
					// Memory field via mapRow (D5-07).
					ignored: m.ignored === true,
					// v0.6.0 (K6-022) — the memory's computed confidence
					// (may be null for rows without evidence).
					confidence: m.confidence ?? undefined,
				},
				{
					seenThisSession: seen,
					// v0.4.0 (K4-025) — plan §5.1 rule 4: a causal pattern
					// re-admits a lesson that the stale error row cannot.
					// The recurrence ban (QualityGate rule 3) is scoped to
					// error lessons — a pattern is the FIXED form of the
					// fingerprint and is exactly what D4-06 wants back in
					// the prompt.
					recurrenceCount:
						m.type === "pattern"
							? 0
							: m.fingerprint
								? (recurrences.get(m.fingerprint) ?? 0)
								: 0,
					confidenceFloor,
				},
				qualityGateEnabled,
			);
			verdicts.push({ ...verdict, memory: m });
		}
		return { verdicts, seen };
	}

	/**
	 * v0.5.0 (K5-017 / plan §8.11, D5-11) — the effective pre-prompt cap,
	 * read at call time from `pre_prompt_budget_tokens` (seeded "900" by
	 * migration 006). Clamped to [100, 4000]; a non-numeric value falls
	 * back to 900. `kevin_trace` reports the value used via `plan().cap`.
	 *
	 * v0.6.0 (K6-021 / plan §5.8) — default becomes "400" and the lower
	 * clamp bound drops to **0**: the roadmap's kill criterion K1 prescribes
	 * cutting the push budget to zero when coverage is poor, and v0.5's
	 * [100, 4000] clamp made that response unimplementable. A non-numeric
	 * value falls back to 400. `onSystemTransform` treats 0 as off and
	 * returns before any retrieval (see K6-021 acceptance).
	 */
	private prePromptCap(): number {
		return effectivePrePromptCap(
			this.memoryService.getSetting("pre_prompt_budget_tokens", "400"),
		);
	}

	/**
	 * v0.4.0 (K4-017) — QualityGate admission: filters the ranked slice to
	 * memories that may be injected this session, updating the session
	 * seen-set.
	 *
	 * v0.5.0 (K5-007 / plan §5.2, D5-04) — uses `canInjectVerdict` and
	 * increments the matching `injections_blocked_*` counter for every
	 * rejection, so gate policy becomes measurable. When `dryRun === true`
	 * the counters stay untouched (D5-08) — and so does the seen-set
	 * (a dry run is a strict read, K5-014).
	 *
	 * BUG-005 — strength/actionability now go through the REAL
	 * `QualityGate.evaluate` semantics (plan §5.1 rules 1-2), which this
	 * class had only re-derived from `metadata.dispatch`:
	 *   - dispatched code → strong + actionable (rescued errorType);
	 *   - generic fallback suggestion + no code → weak, NOT actionable
	 *     (the generic-suggestion ban is now enforced even for legacy
	 *     lessons without dispatch metadata, as long as the `Suggestion:`
	 *     text is available);
	 *   - specific suggestion without code → strong + actionable;
	 *   - no `Suggestion:` text at all (agent-saved note) → strong +
	 *     actionable — the agent explicitly asked to remember it;
	 *   - causal patterns (type='pattern') → always strong + actionable:
	 *     they are the FIXED form of a fingerprint (K4-025).
	 */
	private admit(
		memories: Memory[],
		sessionId: string,
		dryRun = false,
	): Memory[] {
		const { verdicts, seen } = this.evaluate(memories, sessionId);
		const admitted: Memory[] = [];
		for (const v of verdicts) {
			if (v.allowed) {
				admitted.push(v.memory);
				seen.add(v.memory.id);
			} else if (!dryRun) {
				const key = BLOCKED_METRIC[v.reason];
				if (key) this.metrics?.incr(key, 1);
			}
		}
		if (!dryRun) this.seenBySession.set(sessionId, seen);
		return admitted;
	}

	/**
	 * BUG-005 — the single source of truth for a memory's lesson quality,
	 * shared by `admit` (the gate) and `format` (the K4-023 `(low
	 * confidence)` marker). Routes lessons through `QualityGate.evaluate`
	 * — the production call site that was previously missing.
	 */
	private lessonQuality(m: Memory): {
		strength: "strong" | "weak";
		isActionable: boolean;
		weak: boolean;
	} {
		// K4-025: a causal pattern is the fixed form of the fingerprint —
		// never gated by suggestion text.
		if (m.type === "pattern") {
			return { strength: "strong", isActionable: true, weak: false };
		}
		const meta = (m.metadata ?? null) as {
			dispatch?: { code: string | null; hint: string | null } | null;
		} | null;
		const dispatch = meta?.dispatch ?? null;
		const suggestion = extractSuggestionText(m.content);
		if (suggestion === null) {
			// Agent-saved note without a `Suggestion:` line: the agent
			// explicitly asked to remember it → strong + actionable.
			return { strength: "strong", isActionable: true, weak: false };
		}
		// The lesson's `fails with X` slot holds the displayed errorType;
		// when no code was dispatched it equals the coarse errorType that
		// `evaluate` needs for the strength classification.
		const errorType = extractFailsWithErrorType(m.content);
		const q = QualityGate.evaluate(
			{ errorType: errorType ?? "unknown", suggestion },
			dispatch,
			errorType ?? "unknown",
		);
		return {
			strength: q.strength,
			isActionable: q.isActionable,
			weak: q.strength === "weak",
		};
	}

	/**
	 * v0.4.0 (K4-017) — one ledger row per admitted memory (plan §5.2).
	 * Token attribution uses the memory's share of the final block.
	 *
	 * v0.8.0 (K8-024 / plan §5.7) — shared projections are recorded even
	 * though they carry NO fingerprint by design (K8-017 — it is a
	 * different identity dimension): the memory id is their identity in
	 * the ledger, and recording them is what makes `injections_from_shared`
	 * observable at all. No tool call can ever match a memory id, so
	 * settle() marks the row inconclusive — excluded from the precision
	 * denominator (K5-005) — and the BUG-015 skip is unchanged for local
	 * notes without a fingerprint.
	 */
	private recordInjections(
		admitted: Memory[],
		sessionId: string,
		tag: "context" | "memory",
		block: string,
	): void {
		if (this.ledger === null) return;
		const blockTokens = estimateTokens(block);
		const perMemory = Math.max(1, Math.round(blockTokens / admitted.length));
		const hook = tag === "context" ? "pre_prompt" : "compacting";
		for (const m of admitted) {
			if (!m.fingerprint && m.layer !== "shared") continue;
			this.ledger.record({
				memoryId: m.id,
				fingerprint: m.fingerprint ?? m.id,
				sessionId,
				hook,
				tokens: perMemory,
				layer: m.layer ?? "local",
			});
		}
	}

	/**
	 * v0.4.0 (K4-012) — snippet injection payload (plan §5.1 rule 5,
	 * D4-05): rows show `id:` + first 2 non-empty lines + `<protect>`
	 * instead of the full body. Gated by the `lesson_snippet_injection`
	 * setting (default `'1'`); when `'0'`, full content is restored.
	 * `escapeInjectedText` is applied to snippet content by the formatter.
	 * v0.4.0 (K4-023) — weak lessons admitted in debug mode are flagged so
	 * the formatter renders the `(low confidence)` marker.
	 */
	private format(
		memories: MemoryBlockItem[],
		tag: "context" | "memory",
	): string {
		const snippetsOn =
			this.memoryService.getSetting(SNIPPET_INJECTION_SETTING, "1") === "1";
		const items = memories.map((m) => ({
			...m,
			// BUG-005 — the weak marker must mirror the admission decision
			// (K4-023 debug mode), not re-derive from dispatch alone.
			weak: this.lessonQuality(m as Memory).weak,
		}));
		return snippetsOn
			? formatMemorySnippets(items, tag)
			: formatMemories(items, tag);
	}

	deriveQuery(messages: ChatMessage[]): string {
		let lastUserContent = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				lastUserContent = messages[i].content;
				break;
			}
		}
		if (!lastUserContent) return "";

		const tokens = lastUserContent
			.toLowerCase()
			.split(/\s+/)
			.map((t) => {
				let out = "";
				for (const ch of t) {
					if (isWordChar(ch)) out += ch;
				}
				return out;
			})
			.filter((t) => t.length > 0 && !STOP_WORDS.has(t));
		return tokens.join(" ");
	}

	onSystemTransform(
		input: SystemTransformInput,
		output: SystemTransformOutput,
	): void {
		// v0.6.0 (K6-021 / plan §5.8) — a cap of 0 means off: return before
		// any retrieval, gate evaluation or metric write. "Off" must not
		// run a hidden query and throw away the result.
		const cap = this.prePromptCap();
		if (cap === 0) return;
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const block = this.inject(
			query,
			"context",
			cap,
			"tokens_injected_pre_prompt",
			input.sessionID ?? "",
		);
		if (block) output.system.push(block);
	}

	onCompacting(input: CompactingInput, output: CompactingOutput): void {
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const block = this.inject(
			query,
			"memory",
			COMPACTING_TOKENS,
			"tokens_injected_compacting",
			input.sessionID,
		);
		if (block) output.context.push(block);
	}
}

import type { InjectionLedger } from "./InjectionLedger.js";
import type { Memory, MemoryService } from "./MemoryService.js";
import { QualityGate } from "./QualityGate.js";
import type { MemoryBlockItem } from "./memory-format.js";
import { formatMemories, formatMemorySnippets } from "./memory-format.js";
import { type Metrics, estimateTokens } from "./metrics.js";
import { STOP_WORDS } from "./query-tokenizer.js";

export const QUALITY_GATE_SETTING = "quality_gate_enabled";

export const SNIPPET_INJECTION_SETTING = "lesson_snippet_injection";

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

const SYSTEM_TRANSFORM_TOKENS = 1500;
const COMPACTING_TOKENS = 2000;

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
	 */
	private inject(
		query: string,
		tag: "context" | "memory",
		cap: number,
		metricKey: "tokens_injected_pre_prompt" | "tokens_injected_compacting",
		sessionId: string,
	): string {
		// BUG-016 — probe WITHOUT bumping so the overflow decision and any
		// retry both see the ORIGINAL ranking. The single relevance bump
		// (K2-023) is applied exactly once, to the slice that actually
		// produces the injected block — see below.
		let memories = this.memoryService.getRelevant({
			query,
			maxTokens: cap,
			bump: false,
		});
		if (memories.length === 0) return "";
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
			});
			if (memories.length === 0) return "";
		} else {
			// No retry: the probe slice IS the injected slice — bump it
			// exactly once here.
			this.memoryService.bumpRelevance(memories.map((m) => m.id));
		}
		const admitted = this.admit(memories, sessionId);
		if (admitted.length === 0) return "";
		const block = this.format(admitted, tag);
		this.recordInjections(admitted, sessionId, tag, block);
		this.metrics?.incr(metricKey, estimateTokens(block));
		return block;
	}

	/**
	 * v0.4.0 (K4-017) — QualityGate admission: filters the ranked slice to
	 * memories that may be injected this session, updating the session
	 * seen-set.
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
	private admit(memories: Memory[], sessionId: string): Memory[] {
		const qualityGateEnabled =
			this.memoryService.getSetting(QUALITY_GATE_SETTING, "1") === "1";
		const seen = this.seenBySession.get(sessionId) ?? new Set<string>();
		const recurrences =
			this.ledger?.postInjectionRecurrencesFor(sessionId) ??
			new Map<string, number>();
		const admitted: Memory[] = [];
		for (const m of memories) {
			const q = this.lessonQuality(m);
			if (
				QualityGate.canInject(
					{
						id: m.id,
						status: m.status ?? undefined,
						strength: q.strength,
						isActionable: q.isActionable,
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
					},
					qualityGateEnabled,
				)
			) {
				admitted.push(m);
				seen.add(m.id);
			}
		}
		this.seenBySession.set(sessionId, seen);
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
	 */
	private recordInjections(
		admitted: Memory[],
		sessionId: string,
		tag: "context" | "memory",
		block: string,
	): void {
		if (this.ledger === null) return;
		const blockTokens = estimateTokens(block);
		const measurable = admitted.filter((m) => m.fingerprint);
		const perMemory = Math.max(1, Math.round(blockTokens / admitted.length));
		const hook = tag === "context" ? "pre_prompt" : "compacting";
		for (const m of measurable) {
			this.ledger.record({
				memoryId: m.id,
				fingerprint: m.fingerprint as string,
				sessionId,
				hook,
				tokens: perMemory,
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
		const query = this.deriveQuery(input.messages);
		if (!query) return;
		const block = this.inject(
			query,
			"context",
			SYSTEM_TRANSFORM_TOKENS,
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

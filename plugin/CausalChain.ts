import {
	type EnrichFn,
	enrichAtPromotion,
	extractFixArgs,
} from "./LessonFixer.js";
import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";

/** K3-007 — a success only links to a failure within this many calls. */
const MAX_LINK_DISTANCE = 10;

export class CausalChain {
	constructor(
		private store: Store,
		private memoryService: MemoryService,
		private metrics: Metrics | null,
		// v0.4.0 (K4-015) — opt-in promotion-time LLM phrasing. Absent in
		// production (zero network calls by default); injected by tests or
		// by a future settings-driven wiring.
		private enrichFn?: EnrichFn,
	) {}

	// K3-007: link a success to the failing fingerprint only when it
	// occurred within MAX_LINK_DISTANCE tool calls of the failure (plan
	// §K3-007 acceptance: "within 24h and within 10 tool calls").
	// v0.3.0 fix (bug #3) — the old code linked the most recent session
	// success to the most recent unlinked error memory regardless of
	// distance, so an unrelated success (e.g. an `ls` run after a
	// typecheck failure) was stamped as the fix for that error.
	onSuccess(
		_tool: string,
		_args: Record<string, unknown>,
		_projectId: string | null,
		sessionId: string,
	): void {
		const successRow = this.store
			.prepare(
				`SELECT rowid, tool, args_summary FROM tool_calls
				 WHERE session_id = ? AND success = 1
				 ORDER BY rowid DESC LIMIT 1`,
			)
			.get(sessionId) as
			| { rowid: number; tool: string; args_summary: string | null }
			| undefined;
		if (!successRow) return;

		const linkedFps = new Set(
			(
				this.store
					.prepare(
						`SELECT DISTINCT fix_for_fingerprint FROM tool_calls
						 WHERE session_id = ? AND fix_for_fingerprint IS NOT NULL`,
					)
					.all(sessionId) as { fix_for_fingerprint: string }[]
			).map((r) => r.fix_for_fingerprint),
		);

		// Most recent failing calls in this session, newest first. The
		// failing call's `error_fingerprint` (stamped by Reflector via
		// onLinkError) is the SAME identity dimension the error memory
		// uses; `fingerprint` is the legacy tool|args|success hash and
		// simply never matches a reflector error memory.
		const failRows = this.store
			.prepare(
				`SELECT rowid, COALESCE(error_fingerprint, fingerprint) AS fp
				 FROM tool_calls
				 WHERE session_id = ?
				   AND success = 0
				   AND (error_fingerprint IS NOT NULL OR fingerprint IS NOT NULL)
				 ORDER BY rowid DESC LIMIT ?`,
			)
			.all(sessionId, MAX_LINK_DISTANCE) as {
			rowid: number;
			fp: string | null;
		}[];

		for (const fail of failRows) {
			if (!fail.fp || linkedFps.has(fail.fp)) continue;
			const dist = successRow.rowid - fail.rowid;
			if (dist <= 0 || dist > MAX_LINK_DISTANCE) continue;

			const mem = this.store
				.prepare(
					`SELECT 1 FROM memories
					 WHERE fingerprint = ? AND type = 'error'
					   AND origin = 'reflector' AND status IN ('active', 'stale')
					   AND created_at > datetime('now', '-24 hours')
					 LIMIT 1`,
				)
				.get(fail.fp);
			if (!mem) continue;

			this.store
				.prepare(
					"UPDATE tool_calls SET fix_for_fingerprint = ? WHERE rowid = ?",
				)
				.run(fail.fp, successRow.rowid);

			// v0.4.0 (K4-014) — deterministic "Fixed by:" raw material
			// (plan §5.4 / D4-07): copy the linked success call's
			// args_summary into memories.fix_args for every active row of
			// that fingerprint (error + pattern), zero LLM cost.
			const fixArgs = extractFixArgs({
				tool: successRow.tool,
				args_summary: successRow.args_summary ?? null,
			});
			if (fixArgs) {
				this.store
					.prepare(
						`UPDATE memories SET fix_args = ?
						 WHERE fingerprint = ? AND status IN ('active', 'stale')`,
					)
					.run(fixArgs, fail.fp);
			}

			this.metrics?.incr("causal_links", 1);
			return;
		}
	}

	async onSessionIdle(sessionId: string): Promise<number> {
		const linkedErrors = this.store
			.prepare(
				`SELECT m.id, m.fingerprint, m.recurrence_count,
				        (SELECT COUNT(*)
				         FROM tool_calls tc_all
				         WHERE tc_all.fix_for_fingerprint = m.fingerprint) as evidence_count
				 FROM memories m
				 WHERE m.type = 'error'
				   AND m.origin = 'reflector'
				   AND m.fingerprint IN (
				       SELECT DISTINCT fix_for_fingerprint
				       FROM tool_calls
				       WHERE session_id = ? AND fix_for_fingerprint IS NOT NULL
				   )
				   AND m.status IN ('active', 'stale')
				 GROUP BY m.fingerprint
				 HAVING (
				     SELECT MAX(tc.ts) FROM tool_calls tc
				     WHERE tc.fix_for_fingerprint = m.fingerprint
				 ) >= COALESCE(
				     (SELECT MAX(m2.updated_at) FROM memories m2
				      WHERE m2.fingerprint = m.fingerprint
				        AND m2.type = 'pattern'
				        AND m2.origin = 'causal'),
				     '1970-01-01'
				 )`,
			)
			.all(sessionId) as {
			id: string;
			fingerprint: string;
			recurrence_count: number;
			evidence_count: number;
		}[];

		let promoted = 0;
		for (const err of linkedErrors) {
			try {
				const result = this.memoryService.promoteToPattern(
					err.id,
					err.evidence_count,
					err.recurrence_count ?? 0,
				);
				if (result) {
					promoted++;
					// v0.4.0 (K4-009) — only a NEW pattern row counts as a
					// promotion; the idempotent refresh path no longer
					// inflates the metric. `patterns_causal` is deprecated
					// (key kept for compat, never incremented).
					if (result.created) {
						this.metrics?.incr("patterns_promoted_new", 1);
						// v0.4.0 (K4-015) — promotion-time LLM enrichment:
						// at most one call per NEW pattern, gated on
						// `kevin_settings.llm_reflection_enabled` and the
						// per-pattern `metadata.enriched` marker. Never on
						// the failure hot path.
						await this.enrichIfEnabled(err.id, result.id);
					}
				}
			} catch {
				// promoteToPattern may fail if the error memory was removed
			}
		}

		return promoted;
	}

	/**
	 * v0.4.0 (K4-015) — fire the opt-in enrich hook at most once per
	 * promoted pattern. The hook's one-line phrase replaces the
	 * deterministic `Fixed by:` line; null keeps it. A call (phrase or
	 * not) stamps `metadata.enriched` so repeated idle cycles stay at
	 * one LLM call per pattern.
	 */
	private async enrichIfEnabled(
		errorId: string,
		patternId: string,
	): Promise<void> {
		if (!this.enrichFn || !this.isLlmReflectionEnabled()) return;
		const pattern = this.memoryService.getById(patternId);
		if (!pattern) return;
		const meta = (pattern.metadata ?? {}) as Record<string, unknown>;
		if (meta.enriched === true) return;

		const phrase = await this.enrichFn({
			lesson: pattern.content,
			fixArgs: pattern.fixArgs ?? null,
			originalError: this.memoryService.getById(errorId)?.content ?? null,
		});

		const content = phrase
			? pattern.content.includes("\nFixed by: ")
				? pattern.content.replace(/\nFixed by: .+$/s, `\n${phrase}`)
				: `${pattern.content}\n${phrase}`
			: pattern.content;
		this.memoryService.update(patternId, {
			content,
			metadata: { ...meta, enriched: true },
		});
	}

	private isLlmReflectionEnabled(): boolean {
		const row = this.store
			.prepare("SELECT value FROM kevin_settings WHERE key = ?")
			.get("llm_reflection_enabled") as { value: string } | undefined;
		return row?.value === "1";
	}
}

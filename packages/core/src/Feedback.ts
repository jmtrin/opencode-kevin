import type { Store } from "./Store.js";
import { hasFeedbackTable } from "./columns.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

/**
 * v0.5.0 Feedback (K5-009 / plan §5.3, D5-02).
 *
 * The human-judgement half of the glassbox: the agent can report whether a
 * memory was useful, wrong, outdated, or should be ignored. Verdicts are
 * stored in `memory_feedback` (migration 006_v05_glassbox.sql) and folded
 * into the memory's `feedback_positive` / `feedback_negative` counters —
 * kept SEPARATE from `evidence_count` / `recurrence_count` by design: human
 * judgement is evidence about the memory, causal counters are evidence
 * about the world (the confidence-poisoning defect closed in v0.4.0).
 *
 * D5-07 — the `ignore` verdict is a hard lifecycle action, not a soft
 * signal: the memory is stamped `ignored = 1`, which excludes it from
 * retrieval (K5-008) and from the quality gate (K5-007).
 *
 * Schema:
 *   memory_feedback(id PK, memory_id, verdict, session_id, note, created_at)
 *   memories(feedback_positive, feedback_negative, ignored)
 */
export type FeedbackVerdict = "useful" | "wrong" | "outdated" | "ignore";

export interface FeedbackRecordInput {
	memoryId: string;
	verdict: FeedbackVerdict;
	sessionId?: string | null;
	note?: string | null;
}

export interface FeedbackRow {
	id: string;
	memoryId: string;
	verdict: FeedbackVerdict;
	sessionId: string | null;
	note: string | null;
	createdAt: string;
}

export interface FeedbackCounts {
	positive: number;
	negative: number;
}

const POSITIVE_VERDICTS: readonly FeedbackVerdict[] = ["useful"];
const NEGATIVE_VERDICTS: readonly FeedbackVerdict[] = [
	"wrong",
	"outdated",
	"ignore",
];

// v1.1.0 (K11-011) — table probe delegates to columns registry

export class Feedback {
	private readonly metrics: Metrics | null;
	private readonly now: () => Date;

	constructor(
		private readonly store: Store,
		metrics?: Metrics | null,
		now: () => Date = () => new Date(),
	) {
		this.metrics = metrics ?? null;
		this.now = now;
	}

	/**
	 * Records one human verdict and folds it into the memory's counters.
	 * Counters are RECOMPUTED from the table (never incremented) so rows
	 * deleted in tests or by hand cannot drift them.
	 *
	 * The `ignore` verdict also stamps `memories.ignored = 1` (D5-07).
	 * Returns the feedback row id.
	 */
	record(input: FeedbackRecordInput): string {
		if (!hasFeedbackTable(this.store)) {
			throw new Error(
				"kevin_feedback requires migration 006_v05_glassbox.sql (missing table memory_feedback)",
			);
		}
		const id = uuidv7();
		this.store
			.prepare(
				`INSERT INTO memory_feedback
				   (id, memory_id, verdict, session_id, note)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.memoryId,
				input.verdict,
				input.sessionId ?? null,
				input.note ?? null,
			);

		this.recomputeCounters(input.memoryId);

		if (input.verdict === "ignore") {
			this.store
				.prepare("UPDATE memories SET ignored = 1 WHERE id = ?")
				.run(input.memoryId);
		}
		// v0.5.0 (K5-023 / plan §5.3, D5-06) — lifecycle action of a
		// negative verdict. `wrong` is an opinion and deserves a second
		// opinion: it demotes only at feedback_negative >= 2. `outdated`
		// is a self-verifying claim about the world and acts at once.
		// `useful` confirms the memory and refreshes its verification.
		if (input.verdict === "outdated") {
			this.store
				.prepare("UPDATE memories SET status = 'stale' WHERE id = ?")
				.run(input.memoryId);
		} else if (input.verdict === "wrong") {
			const counts = this.countsFor(input.memoryId);
			if (counts.negative >= 2) {
				this.store
					.prepare("UPDATE memories SET status = 'stale' WHERE id = ?")
					.run(input.memoryId);
			}
		} else if (input.verdict === "useful") {
			this.store
				.prepare(
					"UPDATE memories SET last_verified_at = datetime('now') WHERE id = ?",
				)
				.run(input.memoryId);
		}

		if (POSITIVE_VERDICTS.includes(input.verdict)) {
			this.metrics?.incr("feedback_positive_total", 1);
		} else if (NEGATIVE_VERDICTS.includes(input.verdict)) {
			this.metrics?.incr("feedback_negative_total", 1);
		}
		return id;
	}

	/** Human-judgement counters for one memory (from the row, not the table). */
	countsFor(memoryId: string): FeedbackCounts {
		const row = this.store
			.prepare(
				"SELECT feedback_positive, feedback_negative FROM memories WHERE id = ?",
			)
			.get(memoryId) as
			| { feedback_positive: number; feedback_negative: number }
			| undefined;
		if (!row) return { positive: 0, negative: 0 };
		return { positive: row.feedback_positive, negative: row.feedback_negative };
	}

	/**
	 * Raw verdict history, newest first. Used by `kevin_feedback` (K5-011)
	 * and by the audit tool (K5-016).
	 */
	list(memoryId?: string, limit = 50): FeedbackRow[] {
		const rows = this.store
			.prepare(
				`SELECT id, memory_id, verdict, session_id, note, created_at
				   FROM memory_feedback
				  ${memoryId ? "WHERE memory_id = ?" : ""}
				  ORDER BY created_at DESC, rowid DESC
				  LIMIT ?`,
			)
			.all(...(memoryId ? [memoryId, limit] : [limit])) as {
			id: string;
			memory_id: string;
			verdict: FeedbackVerdict;
			session_id: string | null;
			note: string | null;
			created_at: string;
		}[];
		return rows.map((r) => ({
			id: r.id,
			memoryId: r.memory_id,
			verdict: r.verdict,
			sessionId: r.session_id,
			note: r.note,
			createdAt: r.created_at,
		}));
	}

	/**
	 * Recompute a memory's positive/negative counters straight from the
	 * verdict table. Kept private — `record` is the only mutation path.
	 */
	private recomputeCounters(memoryId: string): void {
		this.store
			.prepare(
				`UPDATE memories SET
				   feedback_positive = (
				     SELECT COUNT(*) FROM memory_feedback
				      WHERE memory_id = ? AND verdict = 'useful'),
				   feedback_negative = (
				     SELECT COUNT(*) FROM memory_feedback
				      WHERE memory_id = ? AND verdict IN ('wrong','outdated','ignore'))
				 WHERE id = ?`,
			)
			.run(memoryId, memoryId, memoryId);
	}
}

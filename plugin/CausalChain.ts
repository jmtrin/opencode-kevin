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
				`SELECT rowid FROM tool_calls
				 WHERE session_id = ? AND success = 1
				 ORDER BY rowid DESC LIMIT 1`,
			)
			.get(sessionId) as { rowid: number } | undefined;
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
					   AND origin = 'reflector' AND status = 'active'
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
			this.metrics?.incr("causal_links", 1);
			return;
		}
	}

	onSessionIdle(sessionId: string): number {
		const linkedErrors = this.store
			.prepare(
				`SELECT m.id, m.fingerprint,
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
				   AND m.status = 'active'
				 GROUP BY m.fingerprint
				 HAVING (
				     SELECT MAX(tc.rowid) FROM tool_calls tc
				     WHERE tc.fix_for_fingerprint = m.fingerprint
				 ) > COALESCE(
				     (SELECT MAX(m2.rowid) FROM memories m2
				      WHERE m2.fingerprint = m.fingerprint
				        AND m2.type = 'pattern'
				        AND m2.origin = 'causal'),
				     0
				 )`,
			)
			.all(sessionId) as {
			id: string;
			fingerprint: string;
			evidence_count: number;
		}[];

		let promoted = 0;
		for (const err of linkedErrors) {
			try {
				const id = this.memoryService.promoteToPattern(
					err.id,
					err.evidence_count,
				);
				if (id) {
					promoted++;
					this.metrics?.incr("patterns_causal", 1);
				}
			} catch {
				// promoteToPattern may fail if the error memory was removed
			}
		}

		return promoted;
	}
}

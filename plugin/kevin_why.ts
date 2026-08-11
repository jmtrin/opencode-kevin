import { TS_CODE_RULES } from "./Reflector.js";
import type { Store } from "./Store.js";
import { computeConfidence } from "./confidence.js";
import { toMatchClause, tokenizeQuery } from "./query-tokenizer.js";

// v0.5.0 (K5-010 / plan §5.3) — pre-006 DBs lack the feedback columns;
// kevin_why must not reference them (it degrades via the try/catch below,
// which is for missing ROWS, not missing COLUMNS). Probe once per store.
const feedbackColumnCache = new WeakMap<Store, boolean>();
function hasFeedbackColumns(store: Store): boolean {
	const cached = feedbackColumnCache.get(store);
	if (cached !== undefined) return cached;
	try {
		store.prepare("SELECT feedback_positive FROM memories LIMIT 1").get();
		feedbackColumnCache.set(store, true);
		return true;
	} catch {
		feedbackColumnCache.set(store, false);
		return false;
	}
}

export interface WhyInput {
	query: string;
}

export interface WhyTraceEvent {
	event: "failure" | "fix";
	fingerprint: string;
	session: string;
	ts: string;
}

export interface WhyResult {
	summary: string;
	confidence: number;
	evidence_count: number;
	/** v0.4.0 (K4-020) — negative evidence for the honest phrasing. */
	recurrence_count: number;
	/** v0.4.0 (K4-020) — deterministic "Fixed by:" raw material, if any. */
	fix_args: string | null;
	last_verified: string | null;
	trace: WhyTraceEvent[];
	related_rules: string[];
}

export function kevinWhy(store: Store, query: string): WhyResult | null {
	// v0.3.0 fix (bug #7) — the old code wrapped the WHOLE query in a
	// single quoted phrase, so it only matched the exact full-string
	// sequence. Tokenize like MemoryService.queryRelevant: quote each
	// word (escaping inner quotes) and AND them together, so partial or
	// multi-word queries still hit the FTS index.
	const tokens = tokenizeQuery(query);
	if (tokens.length === 0) return null;
	const match = toMatchClause(tokens, " AND ");

	// Best-effort (v0.4.0): DBs pre-005 lack `recurrence_count`; degrade
	// to "no explanation" instead of crashing the calling session.
	let patternRows: {
		id: string;
		content: string;
		fingerprint: string;
		evidence_count: number;
		recurrence_count: number;
		fix_args: string | null;
		last_verified_at: string | null;
		created_at: string;
		feedback_positive: number;
		feedback_negative: number;
	}[];
	try {
		patternRows = store
			.prepare(
				`SELECT m.id, m.content, m.fingerprint, m.evidence_count,
				        m.recurrence_count, m.fix_args, m.last_verified_at, m.created_at${
									hasFeedbackColumns(store)
										? ", m.feedback_positive, m.feedback_negative"
										: ""
								}
				 FROM memories_fts
				 JOIN memories m ON m.rowid = memories_fts.rowid
				 WHERE memories_fts MATCH ?
				   AND m.type = 'pattern'
				   AND m.origin IN ('causal', 'pattern')
				   AND m.status = 'active'
				 ORDER BY m.evidence_count DESC, m.created_at DESC
				 LIMIT 1`,
			)
			.all(match) as {
			id: string;
			content: string;
			fingerprint: string;
			evidence_count: number;
			recurrence_count: number;
			fix_args: string | null;
			last_verified_at: string | null;
			created_at: string;
			feedback_positive: number;
			feedback_negative: number;
		}[];
	} catch {
		return null;
	}

	if (patternRows.length === 0) return null;

	const pattern = patternRows[0];
	const fp = pattern.fingerprint;
	// v0.4.0 (K4-010) — two-sided confidence shared with promoteToPattern.
	// v0.5.0 (K5-010) — human feedback terms nudge it (D5-02).
	const confidence = computeConfidence(
		pattern.evidence_count ?? 0,
		pattern.recurrence_count ?? 0,
		pattern.feedback_positive ?? 0,
		pattern.feedback_negative ?? 0,
	);

	// BUG-007 — the trace is built from the error-memory sessions below;
	// the legacy `traceRows` probe (executed but unused, with a
	// never-matching `tc.fingerprint LIKE '%<8-hex>%'` branch against the
	// tool|args|success hash) was deleted.
	const trace: WhyTraceEvent[] = [];

	const errorSessions = store
		.prepare(
			`SELECT DISTINCT source_session, fingerprint, created_at
			 FROM memories
			 WHERE fingerprint = ? AND type = 'error' AND origin = 'reflector'
			 ORDER BY created_at ASC`,
		)
		.all(fp) as {
		source_session: string;
		fingerprint: string;
		created_at: string;
	}[];

	for (const err of errorSessions) {
		trace.push({
			event: "failure",
			fingerprint: err.fingerprint,
			session: err.source_session ?? "unknown",
			ts: err.created_at,
		});

		const fixRow = store
			.prepare(
				`SELECT session_id, ts FROM tool_calls
				 WHERE fix_for_fingerprint = ?
				   AND session_id = ?
				 ORDER BY ts ASC LIMIT 1`,
			)
			.get(fp, err.source_session) as
			| { session_id: string; ts: string }
			| undefined;

		if (fixRow) {
			trace.push({
				event: "fix",
				fingerprint: fp,
				session: fixRow.session_id,
				ts: fixRow.ts,
			});
		}
	}

	const relatedRules: string[] = [];
	const tsCodeMatch = query.match(/TS(\d{4,5})/);
	if (tsCodeMatch) {
		const hint = TS_CODE_RULES[tsCodeMatch[1]] ?? `review TS${tsCodeMatch[1]}`;
		relatedRules.push(hint);
	}

	// v0.4.0 (K4-020) — honest summary (plan §5.3 / D4-11): with
	// recurrences the pattern is NOT consistently resolved, so the
	// phrasing reports the real success ratio ("resolved in N of M
	// attempts") instead of "consistently resolved".
	const evidenceCount = pattern.evidence_count ?? 0;
	const recurrence = pattern.recurrence_count ?? 0;
	let summary: string;
	if (recurrence > 0) {
		const fix = pattern.fix_args
			? `fixing ${pattern.fix_args}`
			: `fixing ${
					relatedRules.length > 0
						? relatedRules.join(", ")
						: "the underlying issue"
				}`;
		summary = `When tool fails with ${query}: resolved in ${evidenceCount} of ${evidenceCount + recurrence} attempts by ${fix}.`;
	} else {
		summary = `When tool fails with ${query}: ${
			confidence >= 0.7 ? "consistently" : "often"
		} resolved by fixing ${
			relatedRules.length > 0 ? relatedRules.join(", ") : "the underlying issue"
		}.`;
	}

	return {
		summary,
		confidence,
		evidence_count: evidenceCount,
		recurrence_count: recurrence,
		fix_args: pattern.fix_args ?? null,
		last_verified: pattern.last_verified_at ?? null,
		trace,
		related_rules: relatedRules,
	};
}

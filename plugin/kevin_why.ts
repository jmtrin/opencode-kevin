import { TS_CODE_RULES } from "./Reflector.js";
import type { Store } from "./Store.js";

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
	const tokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t.replace(/"/g, '""')}"`);
	if (tokens.length === 0) return null;
	const match = tokens.join(" AND ");

	const patternRows = store
		.prepare(
			`SELECT m.id, m.content, m.fingerprint, m.evidence_count,
			        m.last_verified_at, m.created_at
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
		last_verified_at: string | null;
		created_at: string;
	}[];

	if (patternRows.length === 0) return null;

	const pattern = patternRows[0];
	const fp = pattern.fingerprint;
	const confidence = Math.min(1.0, 0.5 + 0.1 * (pattern.evidence_count ?? 0));

	const traceRows = store
		.prepare(
			`SELECT tc.session_id, tc.ts, tc.success,
			        m.id as memory_id, m.type as memory_type, m.created_at as memory_created_at
			 FROM tool_calls tc
			 LEFT JOIN memories m ON m.fingerprint = tc.fix_for_fingerprint
				 AND m.type = 'error' AND m.origin = 'reflector'
			 WHERE (tc.fix_for_fingerprint = ? OR tc.fingerprint LIKE ?)
			   AND tc.session_id IN (
				   SELECT DISTINCT source_session FROM memories
				   WHERE fingerprint = ? AND type = 'error'
			   )
			 ORDER BY tc.ts ASC
			 LIMIT 20`,
		)
		.all(fp, `%${fp.slice(0, 8)}%`, fp) as {
		session_id: string;
		ts: string;
		success: number;
		memory_id: string | null;
		memory_type: string | null;
		memory_created_at: string | null;
	}[];

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

	const summary = `When tool fails with ${query}: ${confidence >= 0.7 ? "consistently" : "often"} resolved by fixing ${relatedRules.length > 0 ? relatedRules.join(", ") : "the underlying issue"}.`;

	return {
		summary,
		confidence,
		evidence_count: pattern.evidence_count ?? 0,
		last_verified: pattern.last_verified_at ?? null,
		trace,
		related_rules: relatedRules,
	};
}

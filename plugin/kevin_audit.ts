import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";

/**
 * v0.5.0 (K5-016 / plan §5.7) — `kevin_audit`.
 *
 * Pure SQL over `memories`, `kevin_injections`, `kevin_metrics`,
 * `memory_feedback`. No writes, no LLM, no filesystem access.
 *
 * There is deliberately **no `kevin_context_ratio`** (D5-09): Kevin cannot
 * observe total session input tokens, so any such figure would be fabricated.
 *
 * Pre-006 databases degrade gracefully: any block that fails (missing column
 * or table) falls back to its zero value and the report is flagged
 * `"partial": true` instead of throwing.
 */

export interface AuditReport {
	memories: {
		total: number;
		by_status: Record<string, number>;
		by_origin: Record<string, number>;
		by_type: Record<string, number>;
		ignored: number;
		archived: number;
		with_feedback: number;
		superseded_with_target: number;
	};
	injections: {
		total: number;
		effective: number;
		ineffective: number;
		inconclusive: number;
		unmeasured: number;
		precision_rate: number;
		coverage_rate: number;
	};
	blocked: Record<string, number>;
	feedback: {
		positive: number;
		negative: number;
		by_verdict: Record<string, number>;
	};
	tokens: {
		pre_prompt: number;
		compacting: number;
	};
	settings: Record<string, string>;
	partial: boolean;
}

function groupCounts(store: Store, column: string): Record<string, number> {
	const rows = store
		.prepare(
			`SELECT ${column} AS k, COUNT(*) AS n FROM memories GROUP BY ${column}`,
		)
		.all() as { k: string | null; n: number }[];
	const out: Record<string, number> = {};
	for (const r of rows) {
		out[r.k ?? "unknown"] = r.n;
	}
	return out;
}

function scalar(store: Store, sql: string): number {
	const row = store.prepare(sql).get() as { n: number };
	return row.n ?? 0;
}

export function buildAudit(store: Store, metrics: Metrics): AuditReport {
	let partial = false;

	// Memories block: `total` + the three GROUP BYs are pre-006 safe; the
	// lifecycle counters need the 006 columns and fall back separately.
	let memories: AuditReport["memories"] = {
		total: 0,
		by_status: {},
		by_origin: {},
		by_type: {},
		ignored: 0,
		archived: 0,
		with_feedback: 0,
		superseded_with_target: 0,
	};
	try {
		memories = {
			...memories,
			total: scalar(store, "SELECT COUNT(*) AS n FROM memories"),
			by_status: groupCounts(store, "status"),
			by_origin: groupCounts(store, "origin"),
			by_type: groupCounts(store, "type"),
		};
	} catch {
		partial = true;
	}
	try {
		memories = {
			...memories,
			ignored: scalar(
				store,
				"SELECT COUNT(*) AS n FROM memories WHERE ignored = 1",
			),
			archived: scalar(
				store,
				"SELECT COUNT(*) AS n FROM memories WHERE status = 'archived'",
			),
			with_feedback: scalar(
				store,
				"SELECT COUNT(*) AS n FROM memories WHERE feedback_positive > 0 OR feedback_negative > 0",
			),
			superseded_with_target: scalar(
				store,
				"SELECT COUNT(*) AS n FROM memories WHERE status = 'superseded' AND superseded_by IS NOT NULL",
			),
		};
	} catch {
		partial = true;
	}

	// Injections block: grouped rollup over the ledger (same query the
	// InjectionLedger.outcomeCounts() runs), rates from the metric cache.
	let injections: AuditReport["injections"] = {
		total: 0,
		effective: 0,
		ineffective: 0,
		inconclusive: 0,
		unmeasured: 0,
		precision_rate: 0,
		coverage_rate: 0,
	};
	try {
		const rows = store
			.prepare(
				"SELECT outcome, COUNT(*) AS n FROM kevin_injections GROUP BY outcome",
			)
			.all() as { outcome: string; n: number }[];
		const counts: Record<string, number> = {
			unmeasured: 0,
			effective: 0,
			ineffective: 0,
			inconclusive: 0,
		};
		for (const r of rows) {
			counts[r.outcome] = r.n;
		}
		injections = {
			total: rows.reduce((acc, r) => acc + r.n, 0),
			effective: counts.effective,
			ineffective: counts.ineffective,
			inconclusive: counts.inconclusive,
			unmeasured: counts.unmeasured,
			precision_rate: metrics.precisionRate(),
			coverage_rate: metrics.coverageRate(),
		};
	} catch {
		partial = true;
	}

	// Feedback block: verdict rollup from the table, totals from the cache.
	let feedback: AuditReport["feedback"] = {
		positive: 0,
		negative: 0,
		by_verdict: {},
	};
	try {
		const rows = store
			.prepare(
				"SELECT verdict, COUNT(*) AS n FROM memory_feedback GROUP BY verdict",
			)
			.all() as { verdict: string; n: number }[];
		const byVerdict: Record<string, number> = {};
		for (const r of rows) {
			byVerdict[r.verdict] = r.n;
		}
		feedback = {
			positive: metrics.get("feedback_positive_total"),
			negative: metrics.get("feedback_negative_total"),
			by_verdict: byVerdict,
		};
	} catch {
		partial = true;
	}

	const blocked = metrics.blockedSnapshot();

	const tokens = {
		pre_prompt: metrics.get("tokens_injected_pre_prompt"),
		compacting: metrics.get("tokens_injected_compacting"),
	};

	let settings: Record<string, string> = {};
	try {
		const rows = store
			.prepare("SELECT key, value FROM kevin_settings")
			.all() as { key: string; value: string }[];
		settings = {};
		for (const r of rows) {
			settings[r.key] = r.value;
		}
	} catch {
		partial = true;
	}

	return {
		memories,
		injections,
		blocked,
		feedback,
		tokens,
		settings,
		partial,
	};
}

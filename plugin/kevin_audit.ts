import { effectivePrePromptCap } from "./ContextInjector.js";
import type { Store } from "./Store.js";
import type { Capabilities } from "./capabilities.js";
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
 *
 * v0.6.0 (K6-023 / plan §5.8) — the `channels` and `curation` blocks are the
 * release's own scoreboard. On a pre-007 database they are **omitted** (not
 * zero-valued) and `"partial": true` is set: a report that cannot answer
 * "do the pull channels beat push?" must say so rather than suggest it can.
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
	channels?: ChannelReport;
	curation?: CurationReport;
	partial: boolean;
}

/**
 * v0.6.0 (K6-023 / plan §5.8) — three-channel comparison on the same axes.
 * `skill_emission` / `reference_emission` distinguish the three states a
 * channel can be in: "unavailable" (v1 host, no domain on the plugin input),
 * "off" (capable host, setting '0'), "on" (capable host, setting '1').
 * Collapsing "unavailable" and "off" would make "my host is too old"
 * indistinguishable from "I turned it off".
 */
export type EmissionState = "on" | "off" | "unavailable";

export interface ChannelReport {
	push: {
		tokens_pre_prompt: number;
		tokens_compacting: number;
		injections_total: number;
		precision_rate: number;
		coverage_rate: number;
		budget_tokens: number;
	};
	pull: {
		proposals_created: number;
		proposals_approved: number;
		proposals_rejected: number;
		artifact_writes_total: number;
		artifact_writes_noop: number;
		references_registered: number;
		skills_registered: number;
		skill_emission: EmissionState;
		reference_emission: EmissionState;
	};
}

export interface CurationReport {
	eligible: number;
	curated: number;
	inferable: number;
	non_inferable: number;
	unknown: number;
	proposals_by_status: Record<string, number>;
}

const ALL_FALSE_CAPABILITIES: Capabilities = {
	skills: false,
	references: false,
	apiVersion: null,
};

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

export function buildAudit(
	store: Store,
	metrics: Metrics,
	capabilities: Capabilities = ALL_FALSE_CAPABILITIES,
): AuditReport {
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

	// v0.6.0 (K6-023 / plan §5.8) — channels + curation. Both blocks are
	// gated on migration 007's schema: on a pre-007 database they are
	// OMITTED (not zero-valued) and `partial` is set, so the release's
	// scoreboard is never presented as computed when it cannot be.
	let channels: ChannelReport | undefined;
	let curation: CurationReport | undefined;
	let hasSchema007 = false;
	try {
		store.prepare("SELECT 1 FROM curation_proposals LIMIT 1").get();
		hasSchema007 = true;
	} catch {
		hasSchema007 = false;
	}
	if (hasSchema007) {
		try {
			const emission = (capable: boolean, key: string): EmissionState => {
				if (!capable) return "unavailable";
				return settings[key] === "1" ? "on" : "off";
			};
			const registered = (key: string): number => {
				const row = store
					.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
					.get(key) as { value: number } | undefined;
				return row?.value ?? 0;
			};
			channels = {
				push: {
					tokens_pre_prompt: metrics.get("tokens_injected_pre_prompt"),
					tokens_compacting: metrics.get("tokens_injected_compacting"),
					injections_total: metrics.get("injections_total"),
					precision_rate: metrics.precisionRate(),
					coverage_rate: metrics.coverageRate(),
					// The EFFECTIVE cap (K6-021 clamp semantics), not the raw
					// setting: the channel comparison must use the budget the
					// push channel actually charges against.
					budget_tokens: effectivePrePromptCap(
						settings.pre_prompt_budget_tokens,
					),
				},
				pull: {
					proposals_created: metrics.get("proposals_created"),
					// "approved" is the human decision: approved + applied.
					proposals_approved: metrics.get("proposals_approved"),
					proposals_rejected: metrics.get("proposals_rejected"),
					artifact_writes_total: metrics.get("artifact_writes_total"),
					artifact_writes_noop: metrics.get("artifact_writes_noop"),
					references_registered: registered("references_registered"),
					skills_registered: registered("skills_registered"),
					skill_emission: emission(
						capabilities.skills,
						"skill_emission_enabled",
					),
					reference_emission: emission(
						capabilities.references,
						"reference_emission_enabled",
					),
				},
			};
		} catch {
			partial = true;
			channels = undefined;
		}
		try {
			const proposalRows = store
				.prepare(
					"SELECT status, COUNT(*) AS n FROM curation_proposals GROUP BY status",
				)
				.all() as { status: string; n: number }[];
			const byStatus: Record<string, number> = {};
			for (const r of proposalRows) {
				byStatus[r.status] = r.n;
			}
			curation = {
				// The Curator predicate is `inferable != 1` (plan §5.5): an
				// unclassified (NULL) memory must not be silently withheld.
				eligible: scalar(
					store,
					"SELECT COUNT(*) AS n FROM memories WHERE inferable IS NOT 1",
				),
				curated: scalar(
					store,
					"SELECT COUNT(*) AS n FROM memories WHERE curated = 1",
				),
				inferable: scalar(
					store,
					"SELECT COUNT(*) AS n FROM memories WHERE inferable = 1",
				),
				non_inferable: scalar(
					store,
					"SELECT COUNT(*) AS n FROM memories WHERE inferable = 0",
				),
				unknown: scalar(
					store,
					"SELECT COUNT(*) AS n FROM memories WHERE inferable IS NULL",
				),
				proposals_by_status: byStatus,
			};
		} catch {
			partial = true;
			curation = undefined;
		}
	} else {
		partial = true;
	}

	return {
		memories,
		injections,
		blocked,
		feedback,
		tokens,
		settings,
		channels,
		curation,
		partial,
	};
}

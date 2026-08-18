import { effectivePrePromptCap } from "./ContextInjector.js";
import { hasRepoIdColumn } from "./MemoryService.js";
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
 *
 * v0.7.0 (K7-019 / plan §5.3, K7-006) — the `truth` block is project-scoped:
 * facts scanned, penalized memory count and the truncation flag for the
 * current project. It is omitted (and `"partial": true` set) on a pre-008
 * database, exactly like the conflicts block. `facts_scanned` counts every
 * `repo_facts` row for the project — the same COUNT(*) semantics as the
 * `repo_facts_scanned` metric — while `truncated` reports the scan cap
 * separately, mirroring `kevin_facts`.
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
	conflicts?: {
		by_kind: Record<string, number>;
		by_status: Record<string, number>;
	};
	truth?: TruthReport;
	mix?: {
		injected_by_type: Record<string, number>;
		injected_total: number;
		non_error_injected: number;
		non_error_share: number;
		precision_error: number;
		precision_non_error: number;
		meets_exit_criterion: boolean;
		reason?: "immature_db";
	};
	channels?: ChannelReport;
	curation?: CurationReport;
	/**
	 * v0.8.0 (K8-018/023 / plan §5.2, §5.7) — the shared-layer block.
	 * K8-018 kept it minimal (write_refusals); K8-023 extends it with
	 * the full team rollup, computed in pure SQL. On a database below
	 * the v0.7.0 maturity floor the precision numbers are omitted and
	 * `reason: "immature_db"` reported instead.
	 */
	team?: {
		write_refusals: number;
		shared_total?: number;
		tombstones?: number;
		distinct_authors?: number;
		last_import_at?: string | null;
		last_import_rejected?: number;
		precision_shared?: number;
		precision_local?: number;
		reason?: "immature_db";
	};
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

/**
 * v0.7.0 (K7-019 / plan §5.3) — the Project Truth block. The same shape
 * `kevin_facts` exposes: `facts_scanned` counts every repo_facts row for the
 * project (COUNT(*) semantics, matching the `repo_facts_scanned` metric),
 * `penalized_memories` counts memories with `truth_penalty > 0`, and
 * `truncated` reports the 500-fact scan cap from the `_truncated` marker row.
 */
export interface TruthReport {
	facts_scanned: number;
	penalized_memories: number;
	truncated: { is_truncated: true; count: number } | { is_truncated: false };
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

function scalar(store: Store, sql: string, ...params: unknown[]): number {
	const row = store.prepare(sql).get(...params) as { n: number };
	return row.n ?? 0;
}

export function buildAudit(
	store: Store,
	metrics: Metrics,
	capabilities: Capabilities = ALL_FALSE_CAPABILITIES,
	projectId?: string,
	repoId?: string | null,
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
	let conflicts: AuditReport["conflicts"];
	let mix: AuditReport["mix"];
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
	// v0.8.0 (K8-018/023 / plan §5.2, §5.7) — the shared-layer block.
	// `write_refusals` lives OUTSIDE the frozen METRIC_KEYS ladder (K7-004)
	// and is read as a bare SQL scalar, following the `skills_registered`
	// precedent; a missing row means no refusals yet. The K8-023 team
	// rollup (shared_entries, okf_imports, layer precision) is gated on
	// migration 009's schema and is pure SQL — no JavaScript-side
	// aggregation (plan §5.7 acceptance).
	let team: AuditReport["team"] = { write_refusals: 0 };
	try {
		team = {
			write_refusals: scalar(
				store,
				`SELECT COALESCE(
					(SELECT value FROM kevin_metrics WHERE key = 'shared_write_refusals'),
					0
				) AS n`,
			),
		};
	} catch {
		partial = true;
		team = undefined;
	}
	let hasSchema009 = false;
	try {
		store.prepare("SELECT 1 FROM shared_entries LIMIT 1").get();
		hasSchema009 = true;
	} catch {
		hasSchema009 = false;
	}
	if (hasSchema009 && team !== undefined) {
		try {
			const repoWhere = (column: string): string =>
				repoId ? `${column} = ?` : "1 = 1";
			const repoParams: (string | null)[] = repoId ? [repoId] : [];
			const lastImport = store
				.prepare(
					`SELECT imported_at, entries_rejected
					 FROM okf_imports
					 WHERE ${repoWhere("repo_id")}
					 ORDER BY imported_at DESC, id DESC LIMIT 1`,
				)
				.get(...repoParams) as
				| { imported_at: string; entries_rejected: number }
				| undefined;
			// v0.5.0 precision formula (effective / (effective +
			// ineffective)) per layer, same shape as `mix`.
			const layerPrecision = (layer: string): number => {
				const row = store
					.prepare(
						`SELECT
						 SUM(CASE WHEN i.outcome = 'effective' THEN 1 ELSE 0 END) AS effective,
						 SUM(CASE WHEN i.outcome = 'ineffective' THEN 1 ELSE 0 END) AS ineffective
						 FROM kevin_injections i JOIN memories m ON m.id = i.memory_id
						 WHERE m.layer = ? ${
								repoId ? "AND (m.repo_id = ? OR m.repo_id IS NULL)" : ""
							}`,
					)
					.get(layer, ...((repoId ? [repoId] : []) as (string | null)[])) as {
					effective: number | null;
					ineffective: number | null;
				};
				const effective = row.effective ?? 0;
				const measured = effective + (row.ineffective ?? 0);
				return measured > 0 ? effective / measured : 0;
			};
			// The v0.7.0 maturity floor, verbatim: below it the
			// precision numbers are omitted and `immature_db` reported
			// (plan §5.7 step 5).
			const memoryCount = scalar(store, "SELECT COUNT(*) AS n FROM memories");
			const settled = scalar(
				store,
				"SELECT COUNT(*) AS n FROM kevin_injections WHERE outcome IN ('effective','ineffective')",
			);
			const mature = memoryCount >= 100 && settled >= 50;
			team = {
				...team,
				shared_total: scalar(
					store,
					`SELECT COUNT(*) AS n FROM shared_entries
					 WHERE ${repoWhere("repo_id")} AND op = 'assert'`,
					...repoParams,
				),
				tombstones: scalar(
					store,
					`SELECT COUNT(*) AS n FROM shared_entries
					 WHERE ${repoWhere("repo_id")} AND op = 'tombstone'`,
					...repoParams,
				),
				// Counts distinct non-null author_hash values; with
				// author_identity_mode='none' imports write NULL, so
				// the count is naturally 0.
				distinct_authors: scalar(
					store,
					`SELECT COUNT(DISTINCT author_hash) AS n FROM shared_entries
					 WHERE ${repoWhere("repo_id")} AND author_hash IS NOT NULL`,
					...repoParams,
				),
				last_import_at: lastImport?.imported_at ?? null,
				last_import_rejected: lastImport?.entries_rejected ?? 0,
				...(mature
					? {
							precision_shared: layerPrecision("shared"),
							precision_local: layerPrecision("local"),
						}
					: { reason: "immature_db" as const }),
			};
		} catch {
			partial = true;
			team = undefined;
		}
	}
	try {
		const rows = store
			.prepare(
				"SELECT kind, status, COUNT(*) AS n FROM memory_conflicts GROUP BY kind, status",
			)
			.all() as { kind: string; status: string; n: number }[];
		const byKind: Record<string, number> = {};
		const byStatus: Record<string, number> = {};
		for (const row of rows) {
			byKind[row.kind] = (byKind[row.kind] ?? 0) + row.n;
			byStatus[row.status] = (byStatus[row.status] ?? 0) + row.n;
		}
		conflicts = { by_kind: byKind, by_status: byStatus };
	} catch {
		partial = true;
	}
	// v0.7.0 (K7-019 / plan §5.3, K7-006) — the `truth` block is
	// project-scoped. On a pre-008 database the repo_facts query throws, so
	// the block is omitted and `partial` set — a report that cannot answer
	// "how many facts does this project have?" must say so.
	// v0.8.0 (K8-007 / plan §5.7) — the penalized-memory rollup scopes on
	// repo_id once the 009 column exists and an identity is resolved
	// (NULL-repo_id rows are global); project_id stays as the fallback.
	let truth: AuditReport["truth"];
	if (projectId || repoId) {
		try {
			const truncatedRow = store
				.prepare(
					"SELECT value FROM repo_facts WHERE project_id = ? AND key_path = '_truncated'",
				)
				.get(projectId) as { value: string } | undefined;
			const penalized =
				repoId && hasRepoIdColumn(store)
					? scalar(
							store,
							"SELECT COUNT(*) AS n FROM memories WHERE (repo_id = ? OR repo_id IS NULL) AND truth_penalty > 0",
							repoId,
						)
					: scalar(
							store,
							"SELECT COUNT(*) AS n FROM memories WHERE project_id = ? AND truth_penalty > 0",
							projectId,
						);
			truth = {
				facts_scanned: scalar(
					store,
					"SELECT COUNT(*) AS n FROM repo_facts WHERE project_id = ?",
					projectId,
				),
				penalized_memories: penalized,
				truncated: truncatedRow
					? { is_truncated: true, count: Number(truncatedRow.value) || 0 }
					: { is_truncated: false },
			};
		} catch {
			partial = true;
			truth = undefined;
		}
	}
	try {
		const typeRows = store
			.prepare(
				`SELECT m.type, COUNT(*) AS n
				 FROM kevin_injections i JOIN memories m ON m.id = i.memory_id
				 GROUP BY m.type`,
			)
			.all() as { type: string; n: number }[];
		const injectedByType: Record<string, number> = {
			error: 0,
			rule: 0,
			decision: 0,
			pattern: 0,
			solution: 0,
			context: 0,
		};
		for (const row of typeRows) injectedByType[row.type] = row.n;
		const total = typeRows.reduce((sum, row) => sum + row.n, 0);
		const nonError = total - (injectedByType.error ?? 0);
		const precisionFor = (isError: boolean): number => {
			const row = store
				.prepare(
					`SELECT
					 SUM(CASE WHEN i.outcome = 'effective' THEN 1 ELSE 0 END) AS effective,
					 SUM(CASE WHEN i.outcome = 'ineffective' THEN 1 ELSE 0 END) AS ineffective
					 FROM kevin_injections i JOIN memories m ON m.id = i.memory_id
					 WHERE ${isError ? "m.type = 'error'" : "m.type <> 'error'"}`,
				)
				.get() as { effective: number | null; ineffective: number | null };
			const effective = row.effective ?? 0;
			const measured = effective + (row.ineffective ?? 0);
			return measured > 0 ? effective / measured : 0;
		};
		const precisionError = precisionFor(true);
		const precisionNonError = precisionFor(false);
		const memoryCount = scalar(store, "SELECT COUNT(*) AS n FROM memories");
		const settled = scalar(
			store,
			"SELECT COUNT(*) AS n FROM kevin_injections WHERE outcome IN ('effective','ineffective')",
		);
		const mature = memoryCount >= 100 && settled >= 50;
		const meets =
			mature &&
			nonError / Math.max(total, 1) >= 0.5 &&
			precisionNonError > precisionError;
		mix = {
			injected_by_type: injectedByType,
			injected_total: total,
			non_error_injected: nonError,
			non_error_share: total > 0 ? nonError / total : 0,
			precision_error: precisionError,
			precision_non_error: precisionNonError,
			meets_exit_criterion: meets,
			...(mature ? {} : { reason: "immature_db" as const }),
		};
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
		conflicts,
		truth,
		mix,
		channels,
		curation,
		team,
		partial,
	};
}

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./Store.js";

/**
 * K13-008 (D13-04) — core-owns-migrations. Returns the directory containing
 * the SQL migration files, resolved relative to the compiled location.
 * Works both when running from src via tsx (src/.. → migrations) and from
 * dist (dist/migrations).
 */
export function exportMigrationsDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const direct = join(here, "migrations");
	if (existsSync(direct)) return direct;
	return join(here, "..", "migrations");
}

export interface MigrateResult {
	from: string;
	to: string;
	applied: string[];
}

export type PostApplyHook = (store: Store) => void;

// v0.9.0 (K9-001 / plan §5.3, D9-08) — the six hooks Kevin registers, in
// hook-object order, plus `dispose` (v1.0.0 K10-013): the seventh
// instrumented hook. Canonical list: the "010" post-apply hook seeds
// hook_liveness from it, and HookLiveness (K9-009) wraps exactly these
// names, so a future hook added here is visible in the table on the next
// migration run.
export const HOOK_NAMES = [
	"tool.execute.before",
	"tool.execute.after",
	"chat.message",
	"experimental.chat.system.transform",
	"experimental.session.compacting",
	"event",
	"dispose",
] as const;

// Built-in post-apply hooks, keyed by migration version. Each hook runs inside
// the same transaction as the migration's DDL, so a hook failure rolls back the
// whole migration. Hooks run when their version is applied. Migration 008's
// reconciliation hook is also safe to run on later no-op starts (K7-002).
const DEFAULT_POST_APPLY_HOOKS: Record<string, PostApplyHook> = {
	// v0.2.0 Signal Quality: defensive backfill of memories.origin for legacy
	// rows. The column is NOT NULL DEFAULT 'agent', so SQLite already populates
	// pre-existing rows with 'agent' on ALTER TABLE. This hook is a belt-and-
	// braces UPDATE that coerces any NULL/empty stragglers (which would only
	// exist if a partial DB skipped the DEFAULT) back to 'agent'.
	"003": (store) => {
		store
			.prepare(
				"UPDATE memories SET origin = 'agent' WHERE origin IS NULL OR origin = ''",
			)
			.run();
	},
	// v0.3.0 Knowledge + Causality: backfill evidence_count and status for
	// legacy rows. Columns have NOT NULL DEFAULT, so SQLite already populates
	// pre-existing rows. This hook is belt-and-braces in case a partial DB
	// skipped the defaults.
	"004": (store) => {
		store
			.prepare(
				"UPDATE memories SET evidence_count = 0 WHERE evidence_count IS NULL",
			)
			.run();
		store
			.prepare(
				"UPDATE memories SET status = 'active' WHERE status IS NULL OR status = ''",
			)
			.run();
	},
	// v0.4.0 Signal over Noise: backfill recurrence_count for legacy rows.
	// recurrence_count has NOT NULL DEFAULT 0, so SQLite already populates
	// pre-existing rows; fix_args and last_injected_at are nullable and need
	// no coercion. This hook is belt-and-braces in case a partial DB skipped
	// the defaults.
	"005": (store) => {
		store
			.prepare(
				"UPDATE memories SET recurrence_count = 0 WHERE recurrence_count IS NULL",
			)
			.run();
	},
	// v0.5.0 (K5-002 / plan §6, D5-13) — Glass Box: re-derive the four
	// injection counters from the ledger table instead of incrementing them.
	// The rebuild remapped prior `effective` rows to `inconclusive`, so any
	// pre-existing counter values would otherwise carry the v0.4 confound
	// forward. Re-derivation is idempotent by construction and self-healing
	// on earlier drift. No INSERTs: the rows are seeded by the migration SQL;
	// a missing row makes the UPDATE a harmless no-op.
	"006": (store) => {
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections) WHERE key = 'injections_total'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'effective') WHERE key = 'injections_effective'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'ineffective') WHERE key = 'injections_ineffective'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'inconclusive') WHERE key = 'injections_inconclusive'",
			)
			.run();
	},
	// v0.6.0 (K6-002 / plan §6, D6-08) — Pull: three re-derivations, all
	// idempotent by re-derivation (same discipline as "006", D5-13).
	// 1. Back-fill `inferable = 0` for the four non-`error` types still NULL:
	//    they are `non_inferable` by rules 1 and 2 of plan §5.3
	//    unconditionally. Guarded by `inferable IS NULL` so a re-run cannot
	//    overwrite a classification produced later by inferability.classify().
	//    `error` rows are left NULL and classified lazily.
	// 2-3. proposals_created / artifact_writes_total are re-derived from
	//    their tables; a missing row makes the UPDATE a harmless no-op.
	"007": (store) => {
		store
			.prepare(
				"UPDATE memories SET inferable = 0 WHERE inferable IS NULL AND type IN ('decision','rule','solution','pattern')",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM curation_proposals) WHERE key = 'proposals_created'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM artifact_writes WHERE outcome = 'written') WHERE key = 'artifact_writes_total'",
			)
			.run();
	},
	// v0.7.0 (K7-002 / plan §6, D7-02) — Truth: four re-derivations, all
	// idempotent by re-derivation (same discipline as "006"/"007", D5-13).
	// 1. Normalize any NULL truth_penalty to 0.0 (belt-and-braces; the column
	//    is NOT NULL DEFAULT 0.0, so SQLite already back-fills on ALTER TABLE).
	// 2-4. repo_facts_scanned / conflicts_detected / memories_contradicted
	//    are re-derived from their tables, NOT trusted from the counters, so
	//    the metrics survive a database restored from backup or edited by
	//    hand. A missing row makes the UPDATE a harmless no-op.
	"008": (store) => {
		store
			.prepare(
				"UPDATE memories SET truth_penalty = 0.0 WHERE truth_penalty IS NULL",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM repo_facts) WHERE key = 'repo_facts_scanned'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM memory_conflicts) WHERE key = 'conflicts_detected'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM memories WHERE truth_penalty > 0.0) WHERE key = 'memories_contradicted'",
			)
			.run();
	},
	// v0.8.0 (K8-002 / plan §6.1, D8-03) — Team: three operations, all
	// idempotent by re-derivation (same discipline as "006"/"007"/"008").
	// 1. Back-fill the new scope from the old one: repo_id = project_id
	//    keeps every pre-v0.8 row retrievable on the same machine with an
	//    identical result set. Guarded by `repo_id IS NULL`; a row whose
	//    project_id is also NULL keeps a NULL repo_id — the retrieval
	//    path handles NULL as global (K8-007) instead of the hook faking
	//    a value. No git-derived identity here: the hook runs inside a
	//    migration and must not read the filesystem (K8-002 criterion).
	// 2. Normalize the layer marker for any row written by a concurrent
	//    v0.7.0 process between ALTER and hook (belt and braces; the
	//    column DEFAULT already covers the ordinary case).
	// 3. Re-derive shared_entries_total from state rather than trusting
	//    an incremented value that may predate a crash.
	"009": (store) => {
		store
			.prepare("UPDATE memories SET repo_id = project_id WHERE repo_id IS NULL")
			.run();
		store
			.prepare(
				"UPDATE memories SET layer = 'local' WHERE layer IS NULL OR layer = ''",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM shared_entries) WHERE key = 'shared_entries_total'",
			)
			.run();
	},
	// v0.9.0 (K9-001 / plan §6.1, D9-08) — Native: three operations, all
	// idempotent by design.
	// 1. Seed one hook_liveness row per name in HOOK_NAMES, with the
	//    experimental flag derived from the hook's own `experimental.`
	//    prefix and every counter at zero. Seeding eagerly (INSERT OR
	//    IGNORE) makes a hook that has never fired a visible row with
	//    fire_count = 0, not an absent row indistinguishable from a hook
	//    Kevin does not register.
	// 2. Re-derive hooks_dead_total from hook_liveness state rather than
	//    trusting an incremented value (same discipline as "006"-"009").
	// 3. Normalize any experimental flag that disagrees with its own
	//    hook column's prefix — cheap, and it repairs a row hand-edited
	//    during debugging.
	"010": (store) => {
		const seed = store.prepare(
			"INSERT OR IGNORE INTO hook_liveness (hook, experimental) VALUES (?, ?)",
		);
		for (const name of HOOK_NAMES) {
			seed.run(name, name.startsWith("experimental.") ? 1 : 0);
		}
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM hook_liveness WHERE dead_since IS NOT NULL) WHERE key = 'hooks_dead_total'",
			)
			.run();
		store
			.prepare(
				"UPDATE hook_liveness SET experimental = CASE WHEN hook LIKE 'experimental.%' THEN 1 ELSE 0 END",
			)
			.run();
	},
	// v1.0.0 (K10-005 / plan §6.1) — Proven: four operations, all idempotent.
	// 1. Seed dispose row defensively.
	// 2-3. Re-derive perf_budget_breaches and bench_runs_total.
	// 4. Normalise NULL within_budget to 1.
	"011": (store) => {
		store
			.prepare("INSERT OR IGNORE INTO hook_liveness (hook) VALUES ('dispose')")
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM perf_samples WHERE within_budget = 0) WHERE key = 'perf_budget_breaches'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM bench_runs) WHERE key = 'bench_runs_total'",
			)
			.run();
		store
			.prepare(
				"UPDATE perf_samples SET within_budget = 1 WHERE within_budget IS NULL",
			)
			.run();
	},
};

export class Migrate {
	private readonly postApplyHooks: Map<string, PostApplyHook>;

	constructor(
		private store: Store,
		private migrationsDir: string,
		postApplyHooks?: Record<string, PostApplyHook>,
	) {
		this.postApplyHooks = new Map<string, PostApplyHook>(
			Object.entries({
				...DEFAULT_POST_APPLY_HOOKS,
				...(postApplyHooks ?? {}),
			}),
		);
	}

	registerPostApply(version: string, hook: PostApplyHook): void {
		this.postApplyHooks.set(version, hook);
	}

	async run(): Promise<MigrateResult> {
		this.store.exec(
			`CREATE TABLE IF NOT EXISTS schema_version (
         version TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
		);

		const currentRow = this.store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string } | undefined;

		const from = currentRow?.version ?? "000";
		const pending = this.listPending(from);

		if (pending.length === 0) {
			// v0.7.0 (K7-002) — heal drift in the 008 counters on a no-op
			// startup while preserving `applied: []` idempotency. v0.8.0
			// (K8-002 / plan §6.1) extends the same repair to the 009
			// back-fill and the shared_entries_total re-derivation, and
			// v0.9.0 (K9-001 / plan §6.1) to the 010 seeding,
			// hooks_dead_total re-derivation and experimental
			// normalization: all three hooks are idempotent by guarded
			// updates and re-derivation, so a no-op startup can heal a
			// crash that landed between the DDL and the hook without
			// re-applying DDL.
			if (
				from === "008" ||
				from === "009" ||
				from === "010" ||
				from === "011"
			) {
				const repairHook = this.postApplyHooks.get(from);
				if (repairHook) this.store.transaction(() => repairHook(this.store));
			}
			return { from, to: from, applied: [] };
		}

		const insertVersion = this.store.prepare(
			"INSERT OR IGNORE INTO schema_version (version) VALUES (?)",
		);

		for (const migration of pending) {
			const sql = readFileSync(
				join(this.migrationsDir, migration.file),
				"utf8",
			);
			this.store.transaction(() => {
				this.store.exec(sql);
				const hook = this.postApplyHooks.get(migration.version);
				if (hook) hook(this.store);
				insertVersion.run(migration.version);
			});
		}

		return {
			from,
			to: pending[pending.length - 1].version,
			applied: pending.map((m) => m.version),
		};
	}

	// v1.1.0 (K11-015) — lexicographic ordering is valid through "999" because
	// versions are zero-padded 3-digit strings ("001" … "999"). Any future
	// migration beyond 999 must use a 4-digit prefix and this comparison must
	// become numeric (parseInt). Until then, string > works and keeps the
	// migration idempotency simple (plan §5.5, D11-??).
	private listPending(current: string): { version: string; file: string }[] {
		let files: string[] = [];
		try {
			files = readdirSync(this.migrationsDir).filter((f) => f.endsWith(".sql"));
		} catch {
			return [];
		}
		files.sort();
		return files
			.map((file) => {
				const match = file.match(/^(\w+?)_/);
				return match ? { version: match[1], file } : null;
			})
			.filter(
				(m): m is { version: string; file: string } =>
					m !== null && m.version > current,
			);
	}
}

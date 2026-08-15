import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./Store.js";

export interface MigrateResult {
	from: string;
	to: string;
	applied: string[];
}

export type PostApplyHook = (store: Store) => void;

// Built-in post-apply hooks, keyed by migration version. Each hook runs inside
// the same transaction as the migration's DDL, so a hook failure rolls back the
// whole migration. Hooks are only invoked when their version is being applied
// (i.e., not already present in schema_version).
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

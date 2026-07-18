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

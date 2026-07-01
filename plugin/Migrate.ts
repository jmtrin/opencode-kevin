import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./Store.js";

export interface MigrateResult {
	from: string;
	to: string;
	applied: string[];
}

export class Migrate {
	constructor(
		private store: Store,
		private migrationsDir: string,
	) {}

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

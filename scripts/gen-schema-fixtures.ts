/**
 * K10-028 — migration-matrix fixture generator.
 *
 * Builds tests/fixtures/schema/<version>.db for every historical
 * schema_version 001..010 by running Migrate.run() against a fresh
 * database with the migration list truncated at that version — never by
 * hand-writing SQL, which would reflect the author's memory of the
 * schema rather than the schema. Each database is then seeded with
 * representative rows for the tables that existed at that version.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Migrate } from "../plugin/Migrate.js";
import { Store } from "../plugin/Store.js";

const VERSIONS = [
	"001",
	"002",
	"003",
	"004",
	"005",
	"006",
	"007",
	"008",
	"009",
	"010",
] as const;

type Cols = Map<string, Set<string>>;

function tables(store: Store): Set<string> {
	const rows = store
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all() as { name: string }[];
	return new Set(rows.map((r) => r.name));
}

function columns(store: Store, table: string): Set<string> {
	const rows = store.prepare(`PRAGMA table_info(${table})`).all() as {
		name: string;
	}[];
	return new Set(rows.map((r) => r.name));
}

/** Insert into the intersection of the wanted and existing columns. */
function insertRow(
	store: Store,
	table: string,
	row: Record<string, string | number | null>,
): void {
	const cols = columns(store, table);
	const names = Object.keys(row).filter((c) => cols.has(c));
	store
		.prepare(
			`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
		)
		.run(...names.map((n) => row[n]));
}

function seed(store: Store): void {
	insertRow(store, "memories", {
		id: "fix-mem-1",
		type: "context",
		content: "fixture memory one (K10-028)",
		scope: "project",
		relevance_score: 0.5,
		created_at: "2026-01-01 00:00:00",
		updated_at: "2026-01-01 00:00:00",
	});
	if (tables(store).has("tool_calls")) {
		insertRow(store, "tool_calls", {
			id: "fix-tool-1",
			session_id: "fix-session-1",
			ts: "2026-01-01 00:00:00",
			tool: "bash",
			args_summary: "{}",
			success: 1,
		});
	}
	if (tables(store).has("kevin_settings")) {
		insertRow(store, "kevin_settings", { key: "fixture_setting", value: "on" });
	}
	if (tables(store).has("kevin_metrics")) {
		insertRow(store, "kevin_metrics", { key: "fixture_metric", value: 7 });
	}
}

function truncatedMigrationsDir(root: string, version: string): string {
	const dir = join(root, `migrations-${version}`);
	mkdirSync(dir, { recursive: true });
	for (const f of readdirSync(join(process.cwd(), "migrations"))) {
		if (!f.endsWith(".sql")) continue;
		if (f.slice(0, 3) <= version) {
			copyFileSync(join(process.cwd(), "migrations", f), join(dir, f));
		}
	}
	return dir;
}

async function main(): Promise<void> {
	const outDir = join(
		fileURLToPath(new URL(".", import.meta.url)),
		"..",
		"tests",
		"fixtures",
		"schema",
	);
	mkdirSync(outDir, { recursive: true });
	const tmpRoot = join(outDir, ".gen-tmp");
	rmSync(tmpRoot, { recursive: true, force: true });
	mkdirSync(tmpRoot, { recursive: true });
	for (const v of VERSIONS) {
		for (const stale of [`${v}.db`, `${v}.db-wal`, `${v}.db-shm`]) {
			rmSync(join(outDir, `v${stale}`), { force: true });
		}
		const dbPath = join(outDir, `v${v}.db`);
		const store = new Store({ path: dbPath });
		const migrate = new Migrate(store, truncatedMigrationsDir(tmpRoot, v));
		await migrate.run();
		seed(store);
		const row = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		console.log(`v${v}.db -> schema ${row.version}`);
		store.close();
	}
	rmSync(tmpRoot, { recursive: true, force: true });
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);
const SQL_008 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "008_v07_truth.sql"),
	"utf8",
);
const SQL_009 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "009_v08_team.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate009-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function writeAllMigrations(): void {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
	writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
	writeFileSync(join(migrationsDir, "008_v07_truth.sql"), SQL_008);
	writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
}

function writeThrough008(): void {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
	writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
	writeFileSync(join(migrationsDir, "008_v07_truth.sql"), SQL_008);
}

describe("Migration 009 — v0.8.0 Team (K8-001)", () => {
	it("applies 009 after the full chain and registers the version", async () => {
		writeAllMigrations();
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.applied).toEqual([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
		]);
		expect(result.to).toBe("009");
		const row = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		expect(row.version).toBe("009");
	});

	it("is idempotent: a second run reports applied: [] with no duplicated rows", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const metricsBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM kevin_metrics").get() as {
				c: number;
			}
		).c;
		const settingsBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM kevin_settings").get() as {
				c: number;
			}
		).c;
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.to).toBe("009");
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM kevin_metrics").get() as {
					c: number;
				}
			).c,
		).toBe(metricsBefore);
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM kevin_settings").get() as {
					c: number;
				}
			).c,
		).toBe(settingsBefore);
	});

	it("adds repo_id, layer and shared_entry_id to memories, with layer NOT NULL defaulting to 'local' and no CHECK", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const cols = store.prepare("PRAGMA table_info(memories)").all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		const repoId = cols.find((c) => c.name === "repo_id");
		const layer = cols.find((c) => c.name === "layer");
		const sharedEntryId = cols.find((c) => c.name === "shared_entry_id");
		expect(repoId).toBeDefined();
		expect(repoId?.notnull).toBe(0);
		expect(layer).toBeDefined();
		expect(layer?.notnull).toBe(1);
		expect(layer?.dflt_value).toBe("'local'");
		expect(sharedEntryId).toBeDefined();
		// D8-07: no CHECK constraint on layer — the domain is enforced in
		// TypeScript, and a CHECK would force a table rebuild to widen later.
		expect(SQL_009).not.toMatch(/layer\s+TEXT[^)]*CHECK/i);
		const memorySql = (
			store
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'",
				)
				.get() as { sql: string }
		).sql;
		expect(memorySql).not.toMatch(/CHECK.*layer|layer.*CHECK/i);
	});

	it("uq_shared_entries covers (repo_id, entry_id) in that order", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const cols = store
			.prepare("PRAGMA index_info(uq_shared_entries)")
			.all() as { seqno: number; name: string }[];
		expect(cols.sort((a, b) => a.seqno - b.seqno).map((c) => c.name)).toEqual([
			"repo_id",
			"entry_id",
		]);
	});

	it("neither new table carries a REFERENCES clause (D8-12)", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const sharedSql = (
			store
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='shared_entries'",
				)
				.get() as { sql: string }
		).sql;
		const importsSql = (
			store
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='okf_imports'",
				)
				.get() as { sql: string }
		).sql;
		expect(sharedSql).not.toMatch(/REFERENCES/i);
		expect(importsSql).not.toMatch(/REFERENCES/i);
	});

	it("adds exactly 6 metric rows and exactly 5 setting rows", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		const metricsBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM kevin_metrics").get() as {
				c: number;
			}
		).c;
		const settingsBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM kevin_settings").get() as {
				c: number;
			}
		).c;
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		await new Migrate(store, migrationsDir).run();
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM kevin_metrics").get() as {
					c: number;
				}
			).c,
		).toBe(metricsBefore + 6);
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM kevin_settings").get() as {
					c: number;
				}
			).c,
		).toBe(settingsBefore + 5);
	});

	it("seeds the six new metric counters and the five new settings", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const key of [
			"shared_entries_total",
			"shared_entries_imported",
			"shared_entries_exported",
			"okf_merge_folds",
			"rekey_events",
			"injections_from_shared",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(0);
		}
		const settings = store
			.prepare(
				"SELECT key, value FROM kevin_settings WHERE key IN ('shared_layer_enabled', 'okf_path', 'share_requires_approval', 'author_identity_mode', 'shared_confidence_floor') ORDER BY key",
			)
			.all() as { key: string; value: string }[];
		expect(settings).toEqual([
			{ key: "author_identity_mode", value: "hashed" },
			{ key: "okf_path", value: ".kevin/knowledge.okf" },
			{ key: "share_requires_approval", value: "1" },
			{ key: "shared_confidence_floor", value: "0.7" },
			{ key: "shared_layer_enabled", value: "0" },
		]);
	});

	it("a pre-existing v0.7.0 database survives with every row intact and every prior index present", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, status) VALUES ('m1', 'decision', 'keep me', 'project', 'active')",
			)
			.run();
		const priorIndexes = (
			store
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		expect(priorIndexes).toContain("uq_repo_facts");
		expect(priorIndexes).toContain("idx_conflicts_status");
		expect(priorIndexes).toContain("idx_memories_truth_penalty");

		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		await new Migrate(store, migrationsDir).run();

		const m1 = store
			.prepare(
				"SELECT id, type, content, scope, status FROM memories WHERE id = 'm1'",
			)
			.get() as {
			id: string;
			type: string;
			content: string;
			scope: string;
			status: string;
		};
		expect(m1).toEqual({
			id: "m1",
			type: "decision",
			content: "keep me",
			scope: "project",
			status: "active",
		});
		const afterIndexes = (
			store
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		for (const name of priorIndexes) expect(afterIndexes).toContain(name);
	});

	it("shared_entries rejects an out-of-domain type and op via CHECK", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('s1', 'repoA', 'e1', 'decision', 'x', '2026-01-01T00:00:00.000Z')",
			)
			.run();
		expect(() =>
			store
				.prepare(
					"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('s2', 'repoA', 'e2', 'nonsense', 'y', '2026-01-01T00:00:00.000Z')",
				)
				.run(),
		).toThrow();
		expect(() =>
			store
				.prepare(
					"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, op, created_at) VALUES ('s3', 'repoA', 'e3', 'rule', 'z', 'revive', '2026-01-01T00:00:00.000Z')",
				)
				.run(),
		).toThrow();
	});

	it("uq_shared_entries allows the same entry_id under different repo_ids but rejects a duplicate (repo_id, entry_id)", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('a1', 'repoA', 'e1', 'decision', 'x', '2026-01-01T00:00:00.000Z')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('a2', 'repoB', 'e1', 'decision', 'x', '2026-01-01T00:00:00.000Z')",
			)
			.run();
		const count = store
			.prepare("SELECT COUNT(*) AS c FROM shared_entries")
			.get() as { c: number };
		expect(count.c).toBe(2);
		expect(() =>
			store
				.prepare(
					"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('a3', 'repoA', 'e1', 'decision', 'x', '2026-01-01T00:00:00.000Z')",
				)
				.run(),
		).toThrow();
	});

	it("defaults new shared_entries rows and memory layer rows", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('s1', 'repoA', 'e1', 'pattern', 'p', '2026-01-01T00:00:00.000Z')",
			)
			.run();
		const row = store
			.prepare(
				"SELECT confidence, evidence, origin, op, supersedes, imported_at FROM shared_entries WHERE id = 's1'",
			)
			.get() as {
			confidence: number;
			evidence: number;
			origin: string;
			op: string;
			supersedes: string | null;
			imported_at: string;
		};
		expect(row.confidence).toBe(0);
		expect(row.evidence).toBe(0);
		expect(row.origin).toBe("shared");
		expect(row.op).toBe("assert");
		expect(row.supersedes).toBeNull();
		expect(row.imported_at).toBeTruthy();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'x')",
			)
			.run();
		const m1 = store
			.prepare("SELECT layer FROM memories WHERE id = 'm1'")
			.get() as { layer: string };
		expect(m1.layer).toBe("local");
	});

	it("contains no DROP TABLE, no memories rebuild, and no new CHECK on memories", () => {
		expect(SQL_009).not.toMatch(/DROP TABLE/i);
		expect(SQL_009).not.toMatch(/CREATE TABLE memories_new/i);
		expect(SQL_009).not.toMatch(/CREATE TABLE memories_v\d/i);
		expect(SQL_009).not.toMatch(/RENAME TO/i);
	});
});

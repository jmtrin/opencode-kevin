import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(__dirname, "..", "..", "migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(__dirname, "..", "..", "migrations", "007_v06_pull.sql"),
	"utf8",
);
const SQL_008 = readFileSync(
	join(__dirname, "..", "..", "migrations", "008_v07_truth.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate008-"));
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
}

function writeThrough007(): void {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
	writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
}

describe("Migration 008 — v0.7.0 Project Truth (K7-001)", () => {
	it("applies 008 after the full chain and registers the version", async () => {
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
		]);
		expect(result.to).toBe("008");
		const row = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		expect(row.version).toBe("008");
	});

	it("is idempotent: a second run reports applied: []", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.to).toBe("008");
	});

	it("repairs drifted truth counters on a later no-op run", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = 999 WHERE key IN ('repo_facts_scanned', 'conflicts_detected', 'memories_contradicted')",
			)
			.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		const rows = store
			.prepare(
				"SELECT key, value FROM kevin_metrics WHERE key IN ('repo_facts_scanned', 'conflicts_detected', 'memories_contradicted') ORDER BY key",
			)
			.all() as { key: string; value: number }[];
		expect(rows).toEqual([
			{ key: "conflicts_detected", value: 0 },
			{ key: "memories_contradicted", value: 0 },
			{ key: "repo_facts_scanned", value: 0 },
		]);
	});

	it("uq_repo_facts allows two projects to differ only in project_id but rejects a duplicate (project_id, file, key_path)", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		// Two rows differing ONLY in project_id must both succeed.
		store
			.prepare(
				"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('a1', 'projA', 'package.json', 'packageManager', 'npm', 'fp')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('b1', 'projB', 'package.json', 'packageManager', 'pnpm', 'fp')",
			)
			.run();
		const count = store
			.prepare("SELECT COUNT(*) AS c FROM repo_facts")
			.get() as {
			c: number;
		};
		expect(count.c).toBe(2);
		// A duplicate (project_id, file, key_path) must be rejected.
		expect(() =>
			store
				.prepare(
					"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('a2', 'projA', 'package.json', 'packageManager', 'yarn', 'fp2')",
				)
				.run(),
		).toThrow();
		// Same key under a different project still succeeds (the third state).
		store
			.prepare(
				"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('c1', 'projC', 'package.json', 'packageManager', 'yarn', 'fp2')",
			)
			.run();
	});

	it("memory_conflicts rejects an out-of-domain kind and status", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const kind of ["repo_truth", "decision_pair", "temporal"]) {
			store
				.prepare(
					"INSERT INTO memory_conflicts (id, project_id, memory_a, kind) VALUES (?, 'proj', 'm1', ?)",
				)
				.run(`k-${kind}`, kind);
		}
		expect(() =>
			store
				.prepare(
					"INSERT INTO memory_conflicts (id, project_id, memory_a, kind) VALUES ('k-bad', 'proj', 'm1', 'nonsense')",
				)
				.run(),
		).toThrow();
		expect(() =>
			store
				.prepare(
					"INSERT INTO memory_conflicts (id, project_id, memory_a, kind, status) VALUES ('s-bad', 'proj', 'm1', 'temporal', 'bogus')",
				)
				.run(),
		).toThrow();
	});

	it("a pre-existing memory reads truth_penalty === 0 and contradicted_at === null after migration", async () => {
		writeThrough007();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'x')",
			)
			.run();
		writeFileSync(join(migrationsDir, "008_v07_truth.sql"), SQL_008);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT truth_penalty, contradicted_at FROM memories WHERE id = 'm1'",
			)
			.get() as { truth_penalty: number; contradicted_at: string | null };
		expect(row.truth_penalty).toBe(0);
		expect(row.contradicted_at).toBeNull();
	});

	it("error_lesson_mode reads 'all' and the feature flags read '0' on a fresh database", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const settings = store
			.prepare(
				"SELECT key, value FROM kevin_settings WHERE key IN ('repo_truth_enabled', 'convention_mining_enabled', 'conflict_detection_enabled', 'error_lesson_mode') ORDER BY key",
			)
			.all() as { key: string; value: string }[];
		expect(settings).toEqual([
			{ key: "conflict_detection_enabled", value: "0" },
			{ key: "convention_mining_enabled", value: "0" },
			{ key: "error_lesson_mode", value: "all" },
			{ key: "repo_truth_enabled", value: "0" },
		]);
	});

	it("seeds the five new metric counters at zero", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const key of [
			"repo_facts_scanned",
			"memories_contradicted",
			"conventions_mined",
			"conflicts_detected",
			"error_lessons_suppressed",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(0);
		}
	});

	it("contains no DROP TABLE, no memories rebuild, and no origin CHECK redefinition", () => {
		expect(SQL_008).not.toMatch(/DROP TABLE/i);
		expect(SQL_008).not.toMatch(/CREATE TABLE memories_new/i);
		expect(SQL_008).not.toMatch(/CREATE TABLE memories_v\d/i);
		const originRedefinition = SQL_008.match(/origin\s+TEXT[^)]*CHECK/i);
		expect(originRedefinition).toBeNull();
		expect(SQL_008).not.toMatch(/RENAME TO/i);
	});

	it("creates the two repo_facts indexes and the two conflict indexes", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name IN ('uq_repo_facts', 'idx_repo_facts_fp', 'idx_conflicts_status', 'idx_conflicts_memory', 'idx_memories_truth_penalty') ORDER BY name",
			)
			.all() as { name: string }[];
		expect(rows.map((r) => r.name)).toEqual([
			"idx_conflicts_memory",
			"idx_conflicts_status",
			"idx_memories_truth_penalty",
			"idx_repo_facts_fp",
			"uq_repo_facts",
		]);
	});
});

describe("Migration 008 post-apply hook (K7-002)", () => {
	// Pre-build ONLY the two fact/conflict tables (008's DDL shape, minus the
	// memories ALTER columns, metric seeds and version marker) so the hook
	// can be exercised over a drifted store in which 008 is still pending.
	function seedDrift(): void {
		store.exec(`CREATE TABLE IF NOT EXISTS repo_facts (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			file TEXT NOT NULL,
			key_path TEXT NOT NULL,
			value TEXT NOT NULL,
			fingerprint TEXT NOT NULL,
			source_mtime TEXT,
			scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`);
		store.exec(`CREATE TABLE IF NOT EXISTS memory_conflicts (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			memory_a TEXT NOT NULL,
			memory_b TEXT,
			fact_id TEXT,
			kind TEXT NOT NULL CHECK (kind IN ('repo_truth','decision_pair','temporal')),
			detail TEXT,
			status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
			detected_at TEXT NOT NULL DEFAULT (datetime('now')),
			resolved_at TEXT
		);`);
	}

	it("re-derives the three counters from their tables and normalizes NULL truth_penalty", async () => {
		writeThrough007();
		await new Migrate(store, migrationsDir).run();
		// Drifted store: facts exist but the counters were never maintained.
		seedDrift();
		store
			.prepare(
				"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('r1', 'proj', 'package.json', 'scripts.test', 'vitest', 'fp')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memory_conflicts (id, project_id, memory_a, kind) VALUES ('c1', 'proj', 'm1', 'temporal')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'a')",
			)
			.run();
		// Apply 008 from a pending dir: ALTER adds the columns (absent in the
		// drifted store), seeds metrics, and the hook re-derives all three
		// counters from the tables instead of trusting prior values.
		const pendingDir = join(tmpRoot, "pending");
		mkdirSync(pendingDir, { recursive: true });
		writeFileSync(join(pendingDir, "008_v07_truth.sql"), SQL_008);
		const result = await new Migrate(store, pendingDir).run();
		expect(result.applied).toEqual(["008"]);

		const scanned = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'repo_facts_scanned'",
			)
			.get() as { value: number };
		const conflicts = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'conflicts_detected'",
			)
			.get() as { value: number };
		const contradicted = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'memories_contradicted'",
			)
			.get() as { value: number };
		expect(scanned.value).toBe(1);
		expect(conflicts.value).toBe(1);
		expect(contradicted.value).toBe(0); // no memory has truth_penalty > 0
		// The drifted memory reads a clean 0 penalty (never NULL).
		const m1 = store
			.prepare("SELECT truth_penalty FROM memories WHERE id = 'm1'")
			.get() as { truth_penalty: number };
		expect(m1.truth_penalty).toBe(0);
	});

	it("re-deriving the counters heals a deliberately corrupt value", async () => {
		writeThrough007();
		await new Migrate(store, migrationsDir).run();
		// Drift: a fact + a corrupt memories_contradicted counter.
		seedDrift();
		store
			.prepare(
				"INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES ('r1', 'proj', 'package.json', 'scripts.test', 'vitest', 'fp')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO kevin_metrics (key, value) VALUES ('memories_contradicted', 999)",
			)
			.run();
		// Applying 008 re-derives the corrupt counter from the tables.
		const pendingDir = join(tmpRoot, "pending-heal");
		mkdirSync(pendingDir, { recursive: true });
		writeFileSync(join(pendingDir, "008_v07_truth.sql"), SQL_008);
		const migrated = await new Migrate(store, pendingDir).run();
		expect(migrated.applied).toEqual(["008"]);
		const healed = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'memories_contradicted'",
			)
			.get() as { value: number };
		// Zero memories have truth_penalty > 0, so the correct value is 0,
		// not the corrupted 999.
		expect(healed.value).toBe(0);
		// And a second full run is a no-op (idempotency preserved).
		expect((await new Migrate(store, pendingDir).run()).applied).toEqual([]);
	});

	it("no memory's truth_penalty is NULL after the hook", async () => {
		writeThrough007();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'a')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m2', 'decision', 'b')",
			)
			.run();
		writeFileSync(join(migrationsDir, "008_v07_truth.sql"), SQL_008);
		await new Migrate(store, migrationsDir).run();
		const rows = store.prepare("SELECT truth_penalty FROM memories").all() as {
			truth_penalty: number | null;
		}[];
		expect(rows).toHaveLength(2);
		for (const r of rows) expect(r.truth_penalty).toBe(0);
	});
});

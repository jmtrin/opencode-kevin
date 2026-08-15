import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate007-"));
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
}

describe("Migration 007 — v0.6.0 Pull", () => {
	it("applies 007 after the full chain and registers the version", async () => {
		writeAllMigrations();
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.applied).toEqual(["001", "003", "004", "005", "006", "007"]);
		expect(result.to).toBe("007");
		const row = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		expect(row.version).toBe("007");
	});

	it("is idempotent: a second run reports applied: []", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.to).toBe("007");
	});

	it("creates curation_proposals with CHECK constraints on status and kind", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO curation_proposals (id, project_id, memory_id, kind, target_path, proposed_text, diff, status) VALUES ('p1', 'proj', 'm1', 'agents_md', 'AGENTS.md', 'x', '', 'pending')",
			)
			.run();
		expect(() =>
			store
				.prepare(
					"INSERT INTO curation_proposals (id, project_id, memory_id, kind, target_path, proposed_text, diff, status) VALUES ('p2', 'proj', 'm1', 'agents_md', 'AGENTS.md', 'x', '', 'bogus')",
				)
				.run(),
		).toThrow();
		expect(() =>
			store
				.prepare(
					"INSERT INTO curation_proposals (id, project_id, memory_id, kind, target_path, proposed_text, diff, status) VALUES ('p3', 'proj', 'm1', 'nonsense', 'AGENTS.md', 'x', '', 'pending')",
				)
				.run(),
		).toThrow();
	});

	it("creates the three curation_proposals indexes", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_proposals_status', 'idx_proposals_memory', 'idx_proposals_project') ORDER BY name",
			)
			.all() as { name: string }[];
		expect(rows.map((r) => r.name)).toEqual([
			"idx_proposals_memory",
			"idx_proposals_project",
			"idx_proposals_status",
		]);
	});

	it("artifact_writes accepts written/noop/refused and rejects others", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const outcome of ["written", "noop", "refused"]) {
			store
				.prepare(
					"INSERT INTO artifact_writes (id, project_id, path, outcome) VALUES (?, 'proj', 'AGENTS.md', ?)",
				)
				.run(`w-${outcome}`, outcome);
		}
		const count = store
			.prepare("SELECT COUNT(*) AS c FROM artifact_writes")
			.get() as { c: number };
		expect(count.c).toBe(3);
		expect(() =>
			store
				.prepare(
					"INSERT INTO artifact_writes (id, project_id, path, outcome) VALUES ('w-bogus', 'proj', 'AGENTS.md', 'bogus')",
				)
				.run(),
		).toThrow();
	});

	it("adds curated (default 0) and nullable inferable columns to memories", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'x')",
			)
			.run();
		const row = store
			.prepare(
				"SELECT curated, curated_at, inferable FROM memories WHERE id = 'm1'",
			)
			.get() as {
			curated: number;
			curated_at: string | null;
			inferable: number | null;
		};
		expect(row.curated).toBe(0);
		expect(row.curated_at).toBeNull();
		expect(row.inferable).toBeNull();
	});

	it("preserves a user override of 1200 through the budget demotion", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1200' WHERE key = 'pre_prompt_budget_tokens'",
			)
			.run();
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'pre_prompt_budget_tokens'",
			)
			.get() as { value: string };
		expect(row.value).toBe("1200");
	});

	it("demotes only the untouched default of 900 to 400", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		const before = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'pre_prompt_budget_tokens'",
			)
			.get() as { value: string };
		expect(before.value).toBe("900");
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'pre_prompt_budget_tokens'",
			)
			.get() as { value: string };
		expect(row.value).toBe("400");
	});

	it("seeds the five new settings with TEXT values", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare(
				"SELECT key, value FROM kevin_settings WHERE key IN ('curation_enabled', 'agents_md_path', 'skill_emission_enabled', 'reference_emission_enabled', 'injection_confidence_floor') ORDER BY key",
			)
			.all() as { key: string; value: string }[];
		expect(rows).toEqual([
			{ key: "agents_md_path", value: "AGENTS.md" },
			{ key: "curation_enabled", value: "1" },
			{ key: "injection_confidence_floor", value: "0.6" },
			{ key: "reference_emission_enabled", value: "0" },
			{ key: "skill_emission_enabled", value: "0" },
		]);
	});

	it("seeds the six new metric counters at zero", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const key of [
			"proposals_created",
			"proposals_approved",
			"proposals_rejected",
			"artifact_writes_total",
			"artifact_writes_noop",
			"injections_blocked_confidence",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(0);
		}
	});

	it("contains no table rebuild: no DROP TABLE and no RENAME", () => {
		expect(SQL_007).not.toMatch(/DROP TABLE/i);
		expect(SQL_007).not.toMatch(/RENAME TO/i);
	});
});

describe("Migration 007 post-apply hook (K6-002)", () => {
	it("back-fills inferable = 0 for decision/rule/solution/pattern rows", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		for (const [i, type] of ["decision", "decision", "decision"].entries()) {
			store
				.prepare("INSERT INTO memories (id, type, content) VALUES (?, ?, ?)")
				.run(`d${i}`, type, `decision content ${i}`);
		}
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare(
				"SELECT id, inferable FROM memories WHERE type = 'decision' ORDER BY id",
			)
			.all() as { id: string; inferable: number | null }[];
		expect(rows).toHaveLength(3);
		for (const r of rows) expect(r.inferable).toBe(0);
	});

	it("leaves error memories NULL after the hook", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('e1', 'error', 'x')",
			)
			.run();
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare("SELECT inferable FROM memories WHERE id = 'e1'")
			.get() as { inferable: number | null };
		expect(row.inferable).toBeNull();
	});

	it("re-running Migrate.run() never overwrites a non-NULL classification", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, inferable) VALUES ('m1', 'decision', 'x', 1)",
			)
			.run();
		// A second run must not touch the explicitly-set classification.
		await migrate.run();
		const row = store
			.prepare("SELECT inferable FROM memories WHERE id = 'm1'")
			.get() as { inferable: number | null };
		expect(row.inferable).toBe(1);
	});

	it("re-derives proposals_created from the table count", async () => {
		// Partial-application scenario the hook exists to heal: the
		// curation_proposals table already exists with rows (created
		// outside the migration chain) when 007 is applied via Migrate.
		// The hook must re-derive the counter from the table itself.
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		store.exec(
			"CREATE TABLE IF NOT EXISTS curation_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, memory_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('agents_md','skill','reference')), target_path TEXT NOT NULL, proposed_text TEXT NOT NULL, diff TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied','superseded')), created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT, applied_at TEXT)",
		);
		for (let i = 0; i < 3; i++) {
			store
				.prepare(
					"INSERT INTO curation_proposals (id, project_id, memory_id, kind, target_path, proposed_text, diff, status) VALUES (?, 'proj', 'm1', 'agents_md', 'AGENTS.md', 'x', '', 'pending')",
				)
				.run(`p${i}`);
		}
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'proposals_created'",
			)
			.get() as { value: number };
		expect(row.value).toBe(3);
	});
});

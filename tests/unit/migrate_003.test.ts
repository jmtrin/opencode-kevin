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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate003-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function columnExists(table: string, column: string): boolean {
	const row = store
		.prepare("SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?")
		.get(table, column) as { c: number };
	return row.c > 0;
}

function indexExists(name: string): boolean {
	const row = store
		.prepare(
			"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name = ?",
		)
		.get(name) as { c: number };
	return row.c > 0;
}

function tableExists(name: string): boolean {
	const row = store
		.prepare(
			"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name = ?",
		)
		.get(name) as { c: number };
	return row.c > 0;
}

describe("Migration 003 — v0.2.0 Signal Quality", () => {
	it("applies 003 after 001 and registers the version", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toEqual(["001", "003"]);
		expect(result.from).toBe("000");
		expect(result.to).toBe("003");
		const versions = store
			.prepare("SELECT version FROM schema_version ORDER BY version")
			.all() as { version: string }[];
		expect(versions.map((v) => v.version)).toEqual(["001", "003"]);
	});

	it("adds nullable project_id, fingerprint, origin columns to memories", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(columnExists("memories", "project_id")).toBe(true);
		expect(columnExists("memories", "fingerprint")).toBe(true);
		expect(columnExists("memories", "origin")).toBe(true);
	});

	it("adds nullable project_id, fingerprint columns to tool_calls", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(columnExists("tool_calls", "project_id")).toBe(true);
		expect(columnExists("tool_calls", "fingerprint")).toBe(true);
	});

	it("creates the partial UNIQUE index uq_memories_error_fp", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(indexExists("uq_memories_error_fp")).toBe(true);
	});

	it("creates kevin_metrics table seeded with the six counters at zero", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(tableExists("kevin_metrics")).toBe(true);
		const rows = store
			.prepare("SELECT key, value FROM kevin_metrics ORDER BY key")
			.all() as { key: string; value: number }[];
		expect(rows).toEqual([
			{ key: "duplicate_suppressions", value: 0 },
			{ key: "patterns_mined", value: 0 },
			{ key: "reflections_throttled", value: 0 },
			{ key: "tokens_injected_compacting", value: 0 },
			{ key: "tokens_injected_pre_prompt", value: 0 },
			{ key: "tool_calls_deduped", value: 0 },
		]);
	});

	it("creates kevin_settings table seeded with opt-in flags off", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(tableExists("kevin_settings")).toBe(true);
		const rows = store
			.prepare("SELECT key, value FROM kevin_settings ORDER BY key")
			.all() as { key: string; value: string }[];
		expect(rows).toEqual([
			{ key: "patternminer_enabled", value: "0" },
			{ key: "tool_calls_dedup_enabled", value: "0" },
		]);
	});

	it("backfills origin='agent' for legacy memories via the DEFAULT", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		await new Migrate(store, migrationsDir).run();
		// Insert a legacy memory before 003 is applied (no origin column yet).
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m-legacy', 'error', 'legacy error')",
			)
			.run();
		// Now apply 003.
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare("SELECT origin FROM memories WHERE id = 'm-legacy'")
			.get() as { origin: string };
		expect(row.origin).toBe("agent");
	});

	it("enforces the origin CHECK constraint on new writes", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		expect(() =>
			store
				.prepare(
					"INSERT INTO memories (id, type, content, origin) VALUES ('m-bad', 'error', 'x', 'bogus')",
				)
				.run(),
		).toThrow();
		// Valid origin values accepted.
		for (const origin of ["reflector", "agent", "pattern", "retrospective"]) {
			store
				.prepare(
					"INSERT INTO memories (id, type, content, origin) VALUES (?, 'error', 'x', ?)",
				)
				.run(`m-${origin}`, origin);
		}
		const count = store
			.prepare(
				"SELECT COUNT(*) AS c FROM memories WHERE origin IN ('reflector','agent','pattern','retrospective')",
			)
			.get() as { c: number };
		expect(count.c).toBe(4);
	});

	it("dedups reflector-sourced error memories via the partial UNIQUE index", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		// First reflector error for (proj-A, fp-1) succeeds.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m1', 'error', 'x', 'proj-A', 'fp-1', 'reflector')",
			)
			.run();
		// Second reflector error for the same (proj-A, fp-1) violates UNIQUE.
		expect(() =>
			store
				.prepare(
					"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m2', 'error', 'x', 'proj-A', 'fp-1', 'reflector')",
				)
				.run(),
		).toThrow();
		// Same fingerprint in a different project is allowed.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m3', 'error', 'x', 'proj-B', 'fp-1', 'reflector')",
			)
			.run();
		// Same fingerprint in the same project but a different origin ('agent') is allowed.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m4', 'error', 'x', 'proj-A', 'fp-1', 'agent')",
			)
			.run();
		// NULL fingerprint never collides.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m5', 'error', 'x', 'proj-A', NULL, 'reflector')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m6', 'error', 'x', 'proj-A', NULL, 'reflector')",
			)
			.run();
		// Non-error types ignore the index even with same fingerprint.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES ('m7', 'pattern', 'x', 'proj-A', 'fp-1', 'reflector')",
			)
			.run();
		const count = store.prepare("SELECT COUNT(*) AS c FROM memories").get() as {
			c: number;
		};
		// 6 successful inserts: m1, m3, m4, m5, m6, m7 (m2 throws on UNIQUE).
		expect(count.c).toBe(6);
	});

	it("does not run 003 if schema_version already has '003'", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.from).toBe("003");
		expect(second.to).toBe("003");
	});
});

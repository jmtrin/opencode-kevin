import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate005-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
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
}

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

describe("Migration 005 — v0.4.0 Signal over Noise", () => {
	it("applies 005 after 001/003/004 and registers the version", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toEqual(["001", "003", "004", "005"]);
		expect(result.from).toBe("000");
		expect(result.to).toBe("005");
		const versions = store
			.prepare("SELECT version FROM schema_version ORDER BY version")
			.all() as { version: string }[];
		expect(versions.map((v) => v.version)).toEqual([
			"001",
			"003",
			"004",
			"005",
		]);
	});

	it("adds recurrence_count, fix_args, last_injected_at to memories", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		expect(columnExists("memories", "recurrence_count")).toBe(true);
		expect(columnExists("memories", "fix_args")).toBe(true);
		expect(columnExists("memories", "last_injected_at")).toBe(true);
	});

	it("legacy rows default recurrence_count=0, fix_args=NULL, last_injected_at=NULL", async () => {
		// Apply up to 004, insert a legacy memory, then apply 005.
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m-legacy', 'error', 'boom')",
			)
			.run();
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT recurrence_count, fix_args, last_injected_at FROM memories WHERE id = 'm-legacy'",
			)
			.get() as {
			recurrence_count: number;
			fix_args: string | null;
			last_injected_at: string | null;
		};
		expect(row.recurrence_count).toBe(0);
		expect(row.fix_args).toBeNull();
		expect(row.last_injected_at).toBeNull();
	});

	it("creates kevin_injections with CHECK constraints and outcome default", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		expect(tableExists("kevin_injections")).toBe(true);
		// Default outcome is 'unmeasured'.
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens) VALUES ('i1', 'm1', 'fp1', 's1', 'pre_prompt', 10)",
			)
			.run();
		const row = store
			.prepare("SELECT outcome FROM kevin_injections WHERE id = 'i1'")
			.get() as { outcome: string };
		expect(row.outcome).toBe("unmeasured");
		// Invalid hook rejected.
		expect(() =>
			store
				.prepare(
					"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens) VALUES ('i2', 'm1', 'fp1', 's1', 'bogus', 10)",
				)
				.run(),
		).toThrow();
		// Invalid outcome rejected.
		expect(() =>
			store
				.prepare(
					"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('i3', 'm1', 'fp1', 's1', 'pre_prompt', 10, 'bogus')",
				)
				.run(),
		).toThrow();
	});

	it("creates the three kevin_injections indexes", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		expect(indexExists("idx_injections_fp")).toBe(true);
		expect(indexExists("idx_injections_session")).toBe(true);
		expect(indexExists("idx_injections_outcome")).toBe(true);
	});

	it("seeds the four new metric counters at zero", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const key of [
			"injections_total",
			"injections_effective",
			"injections_ineffective",
			"patterns_promoted_new",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(0);
		}
	});

	it("seeds the two new settings", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const [key, value] of [
			["quality_gate_enabled", "1"],
			["lesson_snippet_injection", "1"],
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_settings WHERE key = ?")
				.get(key) as { value: string } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(value);
		}
	});

	it("is idempotent: second run applies nothing and does not duplicate seeds", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.from).toBe("005");
		expect(second.to).toBe("005");
		const metricsCount = store
			.prepare(
				"SELECT COUNT(*) AS c FROM kevin_metrics WHERE key = 'injections_total'",
			)
			.get() as { c: number };
		expect(metricsCount.c).toBe(1);
		const settingsCount = store
			.prepare(
				"SELECT COUNT(*) AS c FROM kevin_settings WHERE key = 'quality_gate_enabled'",
			)
			.get() as { c: number };
		expect(settingsCount.c).toBe(1);
	});
});

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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate006-"));
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
}

function columnInfo(
	table: string,
	column: string,
): {
	type: string;
	dflt_value: string | null;
	notnull: number;
} | null {
	const row = store
		.prepare(
			'SELECT type, dflt_value, "notnull" FROM pragma_table_info(?) WHERE name = ?',
		)
		.get(table, column) as
		| { type: string; dflt_value: string | null; notnull: number }
		| undefined;
	return row ?? null;
}

describe("Migration 006 — v0.5.0 Glass Box", () => {
	it("applies 006 after 001/003/004/005 and registers the version", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toEqual(["001", "003", "004", "005", "006"]);
		expect(result.from).toBe("000");
		expect(result.to).toBe("006");
	});

	it("is idempotent: a second run reports applied: []", async () => {
		writeAllMigrations();
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.to).toBe("006");
	});

	it("adds the five new memories columns with stated types and defaults", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const feedbackPositive = columnInfo("memories", "feedback_positive");
		expect(feedbackPositive).toMatchObject({
			type: "INTEGER",
			dflt_value: "0",
			notnull: 1,
		});
		const feedbackNegative = columnInfo("memories", "feedback_negative");
		expect(feedbackNegative).toMatchObject({
			type: "INTEGER",
			dflt_value: "0",
			notnull: 1,
		});
		const ignored = columnInfo("memories", "ignored");
		expect(ignored).toMatchObject({
			type: "INTEGER",
			dflt_value: "0",
			notnull: 1,
		});
		const supersededBy = columnInfo("memories", "superseded_by");
		expect(supersededBy).toMatchObject({
			type: "TEXT",
			dflt_value: null,
			notnull: 0,
		});
		const archivedAt = columnInfo("memories", "archived_at");
		expect(archivedAt).toMatchObject({
			type: "TEXT",
			dflt_value: null,
			notnull: 0,
		});
	});

	it("accepts outcome='inconclusive' and rejects outcome='bogus'", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('i1', 'm1', 'fp1', 's1', 'pre_prompt', 10, 'inconclusive')",
			)
			.run();
		const row = store
			.prepare("SELECT outcome FROM kevin_injections WHERE id = 'i1'")
			.get() as { outcome: string };
		expect(row.outcome).toBe("inconclusive");
		expect(() =>
			store
				.prepare(
					"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('i2', 'm1', 'fp1', 's1', 'pre_prompt', 10, 'bogus')",
				)
				.run(),
		).toThrow();
	});

	it("remaps prior effective rows to inconclusive with zero row loss", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('a', 'm1', 'fp1', 's1', 'pre_prompt', 10, 'effective'), ('b', 'm2', 'fp2', 's1', 'pre_prompt', 10, 'ineffective'), ('c', 'm3', 'fp3', 's1', 'pre_prompt', 10, 'unmeasured')",
			)
			.run();
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare("SELECT id, outcome FROM kevin_injections ORDER BY id")
			.all() as { id: string; outcome: string }[];
		expect(rows).toHaveLength(3);
		const byId = new Map(rows.map((r) => [r.id, r.outcome]));
		expect(byId.get("a")).toBe("inconclusive");
		expect(byId.get("b")).toBe("ineffective");
		expect(byId.get("c")).toBe("unmeasured");
	});

	it("seeds the three new settings", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare(
				"SELECT COUNT(*) AS c FROM kevin_settings WHERE key IN ('deterministic_retrieval', 'pre_prompt_budget_tokens', 'archive_after_days')",
			)
			.get() as { c: number };
		expect(row.c).toBe(3);
	});

	it("creates memory_feedback with verdict CHECK and its indexes", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memory_feedback (id, memory_id, verdict) VALUES ('f1', 'm1', 'useful')",
			)
			.run();
		expect(() =>
			store
				.prepare(
					"INSERT INTO memory_feedback (id, memory_id, verdict) VALUES ('f2', 'm1', 'bogus')",
				)
				.run(),
		).toThrow();
		const idxRows = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_feedback_memory', 'idx_feedback_created', 'idx_memories_ignored', 'idx_memories_archived') ORDER BY name",
			)
			.all() as { name: string }[];
		expect(idxRows.map((r) => r.name)).toEqual([
			"idx_feedback_created",
			"idx_feedback_memory",
			"idx_memories_archived",
			"idx_memories_ignored",
		]);
	});

	it("seeds the nine new metric counters at zero", async () => {
		writeAllMigrations();
		await new Migrate(store, migrationsDir).run();
		for (const key of [
			"injections_inconclusive",
			"injections_blocked_seen",
			"injections_blocked_weak",
			"injections_blocked_recurrence",
			"injections_blocked_stale",
			"injections_blocked_ignored",
			"feedback_positive_total",
			"feedback_negative_total",
			"memories_archived",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.value).toBe(0);
		}
	});
});

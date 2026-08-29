import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate009hook-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function writeThrough008(): void {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
	writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
	writeFileSync(join(migrationsDir, "008_v07_truth.sql"), SQL_008);
}

function memoryRows(): {
	id: string;
	project_id: string | null;
	repo_id: string | null;
	layer: string;
}[] {
	return store
		.prepare("SELECT id, project_id, repo_id, layer FROM memories ORDER BY id")
		.all() as {
		id: string;
		project_id: string | null;
		repo_id: string | null;
		layer: string;
	}[];
}

describe("Migration 009 post-apply hook (K8-002)", () => {
	it("back-fills repo_id = project_id so no row is left NULL, and layer defaults to 'local'", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id) VALUES ('m1', 'error', 'a', 'projA')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id) VALUES ('m2', 'decision', 'b', 'projB')",
			)
			.run();
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.applied).toEqual(["009"]);
		expect(memoryRows()).toEqual([
			{ id: "m1", project_id: "projA", repo_id: "projA", layer: "local" },
			{ id: "m2", project_id: "projB", repo_id: "projB", layer: "local" },
		]);
		expect(
			(
				store
					.prepare("SELECT COUNT(*) AS c FROM memories WHERE repo_id IS NULL")
					.get() as { c: number }
			).c,
		).toBe(0);
	});

	it("a row whose project_id is NULL keeps repo_id NULL — the hook never fakes a value", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'a')",
			)
			.run();
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		await new Migrate(store, migrationsDir).run();
		expect(memoryRows()).toEqual([
			{ id: "m1", project_id: null, repo_id: null, layer: "local" },
		]);
	});

	it("running the hook a second time changes no row and no metric value", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id) VALUES ('m1', 'error', 'a', 'projA')",
			)
			.run();
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		await new Migrate(store, migrationsDir).run();
		const before = memoryRows();
		const totalBefore = (
			store
				.prepare(
					"SELECT value FROM kevin_metrics WHERE key = 'shared_entries_total'",
				)
				.get() as { value: number }
		).value;
		const second = await new Migrate(store, migrationsDir).run();
		expect(second.applied).toEqual([]);
		expect(memoryRows()).toEqual(before);
		expect(
			(
				store
					.prepare(
						"SELECT value FROM kevin_metrics WHERE key = 'shared_entries_total'",
					)
					.get() as { value: number }
			).value,
		).toBe(totalBefore);
	});

	it("shared_entries_total is re-derived from COUNT(*) on a no-op startup, healing drift", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		// Fresh migration: the counter equals the empty table.
		expect(
			(
				store
					.prepare(
						"SELECT value FROM kevin_metrics WHERE key = 'shared_entries_total'",
					)
					.get() as { value: number }
			).value,
		).toBe(0);
		// Drift: rows exist but the counter was corrupted.
		store
			.prepare(
				"INSERT INTO shared_entries (id, repo_id, entry_id, type, statement, created_at) VALUES ('s1', 'repoA', 'e1', 'rule', 'x', '2026-01-01T00:00:00.000Z')",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = 999 WHERE key = 'shared_entries_total'",
			)
			.run();
		const noop = await migrate.run();
		expect(noop.applied).toEqual([]);
		const healed = (
			store
				.prepare(
					"SELECT value FROM kevin_metrics WHERE key = 'shared_entries_total'",
				)
				.get() as { value: number }
		).value;
		expect(healed).toBe(1);
		// And a further run is still a no-op (idempotency preserved).
		await migrate.run();
		expect(
			(
				store
					.prepare(
						"SELECT value FROM kevin_metrics WHERE key = 'shared_entries_total'",
					)
					.get() as { value: number }
			).value,
		).toBe(1);
	});

	it("performs no filesystem access — applies with cwd pointed at a non-existent directory", async () => {
		writeThrough008();
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id) VALUES ('m1', 'error', 'a', 'projA')",
			)
			.run();
		const ghost = join(tmpRoot, "does-not-exist");
		vi.spyOn(process, "cwd").mockReturnValue(ghost);
		writeFileSync(join(migrationsDir, "009_v08_team.sql"), SQL_009);
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.applied).toEqual(["009"]);
		expect(memoryRows()).toEqual([
			{ id: "m1", project_id: "projA", repo_id: "projA", layer: "local" },
		]);
	});
});

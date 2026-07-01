import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Migrate", () => {
	it("creates schema_version table if it does not exist", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const row = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
			)
			.get();
		expect(row).toBeDefined();
	});

	it("applies pending migrations in order and seeds version", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toEqual(["001"]);
		expect(result.from).toBe("000");
		expect(result.to).toBe("001");
	});

	it("is idempotent when all migrations already applied", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.from).toBe("001");
		expect(second.to).toBe("001");
	});

	it("correctly reports applied list returned as 001", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toEqual(["001"]);
	});

	it("creates all expected tables from the initial schema", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const tables = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		expect(names).toContain("memories");
		expect(names).toContain("memories_fts");
		expect(names).toContain("tool_calls");
		expect(names).toContain("retrospectives");
		expect(names).toContain("schema_version");
	});

	it("FTS5 keeps memories_fts in sync with memories via triggers", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m1', 'error', 'autenticación fallida')",
			)
			.run();
		const fts = store
			.prepare(
				"SELECT content FROM memories_fts WHERE memories_fts MATCH 'autenticacion'",
			)
			.get() as { content: string } | undefined;
		expect(fts?.content).toContain("autenticación");
		store.prepare("DELETE FROM memories WHERE id = 'm1'").run();
		const after = store
			.prepare("SELECT COUNT(*) as c FROM memories_fts")
			.get() as { c: number };
		expect(after.c).toBe(0);
	});

	it("rolls back the whole migration if it fails", async () => {
		const badSql = "CREATE TABLE broken (x);\nTHIS IS NOT SQL;";
		writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
		writeFileSync(join(migrationsDir, "002_bad.sql"), badSql);
		const migrate = new Migrate(store, migrationsDir);
		await expect(migrate.run()).rejects.toThrow();
		const versions = store
			.prepare("SELECT version FROM schema_version ORDER BY version")
			.all() as { version: string }[];
		expect(versions.map((v) => v.version)).toEqual(["001"]);
	});
});

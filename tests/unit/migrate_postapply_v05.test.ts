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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate-pa05-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

async function applyUpTo004(): Promise<void> {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	await new Migrate(store, migrationsDir).run();
}

describe("Migrate post-apply hook 005", () => {
	it("backfills recurrence_count to 0 for legacy rows", async () => {
		await applyUpTo004();
		// A v0.3-era memory: no recurrence_count column yet.
		store
			.prepare(
				"INSERT INTO memories (id, type, content, fingerprint, origin) VALUES ('m-legacy', 'error', 'boom', 'fp-1', 'reflector')",
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

	it("leaves existing recurrence_count values untouched", async () => {
		await applyUpTo004();
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, recurrence_count) VALUES ('m-new', 'error', 'x', 3)",
			)
			.run();
		// Re-run: migration 005 already applied, but the hook must not fire
		// again (idempotency), and the value stays 3.
		const second = await new Migrate(store, migrationsDir).run();
		expect(second.applied).toEqual([]);
		const row = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = 'm-new'")
			.get() as { recurrence_count: number };
		expect(row.recurrence_count).toBe(3);
	});

	it("runs inside the migration transaction (hook failure rolls back 005)", async () => {
		await applyUpTo004();
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		const migrate = new Migrate(store, migrationsDir);
		migrate.registerPostApply("005", () => {
			throw new Error("hook failed");
		});
		await expect(migrate.run()).rejects.toThrow("hook failed");
		const versions = store
			.prepare("SELECT version FROM schema_version ORDER BY version")
			.all() as { version: string }[];
		expect(versions.map((v) => v.version)).toEqual(["001", "003", "004"]);
		// The kevin_injections table from 005 must be rolled back too.
		const rows = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='kevin_injections'",
			)
			.get() as { c: number };
		expect(rows.c).toBe(0);
	});
});

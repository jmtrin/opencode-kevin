import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOOK_NAMES, Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

// v0.9.0 (K9-001 / plan §6.1, D9-08) — every migration SQL read from disk,
// so the chain under test is exactly what ships.
const MIGRATION_FILES: Record<string, string> = {
	"001": "001_initial.sql",
	"003": "003_v02_signal.sql",
	"004": "004_v03_knowledge.sql",
	"005": "005_v04_signal.sql",
	"006": "006_v05_glassbox.sql",
	"007": "007_v06_pull.sql",
	"008": "008_v07_truth.sql",
	"009": "009_v08_team.sql",
	"010": "010_v09_native.sql",
};
const ALL_SQL = Object.fromEntries(
	Object.entries(MIGRATION_FILES).map(([version, file]) => [
		version,
		readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
	]),
) as Record<string, string>;

let tmpRoot: string;
let migrationsDir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate010-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	// Task.md §2: migration tests use a temp FILE, never :memory:, so the
	// real file-backed migration path is what is exercised.
	dbPath = join(tmpRoot, "kevin.db");
	store = new Store({ path: dbPath });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function writeMigrations(versions: string[]): void {
	for (const version of versions) {
		writeFileSync(
			join(migrationsDir, MIGRATION_FILES[version]),
			ALL_SQL[version],
		);
	}
}

describe("Migration 010 — v0.9.0 Native (K9-001)", () => {
	it("applies 010 after the full chain and registers the version", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
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
			"010",
		]);
		expect(result.to).toBe("010");
		const row = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		expect(row.version).toBe("010");
		const rows = store
			.prepare("SELECT COUNT(*) AS c FROM schema_version")
			.get() as {
			c: number;
		};
		expect(rows.c).toBe(9);
	});

	it("is idempotent: a second run reports applied: [] with no duplicated rows", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const hooksBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM hook_liveness").get() as {
				c: number;
			}
		).c;
		const probesBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM host_probes").get() as {
				c: number;
			}
		).c;
		const registrationsBefore = (
			store.prepare("SELECT COUNT(*) AS c FROM native_registrations").get() as {
				c: number;
			}
		).c;
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.to).toBe("010");
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM hook_liveness").get() as {
					c: number;
				}
			).c,
		).toBe(hooksBefore);
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM host_probes").get() as {
					c: number;
				}
			).c,
		).toBe(probesBefore);
		expect(
			(
				store
					.prepare("SELECT COUNT(*) AS c FROM native_registrations")
					.get() as {
					c: number;
				}
			).c,
		).toBe(registrationsBefore);
	});

	it("creates the three tables and four indices, with no foreign keys", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		await new Migrate(store, migrationsDir).run();
		const tables = (
			store
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hook_liveness', 'host_probes', 'native_registrations') ORDER BY name",
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		expect(tables).toEqual([
			"hook_liveness",
			"host_probes",
			"native_registrations",
		]);
		const indexes = (
			store
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_hook_liveness_dead', 'idx_host_probes_at', 'idx_native_registrations_surface') ORDER BY name",
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		expect(indexes).toEqual([
			"idx_hook_liveness_dead",
			"idx_host_probes_at",
			"idx_native_registrations_surface",
		]);
		// D9-08 + Task.md §2: none of the three new tables declares a
		// REFERENCES clause, so PRAGMA foreign_key_list is empty for each.
		for (const table of tables) {
			const fks = store.prepare(`PRAGMA foreign_key_list(${table})`).all();
			expect(fks).toEqual([]);
		}
	});

	it("seeds exactly one hook_liveness row per HookName, with experimental = 1 only for the two experimental.* hooks", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		await new Migrate(store, migrationsDir).run();
		const rows = store
			.prepare(
				"SELECT hook, experimental, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since, plugin_version FROM hook_liveness ORDER BY hook",
			)
			.all() as {
			hook: string;
			experimental: number;
			fire_count: number;
			error_count: number;
			expected_count: number;
			first_seen_at: string | null;
			last_seen_at: string | null;
			dead_since: string | null;
			plugin_version: string | null;
		}[];
		expect(rows.map((r) => r.hook)).toEqual([...HOOK_NAMES].sort());
		for (const row of rows) {
			const experimental = row.hook.startsWith("experimental.") ? 1 : 0;
			expect(row.experimental).toBe(experimental);
			expect(row.fire_count).toBe(0);
			expect(row.error_count).toBe(0);
			expect(row.expected_count).toBe(0);
			expect(row.first_seen_at).toBeNull();
			expect(row.last_seen_at).toBeNull();
			expect(row.dead_since).toBeNull();
			expect(row.plugin_version).toBeNull();
		}
		const experimentalRows = rows.filter((r) => r.experimental === 1);
		expect(experimentalRows.map((r) => r.hook)).toEqual([
			"experimental.chat.system.transform",
			"experimental.session.compacting",
		]);
	});

	it("seeds the six new metric counters and the four new settings, without overwriting existing values", async () => {
		writeMigrations(["001", "003", "004", "005", "006", "007", "008", "009"]);
		await new Migrate(store, migrationsDir).run();
		// Pre-existing values must survive the 010 seeds untouched: INSERT
		// OR IGNORE never overwrites. The keys do not exist yet, so plain
		// INSERTs simulate values that predate the migration (a counter
		// restored from backup, a hand-set threshold).
		const metricKeys = [
			"hook_fires_total",
			"hook_errors_total",
			"hooks_dead_total",
			"injections_suppressed_dead_hook",
			"native_registrations_total",
			"native_registration_failures",
		];
		const seedMetric = store.prepare(
			"INSERT INTO kevin_metrics (key, value) VALUES (?, 42)",
		);
		for (const key of metricKeys) seedMetric.run(key);
		store
			.prepare(
				"INSERT INTO kevin_settings (key, value) VALUES ('dead_hook_report_threshold', '7')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO kevin_settings (key, value) VALUES ('hook_liveness_enabled', '0')",
			)
			.run();
		writeMigrations(["010"]);
		await new Migrate(store, migrationsDir).run();
		for (const key of metricKeys) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row).toBeDefined();
			// hooks_dead_total is re-derived from hook_liveness by the
			// post-apply hook (plan §6.1 step 2), so 42 is overwritten
			// there by design — every other seed leaves 42 untouched.
			expect(row?.value).toBe(key === "hooks_dead_total" ? 0 : 42);
		}
		const settings = store
			.prepare(
				"SELECT key, value FROM kevin_settings WHERE key IN ('hook_liveness_enabled', 'native_registration_enabled', 'host_probe_history_enabled', 'dead_hook_report_threshold') ORDER BY key",
			)
			.all() as { key: string; value: string }[];
		expect(settings).toEqual([
			{ key: "dead_hook_report_threshold", value: "7" },
			{ key: "hook_liveness_enabled", value: "0" },
			{ key: "host_probe_history_enabled", value: "0" },
			{ key: "native_registration_enabled", value: "0" },
		]);
	});

	it("seeds the six counters at zero and the four settings at their defaults on a fresh database", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		await new Migrate(store, migrationsDir).run();
		const metrics = store
			.prepare(
				"SELECT key, value FROM kevin_metrics WHERE key IN ('hook_fires_total', 'hook_errors_total', 'hooks_dead_total', 'injections_suppressed_dead_hook', 'native_registrations_total', 'native_registration_failures') ORDER BY key",
			)
			.all() as { key: string; value: number }[];
		expect(metrics).toEqual([
			{ key: "hook_errors_total", value: 0 },
			{ key: "hook_fires_total", value: 0 },
			{ key: "hooks_dead_total", value: 0 },
			{ key: "injections_suppressed_dead_hook", value: 0 },
			{ key: "native_registration_failures", value: 0 },
			{ key: "native_registrations_total", value: 0 },
		]);
		const settings = store
			.prepare(
				"SELECT key, value FROM kevin_settings WHERE key IN ('hook_liveness_enabled', 'native_registration_enabled', 'host_probe_history_enabled', 'dead_hook_report_threshold') ORDER BY key",
			)
			.all() as { key: string; value: string }[];
		expect(settings).toEqual([
			{ key: "dead_hook_report_threshold", value: "3" },
			{ key: "hook_liveness_enabled", value: "1" },
			{ key: "host_probe_history_enabled", value: "0" },
			{ key: "native_registration_enabled", value: "0" },
		]);
	});

	it("migrates a v0.8.0 database forward without touching memories", async () => {
		writeMigrations(["001", "003", "004", "005", "006", "007", "008", "009"]);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, status) VALUES ('m1', 'decision', 'keep me', 'project', 'active')",
			)
			.run();
		const colsBefore = (
			store.prepare("PRAGMA table_info(memories)").all() as { name: string }[]
		).map((c) => c.name);
		writeMigrations(["010"]);
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
		const colsAfter = (
			store.prepare("PRAGMA table_info(memories)").all() as { name: string }[]
		).map((c) => c.name);
		expect(colsAfter).toEqual(colsBefore);
	});

	it("contains no ALTER TABLE, no REFERENCES and no DROP (additive-only, D9-08)", async () => {
		const sql = ALL_SQL["010"];
		expect(sql).not.toMatch(/ALTER TABLE/i);
		expect(sql).not.toMatch(/REFERENCES/i);
		expect(sql).not.toMatch(/DROP TABLE/i);
		expect(sql).not.toMatch(/RENAME TO/i);
		// D9-08: hook_liveness carries no project_id or repo_id column.
		expect(sql).not.toMatch(/project_id/i);
		expect(sql).not.toMatch(/repo_id/i);
	});

	it("native_registrations.surface rejects values outside skill/reference via CHECK", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO native_registrations (id, surface) VALUES ('r1', 'skill')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO native_registrations (id, surface) VALUES ('r2', 'reference')",
			)
			.run();
		expect(() =>
			store
				.prepare(
					"INSERT INTO native_registrations (id, surface) VALUES ('r3', 'agent')",
				)
				.run(),
		).toThrow();
	});

	it("a no-op startup repairs drift: dead_since-derived metric and experimental flags", async () => {
		writeMigrations([
			"001",
			"003",
			"004",
			"005",
			"006",
			"007",
			"008",
			"009",
			"010",
		]);
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		// Simulate a crash between DDL and hook, or hand-edited rows.
		store
			.prepare(
				"UPDATE hook_liveness SET dead_since = '2026-01-01T00:00:00.000Z' WHERE hook = 'experimental.chat.system.transform'",
			)
			.run();
		store
			.prepare(
				"UPDATE kevin_metrics SET value = 0 WHERE key = 'hooks_dead_total'",
			)
			.run();
		store
			.prepare("UPDATE hook_liveness SET experimental = 0 WHERE hook = 'event'")
			.run();
		store
			.prepare(
				"UPDATE hook_liveness SET experimental = 1 WHERE hook = 'chat.message'",
			)
			.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		const dead = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'hooks_dead_total'")
			.get() as { value: number };
		expect(dead.value).toBe(1);
		const rows = store
			.prepare("SELECT hook, experimental FROM hook_liveness ORDER BY hook")
			.all() as { hook: string; experimental: number }[];
		for (const row of rows) {
			expect(row.experimental).toBe(
				row.hook.startsWith("experimental.") ? 1 : 0,
			);
		}
	});
});

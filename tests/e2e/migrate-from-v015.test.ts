import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { uuidv7 } from "../../plugin/uuid.js";

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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate-bc-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("migrate-from-v0.1.5 — backward compat (K2-029)", () => {
	function createV015Db() {
		// Simulate a v0.1.5 DB — only 001_initial.sql applied.
		store.exec("CREATE TABLE schema_version (version TEXT PRIMARY KEY);");
		store.exec(SQL_001);
		// 001_initial.sql already inserts '001' into schema_version at the bottom.
	}

	function insertLegacyMemory() {
		const id = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, source_tool, source_session, metadata, expires_at)
                  VALUES (?, 'error', 'When bash fails with typecheck: cannot find foo', 'project', 0.5, 'bash', 'sess-legacy', '{}', NULL)`,
			)
			.run(id);
		return id;
	}

	function insertLegacyToolCall(sessId: string) {
		const id = uuidv7();
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata)
                  VALUES (?, ?, datetime('now'), 'bash', 'command: tsc', 0, 320, null, 'typecheck', '{}')`,
			)
			.run(id, sessId);
		return id;
	}

	it("applies migration 003 over a v0.1.5 DB and legacy rows remain queryable", async () => {
		createV015Db();
		const memId = insertLegacyMemory();
		const tcId = insertLegacyToolCall("sess-legacy");

		// Apply 003
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			`
-- PLACEHOLDER: already applied
CREATE TABLE IF NOT EXISTS _001_already_applied_ (id INTEGER);
`,
		);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);

		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toContain("003");

		// Legacy rows still queryable
		const mem = store
			.prepare(
				"SELECT id, type, content, scope, origin, project_id, fingerprint FROM memories WHERE id = ?",
			)
			.get(memId) as Record<string, unknown>;
		expect(mem.id).toBe(memId);
		expect(mem.type).toBe("error");
		expect(mem.scope).toBe("project");
		expect(mem.origin).toBe("agent"); // DEFAULT from migration 003
		expect(mem.project_id).toBeNull();
		expect(mem.fingerprint).toBeNull();

		const tc = store
			.prepare(
				"SELECT id, tool, session_id, project_id, fingerprint FROM tool_calls WHERE id = ?",
			)
			.get(tcId) as Record<string, unknown>;
		expect(tc.id).toBe(tcId);
		expect(tc.tool).toBe("bash");
		expect(tc.project_id).toBeNull();
		expect(tc.fingerprint).toBeNull();
	});

	it("rerunning migration 003 over a v0.1.5 DB is a no-op", async () => {
		createV015Db();
		insertLegacyMemory();

		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);

		const migrate = new Migrate(store, migrationsDir);
		const first = await migrate.run();
		expect(first.applied).toContain("003");

		// Re-run
		const second = await migrate.run();
		// After the first run, both 001 and 003 are in schema_version; re-run applies none
		expect(second.applied.length).toBe(0);

		// Table structure still intact
		const hasMetrics = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='kevin_metrics'",
			)
			.get() as { c: number };
		expect(hasMetrics.c).toBe(1);

		const hasSettings = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='kevin_settings'",
			)
			.get() as { c: number };
		expect(hasSettings.c).toBe(1);

		// Legacy memory still accessible
		const count = store.prepare("SELECT COUNT(*) AS c FROM memories").get() as {
			c: number;
		};
		expect(count.c).toBe(1);
	});

	it("new memories written after migration 003 include fingerprint (v0.2.0 path)", async () => {
		createV015Db();

		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);

		await new Migrate(store, migrationsDir).run();

		// Now write a new memory post-migration — columns exist and can be used
		const fpId = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, source_tool, source_session, metadata, expires_at, project_id, fingerprint, origin)
                  VALUES (?, 'error', 'EADDRINUSE port 3000', 'project', 0.7, 'bash', 'sess-new', '{}', NULL, 'proj-A', 'deadbeefdeadbeef', 'reflector')`,
			)
			.run(fpId);

		const mem = store
			.prepare(
				"SELECT id, project_id, fingerprint, origin FROM memories WHERE id = ?",
			)
			.get(fpId) as Record<string, unknown>;
		expect(mem.id).toBe(fpId);
		expect(mem.project_id).toBe("proj-A");
		expect(mem.fingerprint).toBe("deadbeefdeadbeef");
		expect(mem.origin).toBe("reflector");
	});

	it("partial unique index uq_memories_error_fp exists after migration 003 over v0.1.5", async () => {
		createV015Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();

		const idx = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='uq_memories_error_fp'",
			)
			.get() as { c: number };
		expect(idx.c).toBe(1);
	});

	it("kevin_metrics and kevin_settings tables are seeded after migration 003 over v0.1.5", async () => {
		createV015Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();

		const metricsCount = store
			.prepare("SELECT COUNT(*) AS c FROM kevin_metrics")
			.get() as { c: number };
		expect(metricsCount.c).toBe(6);

		const settingsCount = store
			.prepare("SELECT COUNT(*) AS c FROM kevin_settings")
			.get() as { c: number };
		expect(settingsCount.c).toBe(2);

		// Verify specific keys
		const pm = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'patternminer_enabled'",
			)
			.get() as { value: string };
		expect(pm.value).toBe("0");

		const dedupFlag = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'tool_calls_dedup_enabled'",
			)
			.get() as { value: string };
		expect(dedupFlag.value).toBe("0");
	});
});

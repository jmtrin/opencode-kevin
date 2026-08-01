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
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate-v020-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("migrate-from-v0.2.0 — backward compat (K3-027)", () => {
	function createV020Db() {
		store.exec("CREATE TABLE schema_version (version TEXT PRIMARY KEY);");
		store.exec(SQL_001);
		store.exec(SQL_003);
	}

	function insertV020Memory(opts?: {
		type?: string;
		origin?: string;
		fingerprint?: string;
	}) {
		const id = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, source_tool, source_session, metadata, project_id, fingerprint, origin)
				 VALUES (?, ?, 'Error TS2304: cannot find foo', 'project', 0.7, 'bash', 'sess-v020', '{}', 'test-proj', ?, ?)`,
			)
			.run(
				id,
				opts?.type ?? "error",
				opts?.fingerprint ?? null,
				opts?.origin ?? "reflector",
			);
		return id;
	}

	function insertV020ToolCall(sessId: string, success = false) {
		const id = uuidv7();
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, project_id, fingerprint, metadata)
				 VALUES (?, ?, datetime('now'), 'bash', 'command: tsc', ?, 320, null, ?, 'test-proj', ?, '{}')`,
			)
			.run(
				id,
				sessId,
				success ? 1 : 0,
				success ? null : "typecheck",
				success ? null : "deadbeefdeadbeef",
			);
		return id;
	}

	it("applies migration 004 over a v0.2.0 DB and legacy rows remain queryable", async () => {
		createV020Db();
		const memId = insertV020Memory({ fingerprint: "deadbeefdeadbeef" });
		const tcId = insertV020ToolCall("sess-v020");

		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_applied_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_applied_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);

		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.applied).toContain("004");

		const mem = store
			.prepare(
				"SELECT id, type, content, scope, origin, project_id, fingerprint, evidence_count, last_verified_at, status FROM memories WHERE id = ?",
			)
			.get(memId) as Record<string, unknown>;
		expect(mem.id).toBe(memId);
		expect(mem.type).toBe("error");
		expect(mem.origin).toBe("reflector");
		expect(mem.evidence_count).toBe(0);
		expect(mem.last_verified_at).toBeNull();
		expect(mem.status).toBe("active");
		expect(mem.fingerprint).toBe("deadbeefdeadbeef");

		const tc = store
			.prepare(
				"SELECT id, tool, session_id, project_id, fingerprint, fix_for_fingerprint FROM tool_calls WHERE id = ?",
			)
			.get(tcId) as Record<string, unknown>;
		expect(tc.id).toBe(tcId);
		expect(tc.fix_for_fingerprint).toBeNull();
	});

	it("new CHECK constraints allow v0.3.0 types and origins", async () => {
		createV020Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		await new Migrate(store, migrationsDir).run();

		// 'rule' type should be accepted
		const ruleId = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, fingerprint, origin, evidence_count, status)
				 VALUES (?, 'rule', 'my rule', 'project', 'fp1', 'imported', 1, 'active')`,
			)
			.run(ruleId);
		const rule = store
			.prepare("SELECT id, type, origin FROM memories WHERE id = ?")
			.get(ruleId) as Record<string, unknown>;
		expect(rule.type).toBe("rule");
		expect(rule.origin).toBe("imported");

		// 'causal' origin should be accepted
		const patId = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, fingerprint, origin, evidence_count, status)
				 VALUES (?, 'pattern', 'Causal pattern: test', 'project', 'fp2', 'causal', 2, 'active')`,
			)
			.run(patId);
		const pat = store
			.prepare(
				"SELECT id, type, origin, evidence_count FROM memories WHERE id = ?",
			)
			.get(patId) as Record<string, unknown>;
		expect(pat.type).toBe("pattern");
		expect(pat.origin).toBe("causal");
		expect(pat.evidence_count).toBe(2);
	});

	it("rerunning migration 004 over v0.2.0 is a no-op", async () => {
		createV020Db();
		insertV020Memory();

		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);

		const migrate = new Migrate(store, migrationsDir);
		const first = await migrate.run();
		expect(first.applied).toContain("004");

		const second = await migrate.run();
		expect(second.applied.length).toBe(0);

		const hasMetrics = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='kevin_metrics'",
			)
			.get() as { c: number };
		expect(hasMetrics.c).toBe(1);

		const count = store.prepare("SELECT COUNT(*) AS c FROM memories").get() as {
			c: number;
		};
		expect(count.c).toBe(1);
	});

	it("idx_tool_calls_fix_fp and idx_memories_fp indexes exist after migration 004", async () => {
		createV020Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		await new Migrate(store, migrationsDir).run();

		const fixFpIdx = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_tool_calls_fix_fp'",
			)
			.get() as { c: number };
		expect(fixFpIdx.c).toBe(1);

		const memFpIdx = store
			.prepare(
				"SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_memories_fp'",
			)
			.get() as { c: number };
		expect(memFpIdx.c).toBe(1);
	});

	it("kevin_metrics and kevin_settings include v0.3.0 seeds", async () => {
		createV020Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		await new Migrate(store, migrationsDir).run();

		const metricsCount = store
			.prepare("SELECT COUNT(*) AS c FROM kevin_metrics")
			.get() as { c: number };
		expect(metricsCount.c).toBe(9);

		const settingsCount = store
			.prepare("SELECT COUNT(*) AS c FROM kevin_settings")
			.get() as { c: number };
		expect(settingsCount.c).toBe(4);

		const llmReflection = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'llm_reflection_enabled'",
			)
			.get() as { value: string } | undefined;
		expect(llmReflection?.value).toBe("0");

		const crossProject = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'cross_project_enabled'",
			)
			.get() as { value: string } | undefined;
		expect(crossProject?.value).toBe("0");
	});

	it("supersede status is accepted and queryable", async () => {
		createV020Db();
		writeFileSync(
			join(migrationsDir, "001_initial.sql"),
			"CREATE TABLE IF NOT EXISTS _001_already_ (id INTEGER);",
		);
		writeFileSync(
			join(migrationsDir, "003_v02_signal.sql"),
			"CREATE TABLE IF NOT EXISTS _003_already_ (id INTEGER);",
		);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		await new Migrate(store, migrationsDir).run();

		const id = uuidv7();
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, fingerprint, origin, evidence_count, status)
				 VALUES (?, 'pattern', 'old pattern', 'project', 'fp-old', 'causal', 1, 'superseded')`,
			)
			.run(id);

		const mem = store
			.prepare("SELECT id, status FROM memories WHERE id = ?")
			.get(id) as Record<string, unknown>;
		expect(mem.status).toBe("superseded");
	});
});

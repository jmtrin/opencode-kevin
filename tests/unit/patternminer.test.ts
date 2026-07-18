import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { PatternMiner } from "../../plugin/PatternMiner.js";
import { Store } from "../../plugin/Store.js";
import type { Metrics } from "../../plugin/metrics.js";
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
let store: Store;
let memSvc: MemoryService;

function setupStore(): void {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-pm-v021-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memSvc = new MemoryService(store, null);
}

function enablePatternMiner(value: "0" | "1" = "1"): void {
	store
		.prepare(
			"UPDATE kevin_settings SET value = ? WHERE key = 'patternminer_enabled'",
		)
		.run(value);
}

function insertToolCall(
	sid: string,
	tool: string,
	success: boolean,
	ts: string,
	projectId: string | null = null,
): void {
	store
		.prepare(
			`INSERT INTO tool_calls
			   (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id)
			 VALUES (?, ?, ?, ?, '', ?, 0, null, null, null, ?)`,
		)
		.run(uuidv7(), sid, ts, tool, success ? 1 : 0, projectId);
}

function countPatternMemories(projectId?: string | null): number {
	const nullPid = projectId === null || projectId === undefined;
	const sql = nullPid
		? `SELECT COUNT(*) AS c FROM memories
		   WHERE type = 'pattern' AND origin = 'pattern' AND project_id IS NULL`
		: `SELECT COUNT(*) AS c FROM memories
		   WHERE type = 'pattern' AND origin = 'pattern' AND project_id = ?`;
	const stmt = store.prepare(sql);
	const row = (nullPid ? stmt.get() : stmt.get(projectId)) as { c: number };
	return row.c;
}

function createFakeMetrics(): {
	metrics: Metrics;
	incr: ReturnType<typeof vi.fn>;
} {
	const incr = vi.fn();
	const metrics = {
		incr,
		snapshot: vi.fn(() => ({})),
		get: vi.fn(() => 0),
		flush: vi.fn(),
		close: vi.fn(),
	} as unknown as Metrics;
	return { metrics, incr };
}

describe("PatternMiner — v0.2.0 (K2-021)", () => {
	beforeEach(() => setupStore());
	afterEach(() => {
		store.close();
		if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("returns 0 and emits no memories when patternminer_enabled = 0 (default)", () => {
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "read", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "write", true, "2026-07-18 10:00:01");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		// Flag stays at default '0' — no enablePatternMiner() call.
		const emitted = miner.mine();
		expect(emitted).toBe(0);
		expect(countPatternMemories()).toBe(0);
	});

	it("does NOT emit when N < 5 distinct sessions (below threshold)", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 4; s++) {
			insertToolCall(`sess-${s}`, "read", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "write", true, "2026-07-18 10:00:01");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine()).toBe(0);
		expect(countPatternMemories()).toBe(0);
	});

	it("emits exactly one pattern memory when N >= 5 distinct sessions share the 2-gram", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "read", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "write", true, "2026-07-18 10:00:01");
		}
		const { metrics, incr } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		const emitted = miner.mine();
		expect(emitted).toBe(1);
		expect(countPatternMemories()).toBe(1);

		const row = store
			.prepare(
				`SELECT content, fingerprint, origin, project_id FROM memories
				 WHERE type = 'pattern' AND origin = 'pattern' LIMIT 1`,
			)
			.get() as {
			content: string;
			fingerprint: string;
			origin: string;
			project_id: string | null;
		};
		expect(row.content).toContain('"read"');
		expect(row.content).toContain('"write"');
		expect(row.origin).toBe("pattern");
		expect(row.fingerprint.length).toBe(16); // FNV-1a 64-bit hex
		expect(row.fingerprint).toMatch(/^[0-9a-f]{16}$/);
		expect(row.project_id).toBe(null); // no projectId provided
		expect(incr).toHaveBeenCalledWith("patterns_mined", 1);
	});

	it("second mine() run does NOT duplicate the same pattern (idempotency via SELECT)", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "read", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "write", true, "2026-07-18 10:00:01");
		}
		const { metrics, incr } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine()).toBe(1);
		expect(miner.mine()).toBe(0); // idempotent — already emitted
		expect(countPatternMemories()).toBe(1);
		expect(incr).toHaveBeenCalledTimes(1);
	});

	it("emits a 3-gram pattern when middle tool failed across N>=5 sessions", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "lint", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "test", false, "2026-07-18 10:00:01");
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:02");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		const emitted = miner.mine();
		// Both: 2g (lint, test) AND 3g (lint, test-fail, edit) qualify at N>=5.
		// 2g (lint, test), (test, edit) — these are 2-grams recorded.
		// 3g (lint, test-failed, edit) — recorded because middle failed.
		// So at threshold N>=5 each unique group fires its own emission.
		// We expect AT LEAST the 3g emission (the interesting pattern per the
		// plan), and it should be one of the emitted rows.
		expect(emitted).toBeGreaterThanOrEqual(1);
		const rows = store
			.prepare(
				`SELECT content FROM memories
				 WHERE type = 'pattern' AND origin = 'pattern'`,
			)
			.all() as { content: string }[];
		const threeGram = rows.find(
			(r) =>
				r.content.includes("lint") &&
				r.content.includes("test") &&
				r.content.includes("edit") &&
				r.content.includes("failed"),
		);
		expect(threeGram).toBeDefined();
	});

	it("handles NULL project_id: mines tool_calls with project_id IS NULL when no projectId given", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:00", null);
			insertToolCall(`sess-${s}`, "save", true, "2026-07-18 10:00:01", null);
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine()).toBe(1);
		expect(countPatternMemories(null)).toBe(1);
	});

	it("scopes pattern mining per project: same 2-gram in proj-A and proj-B emits two distinct patterns", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`a-${s}`, "edit", true, "2026-07-18 10:00:00", "proj-A");
			insertToolCall(`a-${s}`, "save", true, "2026-07-18 10:00:01", "proj-A");
			insertToolCall(`b-${s}`, "edit", true, "2026-07-18 10:00:00", "proj-B");
			insertToolCall(`b-${s}`, "save", true, "2026-07-18 10:00:01", "proj-B");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine("proj-A")).toBe(1);
		expect(miner.mine("proj-B")).toBe(1);
		expect(countPatternMemories("proj-A")).toBe(1);
		expect(countPatternMemories("proj-B")).toBe(1);
		// fingerprints differ because project_id salts the FNV-1a hash
		const rowA = store
			.prepare(
				`SELECT fingerprint FROM memories
				 WHERE type = 'pattern' AND origin = 'pattern' AND project_id = 'proj-A' LIMIT 1`,
			)
			.get() as { fingerprint: string };
		const rowB = store
			.prepare(
				`SELECT fingerprint FROM memories
				 WHERE type = 'pattern' AND origin = 'pattern' AND project_id = 'proj-B' LIMIT 1`,
			)
			.get() as { fingerprint: string };
		expect(rowA.fingerprint).not.toBe(rowB.fingerprint);
	});

	it("does NOT emit when each session has a single tool call (no 2-gram possible)", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:00");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine()).toBe(0);
		expect(countPatternMemories()).toBe(0);
	});

	it("emits multiple distinct patterns when several groups each reach threshold", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`a-${s}`, "alpha", true, "2026-07-18 10:00:00");
			insertToolCall(`a-${s}`, "beta", true, "2026-07-18 10:00:01");
			insertToolCall(`b-${s}`, "gamma", true, "2026-07-18 11:00:00");
			insertToolCall(`b-${s}`, "delta", true, "2026-07-18 11:00:01");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		expect(miner.mine()).toBe(2);
		expect(countPatternMemories()).toBe(2);
	});

	it("respects custom threshold via PatternMinerOptions { threshold: 2 }", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 2; s++) {
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "save", true, "2026-07-18 10:00:01");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics, {
			threshold: 2,
		});
		expect(miner.mine()).toBe(1);
		expect(countPatternMemories()).toBe(1);
	});

	it("does NOT throw when metrics is null (backward-compat)", () => {
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "save", true, "2026-07-18 10:00:01");
		}
		const miner = new PatternMiner(store, memSvc, null);
		expect(miner.mine()).toBe(1);
		expect(countPatternMemories()).toBe(1);
	});

	it("does NOT boost agent-saved memories (anti-gaming: pattern memories are origin='pattern' only)", () => {
		// Sanity check: PatternMiner emits ONLY origin='pattern' memories.
		// No agent-row contamination expected.
		enablePatternMiner("1");
		for (let s = 0; s < 5; s++) {
			insertToolCall(`sess-${s}`, "edit", true, "2026-07-18 10:00:00");
			insertToolCall(`sess-${s}`, "save", true, "2026-07-18 10:00:01");
		}
		const { metrics } = createFakeMetrics();
		const miner = new PatternMiner(store, memSvc, metrics);
		miner.mine();
		const row = store
			.prepare(`SELECT origin FROM memories WHERE type = 'pattern' LIMIT 1`)
			.get() as { origin: string };
		expect(row.origin).toBe("pattern");
	});
});

describe("PatternMiner — K2-030 edge: upgrade path (001→003 schema)", () => {
	it("runs correctly on a DB that was 001-only then upgraded via migration 003", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-pm-v030-"));
		try {
			const dir = join(root, "migrations");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "001_initial.sql"), SQL_001);
			writeFileSync(join(dir, "003_v02_signal.sql"), SQL_003);
			const st = new Store({ path: ":memory:" });
			void new Migrate(st, dir).run();

			st.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'patternminer_enabled'",
			).run();

			for (let i = 0; i < 5; i++) {
				st.prepare(
					"INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata) VALUES (?, ?, ?, ?, '', 1, 0, null, null, '{}')",
				).run(
					uuidv7(),
					`upg-sess-${i}`,
					`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00`,
					"read",
				);
				st.prepare(
					"INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata) VALUES (?, ?, ?, ?, '', 1, 0, null, null, '{}')",
				).run(
					uuidv7(),
					`upg-sess-${i}`,
					`2026-01-${String(i + 1).padStart(2, "0")}T00:01:00`,
					"write",
				);
			}

			const ms = new MemoryService(st, null);
			const miner = new PatternMiner(st, ms, null);
			const emitted = miner.mine();
			expect(emitted).toBe(1);

			const rows = st
				.prepare(
					"SELECT content, origin, type FROM memories WHERE type='pattern'",
				)
				.all() as Array<{ content: string; type: string; origin: string }>;
			expect(rows.length).toBe(1);
			expect(rows[0].origin).toBe("pattern");

			st.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CausalChain } from "../../plugin/CausalChain.js";
import {
	type EnrichFn,
	deterministicFixLine,
	enrichAtPromotion,
} from "../../plugin/LessonFixer.js";
import { MemoryService } from "../../plugin/MemoryService.js";
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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-enrich-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const [name, sql] of [
		["001_initial.sql", SQL_001],
		["003_v02_signal.sql", SQL_003],
		["004_v03_knowledge.sql", SQL_004],
		["005_v04_signal.sql", SQL_005],
	]) {
		writeFileSync(join(migrationsDir, name), sql);
	}
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function runCycle(
	mem: MemoryService,
	sessionId: string,
	fp: string,
	seq: number,
): void {
	mem.save({
		type: "error",
		content:
			"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
		scope: "project",
		origin: "reflector",
		fingerprint: fp,
		projectId: "proj-A",
		sourceSession: sessionId,
		relevanceScore: 0.5,
	});
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
			 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'TS2304', '{}', 'proj-A', ?)`,
		)
		.run(`${sessionId}-fail-${seq}`, sessionId, fp);
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id)
			 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 1, 5, null, null, '{}', 'proj-A')`,
		)
		.run(`${sessionId}-fix-${seq}`, sessionId);
}

function enableLlmReflection(): void {
	store
		.prepare(
			`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.run("llm_reflection_enabled", "1");
}

function patternContent(fp: string): string | null {
	const mem = new MemoryService(store);
	const row = store
		.prepare(
			`SELECT id FROM memories
			 WHERE fingerprint = ? AND type = 'pattern' AND origin = 'causal'`,
		)
		.get(fp) as { id: string } | undefined;
	return row ? (mem.getById(row.id)?.content ?? null) : null;
}

function patternMetadata(fp: string): Record<string, unknown> {
	const row = store
		.prepare(
			`SELECT metadata FROM memories
			 WHERE fingerprint = ? AND type = 'pattern' AND origin = 'causal'`,
		)
		.get(fp) as { metadata: string | null } | undefined;
	return row?.metadata
		? (JSON.parse(row.metadata) as Record<string, unknown>)
		: {};
}

describe("LessonFixer — promotion-time phrasing (K4-015)", () => {
	it("deterministicFixLine returns the deterministic text or empty", () => {
		expect(
			deterministicFixLine({
				content: "lesson",
				fixArgs: 'bash with args "cmd"',
			}),
		).toBe('Fixed by: bash with args "cmd"');
		expect(deterministicFixLine({ content: "lesson", fixArgs: null })).toBe("");
	});

	it("enrichAtPromotion default path is deterministic, no hook call", async () => {
		let calls = 0;
		const hook: EnrichFn = async () => {
			calls++;
			return null;
		};
		const out = await enrichAtPromotion(
			{ content: "lesson", fixArgs: 'bash with args "cmd"' },
			undefined,
		);
		expect(out).toBe('Fixed by: bash with args "cmd"');
		expect(calls).toBe(0);
	});

	it("enrichAtPromotion uses the hook phrase when returned", async () => {
		const hook: EnrichFn = async ({ fixArgs }) => `Fix: use ${fixArgs} first`;
		const out = await enrichAtPromotion(
			{ content: "lesson", fixArgs: 'bash with args "cmd"' },
			hook,
		);
		expect(out).toBe('Fix: use bash with args "cmd" first');
	});

	it("enrichAtPromotion falls back when the hook returns null", async () => {
		const hook: EnrichFn = async () => null;
		const out = await enrichAtPromotion(
			{ content: "lesson", fixArgs: 'bash with args "cmd"' },
			hook,
		);
		expect(out).toBe('Fixed by: bash with args "cmd"');
	});
});

describe("K4-015 — CausalChain fires enrichment at most once per pattern", () => {
	it("mock enrich: exactly 1 call for a new pattern, 0 on later idle refreshes", async () => {
		enableLlmReflection();
		const mem = new MemoryService(store);
		const calls: string[] = [];
		const hook: EnrichFn = async ({ lesson, fixArgs }) => {
			calls.push(`${fixArgs}::${lesson.length}`);
			return "Fix: instala ripgrep primero";
		};
		const chain = new CausalChain(store, mem, null, hook);
		const fp = "cccccccccccccccc";

		// Session 1: fail + fix → NEW pattern → exactly one enrichment call.
		runCycle(mem, "sess-1", fp, 0);
		chain.onSuccess("bash", {}, "proj-A", "sess-1");
		await chain.onSessionIdle("sess-1");
		expect(calls.length).toBe(1);
		expect(patternMetadata(fp).enriched).toBe(true);

		// The one-line phrase replaces the deterministic `Fixed by:` line.
		expect(patternContent(fp)).toContain("Fix: instala ripgrep primero");
		expect(patternContent(fp)).not.toContain("Fixed by:");

		// Session 2: new fix for the same fingerprint → idempotent refresh,
		// already enriched → 0 additional calls.
		runCycle(mem, "sess-2", fp, 1);
		chain.onSuccess("bash", {}, "proj-A", "sess-2");
		await chain.onSessionIdle("sess-2");
		expect(calls.length).toBe(1);
	});

	it("setting off: 0 calls, deterministic text preserved", async () => {
		const mem = new MemoryService(store);
		const calls: string[] = [];
		const hook: EnrichFn = async () => {
			calls.push("x");
			return "Fix: nope";
		};
		const chain = new CausalChain(store, mem, null, hook);
		const fp = "dddddddddddddddd";

		runCycle(mem, "sess-1", fp, 0);
		chain.onSuccess("bash", {}, "proj-A", "sess-1");
		await chain.onSessionIdle("sess-1");

		expect(calls.length).toBe(0);
		expect(patternContent(fp)).toContain('Fixed by: bash with args "cmd"');
		expect(patternMetadata(fp).enriched).toBeUndefined();
	});

	it("no enrichFn injected: 0 calls even with the setting on", async () => {
		enableLlmReflection();
		const mem = new MemoryService(store);
		const chain = new CausalChain(store, mem, null);
		const fp = "eeeeeeeeeeeeeeee";

		runCycle(mem, "sess-1", fp, 0);
		chain.onSuccess("bash", {}, "proj-A", "sess-1");
		await chain.onSessionIdle("sess-1");

		expect(patternContent(fp)).toContain('Fixed by: bash with args "cmd"');
	});

	it("hook returning null keeps the deterministic text and still stamps enriched", async () => {
		enableLlmReflection();
		const mem = new MemoryService(store);
		const calls: string[] = [];
		const hook: EnrichFn = async () => {
			calls.push("x");
			return null;
		};
		const chain = new CausalChain(store, mem, null, hook);
		const fp = "ffffffffffffffff";

		runCycle(mem, "sess-1", fp, 0);
		chain.onSuccess("bash", {}, "proj-A", "sess-1");
		await chain.onSessionIdle("sess-1");
		await chain.onSessionIdle("sess-1");

		expect(calls.length).toBe(1);
		expect(patternContent(fp)).toContain('Fixed by: bash with args "cmd"');
		expect(patternMetadata(fp).enriched).toBe(true);
	});
});

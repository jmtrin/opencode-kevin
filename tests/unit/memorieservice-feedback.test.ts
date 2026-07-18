import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-fb-v026-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("MemoryService.boostPositiveReflectors — v0.2.0 (K2-026)", () => {
	it("boosts a reflector-sourced lesson by 0.05 when no recurrence in tool_calls", () => {
		const mem = new MemoryService(store);
		const id = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'foo'",
			scope: "project",
			origin: "reflector",
			fingerprint: "aaaaaaaaaaaaaaaa",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		const got = mem.getById(id);
		expect(got?.relevanceScore).toBe(0.5);
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(1);
		const after = mem.getById(id);
		expect(after?.relevanceScore).toBeCloseTo(0.55, 5);
	});

	it("caps the boost at RELEVANCE_MAX = 1.0", () => {
		const mem = new MemoryService(store);
		const id = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'nearcap'",
			scope: "project",
			origin: "reflector",
			fingerprint: "bbbbbbbbbbbbbbbb",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.98,
		});
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(1);
		const after = mem.getById(id);
		expect(after?.relevanceScore).toBe(1.0);
	});

	it("does NOT boost a reflector lesson when its fingerprint recurred in tool_calls", () => {
		const mem = new MemoryService(store);
		const id = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'recur'",
			scope: "project",
			origin: "reflector",
			fingerprint: "cccccccccccccccc",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		// Simulate K2-027 wiring: insert a failing tool_call with the same
		// fingerprint + project_id (the recurrence signal).
		store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
				 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'runtime', '{}', ?, ?)`,
			)
			.run("tc-1", "sess-1", "proj-A", "cccccccccccccccc");
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(0);
		const after = mem.getById(id);
		expect(after?.relevanceScore).toBe(0.5);
	});

	it("scopes recurrence check to the same project_id (recurrence in a different project does NOT block boost)", () => {
		const mem = new MemoryService(store);
		const id = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'scoped'",
			scope: "project",
			origin: "reflector",
			fingerprint: "dddddddddddddddd",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		// Same fingerprint, but in a DIFFERENT project → should not block the boost.
		store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
				 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'runtime', '{}', ?, ?)`,
			)
			.run("tc-2", "sess-1", "proj-B", "dddddddddddddddd");
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(1);
		const after = mem.getById(id);
		expect(after?.relevanceScore).toBeCloseTo(0.55, 5);
	});

	it("does NOT boost agent-sourced memories (anti-gaming guarantee, D2-06/D2-10)", () => {
		const mem = new MemoryService(store);
		mem.save({
			type: "error",
			content: "agent-saved error note",
			scope: "project",
			origin: "agent",
			fingerprint: "eeeeeeeeeeeeeeee",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.4,
		});
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(0);
	});

	it("returns 0 when there are no reflector-sourced lessons for the given session", () => {
		const mem = new MemoryService(store);
		mem.save({
			type: "context",
			content: "no session match",
			scope: "session",
			origin: "reflector",
			sourceSession: "sess-other",
			relevanceScore: 0.3,
		});
		expect(mem.boostPositiveReflectors("sess-1")).toBe(0);
	});

	it("returns 0 for an empty sessionId (defensive guard)", () => {
		const mem = new MemoryService(store);
		mem.save({
			type: "error",
			content: "no session match",
			scope: "project",
			origin: "reflector",
			fingerprint: "ffffffffffffffff",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		expect(mem.boostPositiveReflectors("")).toBe(0);
	});

	it("boosts only reflector lessons, leaving a co-existing agent lesson untouched", () => {
		const mem = new MemoryService(store);
		const refId = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'mixed'",
			scope: "project",
			origin: "reflector",
			fingerprint: "1111111111111111",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		const agentId = mem.save({
			type: "error",
			content: "agent saw a TS2304 once",
			scope: "project",
			origin: "agent",
			fingerprint: "2222222222222222",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.4,
		});
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(1);
		expect(mem.getById(refId)?.relevanceScore).toBeCloseTo(0.55, 5);
		expect(mem.getById(agentId)?.relevanceScore).toBe(0.4);
	});

	it("boosts multiple reflector lessons in a single call (transaction)", () => {
		const mem = new MemoryService(store);
		const id1 = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'a'",
			scope: "project",
			origin: "reflector",
			fingerprint: "3333333333333333",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		const id2 = mem.save({
			type: "error",
			content: "error TS2322 type mismatch for 'b'",
			scope: "project",
			origin: "reflector",
			fingerprint: "4444444444444444",
			projectId: "proj-A",
			sourceSession: "sess-1",
			relevanceScore: 0.6,
		});
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(2);
		expect(mem.getById(id1)?.relevanceScore).toBeCloseTo(0.55, 5);
		expect(mem.getById(id2)?.relevanceScore).toBeCloseTo(0.65, 5);
	});

	it("treats NULL project_id correctly (recurrence check handles NULL=NULL via IS NULL branch)", () => {
		const mem = new MemoryService(store);
		const id = mem.save({
			type: "error",
			content: "error TS2304 cannot find name 'nullproj'",
			scope: "project",
			origin: "reflector",
			fingerprint: "5555555555555555",
			projectId: undefined as unknown as string,
			sourceSession: "sess-1",
			relevanceScore: 0.5,
		});
		// Insert a failing tool_call with NULL project_id and same fingerprint → recurrence should match.
		store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
				 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'runtime', '{}', NULL, ?)`,
			)
			.run("tc-3", "sess-1", "5555555555555555");
		const boosted = mem.boostPositiveReflectors("sess-1");
		expect(boosted).toBe(0);
		expect(mem.getById(id)?.relevanceScore).toBe(0.5);
	});
});

import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-fb-v03-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function saveLesson(mem: MemoryService, fp: string, session: string): string {
	return mem.save({
		type: "error",
		content: `When bash fails with TS2304: error TS2304: Cannot find name 'foo'.`,
		scope: "project",
		origin: "reflector",
		fingerprint: fp,
		projectId: "proj-A",
		sourceSession: session,
		relevanceScore: 0.5,
	});
}

/** Insert a failing tool_call with the same fingerprint (the recurrence). */
function insertRecurringFail(fp: string, session: string, id: string): void {
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
			 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'TS2304', '{}', 'proj-A', ?)`,
		)
		.run(id, session, fp);
}

describe("K4-011 — penalizeRecurringReflectors writes recurrence_count (negative half)", () => {
	it("recurrence bumps recurrence_count, NOT evidence_count", () => {
		const mem = new MemoryService(store);
		const id = saveLesson(mem, "1111111111111111", "sess-1");
		insertRecurringFail("1111111111111111", "sess-1", "tc-r1");

		const penalized = mem.penalizeRecurringReflectors("sess-1");
		expect(penalized).toBe(1);

		const row = store
			.prepare(
				"SELECT evidence_count, recurrence_count, relevance_score FROM memories WHERE id = ?",
			)
			.get(id) as {
			evidence_count: number;
			recurrence_count: number;
			relevance_score: number;
		};
		expect(row.evidence_count).toBe(0); // unchanged — no longer positive evidence
		expect(row.recurrence_count).toBe(1);
		expect(row.relevance_score).toBeCloseTo(0.45, 5); // still penalized
	});

	it("second recurrence raises recurrence_count to 2", () => {
		const mem = new MemoryService(store);
		const id = saveLesson(mem, "2222222222222222", "sess-2");
		insertRecurringFail("2222222222222222", "sess-2", "tc-r2a");
		insertRecurringFail("2222222222222222", "sess-2", "tc-r2b");

		mem.penalizeRecurringReflectors("sess-2");
		mem.penalizeRecurringReflectors("sess-2");

		const row = store
			.prepare(
				"SELECT evidence_count, recurrence_count FROM memories WHERE id = ?",
			)
			.get(id) as { evidence_count: number; recurrence_count: number };
		expect(row.evidence_count).toBe(0);
		expect(row.recurrence_count).toBe(2);
	});

	it("does not count the original failing call (origin_call_id exclusion)", () => {
		const mem = new MemoryService(store);
		// Reflector stores the originating failing call id in the MEMORY
		// metadata; penalize excludes that call from the recurrence count.
		const id = mem.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			scope: "project",
			origin: "reflector",
			fingerprint: "3333333333333333",
			projectId: "proj-A",
			sourceSession: "sess-3",
			relevanceScore: 0.5,
			metadata: { origin_call_id: "tc-orig" },
		});
		// The original failing call that CREATED the lesson: same fingerprint
		// and the memory's origin_call_id → excluded from recurrence.
		store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
				 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 0, 5, null, 'TS2304', '{}', 'proj-A', ?)`,
			)
			.run("tc-orig", "sess-3", "3333333333333333");

		const penalized = mem.penalizeRecurringReflectors("sess-3");
		expect(penalized).toBe(0);
		const row = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = ?")
			.get(id) as { recurrence_count: number };
		expect(row.recurrence_count).toBe(0);
	});

	it("penalization does NOT increment memories_superseded", () => {
		const metrics = new Metrics(store);
		const mem = new MemoryService(store, metrics);
		saveLesson(mem, "4444444444444444", "sess-4");
		insertRecurringFail("4444444444444444", "sess-4", "tc-r4");

		mem.penalizeRecurringReflectors("sess-4");

		expect(metrics.get("memories_superseded")).toBe(0);
		const row = store
			.prepare("SELECT recurrence_count FROM memories WHERE fingerprint = ?")
			.get("4444444444444444") as { recurrence_count: number };
		expect(row.recurrence_count).toBe(1);
	});

	it("real supersede (decision/rule replaced) increments memories_superseded", () => {
		const metrics = new Metrics(store);
		const mem = new MemoryService(store, metrics);
		mem.save({
			type: "rule",
			content: "old rule",
			fingerprint: "9999999999999999",
			projectId: "proj-A",
		});
		mem.save({
			type: "rule",
			content: "new rule",
			fingerprint: "9999999999999999",
			projectId: "proj-A",
		});

		expect(metrics.get("memories_superseded")).toBe(1);
	});
});

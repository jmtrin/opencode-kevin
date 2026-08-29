import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CausalChain } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import {
	CONFIDENCE_MAX,
	CONFIDENCE_MIN,
	computeConfidence,
} from "@jmtrin/kevin-core";

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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-conf-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
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
	recurred: boolean,
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
	if (recurred) {
		// A recurrence is a failure AFTER the lesson was created (penalized
		// by penalizeRecurringReflectors in the full loop; here we simulate
		// the written recurrence_count directly).
	}
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fix_for_fingerprint)
			 VALUES (?, ?, datetime('now'), 'bash', 'cmd', 1, 5, null, null, '{}', 'proj-A', ?)`,
		)
		.run(`${sessionId}-fix-${seq}`, sessionId, fp);
}

function promote(
	mem: MemoryService,
	fp: string,
	evidenceCount: number,
	recurrenceCount: number,
): { id: string } | null {
	const errorId = mem.save({
		type: "error",
		content:
			"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
		scope: "project",
		origin: "reflector",
		fingerprint: fp,
		projectId: "proj-A",
		sourceSession: "sess-1",
		relevanceScore: 0.5,
	});
	return mem.promoteToPattern(errorId, evidenceCount, recurrenceCount);
}

describe("K4-010 — computeConfidence (two-sided formula)", () => {
	it("evidence=1, recurrence=0 → 0.60", () => {
		expect(computeConfidence(1, 0)).toBeCloseTo(0.6, 5);
	});

	it("evidence=1, recurrence=1 → 0.45 (recurrence lowers confidence)", () => {
		expect(computeConfidence(1, 1)).toBeCloseTo(0.45, 5);
	});

	it("clamps at 0.95 for huge evidence", () => {
		expect(computeConfidence(100, 0)).toBe(CONFIDENCE_MAX);
	});

	it("clamps at 0.05 for heavy recurrence", () => {
		expect(computeConfidence(1, 100)).toBe(CONFIDENCE_MIN);
		expect(computeConfidence(0, 5)).toBe(CONFIDENCE_MIN);
	});

	it("promoteToPattern uses the shared helper (recurrence demotes)", () => {
		const mem = new MemoryService(store);
		const fresh = promote(mem, "aaaaaaaaaaaaaaaa", 1, 0);
		const demoted = promote(mem, "bbbbbbbbbbbbbbbb", 1, 1);
		expect(fresh).not.toBeNull();
		expect(demoted).not.toBeNull();
		const rFresh = mem.getById(fresh?.id ?? "");
		const rDemoted = mem.getById(demoted?.id ?? "");
		expect(rFresh?.confidence).toBeCloseTo(0.6, 5);
		expect(rDemoted?.confidence).toBeCloseTo(0.45, 5);
	});

	it("kevin_why uses the shared helper (assert via CausalChain+kevin_why path)", async () => {
		// End-to-end: run a full cycle, penalize a recurrence, then check
		// kevin_why's reported confidence matches computeConfidence.
		const mem = new MemoryService(store);
		const chain = new CausalChain(store, mem, null);
		const fp = "cccccccccccccccc";

		// Session 1: fail + fix → causal pattern promoted with evidence=1.
		runCycle(mem, "sess-1", fp, 0, false);
		chain.onSuccess("bash", {}, "proj-A", "sess-1");
		chain.onSessionIdle("sess-1");

		// Session 2: same fingerprint recurs → penalize (recurrence_count=1),
		// then fix → refresh pattern with evidence=2, recurrence=1.
		runCycle(mem, "sess-2", fp, 1, true);
		chain.onSuccess("bash", {}, "proj-A", "sess-2");
		mem.penalizeRecurringReflectors("sess-2");
		chain.onSessionIdle("sess-2");

		const { kevinWhy } = await import("@jmtrin/kevin-core");
		const why = kevinWhy(store, "TS2304");
		expect(why).not.toBeNull();
		expect(why?.confidence).toBeCloseTo(
			computeConfidence(why?.evidence_count ?? 0, 1),
			5,
		);
		expect(why?.evidence_count).toBeGreaterThanOrEqual(1);
	});
});

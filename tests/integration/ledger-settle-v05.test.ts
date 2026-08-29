import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InjectionLedger } from "@jmtrin/kevin-core";
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
const SQL_006 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);

let tmpRoot: string;
let store: Store;

function makeMigratedStore(): Store {
	const s = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006]) {
		s.exec(sql);
	}
	return s;
}

function addCall(opts: {
	sessionId: string;
	success: number;
	fixForFingerprint?: string;
	errorFingerprint?: string;
	ts: string;
	id?: string;
}): void {
	store
		.prepare(
			`INSERT INTO tool_calls (id, session_id, ts, tool, success, error_fingerprint, fix_for_fingerprint)
			 VALUES (?, ?, ?, 'bash', ?, ?, ?)`,
		)
		.run(
			opts.id ?? `tc-${Math.random().toString(36).slice(2)}`,
			opts.sessionId,
			opts.ts,
			opts.success,
			opts.errorFingerprint ?? null,
			opts.fixForFingerprint ?? null,
		);
}

function seedMemoryAndInjection(fp: string, sessionId: string): string {
	store
		.prepare(
			`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count)
			 VALUES ('mem-1', 'error', 'reflector', 'lesson', ?, 0)`,
		)
		.run(fp);
	store
		.prepare(
			"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome) VALUES ('inj-1', 'mem-1', ?, ?, 'pre_prompt', 10, '2026-08-08 10:00:30', 'unmeasured')",
		)
		.run(fp, sessionId);
	return "inj-1";
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-settle-v05-"));
	store = makeMigratedStore();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K5-005 — three-way settlement (v0.5.0, D5-01)", () => {
	it("recurrence after injection → ineffective (existing behaviour preserved)", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-recur";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-1",
			success: 0,
			errorFingerprint: fp,
			ts: "2026-08-08 10:01:00",
		});
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
		expect(metrics.get("injections_ineffective")).toBe(1);
		const mem = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = 'mem-1'")
			.get() as { recurrence_count: number };
		expect(mem.recurrence_count).toBe(1);
	});

	it("linked fix after injection → effective", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-fix";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-1",
			success: 1,
			fixForFingerprint: fp,
			ts: "2026-08-08 10:01:00",
		});
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("effective");
		expect(metrics.get("injections_effective")).toBe(1);
		expect(metrics.get("injections_inconclusive")).toBe(0);
	});

	it("neither recurrence nor linked fix → inconclusive", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		seedMemoryAndInjection("fp-none", "s-1");
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("inconclusive");
		expect(metrics.get("injections_inconclusive")).toBe(1);
		expect(metrics.get("injections_effective")).toBe(0);
		expect(metrics.get("injections_ineffective")).toBe(0);
	});

	it("recurrence takes precedence over a later linked fix", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-both";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-1",
			success: 0,
			errorFingerprint: fp,
			ts: "2026-08-08 10:01:00",
		});
		addCall({
			sessionId: "s-1",
			success: 1,
			fixForFingerprint: fp,
			ts: "2026-08-08 10:02:00",
		});
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
		expect(metrics.get("injections_ineffective")).toBe(1);
	});

	it("a fix recorded BEFORE injected_at does not produce effective", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-before";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-1",
			success: 1,
			fixForFingerprint: fp,
			ts: "2026-08-08 10:00:00",
		});
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("inconclusive");
		expect(metrics.get("injections_effective")).toBe(0);
	});

	it("a fix recorded in a DIFFERENT session does not produce effective", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-other-session";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-2",
			success: 1,
			fixForFingerprint: fp,
			ts: "2026-08-08 10:01:00",
		});
		ledger.settle("s-1");
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("inconclusive");
		expect(metrics.get("injections_effective")).toBe(0);
	});

	it("settle() is idempotent: settling twice does not re-increment counters", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = "fp-idem";
		seedMemoryAndInjection(fp, "s-1");
		addCall({
			sessionId: "s-1",
			success: 0,
			errorFingerprint: fp,
			ts: "2026-08-08 10:01:00",
		});
		ledger.settle("s-1");
		const before = metrics.get("injections_ineffective");
		ledger.settle("s-1");
		expect(metrics.get("injections_ineffective")).toBe(before);
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
	});

	it("outcomeCounts() returns all four keys, zero-filled", () => {
		const ledger = new InjectionLedger(store, null);
		expect(ledger.outcomeCounts()).toEqual({
			unmeasured: 0,
			effective: 0,
			ineffective: 0,
			inconclusive: 0,
		});
		seedMemoryAndInjection("fp-a", "s-1");
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('x1', 'mem-2', 'fp-b', 's-1', 'pre_prompt', 10, 'effective')",
			)
			.run();
		const counts = ledger.outcomeCounts();
		expect(counts).toEqual({
			unmeasured: 1,
			effective: 1,
			ineffective: 0,
			inconclusive: 0,
		});
	});
});

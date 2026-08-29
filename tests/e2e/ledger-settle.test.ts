import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InjectionLedger } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { fingerprint } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages/core/migrations");

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

function addToolCall(opts: {
	sessionId: string;
	success: number;
	fp?: string;
	ts?: string;
}): void {
	store
		.prepare(
			`INSERT INTO tool_calls (id, session_id, ts, tool, success, error_fingerprint)
			 VALUES (?, ?, ?, 'bash', ?, ?)`,
		)
		.run(
			`tc-${Math.random().toString(36).slice(2)}`,
			opts.sessionId,
			opts.ts ?? "2026-08-08 10:00:00",
			opts.success,
			opts.fp ?? null,
		);
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-settle-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const f of readdirSync(MIGRATIONS_DIR)) {
		copyFileSync(join(MIGRATIONS_DIR, f), join(migrationsDir, f));
	}
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("e2e — InjectionLedger.settle (failure → injection → recurrence)", () => {
	it("marks an injection ineffective when the fingerprint recurs after injection", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = fingerprint("error: something failed");
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:00:00",
		});
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count)
				 VALUES ('mem-1', 'error', 'reflector', 'lesson', ?, 0)`,
			)
			.run(fp);

		ledger.record({
			memoryId: "mem-1",
			fingerprint: fp,
			sessionId: "s-1",
			hook: "pre_prompt",
			tokens: 10,
		});
		// Pin the injection time so `ts >= injected_at` is deterministic:
		// failure 10:00 (before), injection 10:00:30, recurrence 10:01 (after).
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-08-08 10:00:30'",
			)
			.run();
		// Recurrence AFTER the injection (later ts).
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:01:00",
		});

		ledger.settle("s-1");

		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
		expect(metrics.get("injections_ineffective")).toBe(1);
		const mem = store
			.prepare(
				"SELECT recurrence_count, last_injected_at FROM memories WHERE id = 'mem-1'",
			)
			.get() as { recurrence_count: number; last_injected_at: string | null };
		expect(mem.recurrence_count).toBe(1);
		expect(mem.last_injected_at).toBeTruthy();
	});

	it("marks an injection inconclusive when the fingerprint does not recur and no fix was linked", () => {
		// v0.5.0 (K5-005 / D5-01) — the old "effective when the error did
		// not recur" branch is now `inconclusive`: absence of recurrence is
		// not evidence of effect. `effective` now requires an OBSERVED
		// linked fix (fix_for_fingerprint on a successful call).
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = fingerprint("error: something failed");
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:00:00",
		});
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count)
				 VALUES ('mem-1', 'error', 'reflector', 'lesson', ?, 0)`,
			)
			.run(fp);

		ledger.record({
			memoryId: "mem-1",
			fingerprint: fp,
			sessionId: "s-1",
			hook: "pre_prompt",
			tokens: 10,
		});
		// Only a SUCCESS afterwards → nothing to charge, but no linked fix
		// either (the success carries error_fingerprint, not
		// fix_for_fingerprint).
		addToolCall({
			sessionId: "s-1",
			success: 1,
			fp,
			ts: "2026-08-08 10:01:00",
		});

		ledger.settle("s-1");

		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("inconclusive");
		expect(metrics.get("injections_inconclusive")).toBe(1);
		expect(metrics.get("injections_effective")).toBe(0);
		expect(metrics.get("injections_ineffective")).toBe(0);
	});

	it("does not charge recurrences that happened BEFORE the injection", () => {
		const ledger = new InjectionLedger(store, null);
		const fp = fingerprint("error: something failed");
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:00:00",
		});

		ledger.record({
			memoryId: "mem-1",
			fingerprint: fp,
			sessionId: "s-1",
			hook: "pre_prompt",
			tokens: 10,
		});
		// Same second as injection — ts >= injected_at would match only
		// strictly after; keep the injection time later than the failure.
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-08-08 10:05:00'",
			)
			.run();

		ledger.settle("s-1");

		// v0.5.0 (D5-01) — no recurrence in the charged window and no linked
		// fix: `inconclusive`, not the old `effective`.
		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("inconclusive");
	});

	it("is idempotent: settling twice does not double-charge", () => {
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);
		const fp = fingerprint("error: something failed");
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:00:00",
		});
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count)
				 VALUES ('mem-1', 'error', 'reflector', 'lesson', ?, 0)`,
			)
			.run(fp);
		ledger.record({
			memoryId: "mem-1",
			fingerprint: fp,
			sessionId: "s-1",
			hook: "pre_prompt",
			tokens: 10,
		});
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-08-08 10:00:30'",
			)
			.run();
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:01:00",
		});

		ledger.settle("s-1");
		ledger.settle("s-1");

		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
		expect(metrics.get("injections_ineffective")).toBe(1);
		const mem = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = 'mem-1'")
			.get() as { recurrence_count: number };
		expect(mem.recurrence_count).toBe(1);
	});

	it("recurrencesFor counts failing calls per fingerprint in the session", () => {
		const ledger = new InjectionLedger(store, null);
		const fp1 = fingerprint("err one");
		const fp2 = fingerprint("err two");
		addToolCall({ sessionId: "s-1", success: 0, fp: fp1 });
		addToolCall({ sessionId: "s-1", success: 0, fp: fp1 });
		addToolCall({ sessionId: "s-1", success: 0, fp: fp2 });
		addToolCall({ sessionId: "s-2", success: 0, fp: fp2 });

		const map = ledger.recurrencesFor("s-1");
		expect(map.get(fp1)).toBe(2);
		expect(map.get(fp2)).toBe(1);
		expect(map.size).toBe(2);
	});

	it("BUG-003 — lesson created in session A, injected in session B: the first B failure IS a recurrence", () => {
		// The old exclusion (`id != first failing call of the session`)
		// assumed the lesson was born in THIS session. Here the creating
		// call lives in session A, so the first B failure is a genuine
		// post-injection recurrence — it must be charged (ineffective).
		const ledger = new InjectionLedger(store, null);
		const fp = fingerprint("error: cross-session failure");
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, success, error_fingerprint)
				 VALUES ('tc-origin-A', 's-A', '2026-08-08 09:00:00', 'bash', 0, ?)`,
			)
			.run(fp);
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count, metadata)
				 VALUES ('mem-x', 'error', 'reflector', 'lesson', ?, 0, ?)`,
			)
			.run(fp, JSON.stringify({ origin_call_id: "tc-origin-A" }));

		ledger.record({
			memoryId: "mem-x",
			fingerprint: fp,
			sessionId: "s-B",
			hook: "pre_prompt",
			tokens: 10,
		});
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-08-08 10:00:00'",
			)
			.run();
		addToolCall({
			sessionId: "s-B",
			success: 0,
			fp,
			ts: "2026-08-08 10:01:00",
		});

		ledger.settle("s-B");

		const rows = ledger.rowsForSession("s-B");
		expect(rows[0].outcome).toBe("ineffective");
		const mem = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = 'mem-x'")
			.get() as { recurrence_count: number };
		expect(mem.recurrence_count).toBe(1);
	});

	it("BUG-003 — the origin_call_id exemption excludes the creating call inside the charged window", () => {
		// Edge case: the creating call shares the injection second, so
		// `ts >= injected_at` alone cannot exclude it — only the
		// origin_call_id exemption keeps it out of the recurrence count.
		const ledger = new InjectionLedger(store, null);
		const fp = fingerprint("error: same-second creation");
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, success, error_fingerprint)
				 VALUES ('tc-create', 's-1', '2026-08-08 10:00:00', 'bash', 0, ?)`,
			)
			.run(fp);
		store
			.prepare(
				`INSERT INTO memories (id, type, origin, content, fingerprint, recurrence_count, metadata)
				 VALUES ('mem-y', 'error', 'reflector', 'lesson', ?, 0, ?)`,
			)
			.run(fp, JSON.stringify({ origin_call_id: "tc-create" }));
		ledger.record({
			memoryId: "mem-y",
			fingerprint: fp,
			sessionId: "s-1",
			hook: "pre_prompt",
			tokens: 10,
		});
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-08-08 10:00:00'",
			)
			.run();
		addToolCall({
			sessionId: "s-1",
			success: 0,
			fp,
			ts: "2026-08-08 10:01:00",
		});

		ledger.settle("s-1");

		const rows = ledger.rowsForSession("s-1");
		expect(rows[0].outcome).toBe("ineffective");
		const mem = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = 'mem-y'")
			.get() as { recurrence_count: number };
		// Only the 10:01 recurrence is charged; the exempted creating call
		// (same second as the injection) must NOT be counted.
		expect(mem.recurrence_count).toBe(1);
	});
});

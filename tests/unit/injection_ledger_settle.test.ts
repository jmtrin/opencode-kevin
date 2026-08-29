import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InjectionLedger } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K11-003 InjectionLedger ms plumbing", () => {
	let store: Store;
	beforeEach(async () => {
		store = new Store({ path: ":memory:" });
		await new Migrate(store, migrationsDir).run();
	});
	afterEach(() => {
		store.close();
	});

	it("dual-write: fresh injection row has both columns populated", () => {
		const ledger = new InjectionLedger(store, null);
		ledger.record({
			memoryId: "m1",
			fingerprint: "fp1",
			sessionId: "s1",
			hook: "pre_prompt",
			tokens: 10,
		});
		const row = store
			.prepare(
				"SELECT injected_at, injected_at_ms FROM kevin_injections WHERE memory_id = ?",
			)
			.get("m1") as { injected_at: string; injected_at_ms: number } | undefined;
		expect(row).toBeDefined();
		if (!row) return;
		expect(row.injected_at).toBeTruthy();
		expect(typeof row.injected_at_ms).toBe("number");
		// ms should be within 5s of legacy string
		const legacyMs = Date.parse(`${row.injected_at.replace(" ", "T")}Z`);
		expect(Math.abs(row.injected_at_ms - legacyMs)).toBeLessThan(5000);
	});

	it("sub-second fixture: settle distinguishes 250ms apart events", async () => {
		// Setup: create a memory to be injected
		const ms = new MemoryService(store, null);
		const memId = ms.save({
			type: "error",
			content: "boom",
			fingerprint: "fp-sub",
			origin: "reflector",
		});

		const ledger = new InjectionLedger(store, null);

		// We need to control timestamps at ms granularity.
		// Insert injection with explicit ms: we will directly insert row with known ms to simulate 250ms gap
		const baseMs = Date.now();
		const injectionMs = baseMs + 1000; // injection at T+1s
		const beforeMs = baseMs + 900; // a failing call 100ms BEFORE injection (should NOT count)
		const afterMs = baseMs + 1250; // a failing call 250ms AFTER injection (should count as recurrence)

		// Insert injection with controlled ms
		store
			.prepare(
				`INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at, injected_at_ms)
				 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', datetime('now'), ?)`,
			)
			.run(
				"inj-sub",
				memId,
				"fp-sub",
				"sess-sub",
				"pre_prompt",
				10,
				injectionMs,
			);

		// Insert two tool_calls: one before, one after — same second granularity, different ms
		// Use same datetime string for both to simulate second-level tie (both in same second)
		const legacyTs = new Date(baseMs)
			.toISOString()
			.replace("T", " ")
			.slice(0, 19);
		// before injection
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, success, fingerprint, error_fingerprint)
				 VALUES (?, ?, ?, ?, 'bash', 0, ?, ?)`,
			)
			.run("call-before", "sess-sub", legacyTs, beforeMs, "fp-sub", "fp-sub");
		// after injection - same legacy ts string, but ms 250ms later
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, success, fingerprint, error_fingerprint)
				 VALUES (?, ?, ?, ?, 'bash', 0, ?, ?)`,
			)
			.run("call-after", "sess-sub", legacyTs, afterMs, "fp-sub", "fp-sub");

		// Before fix, legacy second-granularity would tie both calls as >= injected_at (if all same second).
		// With ms, only the after call should count.

		ledger.settle("sess-sub");

		const injRow = store
			.prepare("SELECT outcome FROM kevin_injections WHERE id = ?")
			.get("inj-sub") as { outcome: string } | undefined;
		expect(injRow?.outcome).toBe("ineffective");

		const mem = store
			.prepare("SELECT recurrence_count FROM memories WHERE id = ?")
			.get(memId) as { recurrence_count: number } | undefined;
		expect(mem?.recurrence_count).toBe(1);

		// Verify that a call exactly 250ms before injection would be inconclusive if no after
		// Clean up and test opposite: only before injection exists -> should not be ineffective
		store.prepare("DELETE FROM kevin_injections").run();
		store.prepare("DELETE FROM tool_calls").run();
		store
			.prepare(
				`INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at, injected_at_ms)
				 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', ?, ?)`,
			)
			.run(
				"inj-sub2",
				memId,
				"fp-sub",
				"sess-sub2",
				"pre_prompt",
				10,
				injectionMs,
				injectionMs,
			);
		// Only before
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, success, fingerprint, error_fingerprint)
				 VALUES (?, ?, ?, ?, 'bash', 0, ?, ?)`,
			)
			.run("call-before2", "sess-sub2", legacyTs, beforeMs, "fp-sub", "fp-sub");

		const ledger2 = new InjectionLedger(store, null);
		ledger2.settle("sess-sub2");
		const injRow2 = store
			.prepare("SELECT outcome FROM kevin_injections WHERE id = ?")
			.get("inj-sub2") as { outcome: string } | undefined;
		// No recurrence, no fix -> inconclusive
		expect(injRow2?.outcome).toBe("inconclusive");
	});

	it("existing settle tests pass unmodified - effective vs inconclusive via fix", async () => {
		// This mimics the existing integration test: injection without recurrence but with fix => effective
		const ms = new MemoryService(store, null);
		const memId = ms.save({
			type: "error",
			content: "boom2",
			fingerprint: "fp-fix",
			origin: "reflector",
		});
		const ledger = new InjectionLedger(store, null);
		// Insert injection at T
		const baseMs = Date.now();
		store
			.prepare(
				`INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at, injected_at_ms)
				 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', datetime('now'), ?)`,
			)
			.run("inj-fix", memId, "fp-fix", "sess-fix", "pre_prompt", 10, baseMs);

		// Insert a success with fix_for_fingerprint after injection
		const afterMs = baseMs + 500;
		const legacyTs = new Date(baseMs)
			.toISOString()
			.replace("T", " ")
			.slice(0, 19);
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, success, fix_for_fingerprint)
				 VALUES (?, ?, ?, ?, 'bash', 1, ?)`,
			)
			.run("call-fix", "sess-fix", legacyTs, afterMs, "fp-fix");

		ledger.settle("sess-fix");
		const row = store
			.prepare("SELECT outcome FROM kevin_injections WHERE id = ?")
			.get("inj-fix") as { outcome: string } | undefined;
		expect(row?.outcome).toBe("effective");
	});
});

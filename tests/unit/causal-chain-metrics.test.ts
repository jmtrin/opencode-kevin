import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CausalChain } from "../../plugin/CausalChain.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

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

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	store.exec(SQL_004);
	store.exec(SQL_005);
	return store;
}

/** Drive one fail→fix cycle in a session: error memory + failing call +
 * success call + onSuccess link + onSessionIdle promotion. */
function runCycle(
	store: Store,
	chain: CausalChain,
	sessionId: string,
	fp: string,
	seq = 0,
): void {
	store
		.prepare(
			`INSERT INTO tool_calls (id, session_id, tool, args_summary, success, error_type, error_fingerprint)
			 VALUES (?, ?, 'bash', 'npm run typecheck', 0, 'TS2304', ?)`,
		)
		.run(`${sessionId}-fail-${seq}`, sessionId, fp);
	store
		.prepare(
			`INSERT INTO tool_calls (id, session_id, tool, args_summary, success)
			 VALUES (?, ?, 'bash', 'npm i -g rg', 1)`,
		)
		.run(`${sessionId}-fix-${seq}`, sessionId);
	chain.onSuccess("bash", {}, null, sessionId);
	chain.onSessionIdle(sessionId);
}

describe("K4-009 — patterns_promoted_new counts only new pattern rows", () => {
	it("two sessions with the same fingerprint: promoted_new === 1", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		const metrics = new Metrics(store);
		const chain = new CausalChain(store, memories, metrics);
		const fp = "a1b2c3d4a1b2c3d4";

		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: fp,
			sourceSession: "sess-a",
		});
		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: fp,
			sourceSession: "sess-b",
		});

		runCycle(store, chain, "sess-a", fp);
		runCycle(store, chain, "sess-b", fp);

		const patterns = store
			.prepare(
				`SELECT COUNT(*) AS n FROM memories
				 WHERE type = 'pattern' AND origin = 'causal'`,
			)
			.get() as { n: number };
		expect(patterns.n).toBe(1); // idempotent refresh, no duplicate row
		expect(metrics.get("patterns_promoted_new")).toBe(1);
		expect(metrics.get("patterns_causal")).toBe(0); // deprecated, frozen
	});

	it("two sessions with different fingerprints: promoted_new === 2", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		const metrics = new Metrics(store);
		const chain = new CausalChain(store, memories, metrics);

		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: "f1f1f1f1f1f1f1f1",
			sourceSession: "sess-1",
		});
		memories.save({
			type: "error",
			content: "When bash fails with EADDRINUSE: port 8080 already in use.",
			origin: "reflector",
			fingerprint: "f2f2f2f2f2f2f2f2",
			sourceSession: "sess-2",
		});

		runCycle(store, chain, "sess-1", "f1f1f1f1f1f1f1f1");
		runCycle(store, chain, "sess-2", "f2f2f2f2f2f2f2f2");

		expect(metrics.get("patterns_promoted_new")).toBe(2);
		expect(metrics.get("patterns_causal")).toBe(0);
	});

	it("patterns_causal does not grow across idle cycles", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		const metrics = new Metrics(store);
		const chain = new CausalChain(store, memories, metrics);
		const fp = "c3c3c3c3c3c3c3c3";

		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: fp,
			sourceSession: "sess-x",
		});

		runCycle(store, chain, "sess-x", fp, 1);
		runCycle(store, chain, "sess-x", fp, 2);
		runCycle(store, chain, "sess-x", fp, 3);

		expect(metrics.get("patterns_causal")).toBe(0);
		expect(metrics.get("patterns_promoted_new")).toBe(1);
	});
});

describe("BUG-006 — CausalChain refresh guard compares timestamps, not rowids", () => {
	/** fail→fix cycle with an explicit `ts` on both tool_calls. */
	function runCycleAt(
		store: Store,
		chain: CausalChain,
		sessionId: string,
		fp: string,
		ts: string,
		seq = 0,
	): void {
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, error_type, error_fingerprint)
				 VALUES (?, ?, ?, 'bash', 'npm run typecheck', 0, 'TS2304', ?)`,
			)
			.run(`${sessionId}-fail-${seq}`, sessionId, ts, fp);
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success)
				 VALUES (?, ?, ?, 'bash', 'npm i -g rg', 1)`,
			)
			.run(`${sessionId}-fix-${seq}`, sessionId, ts);
		chain.onSuccess("bash", {}, null, sessionId);
		chain.onSessionIdle(sessionId);
	}

	function patternEvidenceCount(store: Store, fp: string): number {
		const row = store
			.prepare(
				`SELECT evidence_count FROM memories
				 WHERE fingerprint = ? AND type = 'pattern' AND origin = 'causal'`,
			)
			.get(fp) as { evidence_count: number } | undefined;
		return row?.evidence_count ?? 0;
	}

	it("a pattern row younger than the linked fixes is NOT refreshed (old rowid compare would refresh it)", () => {
		// Cycle 1 promotes the pattern (created at live `datetime('now')`).
		// Cycle 2 runs in a NEW session (per-session link dedup in
		// `onSuccess` would otherwise block the second fix from linking),
		// so the fix DOES link, but its OLD timestamps (2026-08-01) make
		// MAX(tc.ts) < pattern.updated_at → the guard skips the refresh,
		// evidence_count stays 1. The old `MAX(tc.rowid) > MAX(m2.rowid)`
		// comparison would have refreshed (newer tool_calls rowids) and
		// bumped evidence_count to 2.
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		const metrics = new Metrics(store);
		const chain = new CausalChain(store, memories, metrics);
		const fp = "b6b6b6b6b6b6b6b6";

		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: fp,
			sourceSession: "sess-1",
		});
		runCycleAt(store, chain, "sess-1", fp, "2026-08-01 10:00:00", 1);
		runCycleAt(store, chain, "sess-1b", fp, "2026-08-01 11:00:00", 2);

		expect(patternEvidenceCount(store, fp)).toBe(1);
		expect(metrics.get("patterns_promoted_new")).toBe(1);
	});

	it("a fix newer than the pattern refreshes it (evidence_count bumps)", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		const metrics = new Metrics(store);
		const chain = new CausalChain(store, memories, metrics);
		const fp = "e7e7e7e7e7e7e7e7";

		memories.save({
			type: "error",
			content:
				"When bash fails with TS2304: error TS2304: Cannot find name 'foo'.",
			origin: "reflector",
			fingerprint: fp,
			sourceSession: "sess-2",
		});
		runCycleAt(store, chain, "sess-2", fp, "2026-08-01 10:00:00", 1);
		runCycleAt(store, chain, "sess-2b", fp, "2099-01-01 10:00:00", 2);

		expect(patternEvidenceCount(store, fp)).toBe(2);
		expect(metrics.get("patterns_promoted_new")).toBe(1); // refresh, not new
	});
});

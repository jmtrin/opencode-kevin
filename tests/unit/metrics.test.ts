import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../plugin/Store.js";
import { METRIC_KEYS, Metrics, estimateTokens } from "../../plugin/metrics.js";

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

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	store.exec(SQL_004);
	return store;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-metrics-"));
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("estimateTokens", () => {
	it("returns at least 1 for empty / whitespace-only input", () => {
		expect(estimateTokens("")).toBe(1);
		expect(estimateTokens("    ")).toBe(1);
	});

	it("estimates ~ length/4 for non-empty input", () => {
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("abcdefgh")).toBe(2);
		expect(estimateTokens("a".repeat(40))).toBe(10);
	});
});

describe("Metrics", () => {
	it("seeds the cache with all six seeded keys at zero on a migrated DB", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		const snap = m.snapshot();
		expect(snap.tokens_injected_pre_prompt).toBe(0);
		expect(snap.tokens_injected_compacting).toBe(0);
		expect(snap.reflections_throttled).toBe(0);
		expect(snap.duplicate_suppressions).toBe(0);
		expect(snap.tool_calls_deduped).toBe(0);
		expect(snap.patterns_mined).toBe(0);
		m.close();
		store.close();
	});

	it("seeds zeros even on a fresh DB without 003 applied", () => {
		// No migration run; kevin_metrics table does not exist yet.
		const store = new Store({ path: ":memory:" });
		const m = new Metrics(store);
		const snap = m.snapshot();
		// All 28 keys still present at zero.
		expect(Object.keys(snap).sort()).toEqual(
			[
				"artifact_writes_noop",
				"artifact_writes_total",
				"causal_links",
				"duplicate_suppressions",
				"feedback_negative_total",
				"feedback_positive_total",
				"injections_blocked_confidence",
				"injections_blocked_ignored",
				"injections_blocked_recurrence",
				"injections_blocked_seen",
				"injections_blocked_stale",
				"injections_blocked_weak",
				"injections_effective",
				"injections_inconclusive",
				"injections_ineffective",
				"injections_total",
				"memories_archived",
				"memories_superseded",
				"patterns_causal",
				"patterns_mined",
				"patterns_promoted_new",
				"proposals_approved",
				"proposals_created",
				"proposals_rejected",
				"reflections_throttled",
				"tokens_injected_compacting",
				"tokens_injected_pre_prompt",
				"tool_calls_deduped",
			].sort(),
		);
		for (const v of Object.values(snap)) expect(v).toBe(0);
		m.close();
		store.close();
	});

	it("incr updates the cache without immediately writing to the DB", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store, 1000);
		m.incr("reflections_throttled");
		m.incr("reflections_throttled");
		m.incr("duplicate_suppressions", 3);
		expect(m.get("reflections_throttled")).toBe(2);
		expect(m.get("duplicate_suppressions")).toBe(3);
		// DB has NOT been touched yet (debounce pending).
		const row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'reflections_throttled'",
			)
			.get() as { value: number };
		expect(row.value).toBe(0);
		m.close();
		store.close();
	});

	it("incr schedules a debounced flush", () => {
		vi.useFakeTimers();
		try {
			const store = makeMigratedStore();
			const m = new Metrics(store, 1000);
			m.incr("patterns_mined");
			expect(m.isFlushScheduled()).toBe(true);
			vi.advanceTimersByTime(1000);
			expect(m.isFlushScheduled()).toBe(false);
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
				.get() as { value: number };
			expect(row.value).toBe(1);
			m.close();
			store.close();
		} finally {
			vi.useRealTimers();
		}
	});

	it("coalesces multiple incr calls into a single flush", () => {
		vi.useFakeTimers();
		try {
			const store = makeMigratedStore();
			const m = new Metrics(store, 1000);
			m.incr("patterns_mined");
			m.incr("patterns_mined");
			m.incr("patterns_mined");
			m.incr("duplicate_suppressions", 5);
			expect(m.isFlushScheduled()).toBe(true);
			vi.advanceTimersByTime(1000);
			const r1 = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
				.get() as { value: number };
			const r2 = store
				.prepare(
					"SELECT value FROM kevin_metrics WHERE key = 'duplicate_suppressions'",
				)
				.get() as { value: number };
			expect(r1.value).toBe(3);
			expect(r2.value).toBe(5);
			m.close();
			store.close();
		} finally {
			vi.useRealTimers();
		}
	});

	it("flush() writes every dirty key to the DB in one transaction", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		m.incr("tokens_injected_pre_prompt", 120);
		m.incr("tokens_injected_compacting", 240);
		m.incr("reflections_throttled");
		m.incr("duplicate_suppressions", 2);
		m.incr("tool_calls_deduped", 4);
		m.incr("patterns_mined", 6);
		m.flush();

		const rows = store
			.prepare("SELECT key, value FROM kevin_metrics ORDER BY key")
			.all() as { key: string; value: number }[];
		const map = new Map(rows.map((r) => [r.key, r.value]));
		expect(map.get("tokens_injected_pre_prompt")).toBe(120);
		expect(map.get("tokens_injected_compacting")).toBe(240);
		expect(map.get("reflections_throttled")).toBe(1);
		expect(map.get("duplicate_suppressions")).toBe(2);
		expect(map.get("tool_calls_deduped")).toBe(4);
		expect(map.get("patterns_mined")).toBe(6);
		m.close();
		store.close();
	});

	it("flush() is idempotent when nothing is dirty", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		// First flush with no dirty keys is a no-op.
		expect(() => m.flush()).not.toThrow();
		// After incr + flush, a second flush with no new incrs is also a no-op.
		m.incr("patterns_mined");
		m.flush();
		const before = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
			.get() as { value: number };
		m.flush();
		const after = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
			.get() as { value: number };
		expect(after.value).toBe(before.value);
		m.close();
		store.close();
	});

	it("flush() lazily creates kevin_metrics when it does not exist yet", () => {
		// Fresh store without running migration 003.
		const store = new Store({ path: ":memory:" });
		store.exec(SQL_001);
		const m = new Metrics(store);
		m.incr("patterns_mined", 42);
		// kevin_metrics table does not exist yet -> flush creates + writes.
		expect(() => m.flush()).not.toThrow();
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
			.get() as { value: number };
		expect(row.value).toBe(42);
		m.close();
		store.close();
	});

	it("snapshot() returns a copy and does not mutate the cache", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		const snap = m.snapshot();
		snap.patterns_mined = 999;
		expect(m.get("patterns_mined")).toBe(0);
		m.close();
		store.close();
	});

	it("loads pre-existing DB values into the cache on construction", () => {
		const store = makeMigratedStore();
		// Pre-populate the DB with a known value.
		store
			.prepare(
				"UPDATE kevin_metrics SET value = 17 WHERE key = 'patterns_mined'",
			)
			.run();
		const m = new Metrics(store);
		expect(m.get("patterns_mined")).toBe(17);
		expect(m.snapshot().patterns_mined).toBe(17);
		m.close();
		store.close();
	});

	it("close() flushes pending dirty keys and stops scheduling", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		m.incr("duplicate_suppressions", 4);
		m.close();
		const row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'duplicate_suppressions'",
			)
			.get() as { value: number };
		expect(row.value).toBe(4);
		// After close, further incr's are dropped silently.
		m.incr("duplicate_suppressions", 100);
		expect(m.get("duplicate_suppressions")).toBe(4);
		store.close();
	});

	it("ignores unknown keys returned by the DB row scan", () => {
		const store = makeMigratedStore();
		// Inject a bogus row the cache does NOT track.
		store
			.prepare(
				"INSERT OR REPLACE INTO kevin_metrics (key, value) VALUES ('bogus_key', 99)",
			)
			.run();
		const m = new Metrics(store);
		// bogus_key is not part of the snapshot.
		const snap = m.snapshot() as Record<string, number>;
		expect(snap.bogus_key).toBeUndefined();
		// Tracked keys are still loaded correctly.
		expect(m.get("patterns_mined")).toBe(0);
		m.close();
		store.close();
	});
});

describe("K5-004 — v0.5.0 metrics (Glass Box)", () => {
	it("METRIC_KEYS has exactly 28 keys", () => {
		expect(METRIC_KEYS).toHaveLength(28);
	});

	it("snapshot() includes all 28 keys", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		const snap = m.snapshot();
		for (const key of METRIC_KEYS) {
			expect(Object.prototype.hasOwnProperty.call(snap, key)).toBe(true);
		}
		m.close();
		store.close();
	});

	it("precisionRate() is 0 when nothing is measured even if total is large", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		m.incr("injections_total", 100);
		expect(m.precisionRate()).toBe(0);
		m.close();
		store.close();
	});

	it("precisionRate() and coverageRate() use the measured denominator (D5-02)", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		m.incr("injections_total", 100);
		m.incr("injections_effective", 3);
		m.incr("injections_ineffective", 1);
		m.incr("injections_inconclusive", 96);
		expect(m.precisionRate()).toBeCloseTo(0.75);
		expect(m.coverageRate()).toBeCloseTo(0.04);
		m.close();
		store.close();
	});

	it("coverageRate() is 0 when the ledger is empty", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		expect(m.coverageRate()).toBe(0);
		m.close();
		store.close();
	});

	it("blockedSnapshot() returns the six counters keyed by short names", () => {
		const store = makeMigratedStore();
		const m = new Metrics(store);
		m.incr("injections_blocked_seen", 3);
		m.incr("injections_blocked_weak", 2);
		m.incr("injections_blocked_recurrence", 1);
		const blocked = m.blockedSnapshot();
		expect(blocked).toEqual({
			seen: 3,
			weak: 2,
			recurrence: 1,
			stale: 0,
			ignored: 0,
			confidence: 0,
		});
		for (const v of Object.values(blocked)) {
			expect(typeof v).toBe("number");
		}
		m.close();
		store.close();
	});
});

describe("K6-004 — v0.6.0 metrics (Pull)", () => {
	const SQL_005 = readFileSync(
		join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
		"utf8",
	);
	const SQL_006 = readFileSync(
		join(__dirname, "..", "..", "migrations", "006_v05_glassbox.sql"),
		"utf8",
	);
	const SQL_007 = readFileSync(
		join(__dirname, "..", "..", "migrations", "007_v06_pull.sql"),
		"utf8",
	);

	function makeMigratedStore007(): Store {
		const store = new Store({ path: ":memory:" });
		store.exec(SQL_001);
		store.exec(SQL_003);
		store.exec(SQL_004);
		store.exec(SQL_005);
		store.exec(SQL_006);
		store.exec(SQL_007);
		return store;
	}

	it("every key in METRIC_KEYS has a label in METRIC_KEY_LABELS", async () => {
		const { METRIC_KEY_LABELS } = await import("../../plugin/Retrospective.js");
		for (const key of METRIC_KEYS) {
			expect(typeof METRIC_KEY_LABELS[key]).toBe("string");
			expect(METRIC_KEY_LABELS[key].length).toBeGreaterThan(0);
		}
	});

	it("DB metric rows and METRIC_KEYS are the same set after migration", () => {
		const store = makeMigratedStore007();
		const rows = store.prepare("SELECT key FROM kevin_metrics").all() as {
			key: string;
		}[];
		const dbKeys = rows.map((r) => r.key).sort();
		expect(dbKeys).toEqual([...METRIC_KEYS].sort());
		store.close();
	});

	it("blockedSnapshot() includes the confidence key", () => {
		const store = makeMigratedStore007();
		const m = new Metrics(store);
		const blocked = m.blockedSnapshot();
		expect(Object.keys(blocked).sort()).toEqual([
			"confidence",
			"ignored",
			"recurrence",
			"seen",
			"stale",
			"weak",
		]);
		m.close();
		store.close();
	});

	it("precisionRate() and coverageRate() are unchanged from v0.5.0", () => {
		const store = makeMigratedStore007();
		const m = new Metrics(store);
		m.incr("injections_total", 100);
		m.incr("injections_effective", 3);
		m.incr("injections_ineffective", 1);
		m.incr("injections_inconclusive", 96);
		expect(m.precisionRate()).toBeCloseTo(0.75);
		expect(m.coverageRate()).toBeCloseTo(0.04);
		m.close();
		store.close();
	});
});

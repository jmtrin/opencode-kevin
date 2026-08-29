import type { Store } from "./Store.js";

/**
 * Seeded metric keys defined by migration 003_v02_signal.sql.
 * The order here MUST match the migration's INSERT OR IGNORE block, since
 * snapshot() relies on those keys being present in the cache even when the
 * underlying table is empty (e.g., before 003 is applied, on a fresh
 * :memory: test DB, or after a manual wipe).
 */
export const METRIC_KEYS = [
	"tokens_injected_pre_prompt",
	"tokens_injected_compacting",
	"reflections_throttled",
	"duplicate_suppressions",
	"tool_calls_deduped",
	"patterns_mined",
	"patterns_causal",
	"causal_links",
	"memories_superseded",
	"injections_total",
	"injections_effective",
	"injections_ineffective",
	"patterns_promoted_new",
	// v0.5.0 (K5-004 / plan §8.3) — order matches migration 006's seed block.
	"injections_inconclusive",
	"injections_blocked_seen",
	"injections_blocked_weak",
	"injections_blocked_recurrence",
	"injections_blocked_stale",
	"injections_blocked_ignored",
	"feedback_positive_total",
	"feedback_negative_total",
	"memories_archived",
	// v0.6.0 (K6-004 / plan §8.3) — order matches migration 007's seed block.
	// injections_blocked_confidence is the sixth member of the blocked
	// family and MUST be counted like the other five (Principle 16).
	"proposals_created",
	"proposals_approved",
	"proposals_rejected",
	"artifact_writes_total",
	"artifact_writes_noop",
	"injections_blocked_confidence",
	// v0.7.0 (K7-004 / plan §8.3) — order matches migration 008's seed block.
	// These are the Project Truth counters. No per-type precision helper is
	// exported here: the per-type split of plan §5.6 lives in `kevin_audit`
	// as pure SQL, not as a `Metrics` method, so there is never a second
	// definition of precision to drift from the first (D7-14).
	"repo_facts_scanned",
	"memories_contradicted",
	"conventions_mined",
	"conflicts_detected",
	"error_lessons_suppressed",
	// v0.8.0 (K8-003 / plan §8.3) — order matches migration 009's seed block.
	// These are the Team counters. shared_entries_total is re-derived from
	// the table by the 009 post-apply hook, never trusted from increments.
	"shared_entries_total",
	"shared_entries_imported",
	"shared_entries_exported",
	"okf_merge_folds",
	"rekey_events",
	"injections_from_shared",
	// v1.1.0 (K11-001 / plan §4, D11-01) — drift metrics; order matches 012 seed.
	"bench_regression_failures",
	"forget_requests_total",
	"forget_tombstones_published",
	// v1.2.0 (K12-001 / plan §4) — surface metrics; no migration this
	// release — rows are created on first incr via upsert (K12-001).
	"tui_snapshots_flushed",
	"tui_actions_invoked",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

const DEFAULT_FLUSH_MS = 1000;

function zeroCache(): Map<MetricKey, number> {
	const m = new Map<MetricKey, number>();
	for (const k of METRIC_KEYS) m.set(k, 0);
	return m;
}

/**
 * Cheap token estimate used when bumping the `tokens_injected_*` counters.
 * Per plan §B6.2: heuristic = block.length / 4, floored to 1 so empty strings
 * don't contribute zero tokens (avoids losing signal on whitespace-only
 * blocks).
 */
export function estimateTokens(text: string): number {
	return Math.max(1, Math.round(text.length / 4));
}

/**
 * In-memory mirror of the `kevin_metrics` table with debounced writes.
 *
 * The cache is seeded from `kevin_metrics` on construction (or zeros if the
 * table is missing — graceful degradation for unit tests and pre-003 DBs).
 * `incr()` updates the cache and schedules a debounced `flush()` (1 s by
 * default). `flush()` writes every dirty key in a single transaction and
 * clears the timer, so the call site can also force a flush on `session.idle`
 * and on plugin dispose.
 */
export class Metrics {
	private readonly cache: Map<MetricKey, number>;
	private readonly dirty: Set<MetricKey> = new Set();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly flushMs: number;
	private closed = false;

	constructor(
		private readonly store: Store,
		flushMs: number = DEFAULT_FLUSH_MS,
	) {
		this.flushMs = flushMs;
		this.cache = zeroCache();
		this.loadFromDb();
	}

	private loadFromDb(): void {
		// Graceful: kevin_metrics only exists after migration 003. If a caller
		// instantiates Metrics against a fresh / pre-003 DB, leave the zeros
		// seeded in memory; the eventual flush() will create the rows.
		let rows: { key: string; value: number }[] = [];
		try {
			rows = this.store
				.prepare("SELECT key, value FROM kevin_metrics")
				.all() as { key: string; value: number }[];
		} catch {
			rows = [];
		}
		for (const row of rows) {
			if (this.cache.has(row.key as MetricKey)) {
				this.cache.set(row.key as MetricKey, row.value);
			}
		}
	}

	incr(key: MetricKey, by = 1): void {
		if (this.closed) return;
		const current = this.cache.get(key) ?? 0;
		this.cache.set(key, current + by);
		this.dirty.add(key);
		this.scheduleFlush();
	}

	/**
	 * v0.6.0 (K6-018/019 / plan §5.8) — the pull-channel registration
	 * counters. These live OUTSIDE `METRIC_KEYS`, which is frozen at 33
	 * (K7-004 acceptance, the verified cumulative ladder), but persist to
	 * the same `kevin_metrics` table so `kevin_audit`'s channels block can
	 * read them by SQL (K6-023). They are written immediately (no debounce):
	 * they change at most twice per process, on session start.
	 */
	incrRegistered(
		key: "skills_registered" | "references_registered",
		by = 1,
	): void {
		if (this.closed) return;
		const store = this.store;
		store.transaction(() => {
			store.exec(
				`CREATE TABLE IF NOT EXISTS kevin_metrics (
			            key        TEXT PRIMARY KEY,
			            value      INTEGER NOT NULL DEFAULT 0,
			            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			          )`,
			);
			store
				.prepare(
					`INSERT INTO kevin_metrics (key, value, updated_at)
			         VALUES (?, ?, datetime('now'))
			         ON CONFLICT(key) DO UPDATE SET
			           value = value + excluded.value,
			           updated_at = datetime('now')`,
				)
				.run(key, by);
		});
	}

	/**
	 * Returns a snapshot of the cache. The returned object always contains all
	 * METRIC_KEYS, even if the DB has no rows yet. Does NOT flush.
	 */
	snapshot(): Record<MetricKey, number> {
		const out = {} as Record<MetricKey, number>;
		for (const k of METRIC_KEYS) out[k] = this.cache.get(k) ?? 0;
		return out;
	}

	/**
	 * Returns the cached value for a single key. Does NOT flush.
	 */
	get(key: MetricKey): number {
		return this.cache.get(key) ?? 0;
	}

	/**
	 * v0.4.0 (K4-008): injection precision = effective / total settled
	 * injections. 0 when the ledger has no entries yet (no division by zero).
	 * Computed from the cached counters — does NOT flush.
	 * v0.5.0 (K5-004 / plan §5.1, D5-02) — the denominator is now
	 * `effective + ineffective` only. `inconclusive` (the new majority
	 * bucket) must not inflate precision: absence of recurrence is not
	 * evidence of effect. An idle session therefore no longer drives
	 * precision toward 1.0 — expect the reported rate to fall sharply on
	 * real databases; that is the intended result.
	 */
	precisionRate(): number {
		const effective = this.cache.get("injections_effective") ?? 0;
		const measured =
			effective + (this.cache.get("injections_ineffective") ?? 0);
		if (measured <= 0) return 0;
		return Math.min(1, effective / measured);
	}

	/**
	 * v0.5.0 (K5-004 / plan §5.1, D5-02) — the share of injections that
	 * were actually measured (effective + ineffective) of all injections.
	 * Reported alongside `precisionRate` so a low measurable fraction is
	 * visible rather than hidden behind a large `total`. 0 when the ledger
	 * is empty. Computed from the cached counters — does NOT flush.
	 */
	coverageRate(): number {
		const total = this.cache.get("injections_total") ?? 0;
		if (total <= 0) return 0;
		const measured =
			(this.cache.get("injections_effective") ?? 0) +
			(this.cache.get("injections_ineffective") ?? 0);
		return Math.min(1, measured / total);
	}

	/**
	 * v0.5.0 (K5-004 / plan §5.2, D5-02) — the five `injections_blocked_*`
	 * counters keyed by their short names. Consumed by `kevin_audit`.
	 * v0.6.0 (K6-004 / plan §8.3) — sixth member keyed `confidence`
	 * (the low_confidence gate branch, K6-022).
	 * Computed from the cached counters — does NOT flush.
	 */
	blockedSnapshot(): Record<string, number> {
		return {
			seen: this.cache.get("injections_blocked_seen") ?? 0,
			weak: this.cache.get("injections_blocked_weak") ?? 0,
			recurrence: this.cache.get("injections_blocked_recurrence") ?? 0,
			stale: this.cache.get("injections_blocked_stale") ?? 0,
			ignored: this.cache.get("injections_blocked_ignored") ?? 0,
			confidence: this.cache.get("injections_blocked_confidence") ?? 0,
		};
	}

	/** True iff a debounced flush is scheduled. Useful for tests. */
	isFlushScheduled(): boolean {
		return this.flushTimer !== null;
	}

	/**
	 * Writes every dirty key to `kevin_metrics` in one transaction. Clears
	 * the debounce timer. Safe to call repeatedly; no-op when nothing is
	 * dirty or when the object is closed. Missing rows are inserted, present
	 * rows are updated. The table is created lazily on first flush so this
	 * works against pre-003 DBs too.
	 */
	flush(): void {
		if (this.closed || this.dirty.size === 0) {
			this.clearTimer();
			return;
		}
		this.clearTimer();
		const dirtyKeys = Array.from(this.dirty);
		this.dirty.clear();
		const store = this.store;
		store.transaction(() => {
			store.exec(
				`CREATE TABLE IF NOT EXISTS kevin_metrics (
			            key        TEXT PRIMARY KEY,
			            value      INTEGER NOT NULL DEFAULT 0,
			            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			          )`,
			);
			const upsert = store.prepare(
				`INSERT INTO kevin_metrics (key, value, updated_at)
			         VALUES (?, ?, datetime('now'))
			         ON CONFLICT(key) DO UPDATE SET
			           value = excluded.value,
			           updated_at = datetime('now')`,
			);
			for (const k of dirtyKeys) {
				upsert.run(k, this.cache.get(k) ?? 0);
			}
		});
	}

	close(): void {
		if (this.closed) return;
		this.flush();
		this.closed = true;
		this.clearTimer();
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush();
		}, this.flushMs);
		// unref so the timer never keeps a Node process alive on its own.
		const t = this.flushTimer as unknown as {
			unref?: () => void;
		};
		t.unref?.();
	}

	private clearTimer(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}
}

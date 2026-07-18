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

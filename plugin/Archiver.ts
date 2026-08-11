import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";

/**
 * v0.5.0 Archiver (K5-012 / plan §5.4, D5-05).
 *
 * Lifecycle tail of the memory loop: reflectors mark a lesson `stale` when
 * its fingerprint recurred enough times (penalizeRecurringReflectors,
 * migration 003), but nothing ever retires those rows — they keep
 * circulating through status filters and inflating counts. The Archiver
 * runs on `session.idle` and retires stale memories whose last activity
 * (`updated_at`, falling back to `last_verified_at`) is older than
 * `archive_after_days` (kevin_settings, seeded '30' in migration 006).
 *
 * Rules:
 *  - Only `status = 'stale'` rows with `archived_at IS NULL`.
 *  - `type != 'pattern'`: a pattern is the FIXED form of a fingerprint
 *    (K4-025); archiving it would break kevin_why and the recurrence
 *    re-admission path (QualityGate rule 4).
 *  - Clock: the injection clock (K5-008) — tests freeze it; production
 *    defaults to `new Date()`. Never `Date.now()` inside.
 *  - `memories_archived` is bumped by the batch size, once per run.
 *  - Pre-006 DBs (no `archived_at`) degrade to a no-op.
 *
 * Archived rows remain queryable with `includeSuperseded: true`-style
 * reads (status filter is exclusive, not destructive).
 */
export class Archiver {
	private readonly metrics: Metrics | null;
	private readonly now: () => Date;

	constructor(
		private readonly store: Store,
		private readonly memoryService: MemoryService,
		metrics?: Metrics | null,
		now: () => Date = () => new Date(),
	) {
		this.metrics = metrics ?? null;
		this.now = now;
	}

	/**
	 * Archives every eligible stale memory. Returns the number of rows
	 * retired. Idempotent: archived rows are excluded by `archived_at IS
	 * NULL`, so a second run archives nothing.
	 */
	run(): number {
		if (!this.hasArchivedColumn()) return 0;
		const days = this.archiveAfterDays();
		if (days <= 0) return 0;

		const now = this.now();
		const cutoff = formatSqliteUtc(new Date(now.getTime() - days * 86_400_000));
		this.store
			.prepare(
				`UPDATE memories
				    SET status = 'archived', archived_at = ?, updated_at = ?
				  WHERE status = 'stale'
				    AND type != 'pattern'
				    AND archived_at IS NULL
				    AND updated_at < ?`,
			)
			.run(formatSqliteUtc(now), formatSqliteUtc(now), cutoff);
		const changed = this.store.prepare("SELECT changes() AS n").get() as {
			n: number;
		};
		const n = changed.n;
		if (n > 0) this.metrics?.incr("memories_archived", n);
		return n;
	}

	private archiveAfterDays(): number {
		try {
			const raw = this.memoryService.getSetting("archive_after_days", "30");
			const n = Number(raw);
			return Number.isFinite(n) ? n : 30;
		} catch {
			return 30;
		}
	}

	private hasArchivedColumn(): boolean {
		return hasArchivedColumnCached(this.store);
	}
}

const archivedColumnCache = new WeakMap<Store, boolean>();
function hasArchivedColumnCached(store: Store): boolean {
	const cached = archivedColumnCache.get(store);
	if (cached !== undefined) return cached;
	try {
		store.prepare("SELECT archived_at FROM memories LIMIT 1").get();
		archivedColumnCache.set(store, true);
		return true;
	} catch {
		archivedColumnCache.set(store, false);
		return false;
	}
}

/** 'YYYY-MM-DD HH:MM:SS' UTC — the format SQLite `datetime('now')` uses,
 * so lexicographic comparisons against `updated_at` are valid. */
function formatSqliteUtc(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
		d.getUTCDate(),
	)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

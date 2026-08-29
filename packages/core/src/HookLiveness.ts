import { HOOK_NAMES } from "./Migrate.js";
import type { Store } from "./Store.js";

// v0.9.0 (K9-009/K9-010 / plan §5.3, D9-07/D9-08) — hook liveness.
//
// Observe→Verify: Kevin stops assuming the host reads its hooks. Every
// function hook is wrapped with a recorder that fires on the SUCCESS path
// only, after the delegate returns (a `finally` block would count a
// permanently-throwing hook as live, which inverts the instrument's
// meaning). Counters are in-memory; flush() persists them on the existing
// metrics.flush() cadence — a synchronous write per tool call would be the
// most expensive thing in the plugin.

export type HookName = (typeof HOOK_NAMES)[number];

export type LivenessState = "live" | "dead" | "unknown";

export interface HookReport {
	hook: HookName;
	experimental: boolean;
	state: LivenessState;
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	fireCount: number;
	expectedCount: number;
	/** v0.9.0 (K9-012) — set once when the hook went dead; never cleared. */
	deadSince: string | null;
}

interface HookCounters {
	fireCount: number;
	errorCount: number;
	expectedCount: number;
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	deadSince: string | null;
}

const DEFAULT_THRESHOLD = 3;

/**
 * v0.9.0 (K9-010 / plan §5.3, D9-09) — parse the TEXT setting
 * `dead_hook_report_threshold` into the [1, 1000] clamp. NaN and empty
 * fall back to 3 (never 0: a zero threshold would report every hook dead
 * before a single session completes a checkpoint).
 */
export function parseThreshold(text: string | null | undefined): number {
	if (text === null || text === undefined || text === "")
		return DEFAULT_THRESHOLD;
	const n = Number.parseInt(text, 10);
	// NaN → default; 0 is not a valid threshold (K9-010 AC: 'abc'/''/'0'
	// all clamp to the default of three — never zero).
	if (Number.isNaN(n) || n === 0) return DEFAULT_THRESHOLD;
	return Math.min(1000, Math.max(1, n));
}

interface HookLivenessOptions {
	/** `hook_liveness_enabled === "1"` (TEXT comparison, decided at construction). */
	enabled: boolean;
	/** Raw TEXT of `dead_hook_report_threshold`; parsed+clamped in report(). */
	thresholdText: string | null | undefined;
	/** `host.pluginVersion` at construction, stored on every flushed row. */
	pluginVersion: string | null;
}

/**
 * v0.9.0 (K9-009/K9-010 / plan §5.3) — wraps the plugin's hooks with a
 * success-path recorder, dedups per-session checkpoints, and reports each
 * hook's liveness state. Persistence is machine-scoped: the hook_liveness
 * table carries no project_id or repo_id (D9-08).
 */
export class HookLiveness {
	// v1.1.0 (K11-015) — debug counter for excess arity; never logged on hot path
	public excessArityCount = 0;
	private readonly counters: Map<HookName, HookCounters>;
	private readonly seenSessions: Map<HookName, Set<string>>;
	private readonly suppressedSessions: Set<string> = new Set();
	private readonly threshold: number;
	private readonly pluginVersion: string | null;

	constructor(
		private readonly store: Store,
		private readonly options: HookLivenessOptions,
	) {
		this.threshold = parseThreshold(options.thresholdText);
		this.pluginVersion = options.pluginVersion;
		this.counters = new Map();
		this.seenSessions = new Map();
		for (const hook of HOOK_NAMES) {
			this.counters.set(hook, {
				fireCount: 0,
				errorCount: 0,
				expectedCount: 0,
				firstSeenAt: null,
				lastSeenAt: null,
				deadSince: null,
			});
			this.seenSessions.set(hook, new Set());
		}
		this.loadFromDb();
	}

	/**
	 * Returns a new object with the same keys; function values are replaced
	 * by delegating wrappers, non-function values (the tool map) pass by
	 * reference. When liveness is disabled, returns the argument unchanged —
	 * the same object, not a copy.
	 */
	wrap<T>(hooks: T): T {
		if (!this.options.enabled) return hooks;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(
			hooks as Record<string, unknown>,
		)) {
			if (typeof value === "function") {
				out[key] = this.makeWrapper(key, value as (...a: unknown[]) => unknown);
			} else {
				out[key] = value;
			}
		}
		return out as T;
	}

	/**
	 * v0.9.0 (K9-010 / plan §5.3) — a checkpoint: the session reached a
	 * model turn (tool.execute.after fired), so the system prompt was
	 * assembled and `experimental.chat.system.transform` MUST have been
	 * offered. Deduped per session: 20 tool calls in one session count
	 * exactly one expectation.
	 */
	expect(hook: HookName, sessionID: string): void {
		const seen = this.seenSessions.get(hook);
		if (!seen || seen.has(sessionID)) return;
		seen.add(sessionID);
		const counters = this.counters.get(hook);
		if (!counters) return;
		counters.expectedCount += 1;
		// The dead flag is materialized here (not only in report()) so that
		// flush() persists dead_since even when no report() was ever called:
		// kevin_doctor's PURE-SQL blocks read dead_since from the table.
		if (
			counters.fireCount === 0 &&
			counters.expectedCount >= this.threshold &&
			counters.deadSince === null
		) {
			counters.deadSince = counters.lastSeenAt ?? new Date().toISOString();
		}
		// v0.9.0 (K9-011 / plan §5.3) — when the injection hook is dead, the
		// checkpointed session was suppressed: the host stopped offering the
		// transform, so no injection could happen. Counted once per session
		// (same dedup as expected_count) and persisted by flush(). This is
		// the counter that turns "zero injections" from an ambiguous number
		// into a diagnosis.
		if (
			hook === "experimental.chat.system.transform" &&
			counters.deadSince !== null &&
			!this.suppressedSessions.has(sessionID)
		) {
			this.suppressedSessions.add(sessionID);
		}
	}

	/**
	 * Per-hook liveness verdicts in canonical HOOK_NAMES order.
	 * A hook that fired once is live forever; dead requires both zero fires
	 * and `expectedCount >= threshold`; everything else is unknown — and
	 * unknown is never rounded to healthy (D9-09).
	 */
	report(): HookReport[] {
		const out: HookReport[] = [];
		for (const hook of HOOK_NAMES) {
			const c = this.counters.get(hook);
			if (!c) continue;
			let state: LivenessState;
			if (c.fireCount > 0) {
				state = "live";
			} else if (c.expectedCount >= this.threshold) {
				// dead_since is set ONCE and never cleared: it documents the
				// historical death even if the hook later recovers.
				if (c.deadSince === null) {
					c.deadSince = c.lastSeenAt ?? new Date().toISOString();
				}
				state = "dead";
			} else {
				state = "unknown";
			}
			out.push({
				hook,
				experimental: hook.startsWith("experimental."),
				state,
				firstSeenAt: c.firstSeenAt,
				lastSeenAt: c.lastSeenAt,
				fireCount: c.fireCount,
				expectedCount: c.expectedCount,
				deadSince: c.deadSince,
			});
		}
		return out;
	}

	/** Persists every counter row. Called on the metrics.flush() cadence. */
	flush(): void {
		const store = this.store;
		store.transaction(() => {
			// Created lazily on first flush, mirroring Metrics.flush(): the
			// migration guarantees the table in production, but unit tests
			// against pre-010 DBs must not explode at dispose.
			store.exec(
				`CREATE TABLE IF NOT EXISTS hook_liveness (
				    hook          TEXT PRIMARY KEY,
				    experimental  INTEGER NOT NULL DEFAULT 0,
				    fire_count    INTEGER NOT NULL DEFAULT 0,
				    error_count   INTEGER NOT NULL DEFAULT 0,
				    expected_count INTEGER NOT NULL DEFAULT 0,
				    first_seen_at TEXT,
				    last_seen_at  TEXT,
				    dead_since    TEXT,
				    plugin_version TEXT
				  )`,
			);
			const upsert = store.prepare(
				`INSERT INTO hook_liveness (hook, experimental, fire_count, error_count,
				  expected_count, first_seen_at, last_seen_at, dead_since, plugin_version)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(hook) DO UPDATE SET
				   experimental = excluded.experimental,
				   fire_count = excluded.fire_count,
				   error_count = excluded.error_count,
				   expected_count = excluded.expected_count,
				   first_seen_at = excluded.first_seen_at,
				   last_seen_at = excluded.last_seen_at,
				   dead_since = excluded.dead_since,
				   plugin_version = excluded.plugin_version`,
			);
			for (const [hook, c] of this.counters) {
				upsert.run(
					hook,
					hook.startsWith("experimental.") ? 1 : 0,
					c.fireCount,
					c.errorCount,
					c.expectedCount,
					c.firstSeenAt,
					c.lastSeenAt,
					c.deadSince,
					this.pluginVersion,
				);
			}
			// v0.9.0 (K9-011 / plan §5.3) — the four v0.9.0 counters are
			// re-derived here, on the metrics cadence, exactly like the 009
			// post-apply hook re-derives hooks_dead_total: SUM(fire_count),
			// SUM(error_count), COUNT(dead_since) and the per-session
			// suppression count. No Metrics dependency, no writes in the hot
			// path — flush() is the single persistence point.
			let fireSum = 0;
			let errorSum = 0;
			let deadCount = 0;
			for (const c of this.counters.values()) {
				fireSum += c.fireCount;
				errorSum += c.errorCount;
				if (c.deadSince !== null) deadCount += 1;
			}
			store.exec(
				`CREATE TABLE IF NOT EXISTS kevin_metrics (
				    key        TEXT PRIMARY KEY,
				    value      INTEGER NOT NULL DEFAULT 0,
				    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				  )`,
			);
			const derive = store.prepare(
				`INSERT INTO kevin_metrics (key, value, updated_at)
				 VALUES (?, ?, datetime('now'))
				 ON CONFLICT(key) DO UPDATE SET
				   value = excluded.value,
				   updated_at = datetime('now')`,
			);
			derive.run("hook_fires_total", fireSum);
			derive.run("hook_errors_total", errorSum);
			derive.run("hooks_dead_total", deadCount);
			derive.run(
				"injections_suppressed_dead_hook",
				this.suppressedSessions.size,
			);
		});
	}

	private makeWrapper(
		key: string,
		delegate: (...a: unknown[]) => unknown,
	): (...a: unknown[]) => Promise<unknown> {
		const record = (): void => {
			// v1.0.0 (K10-013) — dispose is recorded inside its own delegate
			// (via recordDispose()) rather than here: the wrapper's post-return
			// record would land after the store is closed and could never be
			// persisted — the event being detected is the process ending.
			if (key === "dispose") return;
			if (HOOK_NAMES.includes(key as HookName)) {
				this.recordSuccess(key as HookName);
			}
		};
		const recordError = (e: unknown): void => {
			if (HOOK_NAMES.includes(key as HookName)) {
				this.recordError(key as HookName);
			}
			throw e;
		};
		// v1.1.0 (K11-015) — arity guard: maximum supported arity is 2 (plan §5.5).
		// Excess args are sliced and counted via excessArityCount; never logged.
		return async (...args: unknown[]) => {
			let callArgs = args;
			if (args.length > 2) {
				this.excessArityCount++;
				callArgs = args.slice(0, 2);
			}
			try {
				const result = await delegate(...callArgs);
				record();
				return result;
			} catch (e) {
				return recordError(e);
			}
		};
	}

	/**
	 * v1.0.0 (K10-013 / plan §5.3) — records the `dispose` fire and
	 * flushes immediately, from inside the dispose delegate: this is the
	 * last write of the process, and nothing after it can persist.
	 */
	recordDispose(): void {
		this.recordSuccess("dispose");
		this.flush();
	}

	private recordSuccess(hook: HookName): void {
		const c = this.counters.get(hook);
		if (!c) return;
		c.fireCount += 1;
		const now = new Date().toISOString();
		if (c.firstSeenAt === null) c.firstSeenAt = now;
		c.lastSeenAt = now;
	}

	private recordError(hook: HookName): void {
		const c = this.counters.get(hook);
		if (!c) return;
		c.errorCount += 1;
	}

	private loadFromDb(): void {
		let rows: {
			hook: string;
			fire_count: number;
			error_count: number;
			expected_count: number;
			first_seen_at: string | null;
			last_seen_at: string | null;
			dead_since: string | null;
		}[] = [];
		try {
			rows = this.store
				.prepare(
					"SELECT hook, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since FROM hook_liveness",
				)
				.all() as typeof rows;
		} catch {
			// Graceful: pre-010 DBs have no hook_liveness table; the seeded
			// zeros remain until the first flush creates rows.
			rows = [];
		}
		for (const row of rows) {
			if (!HOOK_NAMES.includes(row.hook as HookName)) continue;
			const c = this.counters.get(row.hook as HookName);
			if (!c) continue;
			c.fireCount = row.fire_count;
			c.errorCount = row.error_count;
			c.expectedCount = row.expected_count;
			c.firstSeenAt = row.first_seen_at;
			c.lastSeenAt = row.last_seen_at;
			c.deadSince = row.dead_since;
		}
	}
}

// v0.9.0 (K9-012 / plan §5.5, D9-09) — pure reducer: HookReport[] → verdict.
// Any dead hook degrades the whole host; a host where every hook has fired
// is healthy; anything else is unknown. "unknown" is NEVER rounded to
// healthy: a session that never reached the checkpoint is not evidence the
// hook works. The reason string is charset-restricted (no paths, ids or
// session ids — it surfaces in kevin_doctor output).
export type HostVerdict = "healthy" | "degraded" | "unknown";

export interface HostVerdictResult {
	verdict: HostVerdict;
	reason: string;
}

export function reduceVerdict(
	reports: readonly HookReport[],
): HostVerdictResult {
	if (reports.length === 0) {
		return { verdict: "unknown", reason: "no hook reports yet" };
	}
	const dead = reports.filter((r) => r.state === "dead");
	if (dead.length > 0) {
		return {
			verdict: "degraded",
			reason: `${dead.map((r) => r.hook).join(", ")} dead since ${dead[0].deadSince ?? "unknown"}; ${dead.length} affected hook(s)`,
		};
	}
	if (reports.every((r) => r.state === "live")) {
		return { verdict: "healthy", reason: "all hooks live" };
	}
	const pending = reports.filter((r) => r.state === "unknown").length;
	return {
		verdict: "unknown",
		reason: `${pending} hook(s) without checkpoint`,
	};
}

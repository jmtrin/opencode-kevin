import { readOriginCallId } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { hasColumn } from "./columns.js";
import type { Metrics } from "./metrics.js";
import { toMs } from "./time-ms.js";
import { uuidv7 } from "./uuid.js";

/**
 * v0.4.0 InjectionLedger (K4-006/K4-007, plan §5.2, D4-04).
 *
 * The measurement half of the closed feedback loop: every lesson injected
 * into a prompt is recorded in `kevin_injections`, and at `session.idle` the
 * ledger settles each unmeasured row — if the same fingerprint failed again
 * after the injection, the lesson is `ineffective`; otherwise `effective`.
 * `precision_rate = effective / total` is the honest, measured value of the
 * injection system (replacing Kevin_Token_Impact-style estimates).
 *
 * Schema (migration 005_v04_signal.sql):
 *   kevin_injections(id PK, memory_id, fingerprint, session_id, hook,
 *                    tokens, injected_at, outcome)
 *
 * BUG-015 — a ledger row is only meaningful when its fingerprint can be
 * matched against failing tool_calls (`COALESCE(error_fingerprint,
 * fingerprint)`). Memories WITHOUT a fingerprint (agent-saved notes) can
 * never match, so they are NOT recorded: settle() would otherwise mark
 * them `effective` forever and inflate `precision_rate`. The caller
 * (ContextInjector.recordInjections) skips them.
 */
export type InjectionHook = "pre_prompt" | "compacting" | "pull_mcp";
export type InjectionChannel = "plugin" | "mcp";
// v0.5.0 (K5-005 / plan §5.1, D5-01) — a fourth outcome: an injection
// whose fingerprint neither recurred nor was followed by a linked fix is
// `inconclusive`. Absence of recurrence is not evidence of effect.
export type InjectionOutcome =
	| "unmeasured"
	| "effective"
	| "ineffective"
	| "inconclusive";

export interface InjectionRecordInput {
	memoryId: string;
	fingerprint: string;
	sessionId: string;
	hook: InjectionHook;
	tokens: number;
	/**
	 * v0.8.0 (K8-024 / plan §5.7) — the memory's layer, passed by the
	 * caller (the injector already knows it — no lookup on the hot path).
	 * Drives the `injections_from_shared` counter.
	 */
	layer?: string | null;
}

interface InjectionRow {
	id: string;
	memory_id: string;
	fingerprint: string;
	session_id: string;
	hook: InjectionHook;
	tokens: number;
	injected_at: string;
	outcome: InjectionOutcome;
}

export class InjectionLedger {
	private readonly store: Store;
	private readonly metrics: Metrics | null;

	constructor(store: Store, metrics?: Metrics | null) {
		this.store = store;
		this.metrics = metrics ?? null;
	}

	/**
	 * Records one injected memory. Idempotent at the row level (UUID PK);
	 * duplicates are expected only via the caller's per-session seen-set.
	 * v1.4.0 (K14-004 / plan §4.3, D14-04/D14-05) — optional channel, defaults to
	 * "plugin"; written only when the column exists so pre-013 DBs keep working.
	 */
	record(
		input: InjectionRecordInput,
		channel: InjectionChannel = "plugin",
	): void {
		const hasMs = hasColumn(this.store, "kevin_injections", "injected_at_ms");
		const hasChannel = hasColumn(this.store, "kevin_injections", "channel");
		if (hasMs && hasChannel) {
			this.store
				.prepare(
					`INSERT INTO kevin_injections
					   (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at_ms, channel)
					 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', ?, ?)`,
				)
				.run(
					uuidv7(),
					input.memoryId,
					input.fingerprint,
					input.sessionId,
					input.hook,
					input.tokens,
					Date.now(),
					channel,
				);
		} else if (hasMs) {
			this.store
				.prepare(
					`INSERT INTO kevin_injections
					   (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at_ms)
					 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', ?)`,
				)
				.run(
					uuidv7(),
					input.memoryId,
					input.fingerprint,
					input.sessionId,
					input.hook,
					input.tokens,
					Date.now(),
				);
		} else if (hasChannel) {
			this.store
				.prepare(
					`INSERT INTO kevin_injections
					   (id, memory_id, fingerprint, session_id, hook, tokens, outcome, channel)
					 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured', ?)`,
				)
				.run(
					uuidv7(),
					input.memoryId,
					input.fingerprint,
					input.sessionId,
					input.hook,
					input.tokens,
					channel,
				);
		} else {
			this.store
				.prepare(
					`INSERT INTO kevin_injections
					   (id, memory_id, fingerprint, session_id, hook, tokens, outcome)
					 VALUES (?, ?, ?, ?, ?, ?, 'unmeasured')`,
				)
				.run(
					uuidv7(),
					input.memoryId,
					input.fingerprint,
					input.sessionId,
					input.hook,
					input.tokens,
				);
		}
		this.metrics?.incr("injections_total", 1);
		// v0.8.0 (K8-024 / plan §5.7) — shared-layer consumption is counted
		// separately so the audit can tell how much of the push channel
		// came from teammates' entries.
		if (input.layer === "shared") {
			this.metrics?.incr("injections_from_shared", 1);
		}
	}

	/**
	 * Settles every unmeasured injection of the session: a fingerprint that
	 * failed again (as a failing tool_call) after the injection is
	 * `ineffective`, otherwise `effective`. Idempotent — only
	 * `outcome = 'unmeasured'` rows are flipped, and the recurrence charge
	 * is `MAX(recurrence_count, n)` where n = all failing calls of the
	 * fingerprint after `injected_at` (a later idle re-computes n and
	 * catches up — plan §5.1 rule 4: 3 recurrences → stale).
	 *
	 * An ineffective injection also bumps the target memory's
	 * `recurrence_count` (negative evidence, plan §5.3) and stamps
	 * `last_injected_at` (monotonically — an older row can never
	 * regress a newer injection's timestamp; the column means "most
	 * recent injection").
	 */
	settle(sessionId: string): void {
		// v1.1.0 (K11-003 / plan §5.2, D11-01/D11-07) — ms-aware settle: readers
		// prefer _ms and fall back to legacy string. Column probes are cached.
		const hasInjMs = hasColumn(
			this.store,
			"kevin_injections",
			"injected_at_ms",
		);
		const hasToolMs = hasColumn(this.store, "tool_calls", "ts_ms");
		const injections = (
			hasInjMs
				? this.store.prepare(
						`SELECT id, memory_id, fingerprint, injected_at, injected_at_ms, outcome
						   FROM kevin_injections
						  WHERE session_id = ?
						  ORDER BY injected_at ASC, id ASC`,
					)
				: this.store.prepare(
						`SELECT id, memory_id, fingerprint, injected_at, outcome
						   FROM kevin_injections
						  WHERE session_id = ?
						  ORDER BY injected_at ASC, id ASC`,
					)
		).all(sessionId) as {
			id: string;
			memory_id: string;
			fingerprint: string;
			injected_at: string;
			injected_at_ms?: number | null;
			outcome: InjectionOutcome;
		}[];

		for (const inj of injections) {
			// Same identity dimension CausalChain uses: the failing call's
			// `error_fingerprint` (stamped by Reflector) or the legacy
			// `fingerprint` hash.
			// v1.1.0 — time comparison uses toMs helper (prefers _ms).
			//
			// BUG-003 — the exemption is now bounded to the lesson's OWN
			// creating call (memories.metadata.origin_call_id, stamped by
			// Reflector). The old code excluded the session's FIRST failing
			// call of the fingerprint, which is only the creating call when
			// the lesson was born in THIS session; a lesson created in an
			// earlier session had its first in-session failure (a genuine
			// post-injection recurrence) wrongly exempted, inflating
			// precision. Memories without a tracked creating call (agent-
			// saved, test fixtures) get no exemption: only the `ts >=
			// injected_at` bound applies.
			const metaRow = this.store
				.prepare("SELECT metadata FROM memories WHERE id = ?")
				.get(inj.memory_id) as { metadata: string | null } | undefined;
			const originCallId = readOriginCallId(metaRow?.metadata ?? null);
			// v1.1.0 — heuristic: when legacy string and _ms diverge by >2s
			// (manual UPDATE of injected_at in tests), trust the string
			// because the ms reflects wall time at record, not the pinned
			// fixture time. Real rows differ by <1s (second truncation).
			const rawInjMs =
				(inj as { injected_at_ms?: number | null }).injected_at_ms ?? null;
			const stringMs = inj.injected_at
				? Date.parse(`${inj.injected_at.replace(" ", "T")}Z`)
				: null;
			const injectedMs =
				rawInjMs !== null &&
				stringMs !== null &&
				!Number.isNaN(stringMs) &&
				Math.abs(rawInjMs - stringMs) > 2000
					? stringMs
					: toMs(inj.injected_at, rawInjMs);

			// Fetch candidate failing calls for this fingerprint and filter by ms
			const failRows = (
				hasToolMs
					? this.store.prepare(
							`SELECT id, ts, ts_ms FROM tool_calls
							  WHERE session_id = ?
							    AND success = 0
							    AND COALESCE(error_fingerprint, fingerprint) = ?`,
						)
					: this.store.prepare(
							`SELECT id, ts FROM tool_calls
							  WHERE session_id = ?
							    AND success = 0
							    AND COALESCE(error_fingerprint, fingerprint) = ?`,
						)
			).all(sessionId, inj.fingerprint) as {
				id: string;
				ts: string;
				ts_ms?: number | null;
			}[];

			let n = 0;
			for (const r of failRows) {
				if (originCallId !== null && r.id === originCallId) continue;
				const tsMs = toMs(r.ts, (r as { ts_ms?: number | null }).ts_ms ?? null);
				if (injectedMs !== null && tsMs !== null) {
					if (tsMs < injectedMs) continue;
				} else {
					// fallback to string comparison when either side missing (legacy)
					if (r.ts < inj.injected_at) continue;
				}
				n++;
			}

			// v0.5.0 (K5-005 / plan §5.1, D5-01) — three-way settlement:
			//   recurrences >= 1 → ineffective  (existing side effects unchanged)
			//   else fixes >= 1  → effective    (a linked fix was OBSERVED)
			//   else             → inconclusive (new majority bucket; excluded
			//                                    from the precision denominator)
			if (n >= 1) {
				if (inj.outcome === "unmeasured") {
					this.store
						.prepare(
							`UPDATE kevin_injections SET outcome = 'ineffective'
							  WHERE id = ?`,
						)
						.run(inj.id);
					this.metrics?.incr("injections_ineffective", 1);
				}
				this.store
					.prepare(
						`UPDATE memories
						    SET recurrence_count = MAX(recurrence_count, ?),
						        last_injected_at = CASE
						          WHEN last_injected_at IS NULL
						            OR ? > last_injected_at
						            THEN ? ELSE last_injected_at END
						  WHERE fingerprint = ? AND id = ?`,
					)
					.run(
						n,
						inj.injected_at,
						inj.injected_at,
						inj.fingerprint,
						inj.memory_id,
					);
				// v0.4.0 (K4-025 / plan §5.1 rule 4, D4-06) — recurrence
				// expels: a fingerprint at `recurrence_count >= 3` is
				// demoted to `status='stale'` and never injected again
				// (only a new causal pattern — from a linked fix —
				// re-admits the lesson, not the stale error row).
				this.store
					.prepare(
						`UPDATE memories SET status = 'stale'
						  WHERE id = ? AND recurrence_count >= 3`,
					)
					.run(inj.memory_id);
			} else if (inj.outcome === "unmeasured") {
				// Mirror of the recurrence predicate with the success flag
				// inverted and the fingerprint matched on
				// `fix_for_fingerprint` (populated by CausalChain.onSuccess,
				// indexed by idx_tool_calls_fix_fp since migration 004). The
				// `ts >= injected_at` bound and `session_id = ?` filter are
				// kept; there is no `origin_call_id` exemption for fixes —
				// a fix is not the creating call.
				// v1.1.0 — ms-aware: fetch and filter via toMs.
				const fixCandidates = (
					hasToolMs
						? this.store.prepare(
								`SELECT ts, ts_ms FROM tool_calls
								  WHERE session_id = ?
								    AND success = 1
								    AND fix_for_fingerprint = ?`,
							)
						: this.store.prepare(
								`SELECT ts FROM tool_calls
								  WHERE session_id = ?
								    AND success = 1
								    AND fix_for_fingerprint = ?`,
							)
				).all(sessionId, inj.fingerprint) as {
					ts: string;
					ts_ms?: number | null;
				}[];
				let hasFix = false;
				for (const fr of fixCandidates) {
					const tsMs = toMs(
						fr.ts,
						(fr as { ts_ms?: number | null }).ts_ms ?? null,
					);
					if (injectedMs !== null && tsMs !== null) {
						if (tsMs >= injectedMs) {
							hasFix = true;
							break;
						}
					} else if (fr.ts >= inj.injected_at) {
						hasFix = true;
						break;
					}
				}
				if (hasFix) {
					this.store
						.prepare(
							`UPDATE kevin_injections SET outcome = 'effective'
							  WHERE id = ?`,
						)
						.run(inj.id);
					this.metrics?.incr("injections_effective", 1);
				} else {
					this.store
						.prepare(
							`UPDATE kevin_injections SET outcome = 'inconclusive'
							  WHERE id = ?`,
						)
						.run(inj.id);
					this.metrics?.incr("injections_inconclusive", 1);
				}
			}
		}
	}

	/**
	 * Per-fingerprint failing tool-call counts for the session. Feeds
	 * QualityGate.canInject and the HITL suggestion block.
	 */
	recurrencesFor(sessionId: string): Map<string, number> {
		const rows = this.store
			.prepare(
				`SELECT COALESCE(error_fingerprint, fingerprint) AS fp
				   FROM tool_calls
				  WHERE session_id = ? AND success = 0
				    AND (error_fingerprint IS NOT NULL OR fingerprint IS NOT NULL)`,
			)
			.all(sessionId) as { fp: string | null }[];
		const out = new Map<string, number>();
		for (const r of rows) {
			if (!r.fp) continue;
			out.set(r.fp, (out.get(r.fp) ?? 0) + 1);
		}
		return out;
	}

	/**
	 * v0.4.0 (K4-017) — recurrence counts for the QualityGate at
	 * injection time: only failing calls that happened AFTER the
	 * fingerprint was already injected this session count. The failure
	 * that *created* a lesson is not a recurrence — it precedes any
	 * injection (plan §5.1 rule 4, same `ts >= injected_at` semantics
	 * `settle` uses).
	 */
	postInjectionRecurrencesFor(sessionId: string): Map<string, number> {
		const rows = this.store
			.prepare(
				`SELECT COALESCE(t.error_fingerprint, t.fingerprint) AS fp
				   FROM tool_calls t
				  WHERE t.session_id = ? AND t.success = 0
				    AND (t.error_fingerprint IS NOT NULL OR t.fingerprint IS NOT NULL)
				    AND t.ts >= COALESCE(
				          (SELECT MAX(injected_at) FROM kevin_injections
				            WHERE session_id = t.session_id
				              AND fingerprint = COALESCE(t.error_fingerprint, t.fingerprint)),
				          '9999-12-31')`,
			)
			.all(sessionId) as { fp: string | null }[];
		const out = new Map<string, number>();
		for (const r of rows) {
			if (!r.fp) continue;
			out.set(r.fp, (out.get(r.fp) ?? 0) + 1);
		}
		return out;
	}

	/** Number of rows for the session not yet settled (drives tests and settle). */
	unsettledForSession(sessionId: string): number {
		const row = this.store
			.prepare(
				`SELECT COUNT(*) AS n FROM kevin_injections
				  WHERE session_id = ? AND outcome = 'unmeasured'`,
			)
			.get(sessionId) as { n: number };
		return row.n;
	}

	/** Latest ledger rows for a session, newest first (used by tests/tools). */
	rowsForSession(sessionId: string): InjectionRow[] {
		return this.store
			.prepare(
				`SELECT id, memory_id, fingerprint, session_id, hook, tokens,
				        injected_at, outcome
				   FROM kevin_injections
				  WHERE session_id = ?
				  ORDER BY injected_at ASC, id ASC`,
			)
			.all(sessionId) as InjectionRow[];
	}

	/**
	 * v0.5.0 (K5-005 / plan §8.4) — one grouped rollup over the whole
	 * ledger, zero-filled for every outcome. Consumed by `kevin_audit`.
	 */
	outcomeCounts(): Record<InjectionOutcome, number> {
		const rows = this.store
			.prepare(
				"SELECT outcome, COUNT(*) AS n FROM kevin_injections GROUP BY outcome",
			)
			.all() as { outcome: InjectionOutcome; n: number }[];
		const out: Record<InjectionOutcome, number> = {
			unmeasured: 0,
			effective: 0,
			ineffective: 0,
			inconclusive: 0,
		};
		for (const r of rows) {
			out[r.outcome] = r.n;
		}
		return out;
	}
}

// v1.1.0 — readOriginCallId deduplicated: imported from MemoryService (K11-003/K11-013)

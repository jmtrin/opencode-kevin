import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";
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
export type InjectionHook = "pre_prompt" | "compacting";
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
	 */
	record(input: InjectionRecordInput): void {
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
		const injections = this.store
			.prepare(
				`SELECT id, memory_id, fingerprint, injected_at, outcome
				   FROM kevin_injections
				  WHERE session_id = ?
				  ORDER BY injected_at ASC, id ASC`,
			)
			.all(sessionId) as {
			id: string;
			memory_id: string;
			fingerprint: string;
			injected_at: string;
			outcome: InjectionOutcome;
		}[];

		for (const inj of injections) {
			// Same identity dimension CausalChain uses: the failing call's
			// `error_fingerprint` (stamped by Reflector) or the legacy
			// `fingerprint` hash. `ts` and `injected_at` are both
			// `datetime('now')` text → lexicographic comparison is valid.
			// COUNT (not LIMIT 1): every failing call after the injection
			// is a recurrence — the charge must reach 3 so D4-06 expels
			// the lesson.
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
			const originCallId = readOriginCallId(this.store, inj.memory_id);
			const countRow = this.store
				.prepare(
					`SELECT COUNT(*) AS n FROM tool_calls
					  WHERE session_id = ?
					    AND success = 0
					    AND COALESCE(error_fingerprint, fingerprint) = ?
					    AND ts >= ?
					    AND (? IS NULL OR id != ?)
					 LIMIT 1`,
				)
				.get(
					sessionId,
					inj.fingerprint,
					inj.injected_at,
					originCallId,
					originCallId,
				) as { n: number };

			const n = countRow.n;

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
						countRow.n,
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
				const fixRow = this.store
					.prepare(
						`SELECT COUNT(*) AS m FROM tool_calls
						  WHERE session_id = ?
						    AND success = 1
						    AND fix_for_fingerprint = ?
						    AND ts >= ?
						 LIMIT 1`,
					)
					.get(sessionId, inj.fingerprint, inj.injected_at) as {
					m: number;
				};
				if (fixRow.m >= 1) {
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

/**
 * BUG-003 — read `origin_call_id` (the failing tool_call that CREATED the
 * memory) from memories.metadata, mirroring the feedback loop's
 * `readOriginCallId` in MemoryService. Returns null when absent/malformed.
 */
function readOriginCallId(store: Store, memoryId: string): string | null {
	const row = store
		.prepare("SELECT metadata FROM memories WHERE id = ?")
		.get(memoryId) as { metadata: string | null } | undefined;
	if (!row?.metadata) return null;
	try {
		const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
		const id = parsed?.origin_call_id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

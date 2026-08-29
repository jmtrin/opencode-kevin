import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";

/**
 * v0.2.0 PatternMiner (K2-021, plan §B6.10 / D2-08).
 *
 * Opt-in deterministic pattern miner. Reads recent `tool_calls` for a given
 * project, groups consecutive ordered 2-grams of `(tool_name)` and 3-grams
 * where the *middle* tool was a failure, and when a group reaches the
 * threshold (default `N ≥ 5` distinct sessions), emits a single
 * `type='pattern'`, `origin='pattern'` memory describing the pattern.
 *
 * Default OFF — must be enabled by setting `kevin_settings.patternminer_enabled`
 * to `'1'`. Idempotent via SELECT-before-INSERT keyed on
 * `(project_id, fingerprint, type='pattern', origin='pattern')`. Migration 003's
 * partial UNIQUE index only covers `type='error' AND origin='reflector'`, so
 * pattern memories cannot rely on a database uniqueness constraint — the
 * SELECT check inside `mine()` is the single idempotency mechanism.
 *
 * NO LLM hop (D2-08). The emitted suggestion is a deterministic template built
 * from the captured tool names.
 */
export interface PatternMinerOptions {
	/** Minimum distinct sessions a pattern must appear in before emission.
	 * Default 5 (D2-08). */
	threshold?: number;
}

interface ToolCallRow {
	id: string;
	session_id: string;
	ts: string;
	tool: string;
	success: number;
}

interface PatternCandidate {
	key: string;
	content: string;
	sessions: Set<string>;
}

const DEFAULT_THRESHOLD = 5;
const SETTING_KEY = "patternminer_enabled";

export class PatternMiner {
	private readonly store: Store;
	private readonly memoryService: MemoryService;
	private readonly metrics: Metrics | null;
	private readonly threshold: number;

	constructor(
		store: Store,
		memoryService: MemoryService,
		metrics?: Metrics | null,
		options?: PatternMinerOptions,
	) {
		this.store = store;
		this.memoryService = memoryService;
		this.metrics = metrics ?? null;
		this.threshold = options?.threshold ?? DEFAULT_THRESHOLD;
	}

	/**
	 * Mine patterns observed in `tool_calls` for the given project. Returns the
	 * number of NEW `pattern` memories emitted this cycle.
	 *
	 * When the opt-in flag `kevin_settings.patternminer_enabled` is not set to
	 * `'1'` (default), this is a no-op and returns 0.
	 *
	 * When `projectId` is null/undefined, mines tool_calls whose `project_id`
	 * IS NULL (legacy / opt-out flow). When `projectId` is a string, mines
	 * tool_calls scoped to that project only.
	 */
	mine(projectId?: string | null): number {
		if (!this.isEnabled()) return 0;

		const rows = this.fetchToolCalls(projectId ?? null);
		if (rows.length === 0) return 0;

		const candidates = this.collectCandidates(rows);
		if (candidates.length === 0) return 0;

		let emitted = 0;
		for (const c of candidates) {
			if (c.sessions.size < this.threshold) continue;
			const fp = computeFingerprint(c.content, projectId ?? undefined);
			// Idempotency: migration 003's partial unique only covers
			// (type='error', origin='reflector'). For pattern memories we
			// SELECT to detect a prior emission with the same
			// (project_id, fingerprint, type='pattern', origin='pattern').
			const existing = this.store
				.prepare(
					`SELECT id FROM memories
					 WHERE type = 'pattern' AND origin = 'pattern'
					   AND fingerprint = ?
					   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))
					 LIMIT 1`,
				)
				.get(fp, projectId ?? null, projectId ?? null) as
				| { id: string }
				| undefined;
			if (existing) continue;

			this.memoryService.save({
				type: "pattern",
				origin: "pattern",
				fingerprint: fp,
				content: c.content,
				scope: "project",
				projectId: projectId ?? undefined,
				relevanceScore: 0.5,
				sourceTool: "PatternMiner",
			});
			this.metrics?.incr("patterns_mined", 1);
			emitted += 1;
		}
		return emitted;
	}

	private isEnabled(): boolean {
		const row = this.store
			.prepare("SELECT value FROM kevin_settings WHERE key = ?")
			.get(SETTING_KEY) as { value: string } | undefined;
		return row?.value === "1";
	}

	private fetchToolCalls(projectId: string | null): ToolCallRow[] {
		const nullPid = projectId === null || projectId === undefined;
		const sql = nullPid
			? `SELECT id, session_id, ts, tool, success FROM tool_calls
			   WHERE project_id IS NULL
			   ORDER BY session_id ASC, ts ASC`
			: `SELECT id, session_id, ts, tool, success FROM tool_calls
			   WHERE project_id = ?
			   ORDER BY session_id ASC, ts ASC`;
		const stmt = this.store.prepare(sql);
		const rows = (nullPid ? stmt.all() : stmt.all(projectId)) as ToolCallRow[];
		return rows;
	}

	private collectCandidates(rows: ToolCallRow[]): PatternCandidate[] {
		// Group rows by session_id preserving arrival order. The SQL already
		// orders by (session_id ASC, ts ASC), so a sequential scan yields each
		// session's tool_calls in execution order.
		const bySession = new Map<string, ToolCallRow[]>();
		for (const r of rows) {
			let list = bySession.get(r.session_id);
			if (!list) {
				list = [];
				bySession.set(r.session_id, list);
			}
			list.push(r);
		}

		// 2-grams: ordered pair (a, b) of consecutive tool names per session.
		// 3-grams: ordered triple (a, b, c) where the middle tool b failed
		// (success = 0). These capture the "X→Y fails then Z" lifecycle that
		// the plan §B6.10 calls out.
		const map = new Map<string, PatternCandidate>();
		const record = (key: string, content: string, sessionId: string) => {
			let cand = map.get(key);
			if (!cand) {
				cand = { key, content, sessions: new Set<string>() };
				map.set(key, cand);
			}
			cand.sessions.add(sessionId);
		};

		for (const [sessionId, list] of bySession) {
			for (let i = 0; i < list.length - 1; i++) {
				const a = list[i];
				const b = list[i + 1];
				const key2 = `2g::${a.tool}::${b.tool}`;
				const content2 = `Pattern: tool "${a.tool}" followed by tool "${b.tool}". Review the ${a.tool}→${b.tool} contract before retrying.`;
				record(key2, content2, sessionId);

				if (i + 2 < list.length) {
					const c = list[i + 2];
					if (b.success === 0) {
						const key3 = `3g::${a.tool}::${b.tool}::${c.tool}`;
						const content3 = `Pattern: tool "${a.tool}" followed by failing tool "${b.tool}" then tool "${c.tool}". Review the ${a.tool}→${b.tool}(failed)→${c.tool} contract before retrying.`;
						record(key3, content3, sessionId);
					}
				}
			}
		}

		return Array.from(map.values());
	}
}

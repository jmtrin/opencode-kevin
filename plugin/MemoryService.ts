import type { Store } from "./Store.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

export type MemoryType = "error" | "pattern" | "decision" | "context";
export type MemoryScope = "project" | "session";
export type MemoryOrigin = "reflector" | "agent" | "pattern" | "retrospective";

export interface Memory {
	id: string;
	type: MemoryType;
	content: string;
	scope: MemoryScope;
	relevanceScore: number;
	sourceTool?: string | null;
	sourceSession?: string | null;
	metadata?: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string | null;
	/** v0.2.0 — project the memory belongs to (nullable for legacy rows). */
	projectId?: string | null;
	/** v0.2.0 — content fingerprint for dedup (only set for `type='error'`). */
	fingerprint?: string | null;
	/** v0.2.0 — origin of the memory. */
	origin?: MemoryOrigin | null;
}

export interface SaveInput {
	type: MemoryType;
	content: string;
	scope?: MemoryScope;
	relevanceScore?: number;
	sourceTool?: string;
	sourceSession?: string;
	metadata?: Record<string, unknown>;
	expiresAt?: string;
	/** v0.2.0 — project id. When absent, the memory is cross-project (NULL project_id). */
	projectId?: string;
	/** v0.2.0 — origin. Defaults to `'agent'` when omitted. */
	origin?: MemoryOrigin;
	/** v0.2.0 — explicit fingerprint. Auto-derived for `type='error'` if absent. */
	fingerprint?: string;
}

export interface QueryInput {
	text: string;
	type?: string;
	scope?: MemoryScope | "all";
	limit?: number;
	/** v0.2.0 — when true, returns full `Memory` rows (v0.1.x behavior).
	 * When `false` or absent, returns `SlimMemory` rows (default v0.2.0
	 * behavior, per plan §B6.3 / K2-010).
	 */
	full?: boolean;
}

/** v0.2.0 — slim query payload (K2-010). Snippet is a short content prefix;
 * `score` is the FTS5 BM25 score when available, falling back to
 * `relevanceScore` for non-FTS callers. */
export interface SlimMemory {
	id: string;
	type: MemoryType;
	scope: MemoryScope;
	score: number;
	snippet: string;
}

const MAX_SNIPPET_CHARS = 200;

function toSlim(mem: Memory): SlimMemory {
	const rawScore = (mem.metadata as Record<string, unknown> | null)?.score;
	return {
		id: mem.id,
		type: mem.type,
		scope: mem.scope,
		score: typeof rawScore === "number" ? rawScore : mem.relevanceScore,
		snippet: mem.content.slice(0, MAX_SNIPPET_CHARS),
	};
}

export interface GetRelevantInput {
	query?: string;
	maxTokens?: number;
	scope?: MemoryScope | "all";
}

interface MemoryRow {
	id: string;
	type: MemoryType;
	content: string;
	scope: MemoryScope;
	relevance_score: number;
	source_tool: string | null;
	source_session: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	/** v0.2.0 columns — nullable for rows from pre-003 DBs. */
	project_id?: string | null;
	fingerprint?: string | null;
	origin?: MemoryOrigin | null;
}

const TYPE_PRIORITY: Record<MemoryType, number> = {
	error: 0,
	pattern: 1,
	decision: 2,
	context: 3,
};

const SESSION_DEFAULT_TTL_HOURS = 24;
const RELEVANCE_BUMP = 0.05;
const RELEVANCE_MAX = 1.0;

// v0.2.0 origin-aware ranking (K2-023, plan §B6.3 / D2-13).
// Applied as a multiplier on the base rank (FTS5 BM25 or -relevance_score).
// Reflectors lessons outrank pattern-miner lessons outrank agent-saved
// notes, all else equal. No embeddings, no RRF.
const ORIGIN_BOOST_REFLECTOR = 2;
const ORIGIN_BOOST_PATTERN = 1.5;
const ORIGIN_BOOST_AGENT = 1;
const RECENCY_DECAY_PER_DAY = 0.95; // newer = closer to 1 (less penalty)

function sqliteUtcToMs(createdAt: string): number {
	// SQLite `datetime('now')` returns 'YYYY-MM-DD HH:MM:SS' in UTC.
	// JS Date can parse ISO 8601 with 'T' and 'Z'.
	const iso = createdAt.includes("T")
		? createdAt
		: `${createdAt.replace(" ", "T")}Z`;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? Date.now() : ms;
}

// SQLite/better-sqlite3 surface both error code and message variants depending
// on the underlying driver (node:sqlite vs better-sqlite3). Match loosely.
const UNIQUE_VIOLATION_RE =
	/SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed/i;

function sqliteUtcNowPlusHours(hours: number): string {
	const d = new Date(Date.now() + hours * 3_600_000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
		d.getUTCDate(),
	)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function mapRow(row: MemoryRow, score?: number): Memory {
	const mem: Memory = {
		id: row.id,
		type: row.type,
		content: row.content,
		scope: row.scope,
		relevanceScore: row.relevance_score,
		sourceTool: row.source_tool,
		sourceSession: row.source_session,
		metadata: row.metadata
			? (JSON.parse(row.metadata) as Record<string, unknown>)
			: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at,
		projectId: row.project_id ?? null,
		fingerprint: row.fingerprint ?? null,
		origin: (row.origin as MemoryOrigin | null | undefined) ?? null,
	};
	if (score !== undefined) {
		if (!mem.metadata) mem.metadata = {};
		(mem.metadata as Record<string, unknown>).score = score;
	}
	return mem;
}

function sanitizeMatch(text: string): string {
	const tokens = stripUnbalancedQuotes(text.trim())
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.map((t) => `"${t.replace(/"/g, '""')}"`);
	return tokens.join(" ");
}

function stripUnbalancedQuotes(s: string): string {
	const count = (s.match(/"/g) ?? []).length;
	if (count % 2 === 0) return s;
	return s.replace(/"/g, "");
}

function isNotSearchable(mem: Memory): boolean {
	return (
		(mem.metadata as Record<string, unknown> | null)?.not_searchable === true
	);
}

export class MemoryService {
	private readonly metrics: Metrics | null;

	constructor(store: Store, metrics?: Metrics | null) {
		this.store = store;
		this.metrics = metrics ?? null;
	}

	// `store` is declared here (rather than as a constructor parameter property)
	// so that Metrics can be added without changing the parameter order callers
	// have been using since v0.1.0.
	private store: Store;

	save(input: SaveInput): string {
		const scope = input.scope ?? "project";
		const relevanceScore = input.relevanceScore ?? 0.5;
		const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
		const origin: MemoryOrigin = input.origin ?? "agent";
		const projectId = input.projectId ?? null;

		// Fingerprint is used for dedup (error memories via migration 003
		// partial unique index) AND for pattern idempotency (K2-021 — pattern
		// memories store an explicit fingerprint so PatternMiner's SELECT-before-
		// INSERT idempotency check can find prior emissions). Callers may pass
		// an explicit fingerprint for any type; we honor it verbatim. For
		// type='error' only, we auto-compute from content when the caller left
		// it absent.
		let fp: string | null = null;
		if (input.fingerprint) {
			fp = input.fingerprint;
		} else if (input.type === "error") {
			fp = computeFingerprint(input.content, projectId ?? undefined);
		}

		let expiresAt: string | null = input.expiresAt ?? null;
		if (scope === "session" && !input.expiresAt) {
			expiresAt = sqliteUtcNowPlusHours(SESSION_DEFAULT_TTL_HOURS);
		}

		const id = uuidv7();

		try {
			this.store
				.prepare(
					`INSERT INTO memories
             (id, type, content, scope, relevance_score, source_tool, source_session,
              metadata, expires_at, project_id, fingerprint, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					input.type,
					input.content,
					scope,
					relevanceScore,
					input.sourceTool ?? null,
					input.sourceSession ?? null,
					metadata,
					expiresAt,
					projectId,
					fp,
					origin,
				);
			return id;
		} catch (err) {
			const msg = (err as { message?: string } | undefined)?.message ?? "";
			if (!UNIQUE_VIOLATION_RE.test(msg)) throw err;
			// Dedup path enabled by migration 003 partial unique index
			// `uq_memories_error_fp`. The index only fires for
			// type='error' AND fingerprint NOT NULL AND origin='reflector', so
			// an agent-saved identical error memory would NOT have collided.
			if (fp === null || origin !== "reflector") throw err;
			const existing = this.store
				.prepare(
					`SELECT id FROM memories
            WHERE project_id IS ?
              AND fingerprint = ?
              AND type = 'error'
              AND origin = 'reflector'
            LIMIT 1`,
				)
				.get(projectId, fp) as { id: string } | undefined;
			this.metrics?.incr("duplicate_suppressions", 1);
			if (existing) return existing.id;
			// Defensive: if the unique fired but the lookup returns nothing
			// (concurrent delete race), fall through and rethrow rather than
			// fabricate an id.
			throw err;
		}
	}

	getById(id: string): Memory | null {
		const row = this.store
			.prepare(
				`SELECT id, type, content, scope, relevance_score, source_tool, source_session,
                metadata, created_at, updated_at, expires_at,
                project_id, fingerprint, origin
         FROM memories WHERE id = ?`,
			)
			.get(id) as MemoryRow | undefined;
		return row ? mapRow(row) : null;
	}

	update(id: string, fields: Partial<Memory>): void {
		const cols: string[] = [];
		const vals: unknown[] = [];
		if (fields.content !== undefined) {
			cols.push("content = ?");
			vals.push(fields.content);
		}
		if (fields.relevanceScore !== undefined) {
			cols.push("relevance_score = ?");
			vals.push(fields.relevanceScore);
		}
		if (fields.scope !== undefined) {
			cols.push("scope = ?");
			vals.push(fields.scope);
		}
		if (fields.type !== undefined) {
			cols.push("type = ?");
			vals.push(fields.type);
		}
		if (fields.metadata !== undefined) {
			cols.push("metadata = ?");
			vals.push(fields.metadata ? JSON.stringify(fields.metadata) : null);
		}
		if (fields.expiresAt !== undefined) {
			cols.push("expires_at = ?");
			vals.push(fields.expiresAt);
		}
		if (cols.length === 0) return;
		cols.push("updated_at = datetime('now')");
		vals.push(id);
		this.store
			.prepare(`UPDATE memories SET ${cols.join(", ")} WHERE id = ?`)
			.run(...vals);
	}

	delete(id: string): void {
		this.store.prepare("DELETE FROM memories WHERE id = ?").run(id);
	}

	/** v0.1.x behavior — returns full `Memory` rows. */
	query(input: QueryInput & { full: true }): Memory[];
	/** v0.2.0 default — returns `SlimMemory` rows. */
	query(input: QueryInput): SlimMemory[];
	query(input: QueryInput): Memory[] | SlimMemory[] {
		const match = sanitizeMatch(input.text);
		if (match.length === 0) {
			return input.full === true ? [] : [];
		}

		const scope = input.scope ?? "all";
		const limit = input.limit ?? 10;

		let sql = `
      SELECT m.id, m.type, m.content, m.scope, m.relevance_score,
             m.source_tool, m.source_session, m.metadata,
             m.created_at, m.updated_at, m.expires_at,
             m.project_id, m.fingerprint, m.origin,
             bm25(memories_fts) AS score
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))`;
		const params: unknown[] = [match];
		if (input.type) {
			sql += " AND m.type = ?";
			params.push(input.type);
		}
		if (scope !== "all") {
			sql += " AND m.scope = ?";
			params.push(scope);
		}
		sql += " ORDER BY bm25(memories_fts) LIMIT ?";
		params.push(limit);

		const rows = this.store.prepare(sql).all(...params) as (MemoryRow & {
			score: number;
		})[];
		const memories = rows
			.map((r) => mapRow(r, r.score))
			.filter((m) => !isNotSearchable(m));
		return input.full === true ? memories : memories.map(toSlim);
	}

	private loadAll(scope: MemoryScope | "all"): MemoryRow[] {
		let sql = `
      SELECT id, type, content, scope, relevance_score, source_tool, source_session,
             metadata, created_at, updated_at, expires_at,
             project_id, fingerprint, origin
      FROM memories
      WHERE (expires_at IS NULL OR expires_at > datetime('now'))`;
		const params: unknown[] = [];
		if (scope !== "all") {
			sql += " AND scope = ?";
			params.push(scope);
		}
		sql += " ORDER BY relevance_score DESC, created_at DESC";
		return this.store.prepare(sql).all(...params) as MemoryRow[];
	}

	private queryRelevant(text: string, scope: MemoryScope | "all"): Memory[] {
		const tokens = stripUnbalancedQuotes(text.trim())
			.split(/\s+/)
			.filter((t) => t.length > 0)
			.map((t) => `"${t.replace(/"/g, '""')}"`);
		if (tokens.length === 0) return [];
		const match = tokens.join(" OR ");

		let sql = `
      SELECT m.id, m.type, m.content, m.scope, m.relevance_score,
             m.source_tool, m.source_session, m.metadata,
             m.created_at, m.updated_at, m.expires_at,
             m.project_id, m.fingerprint, m.origin,
             bm25(memories_fts) AS score
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))`;
		const params: unknown[] = [match];
		if (scope !== "all") {
			sql += " AND m.scope = ?";
			params.push(scope);
		}
		sql += " ORDER BY bm25(memories_fts) LIMIT 100";

		const rows = this.store.prepare(sql).all(...params) as (MemoryRow & {
			score: number;
		})[];
		return rows
			.map((r) => mapRow(r, r.score))
			.filter((m) => !isNotSearchable(m));
	}

	getRelevant(input: GetRelevantInput): Memory[] {
		const maxTokens = input.maxTokens ?? 2000;
		const charBudget = maxTokens * 4;
		const scope = input.scope ?? "project";

		let candidates: Memory[];
		if (input.query && input.query.trim().length > 0) {
			candidates = this.queryRelevant(input.query, scope);
		} else {
			candidates = this.loadAll(scope)
				.map((r) => mapRow(r))
				.filter((m) => !isNotSearchable(m));
		}

		// v0.2.0 (K2-023) origin-aware rank: BM25 × origin-boost × recency-decay.
		// Tie-breakers preserve the v0.1.x spirit (errors/patterns before
		// context; newer before older when nothing else decides).
		candidates.sort((a, b) => rankCompare(a, b));

		const result: Memory[] = [];
		let used = 0;
		for (const mem of candidates) {
			const len = mem.content.length + 32;
			if (used + len > charBudget && result.length > 0) break;
			result.push(mem);
			used += len;
		}

		if (result.length > 0) {
			const bump = this.store.prepare(
				"UPDATE memories SET relevance_score = MIN(?, relevance_score + ?) WHERE id = ?",
			);
			this.store.transaction(() => {
				for (const m of result) bump.run(RELEVANCE_MAX, RELEVANCE_BUMP, m.id);
			});
		}
		return result;
	}

	/**
	 * v0.2.0 (K2-026) — Feedback loop positive half (plan §B6.10 / D2-10).
	 *
	 * For each reflector-sourced error memory emitted during the given session
	 * whose fingerprint did NOT recur as a failing `tool_call` within the same
	 * project, bump `relevance_score` by `RELEVANCE_BUMP` (capped at
	 * `RELEVANCE_MAX`). Agent-saved memories are NEVER auto-boosted by this
	 * loop (anti-gaming guarantee, D2-06).
	 *
	 * Returns the number of memories that received a positive boost.
	 */
	boostPositiveReflectors(sessionId: string): number {
		if (!sessionId) return 0;
		const lessons = this.store
			.prepare(
				`SELECT id, fingerprint, project_id
				 FROM memories
				 WHERE origin = 'reflector'
				   AND type = 'error'
				   AND source_session = ?
				   AND fingerprint IS NOT NULL`,
			)
			.all(sessionId) as Array<{
			id: string;
			fingerprint: string;
			project_id: string | null;
		}>;
		if (lessons.length === 0) return 0;
		const recurrenceCheck = this.store.prepare(
			`SELECT COUNT(*) AS c
			 FROM tool_calls
			 WHERE fingerprint = ?
			   AND success = 0
			   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))`,
		);
		const bumpOne = this.store.prepare(
			"UPDATE memories SET relevance_score = MIN(?, relevance_score + ?) WHERE id = ?",
		);
		let boosted = 0;
		this.store.transaction(() => {
			for (const l of lessons) {
				const row = recurrenceCheck.get(
					l.fingerprint,
					l.project_id,
					l.project_id,
				) as { c: number } | undefined;
				const c = row?.c ?? 0;
				if (c === 0) {
					bumpOne.run(RELEVANCE_MAX, RELEVANCE_BUMP, l.id);
					boosted += 1;
				}
			}
		});
		return boosted;
	}
}

function originBoost(mem: Memory): number {
	switch (mem.origin ?? "agent") {
		case "reflector":
			return ORIGIN_BOOST_REFLECTOR;
		case "pattern":
			return ORIGIN_BOOST_PATTERN;
		default:
			return ORIGIN_BOOST_AGENT;
	}
}

function rankScore(mem: Memory): number {
	// FTS5 bm25 returns a negative score (more negative = better match).
	// For non-FTS rows (loadAll path), fall back to -relevance_score so
	// higher-relevance memories also come first under the same sign convention.
	const rawScore = (mem.metadata as Record<string, unknown> | null)?.score;
	const base = typeof rawScore === "number" ? rawScore : -mem.relevanceScore;
	const ageDays = Math.max(
		0,
		(Date.now() - sqliteUtcToMs(mem.createdAt)) / 86_400_000,
	);
	const recencyDecay = RECENCY_DECAY_PER_DAY ** ageDays;
	return base * originBoost(mem) * recencyDecay;
}

function rankCompare(a: Memory, b: Memory): number {
	const ra = rankScore(a);
	const rb = rankScore(b);
	if (ra !== rb) return ra - rb; // ascending: most negative (best) first
	if (TYPE_PRIORITY[a.type] !== TYPE_PRIORITY[b.type]) {
		return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
	}
	return sqliteUtcToMs(b.createdAt) - sqliteUtcToMs(a.createdAt); // newer first
}

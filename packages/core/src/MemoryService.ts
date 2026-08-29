import { deterministicFixLine } from "./LessonFixer.js";
import type { Store } from "./Store.js";
import {
	hasCuratedColumn as columnsHasCurated,
	hasIgnoredColumn as columnsHasIgnored,
	hasLayerColumn as columnsHasLayer,
	hasRecurrenceColumn as columnsHasRecurrence,
	hasRepoIdColumn as columnsHasRepoId,
	hasTruthColumns as columnsHasTruth,
} from "./columns.js";
import { computeConfidence } from "./confidence.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import { classify } from "./inferability.js";
import type { Metrics } from "./metrics.js";
import { toMatchClause, tokenizeQuery } from "./query-tokenizer.js";
import { uuidv7 } from "./uuid.js";

export type MemoryType =
	| "error"
	| "pattern"
	| "decision"
	| "context"
	| "rule"
	| "solution";
export type MemoryScope = "project" | "session";
export type MemoryOrigin =
	| "reflector"
	| "agent"
	| "pattern"
	| "retrospective"
	| "causal"
	| "imported";

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
	/** v0.3.0 — confidence derived from causal evidence (0..1). Only set by CausalChain. */
	confidence?: number | null;
	/** v0.3.0 — number of confirmed causal fix confirmations. */
	evidenceCount?: number | null;
	/** v0.3.0 — last time causal evidence was observed. */
	lastVerifiedAt?: string | null;
	/** v0.3.0 — lifecycle status. Default 'active'. */
	status?: string | null;
	/** v0.4.0 — deterministic capture of the linked fix call (K4-014). */
	fixArgs?: string | null;
	/** v0.4.0 (BUG-008/010) — negative evidence: how many times the
	 * fingerprint recurred after injection (demotes confidence). */
	recurrenceCount?: number | null;
	/** v0.5.0 (K5-009 / plan §5.3, D5-07) — human verdict: ignored memories
	 * are excluded from retrieval and injection. */
	ignored?: boolean;
	/** v0.5.0 (K5-009 / plan §5.3) — id of the memory that superseded this
	 * one (decision/rule replacement, K3-014). Null when active. */
	supersedes?: string | null;
	/** v0.5.0 (K5-010 / plan §5.3, D5-02) — human judgement counters,
	 * folded into confidence by computeConfidence. */
	feedbackPositive?: number;
	/** v0.6.0 (K6-011 / plan §5.4) — curation state: curated memories have
	 * been written to AGENTS.md and are excluded from new candidates. */
	curated?: boolean;
	/** v0.6.0 (K6-011 / plan §5.4) — when the memory was curated (ISO time). */
	curatedAt?: string | null;
	/** v0.6.0 (K6-011 / plan §5.3) — deterministic inferability verdict from
	 * `inferability.classify()`; `null` = unknown, never collapsed. */
	inferable?: "inferable" | "non_inferable" | null;
	/** v0.5.0 (K5-010 / plan §5.3, D5-02) — human judgement counters,
	 * folded into confidence by computeConfidence. */
	feedbackNegative?: number;
	/** v0.7.0 (K7-008 / plan §5.3, D7-03) — de-ranking penalty in
	 * [0, 0.5], clamped by applyTruthPenalty. Multiplies rankScore as
	 * `(1 - truthPenalty)`. Defaults to 0. */
	truthPenalty?: number | null;
	/** v0.7.0 (K7-008 / plan §5.3, D7-03) — first contradiction timestamp. */
	contradictedAt?: string | null;
	/** v0.8.0 (K8-018 / plan §5.2) — the memory's layer marker: 'local'
	 * (default) or 'shared'. */
	layer?: string | null;
}

/**
 * v0.8.0 (K8-018 / plan §5.2) — outcome of `update()`. A refusal is a
 * typed value, never a throw and never a silent no-op.
 */
export type MemoryUpdateResult =
	| { ok: true }
	| { ok: false; refused: readonly string[] };

/**
 * v0.8.0 (K8-018 / plan §5.2) — the shared layer's immutable columns,
 * by Memory field name. See the contract comment in `update()`.
 */
const SHARED_FORBIDDEN_FIELDS = {
	content: "statement",
	type: "type",
	scope: "scope",
	relevanceScore: "confidence",
	evidenceCount: "evidence_count",
} as const;

export interface SaveInput {
	type: MemoryType;
	content: string;
	/** v0.4.0 (BUG-008) — preserve the original id on okf import;
	 * when absent a fresh uuidv7 is generated. */
	id?: string;
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
	/** v0.3.0 — number of confirmed causal fix confirmations. */
	evidenceCount?: number;
	/** v0.3.0 — last time causal evidence was observed. */
	lastVerifiedAt?: string;
	/** v0.3.0 — lifecycle status. Default 'active'. */
	status?: string;
	/** v0.4.0 (BUG-008/010) — how many times the fingerprint recurred
	 * after injection (negative evidence, demotes confidence). */
	recurrenceCount?: number;
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
	/** v0.3.0 — when true, includes rows where status = 'superseded'.
	 * Default false (only active rows). */
	includeSuperseded?: boolean;
	/** v0.3.0 (BUG-001) — when true, the slim payload also carries
	 * `confidence`, `evidence_count` and `last_verified_at` (v0.3.0 K3
	 * evidence fields). Default false (minimal slim shape). */
	evidence?: boolean;
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

/** v0.3.0 (BUG-001) — slim payload extended with the evidence fields when
 * `query({ evidence: true })`. Fills the `kevin_query(evidence: true)`
 * contract without falling back to the full `Memory` shape. */
export interface SlimMemoryWithEvidence extends SlimMemory {
	confidence: number | null;
	evidence_count: number | null;
	last_verified_at: string | null;
}

const MAX_SNIPPET_CHARS = 200;

function toSlim(
	mem: Memory,
	evidence = false,
): SlimMemory | SlimMemoryWithEvidence {
	const base: SlimMemory = {
		id: mem.id,
		type: mem.type,
		scope: mem.scope,
		score:
			typeof (mem.metadata as Record<string, unknown> | null)?.score ===
			"number"
				? ((mem.metadata as Record<string, unknown>).score as number)
				: mem.relevanceScore,
		snippet: mem.content.slice(0, MAX_SNIPPET_CHARS),
	};
	if (!evidence) return base;
	return {
		...base,
		confidence: mem.confidence ?? null,
		evidence_count: mem.evidenceCount ?? null,
		last_verified_at: mem.lastVerifiedAt ?? null,
	};
}

export interface GetRelevantInput {
	query?: string;
	maxTokens?: number;
	scope?: MemoryScope | "all";
	/** v0.3.0 — when true, includes rows where status = 'superseded'.
	 * Default false (only active rows). */
	includeSuperseded?: boolean;
	/**
	 * v0.4.0 (BUG-016) — when false, the relevance bump (K2-023) is
	 * skipped. Used by ContextInjector's probe fetch so the decision and
	 * any retry both see the ORIGINAL ranking; the single bump is applied
	 * by the fetch that actually produces the injected block.
	 */
	bump?: boolean;
	/**
	 * v0.5.0 (K5-008 / plan §5.6, D5-10) — injectable clock. Defaults to
	 * `new Date()` at the top of the method and is the ONLY time source
	 * for recency decay: replay and tests can freeze time. Never call
	 * `Date.now()` again inside the method.
	 */
	now?: Date;
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
	/** v0.3.0 */
	evidence_count?: number;
	last_verified_at?: string | null;
	status?: string;
	/** v0.4.0 */
	recurrence_count?: number;
	/** v0.4.0 */
	fix_args?: string | null;
	/** v0.5.0 (K5-009) */
	ignored?: number;
	/** v0.5.0 (K5-009) */
	superseded_by?: string | null;
	/** v0.5.0 (K5-010) */
	feedback_positive?: number;
	/** v0.5.0 (K5-010) */
	feedback_negative?: number;
	/** v0.6.0 (K6-011 / migration 007) */
	curated?: number;
	/** v0.6.0 (K6-011 / migration 007) */
	curated_at?: string | null;
	/** v0.6.0 (K6-011 / migration 007) — 1 = inferable, 0 = non_inferable,
	 * NULL = unknown. */
	inferable?: number | null;
	/** v0.7.0 (K7-008 / migration 008) — de-ranking penalty in [0, 0.5]. */
	truth_penalty?: number | null;
	/** v0.7.0 (K7-008 / migration 008) — first contradiction timestamp. */
	contradicted_at?: string | null;
	/** v0.8.0 (K8-018 / migration 009) — layer marker on the row. */
	layer?: string | null;
}

const TYPE_PRIORITY: Record<MemoryType, number> = {
	error: 0,
	pattern: 1,
	rule: 1,
	solution: 1,
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
const ORIGIN_BOOST_CASUAL = 2;
const ORIGIN_BOOST_AGENT = 1;
const RECENCY_DECAY_PER_DAY = 0.95; // newer = closer to 1 (less penalty)

// v0.5.0 (K5-008 / plan §5.6, D5-10) — DATE_NOW sentinel: deterministic
// retrieval reads this fixed future instant instead of the wall clock,
// making ordering a pure function of database content. Export for tests.
export const DATE_NOW = "2099-01-01T00:00:00.000Z";

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

/** Shared column list for row reads (must stay in sync with MemoryRow). */
const MEMORY_ROW_SELECT = `id, type, content, scope, relevance_score, source_tool, source_session,
                metadata, created_at, updated_at, expires_at,
                project_id, fingerprint, origin,
                evidence_count, recurrence_count, last_verified_at, status, fix_args`;

// v1.1.0 (K11-011 / plan §5.5, D11-06) — probes delegate to columns registry
function hasIgnoredColumn(store: Store): boolean {
	return columnsHasIgnored(store);
}
function hasCuratedColumn(store: Store): boolean {
	return columnsHasCurated(store);
}
function hasTruthColumns(store: Store): boolean {
	return columnsHasTruth(store);
}
export function hasRepoIdColumn(store: Store): boolean {
	return columnsHasRepoId(store);
}
function hasLayerColumn(store: Store): boolean {
	return columnsHasLayer(store);
}

/**
 * v0.5.0 (K5-009 / plan §5.3) — the 006-only columns are appended when the
 * migration has run (same probe as the `ignored = 0` retrieval filter).
 * v0.6.0 (K6-011) — the 007-only curation columns are appended likewise.
 * v0.8.0 (BUG-007) — the 009-only `layer` column is appended likewise, so
 * getById() and every other rowSelect consumer observe 'shared' exactly
 * like loadAll and queryRelevant do.
 */
function rowSelect(store: Store): string {
	const base = hasIgnoredColumn(store)
		? `${MEMORY_ROW_SELECT}, ignored, superseded_by,
		   feedback_positive, feedback_negative`
		: MEMORY_ROW_SELECT;
	const withCurated = hasCuratedColumn(store)
		? `${base}, curated, curated_at, inferable`
		: base;
	const withTruth = hasTruthColumns(store)
		? `${withCurated}, truth_penalty, contradicted_at`
		: withCurated;
	return hasLayerColumn(store) ? `${withTruth}, layer` : withTruth;
}

export function mapRow(row: MemoryRow, score?: number): Memory {
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
		confidence:
			typeof row.evidence_count === "number"
				? computeConfidence(
						row.evidence_count ?? 0,
						row.recurrence_count ?? 0,
						row.feedback_positive ?? 0,
						row.feedback_negative ?? 0,
					)
				: null,
		evidenceCount: row.evidence_count ?? null,
		lastVerifiedAt: row.last_verified_at ?? null,
		status: row.status ?? "active",
		fixArgs: row.fix_args ?? null,
		recurrenceCount: row.recurrence_count ?? null,
		// v0.5.0 (K5-009 / plan §5.3, D5-07) — the human-verdict and
		// supersession fields; absent on pre-006 rows.
		ignored: row.ignored === undefined ? undefined : Boolean(row.ignored),
		supersedes: row.superseded_by ?? null,
		// v0.5.0 (K5-010 / plan §5.3) — human judgement counters.
		feedbackPositive: row.feedback_positive ?? 0,
		feedbackNegative: row.feedback_negative ?? 0,
		// v0.6.0 (K6-011 / plan §5.4) — curation state and the deterministic
		// inferability verdict (absent on pre-007 rows). `NULL` stays `null`
		// — never collapsed, the Curator predicate is `inferable != 1`.
		curated: row.curated === undefined ? undefined : row.curated === 1,
		curatedAt: row.curated_at ?? null,
		inferable:
			row.inferable === undefined
				? undefined
				: row.inferable === 1
					? "inferable"
					: row.inferable === 0
						? "non_inferable"
						: null,
		// v0.7.0 (K7-008 / plan §5.3, D7-03) — de-ranking state. `truth_penalty`
		// defaults to 0 (a pre-008 row without the column reads 0), and
		// `contradicted_at` is null until the first contradiction.
		truthPenalty: row.truth_penalty ?? 0,
		contradictedAt: row.contradicted_at ?? null,
		// v0.8.0 (K8-018 / plan §5.2) — the layer marker ('local' | 'shared').
		// Absent on pre-009 rows.
		layer: row.layer ?? null,
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

/**
 * v0.6.0 (K6-011 / plan §5.3) — the SQL-side inferable verdict: `1`
 * (inferable), `0` (non_inferable), `NULL` (unknown). `NULL` stays NULL —
 * collapsing it would silently exclude every unclassified memory from
 * curation (the Curator predicate is `inferable != 1`).
 */
function persistInferable(
	type: string,
	content: string,
	metadata: unknown,
): number | null {
	const verdict = classify({ type, content, metadata });
	if (verdict === "inferable") return 1;
	if (verdict === "non_inferable") return 0;
	return null;
}

export class MemoryService {
	private readonly metrics: Metrics | null;

	constructor(store: Store, metrics?: Metrics | null, repoId?: string | null) {
		this.store = store;
		this.metrics = metrics ?? null;
		this.repoId = repoId ?? null;
	}

	// `store` is declared here (rather than as a constructor parameter property)
	// so that Metrics can be added without changing the parameter order callers
	// have been using since v0.1.0.
	private store: Store;

	// v0.8.0 (K8-007 / plan §5.7) — the resolved repository identity. When
	// present (and the 009 migration has run) every retrieval path is scoped
	// on it; NULL-repo_id rows stay global and match every scope. When absent
	// the service keeps the pre-009 behaviour byte-for-byte.
	private repoId: string | null;

	// v0.8.0 (BUG-002) — align the service with a mid-session identity
	// change (kevin_project rekey). The id must change together with the
	// SharedLayer bridge, or retrieval silently stops matching the corpus
	// until a restart.
	setRepoId(repoId: string | null): void {
		this.repoId = repoId;
	}

	// v0.4.0 (BUG-008) — cached column probe for pre-005 DBs (which lack
	// `recurrence_count`); save() must not reference the column there.
	// v1.1.0 (K11-011) — delegates to columns registry
	private hasRecurrenceColumn(): boolean {
		return columnsHasRecurrence(this.store);
	}

	// v0.5.0 (K5-008 / plan §5.6) — cached column probe for pre-006 DBs
	// (which lack `ignored`); the retrieval filter must not reference the
	// column there.
	private hasIgnoredColumn(): boolean {
		return hasIgnoredColumn(this.store);
	}

	// v0.6.0 (K6-011 / plan §5.4) — cached column probe for pre-007 DBs
	// (which lack `curated`); save() and the retrieval SELECTs must not
	// reference the column there.
	private hasCuratedColumn(): boolean {
		return hasCuratedColumn(this.store);
	}

	// v0.7.0 (K7-008 / plan §5.3) — cached column probe for pre-008 DBs
	// (which lack `truth_penalty`); the retrieval SELECTs must not reference
	// the column there, or rankScore cannot see the de-ranking factor.
	private hasTruthColumns(): boolean {
		return hasTruthColumns(this.store);
	}

	// v0.8.0 (K8-007 / plan §5.7) — cached column probe for pre-009 DBs
	// (which lack `repo_id`); the retrieval SELECTs and save() must not
	// reference the column there.
	private hasRepoIdColumn(): boolean {
		return hasRepoIdColumn(this.store);
	}

	save(input: SaveInput): string {
		const scope = input.scope ?? "project";
		const relevanceScore = input.relevanceScore ?? 0.5;
		const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
		const origin: MemoryOrigin = input.origin ?? "agent";
		const projectId = input.projectId ?? null;

		const status = input.status ?? "active";

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

		const id = input.id ?? uuidv7();

		// v0.3.0 (K3-014) — supersede model: when saving a decision/rule with
		// the same fingerprint as an existing active row, mark the old as
		// superseded and insert the fresh version as active.
		// v0.4.0 (K4-011) — `memories_superseded` is only counted here,
		// where a row is truly replaced; penalization of recurring
		// reflectors no longer increments it.
		// v0.5.0 (K5-013 / plan §5.5, D5-06) — the old row also records WHO
		// superseded it (`superseded_by = <new id>`), giving status-based
		// supersession a navigable audit trail. Guarded: pre-006 DBs lack
		// the column (same migration as `ignored`).
		const supersedableTypes: MemoryType[] = ["decision", "rule"];
		try {
			this.store.transaction(() => {
			if (fp !== null && supersedableTypes.includes(input.type)) {
				const withSupersededBy = this.hasIgnoredColumn();
				const setClause = withSupersededBy
					? "SET status = 'superseded', superseded_by = ?, updated_at = datetime('now')"
					: "SET status = 'superseded', updated_at = datetime('now')";
				// v0.8.0 (K8-007 / plan §5.7) — once the 009 column exists and an
				// identity is resolved, supersession is scoped on repo_id (NULL
				// rows are global); project_id stays as the pre-009 scope.
				const scopedOnRepoId = this.hasRepoIdColumn() && this.repoId !== null;
				const whereScope = scopedOnRepoId
					? "AND (repo_id IS ? OR repo_id IS NULL)"
					: "AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))";
				const scopeParams: unknown[] = scopedOnRepoId
					? [this.repoId]
					: [projectId, projectId];
				this.store
					.prepare(
						`UPDATE memories
						 ${setClause}
						 WHERE fingerprint = ?
						   AND type = ?
						   AND status = 'active'
						   ${whereScope}`,
					)
					.run(
						...(withSupersededBy
							? [id, fp, input.type, ...scopeParams]
							: [fp, input.type, ...scopeParams]),
					);
				const after = this.store.prepare("SELECT changes() AS n").get() as {
					n: number;
				};
				if (after.n > 0) {
					this.metrics?.incr("memories_superseded", 1);
				}
			}

			// v0.4.0 (BUG-008) — recurrence_count is only persisted when the
			// column exists (migration 005); pre-005 DBs get the legacy shape.
			// v0.6.0 (K6-011 / plan §5.3) — the inferable verdict is persisted
			// on insert when the column exists (migration 007). The column
			// list is assembled so every migration level gets exactly its own
			// shape: 005+ gains recurrence_count, 007+ gains inferable.
			const withRecurrence = this.hasRecurrenceColumn();
			const withCurated = this.hasCuratedColumn();
			const columns = [
				"id",
				"type",
				"content",
				"scope",
				"relevance_score",
				"source_tool",
				"source_session",
				"metadata",
				"expires_at",
				"project_id",
				"fingerprint",
				"origin",
				"evidence_count",
				"last_verified_at",
				"status",
			];
			const params: unknown[] = [
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
				input.evidenceCount ?? 0,
				input.lastVerifiedAt ?? null,
				status,
			];
			if (withRecurrence) {
				columns.push("recurrence_count");
				params.push(input.recurrenceCount ?? 0);
			}
			if (withCurated) {
				columns.push("inferable");
				params.push(
					persistInferable(input.type, input.content, input.metadata),
				);
			}
			// v0.8.0 (K8-007 / plan §5.7) — repo_id is persisted on every new
			// memory (009 column). A NULL projectId stays NULL-scoped — the
			// global rows PatternMiner's nullPid convention relies on — and a
			// NULL repo_id row matches every scope. project_id remains written
			// above: it is provenance now, not scope (D8-02).
			if (this.hasRepoIdColumn()) {
				columns.push("repo_id");
				params.push(projectId !== null ? this.repoId : null);
			}
			const insert = `INSERT INTO memories (${columns.join(", ")})
           VALUES (${params.map(() => "?").join(", ")})`;
			this.store.prepare(insert).run(...params);
			});
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
			if (existing) {
				// v0.6.0 (K6-011 / plan §5.3) — dedup path: the stored
				// classification is left alone unless it is NULL; a NULL
				// (unclassified error, e.g. a pre-007 insert) gets the fresh
				// lazy verdict. Guarded so a re-run cannot overwrite a
				// classification produced later by inferability.classify().
				if (this.hasCuratedColumn()) {
					this.store
						.prepare(
							"UPDATE memories SET inferable = ? WHERE id = ? AND inferable IS NULL",
						)
						.run(
							persistInferable(input.type, input.content, input.metadata),
							existing.id,
						);
				}
				return existing.id;
			}
			// Defensive: if the unique fired but the lookup returns nothing
			// (concurrent delete race), fall through and rethrow rather than
			// fabricate an id.
			throw err;
		}
	}

	/**
	 * v0.6.0 (K6-011 / plan §5.4) — mark memories as curated. Batch in a
	 * single statement with an `IN` clause; do not loop. Returns the number
	 * of rows matched by the statement (not only rows whose value changed):
	 * a second call with the same ids re-matches them, so the caller must
	 * re-filter the id list (e.g. by `curated = 0`) to observe 0.
	 */
	markCurated(ids: readonly string[], at: string): number {
		if (ids.length === 0) return 0;
		const placeholders = ids.map(() => "?").join(", ");
		this.store
			.prepare(
				`UPDATE memories SET curated = 1, curated_at = ?
				 WHERE id IN (${placeholders})`,
			)
			.run(at, ...ids);
		const row = this.store.prepare("SELECT changes() AS n").get() as {
			n: number;
		};
		return Number(row.n);
	}

	getById(id: string): Memory | null {
		const row = this.store
			.prepare(
				`SELECT ${rowSelect(this.store)}
         FROM memories WHERE id = ?`,
			)
			.get(id) as MemoryRow | undefined;
		return row ? mapRow(row) : null;
	}

	/**
	 * v0.4.0 (K4-016) — most recent ACTIVE memory for a fingerprint,
	 * optionally filtered by type. Feeds the HITL suggestion lookup
	 * (most-recurred fingerprint → its pattern memory).
	 */
	getByFingerprint(fingerprint: string, type?: MemoryType): Memory | null {
		const row = this.store
			.prepare(
				`SELECT ${rowSelect(this.store)}
         FROM memories
        WHERE fingerprint = ? AND status = 'active'
          ${type ? "AND type = ?" : ""}
        ORDER BY created_at DESC LIMIT 1`,
			)
			.get(...(type ? [fingerprint, type] : [fingerprint])) as
			| MemoryRow
			| undefined;
		return row ? mapRow(row) : null;
	}

	/**
	 * v0.8.0 (K8-018 / plan §5.2) — result of a memory mutation.
	 * `refused` lists the shared-layer columns that were not written.
	 */
	update(id: string, fields: Partial<Memory>): MemoryUpdateResult {
		// v0.8.0 (K8-018 / plan §5.2) — the shared layer's immutability
		// contract. statement/type/scope are inputs to entry_id: a local
		// edit would silently desynchronize the row from the committed file
		// with no way to detect it — to change a shared entry, author a new
		// one that supersedes it. confidence/evidence_count are merged from
		// the file through the lattice: a local write would be overwritten
		// at the next kevin_sync and the user would watch their edit vanish.
		// The allowed columns (feedback_*, truth_penalty, contradicted_at,
		// ignored, last_injected_at, injection outcomes) are per-machine
		// operational state: your opinion of a teammate's rule is yours
		// (plan §5.2). A refusal is counted, never thrown, and never silent.
		const refused: string[] = [];
		for (const [field, label] of Object.entries(SHARED_FORBIDDEN_FIELDS)) {
			if ((fields as Record<string, unknown>)[field] !== undefined) {
				refused.push(label);
			}
		}
		if (refused.length > 0 && hasLayerColumn(this.store)) {
			const layerRow = this.store
				.prepare("SELECT layer FROM memories WHERE id = ?")
				.get(id) as { layer?: string | null } | undefined;
			if (layerRow?.layer === "shared") {
				this.countSharedRefusal();
				return { ok: false, refused };
			}
		}
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
		if (fields.evidenceCount !== undefined) {
			cols.push("evidence_count = ?");
			vals.push(fields.evidenceCount);
		}
		if (fields.lastVerifiedAt !== undefined) {
			cols.push("last_verified_at = ?");
			vals.push(fields.lastVerifiedAt);
		}
		if (fields.status !== undefined) {
			cols.push("status = ?");
			vals.push(fields.status);
		}
		// v0.4.0 (BUG-008) — recurrence_count is writable so okf-import can
		// restore negative evidence across a round-trip. Guarded by the
		// caller (pre-005 DBs lack the column; update() throws).
		if (fields.recurrenceCount !== undefined) {
			cols.push("recurrence_count = ?");
			vals.push(fields.recurrenceCount);
		}
		if (cols.length === 0) return { ok: true };
		cols.push("updated_at = datetime('now')");
		vals.push(id);
		this.store
			.prepare(`UPDATE memories SET ${cols.join(", ")} WHERE id = ?`)
			.run(...vals);
		return { ok: true };
	}

	/**
	 * v0.8.0 (K8-018 / plan §5.2) — count a refused shared-row write. The
	 * key lives OUTSIDE the frozen METRIC_KEYS ladder (K7-004), following
	 * the v0.6.0 `incrRegistered` precedent: it persists to the same
	 * `kevin_metrics` table and is read back by `kevin_audit` as a bare SQL
	 * scalar, so the counter survives across processes without growing the
	 * 39-key ladder.
	 */
	private countSharedRefusal(): void {
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
					 VALUES ('shared_write_refusals', 1, datetime('now'))
					 ON CONFLICT(key) DO UPDATE SET
					   value = value + 1,
					   updated_at = datetime('now')`,
				)
				.run();
		});
	}

	/**
	 * v0.7.0 (K7-008 / plan §5.3, D7-03) — apply a bounded truth penalty.
	 * Clamps `penalty` to [0, 0.5], writes `truth_penalty` and `contradicted_at`,
	 * and increments `memories_contradicted` ONLY when the value moves from 0
	 * to non-zero (a second penalty on the same memory does not re-count).
	 * It NEVER writes `status` — contradiction de-ranks; it never deletes
	 * (Principle 24). `reason` is the human-readable explanation surfaced by
	 * `kevin_facts`; the caller persists it in the `memory_conflicts` row.
	 */
	applyTruthPenalty(memoryId: string, penalty: number, reason: string): void {
		const clamped = Math.max(0, Math.min(0.5, penalty));
		const row = this.store
			.prepare("SELECT truth_penalty FROM memories WHERE id = ?")
			.get(memoryId) as { truth_penalty?: number | null } | undefined;
		if (!row) return;
		const current = Number(row.truth_penalty ?? 0);
		const hadPenalty = current > 0;
		const nowHasPenalty = clamped > 0;
		// `reason` is accepted for interface parity with plan §5.3; the caller
		// records it in the conflict row, not here.
		void reason;
		const stamp = nowHasPenalty ? new Date().toISOString() : null;
		this.store
			.prepare(
				`UPDATE memories
				 SET truth_penalty = ?,
				     contradicted_at = CASE
				         WHEN ? IS NULL THEN NULL
				         ELSE COALESCE(contradicted_at, ?)
				     END
				 WHERE id = ?`,
			)
			.run(clamped, stamp, stamp, memoryId);
		if (nowHasPenalty && !hadPenalty) {
			this.metrics?.incr("memories_contradicted", 1);
		}
		// v0.7.0 (K7-008 / D7-03) — recovery: a penalty lifted back to 0
		// (the repo no longer contradicts the memory) mirrors the counter,
		// which the 008 post-apply hook re-derives as COUNT(truth_penalty > 0).
		if (!nowHasPenalty && hadPenalty) {
			this.metrics?.incr("memories_contradicted", -1);
		}
	}

	delete(id: string): void {
		this.store.prepare("DELETE FROM memories WHERE id = ?").run(id);
	}

	/** v0.1.x behavior — returns full `Memory` rows. */
	query(input: QueryInput & { full: true }): Memory[];
	/** v0.3.0 (BUG-001) — slim rows carrying the evidence fields. */
	query(input: QueryInput & { evidence: true }): SlimMemoryWithEvidence[];
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
             m.evidence_count, m.last_verified_at, m.status,
             bm25(memories_fts) AS score
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))`;
		// v0.5.0 (K5-011 / plan §5.6, D5-07) — ignored memories are hidden
		// from kevin_query too (guarded for pre-006 DBs).
		if (this.hasIgnoredColumn()) {
			sql += "\n        AND m.ignored = 0";
		}
		const params: unknown[] = [match];
		if (!input.includeSuperseded) {
			sql += "\n        AND m.status = 'active'";
		}
		if (input.type) {
			sql += " AND m.type = ?";
			params.push(input.type);
		}
		if (scope !== "all") {
			sql += " AND m.scope = ?";
			params.push(scope);
		}
		// v0.8.0 (K8-007 / plan §5.7) — retrieval is scoped on repo_id once
		// the 009 column exists and an identity is resolved; NULL-repo_id
		// rows are global and match every scope. Without an identity the
		// predicate is skipped entirely (pre-009 behaviour).
		if (this.hasRepoIdColumn() && this.repoId !== null) {
			sql += "\n        AND (m.repo_id = ? OR m.repo_id IS NULL)";
			params.push(this.repoId);
		}
		sql += " ORDER BY bm25(memories_fts) LIMIT ?";
		params.push(limit);

		const rows = this.store.prepare(sql).all(...params) as (MemoryRow & {
			score: number;
		})[];
		// v0.3.0 (K3-019) — cross-project opt-in must also gate kevin_query
		// (bug #12 fix): when cross_project_enabled is OFF, imported rows
		// (project_id IS NULL AND origin='imported') are hidden.
		const crossProjectOn = this.isCrossProjectEnabled();
		const memories = rows
			.map((r) => mapRow(r, r.score))
			.filter((m) => !isNotSearchable(m))
			.filter(
				(m) =>
					crossProjectOn || m.projectId !== null || m.origin !== "imported",
			);
		return input.full === true
			? memories
			: memories.map((m) => toSlim(m, input.evidence === true));
	}

	private isCrossProjectEnabled(): boolean {
		try {
			const row = this.store
				.prepare(
					"SELECT value FROM kevin_settings WHERE key = 'cross_project_enabled'",
				)
				.get() as { value: string } | undefined;
			// BUG-002 — the column stores TEXT ('0'/'1'); the old numeric
			// comparison `=== 1` could never match '1'.
			return (row?.value ?? "0") === "1";
		} catch {
			return false;
		}
	}

	/**
	 * v0.4.0 (K4-012) — read a kevin_settings flag by key. Falls back to
	 * the caller-provided default when the key is missing or the table is
	 * unavailable (legacy DB without the settings table).
	 */
	getSetting(key: string, fallback = "0"): string {
		try {
			const row = this.store
				.prepare("SELECT value FROM kevin_settings WHERE key = ?")
				.get(key) as { value: string } | undefined;
			return row?.value ?? fallback;
		} catch {
			return fallback;
		}
	}

	private loadAll(
		scope: MemoryScope | "all",
		includeSuperseded = false,
	): MemoryRow[] {
		let sql = `
      SELECT id, type, content, scope, relevance_score, source_tool, source_session,
             metadata, created_at, updated_at, expires_at,
             project_id, fingerprint, origin,
             evidence_count, last_verified_at, status`;
		// v0.5.0 (K5-009/010) — 006-only columns, appended when present.
		if (this.hasIgnoredColumn()) {
			sql += ", ignored, superseded_by, feedback_positive, feedback_negative";
		}
		// v0.6.0 (K6-011) — 007-only curation columns, appended when present.
		if (this.hasCuratedColumn()) {
			sql += ", curated, curated_at, inferable";
		}
		// v0.7.0 (K7-008) — 008-only truth columns, appended when present.
		if (this.hasTruthColumns()) {
			sql += ", truth_penalty, contradicted_at";
		}
		// v0.8.0 (K8-018) — 009-only layer column, appended when present.
		if (hasLayerColumn(this.store)) {
			sql += ", layer";
		}
		sql += `
      FROM memories
      WHERE (expires_at IS NULL OR expires_at > datetime('now'))`;
		// v0.5.0 (K5-008 / plan §5.6) — ignored memories are excluded from
		// retrieval (human verdict, D5-07). Guarded for pre-006 DBs.
		if (this.hasIgnoredColumn()) {
			sql += "\n        AND ignored = 0";
		}
		if (!includeSuperseded) {
			sql += "\n        AND status = 'active'";
		}
		const params: unknown[] = [];
		if (scope !== "all") {
			sql += " AND scope = ?";
			params.push(scope);
		}
		// v0.8.0 (K8-007 / plan §5.7) — repo_id scoping on the loadAll path
		// (bare column names; see queryRelevant for the m.-prefixed twin).
		// NULL-repo_id rows are global and match every scope.
		if (this.hasRepoIdColumn() && this.repoId !== null) {
			sql += "\n        AND (repo_id = ? OR repo_id IS NULL)";
			params.push(this.repoId);
		}
		sql += " ORDER BY relevance_score DESC, created_at DESC";
		return this.store.prepare(sql).all(...params) as MemoryRow[];
	}

	private queryRelevant(
		text: string,
		scope: MemoryScope | "all",
		includeSuperseded = false,
	): Memory[] {
		const tokens = tokenizeQuery(stripUnbalancedQuotes(text));
		if (tokens.length === 0) return [];
		const match = toMatchClause(tokens, " OR ");

		let sql = `
      SELECT m.id, m.type, m.content, m.scope, m.relevance_score,
             m.source_tool, m.source_session, m.metadata,
             m.created_at, m.updated_at, m.expires_at,
             m.project_id, m.fingerprint, m.origin,
             m.evidence_count, m.last_verified_at, m.status`;
		// v0.5.0 (K5-009/010) — 006-only columns, appended when present.
		if (this.hasIgnoredColumn()) {
			sql +=
				", m.ignored, m.superseded_by, m.feedback_positive, m.feedback_negative";
		}
		// v0.6.0 (K6-011) — 007-only curation columns, appended when present.
		if (this.hasCuratedColumn()) {
			sql += ", m.curated, m.curated_at, m.inferable";
		}
		// v0.7.0 (K7-008) — 008-only truth columns, appended when present so
		// rankScore can apply the de-ranking factor in retrieval.
		if (this.hasTruthColumns()) {
			sql += ", m.truth_penalty, m.contradicted_at";
		}
		// v0.8.0 (K8-018) — 009-only layer column, appended when present.
		if (hasLayerColumn(this.store)) {
			sql += ", m.layer";
		}
		sql += `,
             bm25(memories_fts) AS score
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))`;
		// v0.5.0 (K5-008 / plan §5.6) — ignored memories are excluded from
		// retrieval (human verdict, D5-07). Guarded for pre-006 DBs.
		if (this.hasIgnoredColumn()) {
			sql += "\n        AND m.ignored = 0";
		}
		if (!includeSuperseded) {
			sql += "\n        AND m.status = 'active'";
		}
		const params: unknown[] = [match];
		if (scope !== "all") {
			sql += " AND m.scope = ?";
			params.push(scope);
		}
		// v0.8.0 (K8-007 / plan §5.7) — repo_id scoping on the FTS path.
		// NULL-repo_id rows are global and match every scope.
		if (this.hasRepoIdColumn() && this.repoId !== null) {
			sql += "\n        AND (m.repo_id = ? OR m.repo_id IS NULL)";
			params.push(this.repoId);
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
		const includeSuperseded = input.includeSuperseded === true;
		// v0.5.0 (K5-008 / plan §5.6, D5-10) — one clock per call and one
		// read of the opt-in determinism flag. Retrieval then becomes a
		// pure function of database state: recency decay is frozen at 1.0
		// and the relevance bump is skipped regardless of the `bump`
		// argument. The column is TEXT; compare against the string.
		const now = input.now ?? new Date();
		const deterministic =
			this.getSetting("deterministic_retrieval", "0") === "1";
		// v0.5.0 (K5-008 / plan §5.6, D5-10) — DATE_NOW sentinel: in
		// deterministic mode the wall clock is never read; every query sees
		// the same fixed future instant, so ordering is a pure function of
		// database content.
		const clockMs = deterministic
			? new Date(DATE_NOW).getTime()
			: now.getTime();

		let candidates: Memory[];
		if (input.query && input.query.trim().length > 0) {
			candidates = this.queryRelevant(input.query, scope, includeSuperseded);
		} else {
			candidates = this.loadAll(scope, includeSuperseded)
				.map((r) => mapRow(r))
				.filter((m) => !isNotSearchable(m));
		}

		// v0.3.0 (K3-019) — cross-project opt-in.
		// When cross_project_enabled is OFF (default), exclude imported
		// cross-project rows (project_id IS NULL AND origin='imported').
		// OKF import is the cross-project bridge per plan §B12; imported
		// memories always carry project_id NULL (bug #12 fix — the old
		// filter only excluded imported RULES, leaking imported
		// decisions/patterns into recall).
		if (!this.isCrossProjectEnabled()) {
			candidates = candidates.filter(
				(m) => m.projectId !== null || m.origin !== "imported",
			);
		}

		// v0.2.0 (K2-023) origin-aware rank: BM25 × origin-boost × recency-decay.
		// Tie-breakers preserve the v0.1.x spirit (errors/patterns before
		// context; newer before older when nothing else decides).
		candidates.sort((a, b) => rankCompare(a, b, clockMs, deterministic));

		const result: Memory[] = [];
		let used = 0;
		for (const mem of candidates) {
			const len = mem.content.length + 32;
			if (used + len > charBudget && result.length > 0) break;
			result.push(mem);
			used += len;
		}

		// v0.5.0 (K5-008 / D5-10) — the bump is part of the non-determinism
		// this release makes optional: in deterministic mode it is skipped
		// entirely so repeated queries return identical ranks and leave
		// every relevance_score untouched.
		if (result.length > 0 && !deterministic && input.bump !== false) {
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
	 * v0.4.0 (BUG-016) — apply the K2-023 relevance bump to a fixed slice
	 * of ids, exactly once. Lets ContextInjector probe without mutating
	 * and still bump the slice it actually injects.
	 */
	bumpRelevance(ids: string[]): void {
		if (ids.length === 0) return;
		const bump = this.store.prepare(
			"UPDATE memories SET relevance_score = MIN(?, relevance_score + ?) WHERE id = ?",
		);
		this.store.transaction(() => {
			for (const id of ids) bump.run(RELEVANCE_MAX, RELEVANCE_BUMP, id);
		});
	}

	/**
	 * v0.3.0 (K3-004) — Promote an error memory to a causal pattern.
	 *
	 * Creates a new `pattern` memory with `origin = 'causal'`, derived
	 * confidence, and evidence count. The original error memory is NOT
	 * deleted — the audit trail is preserved. Returns the new memory id,
	 * or null when the source error is not eligible (missing fingerprint,
	 * wrong type, or already promoted).
	 */
	/**
	 * v0.4.0 (K4-009) — returns `{ id, created }` so callers can tell a
	 * newly-created pattern from an idempotent refresh.
	 */
	promoteToPattern(
		errorId: string,
		evidenceCount: number,
		recurrenceCount = 0,
	): { id: string; created: boolean } | null {
		const error = this.getById(errorId);
		if (!error || error.type !== "error" || !error.fingerprint) return null;

		// v0.4.0 (K4-010) — two-sided confidence: recurrence demotes the
		// pattern's confidence.
		const confidence = computeConfidence(evidenceCount, recurrenceCount);
		const now = new Date().toISOString();
		const summary = error.content.split("\n")[0].slice(0, 200);
		const base = `Causal pattern: ${summary}\n\nEvidence: ${evidenceCount} confirmed fix(es)\nConfidence: ${(confidence * 100).toFixed(0)}%\n\nOriginal: ${error.content.slice(0, 1000)}`;

		// v0.4.0 (K4-014) — deterministic "Fixed by:" from the linked
		// success call's args_summary (D4-07). The opt-in LLM phrasing
		// (K4-015) runs later in CausalChain.onSessionIdle, never here and
		// never on the failure hot path.
		const fixLine = deterministicFixLine({
			content: base,
			fixArgs: error.fixArgs ?? null,
		});
		const content = fixLine ? `${base}\n${fixLine}` : base;

		// v0.3.0 fix (bug #4) — idempotent promotion: the supersede model
		// only covers decision/rule, so the old code inserted a duplicate
		// pattern on every subsequent session.idle with a new fix. When an
		// active causal pattern already exists for this fingerprint, refresh
		// it (content, evidence_count, last_verified_at) instead. The FTS
		// sync trigger (memories_au) keeps searchable content up to date.
		const existing = this.store
			.prepare(
				`SELECT id FROM memories
				 WHERE fingerprint = ? AND type = 'pattern'
				   AND origin = 'causal' AND status = 'active'
				 ORDER BY created_at DESC LIMIT 1`,
			)
			.get(error.fingerprint) as { id: string } | undefined;
		let patternId: string;
		if (existing) {
			this.update(existing.id, { content, evidenceCount, lastVerifiedAt: now });
			patternId = existing.id;
		} else {
			patternId = this.save({
				type: "pattern",
				content,
				scope: "project",
				origin: "causal",
				sourceTool: error.sourceTool ?? undefined,
				sourceSession: error.sourceSession ?? undefined,
				fingerprint: error.fingerprint,
				evidenceCount,
				lastVerifiedAt: now,
				status: "active",
				projectId: error.projectId ?? undefined,
			});
		}

		// v0.4.0 (K4-010) — persist the recurrence count on the pattern row
		// so mapRow (and kevin_why) recompute the SAME demoted confidence.
		// v0.4.0 (K4-014) — persist fix_args too: the pattern's "Fixed by:"
		// raw material travels with the row for kevin_why/HITL (K4-016/020).
		this.store
			.prepare(
				"UPDATE memories SET recurrence_count = ?, fix_args = ? WHERE id = ?",
			)
			.run(recurrenceCount, error.fixArgs ?? null, patternId);

		return { id: patternId, created: !existing };
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
				`SELECT id, fingerprint, project_id, metadata
				 FROM memories
				 WHERE origin = 'reflector'
				   AND type = 'error'
				   AND source_session = ?
				   AND fingerprint IS NOT NULL
				   AND status = 'active'`,
			)
			.all(sessionId) as Array<{
			id: string;
			fingerprint: string;
			project_id: string | null;
			metadata: string | null;
		}>;
		if (lessons.length === 0) return 0;
		// v0.3.0 fix — recurrence is now matched via `error_fingerprint`
		// (set by Reflector.onLinkError) OR the legacy `fingerprint` column
		// (preserved for tests and pre-fix tool_call rows). The original
		// failing call is excluded when its id is recorded in the memory
		// metadata as `origin_call_id` (set by Reflector from `callID`).
		const recurrenceCheck = this.store.prepare(
			`SELECT COUNT(*) AS c
			 FROM tool_calls
			 WHERE (error_fingerprint = ? OR fingerprint = ?)
			   AND success = 0
			   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))
			   AND (? IS NULL OR id <> ?)`,
		);
		const bumpOne = this.store.prepare(
			"UPDATE memories SET relevance_score = MIN(?, relevance_score + ?) WHERE id = ?",
		);
		let boosted = 0;
		this.store.transaction(() => {
			for (const l of lessons) {
				const originCallId = readOriginCallId(l.metadata);
				const row = recurrenceCheck.get(
					l.fingerprint,
					l.fingerprint,
					l.project_id,
					l.project_id,
					originCallId,
					originCallId,
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

	/**
	 * v0.3.0 (K3-013) — Feedback loop negative half.
	 *
	 * For each reflector-sourced error memory from this session whose
	 * fingerprint DID recur as a failing tool_call (the lesson didn't
	 * prevent the error), decrement `relevance_score` by `RELEVANCE_PENALTY`
	 * (down to zero) and increment `evidence_count` as a negative signal.
	 * Agent-saved memories are NEVER penalized.
	 *
	 * Returns the number of memories penalized.
	 */
	/**
	 * v0.3.0 fix — Mirror of the free function `countSupersedeCandidates`
	 * exposed as an instance method so `okf-import` (which holds a
	 * `MemoryService` reference but not the underlying `Store`) can count
	 * rows that `save()` will mark as superseded.
	 */
	countSupersedeCandidates(
		type: MemoryType,
		fingerprint: string | null | undefined,
		projectId: string | null,
	): number {
		// v0.8.0 (K8-007 / plan §5.7) — with a resolved identity the count
		// mirrors save()'s repo_id scope (NULL rows are global); project_id
		// stays as the legacy (pre-009) scope.
		return this.hasRepoIdColumn() && this.repoId !== null
			? countSupersedeCandidatesOnRepo(
					this.store,
					type,
					fingerprint,
					this.repoId,
				)
			: countSupersedeCandidates(this.store, type, fingerprint, projectId);
	}

	penalizeRecurringReflectors(sessionId: string): number {
		if (!sessionId) return 0;
		const RELEVANCE_PENALTY = 0.05;
		// v0.3.0 fix — to support cross-session feedback we drop the
		// memory-side `source_session` filter: any reflector error whose
		// fingerprint recurs as a failing tool_call IN THIS session is
		// eligible for penalization (the lesson didn't prevent the error).
		// The recurrence check narrows on `tool_calls.session_id = ?` and
		// excludes the original failing call via `origin_call_id` metadata,
		// matching both new `error_fingerprint` and legacy `fingerprint`.
		const lessons = this.store
			.prepare(
				`SELECT id, fingerprint, project_id, metadata
				 FROM memories
				 WHERE origin = 'reflector'
				   AND type = 'error'
				   AND fingerprint IS NOT NULL
				   AND status = 'active'`,
			)
			.all() as Array<{
			id: string;
			fingerprint: string;
			project_id: string | null;
			metadata: string | null;
		}>;
		if (lessons.length === 0) return 0;
		const recurrenceCheck = this.store.prepare(
			`SELECT COUNT(*) AS c
			 FROM tool_calls
			 WHERE session_id = ?
			   AND success = 0
			   AND (error_fingerprint = ? OR fingerprint = ?)
			   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))
			   AND (? IS NULL OR id <> ?)`,
		);
		const settledCheck = this.store.prepare(
			`SELECT 1 FROM kevin_injections
			  WHERE session_id = ? AND memory_id = ? AND outcome = 'ineffective'
			  LIMIT 1`,
		);
		const penalizeOne = this.store.prepare(
			`UPDATE memories
			 SET relevance_score = MAX(0, relevance_score - ?),
			     recurrence_count = recurrence_count + 1,
			     last_verified_at = datetime('now')
			 WHERE id = ?`,
		);
		const penalizeRelevanceOnly = this.store.prepare(
			`UPDATE memories
			 SET relevance_score = MAX(0, relevance_score - ?),
			     last_verified_at = datetime('now')
			 WHERE id = ?`,
		);
		let penalized = 0;
		this.store.transaction(() => {
			for (const l of lessons) {
				const originCallId = readOriginCallId(l.metadata);
				const row = recurrenceCheck.get(
					sessionId,
					l.fingerprint,
					l.fingerprint,
					l.project_id,
					l.project_id,
					originCallId,
					originCallId,
				) as { c: number } | undefined;
				const c = row?.c ?? 0;
				if (c > 0) {
					// v0.4.0 (K4-025) — no double-charge: when the
					// session's injection of this memory was already
					// settled `ineffective`, `InjectionLedger.settle`
					// charged recurrence_count (K4-007) and this pass
					// only applies the relevance penalty. The +1 charge
					// below is the pre-ledger path (K4-011) for memories
					// that were never injected this session.
					const settled = settledCheck.get(sessionId, l.id);
					if (settled) {
						penalizeRelevanceOnly.run(RELEVANCE_PENALTY, l.id);
					} else {
						// v0.4.0 (K4-011) — recurrence is negative evidence:
						// it bumps `recurrence_count`, NOT `evidence_count`
						// (the old code counted recurrence as positive
						// evidence). No `memories_superseded` increment here —
						// supersede is only counted when a decision/rule is
						// truly replaced (see save()).
						penalizeOne.run(RELEVANCE_PENALTY, l.id);
						// v0.4.0 (K4-025 / plan §5.1 rule 4, D4-06) — same
						// recurrence-expels rule the settle enforces: at
						// `recurrence_count >= 3` the error lesson is demoted
						// to `status='stale'`.
						this.store
							.prepare(
								`UPDATE memories SET status = 'stale'
								  WHERE id = ? AND recurrence_count >= 3`,
							)
							.run(l.id);
					}
					penalized += 1;
				}
			}
		});
		return penalized;
	}
}

function originBoost(mem: Memory): number {
	switch (mem.origin ?? "agent") {
		case "reflector":
		case "causal":
			return ORIGIN_BOOST_REFLECTOR;
		case "pattern":
			return ORIGIN_BOOST_PATTERN;
		default:
			return ORIGIN_BOOST_AGENT;
	}
}

/**
 * v0.3.0 fix — Extract `origin_call_id` from the memory metadata blob.
 *
 * Reflector stores the failing tool_call id in metadata.origin_call_id
 * (when available) so the feedback loop can exclude the original call
 * from the recurrence count. Returns null when metadata is absent,
 * malformed, or lacks the field.
 * // v1.1.0 (K11-003 / plan §5.5, D11-05) — single source for origin lookup;
 * // InjectionLedger reuses this implementation (K11-013).
 */
export function readOriginCallId(metadata: string | null): string | null {
	if (!metadata) return null;
	try {
		const parsed = JSON.parse(metadata) as Record<string, unknown>;
		const id = parsed?.origin_call_id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

/**
 * v0.3.0 fix — Count active memories that would be superseded by a new
 * row with the given (type, fingerprint, projectId) tuple. Used by
 * `okf-import` to populate `ImportResult.superseded` accurately.
 *
 * Matches the supersede logic in `save()`: only `decision` and `rule`
 * types supersede prior rows with the same fingerprint. Returns 0 for
 * any other type.
 */
export function countSupersedeCandidates(
	store: Store,
	type: MemoryType,
	fingerprint: string | null | undefined,
	projectId: string | null,
): number {
	if (!fingerprint) return 0;
	if (type !== "decision" && type !== "rule") return 0;
	const row = store
		.prepare(
			`SELECT COUNT(*) AS c
			 FROM memories
			 WHERE type IN ('decision', 'rule')
			   AND fingerprint = ?
			   AND status = 'active'
			   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))`,
		)
		.get(fingerprint, projectId, projectId) as { c: number } | undefined;
	return row?.c ?? 0;
}

/**
 * v0.8.0 (K8-007 / plan §5.7) — repo_id-scoped twin of the exported
 * `countSupersedeCandidates`, mirroring save()'s supersede predicate once
 * the 009 column exists and an identity is resolved. NULL-repo_id rows are
 * global and count for every scope.
 */
function countSupersedeCandidatesOnRepo(
	store: Store,
	type: MemoryType,
	fingerprint: string | null | undefined,
	repoId: string,
): number {
	if (!fingerprint) return 0;
	if (type !== "decision" && type !== "rule") return 0;
	const row = store
		.prepare(
			`SELECT COUNT(*) AS c
			 FROM memories
			 WHERE type IN ('decision', 'rule')
			   AND fingerprint = ?
			   AND status = 'active'
			   AND (repo_id = ? OR repo_id IS NULL)`,
		)
		.get(fingerprint, repoId) as { c: number } | undefined;
	return row?.c ?? 0;
}

function rankScore(mem: Memory, nowMs: number, deterministic: boolean): number {
	// FTS5 bm25 returns a negative score (more negative = better match).
	// For non-FTS rows (loadAll path), fall back to -relevance_score so
	// higher-relevance memories also come first under the same sign convention.
	const rawScore = (mem.metadata as Record<string, unknown> | null)?.score;
	const base = typeof rawScore === "number" ? rawScore : -mem.relevanceScore;
	const ageDays = Math.max(
		0,
		(nowMs - sqliteUtcToMs(mem.createdAt)) / 86_400_000,
	);
	// v0.5.0 (K5-008 / plan §5.6, D5-10) — deterministic retrieval freezes
	// the recency factor at 1.0 so ordering depends only on content
	// relevance and origin boost, never on the wall clock.
	const recencyDecay = deterministic ? 1 : RECENCY_DECAY_PER_DAY ** ageDays;
	// v0.7.0 (K7-008 / plan §5.3, D7-04) — trailing multiplicative factor,
	// applied AFTER the existing chain. At the default (truthPenalty = 0) the
	// expression reduces to the v0.6.0 one exactly. rankScore returns a
	// NEGATIVE score for BM25 rows (more negative = better), so scaling by a
	// factor in (0.5, 1] moves a row toward zero — i.e. toward worse — which
	// is the intended de-ranking direction.
	return base * originBoost(mem) * recencyDecay * (1 - (mem.truthPenalty ?? 0));
}

function rankCompare(
	a: Memory,
	b: Memory,
	nowMs: number,
	deterministic: boolean,
): number {
	const ra = rankScore(a, nowMs, deterministic);
	const rb = rankScore(b, nowMs, deterministic);
	if (ra !== rb) return ra - rb; // ascending: most negative (best) first
	if (TYPE_PRIORITY[a.type] !== TYPE_PRIORITY[b.type]) {
		return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
	}
	return sqliteUtcToMs(b.createdAt) - sqliteUtcToMs(a.createdAt); // newer first
}

import type { Store } from "./Store.js";
import { uuidv7 } from "./uuid.js";

export type MemoryType = "error" | "pattern" | "decision" | "context";
export type MemoryScope = "project" | "session";

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
}

export interface QueryInput {
	text: string;
	type?: string;
	scope?: MemoryScope | "all";
	limit?: number;
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
	constructor(private store: Store) {}

	save(input: SaveInput): string {
		const id = uuidv7();
		const scope = input.scope ?? "project";
		const relevanceScore = input.relevanceScore ?? 0.5;
		const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

		let expiresAt: string | null = input.expiresAt ?? null;
		if (scope === "session" && !input.expiresAt) {
			expiresAt = sqliteUtcNowPlusHours(SESSION_DEFAULT_TTL_HOURS);
		}

		this.store
			.prepare(
				`INSERT INTO memories
             (id, type, content, scope, relevance_score, source_tool, source_session, metadata, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			);

		return id;
	}

	getById(id: string): Memory | null {
		const row = this.store
			.prepare(
				`SELECT id, type, content, scope, relevance_score, source_tool, source_session,
                metadata, created_at, updated_at, expires_at
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

	query(input: QueryInput): Memory[] {
		const match = sanitizeMatch(input.text);
		if (!match) return [];

		const scope = input.scope ?? "all";
		const limit = input.limit ?? 10;

		let sql = `
      SELECT m.id, m.type, m.content, m.scope, m.relevance_score,
             m.source_tool, m.source_session, m.metadata,
             m.created_at, m.updated_at, m.expires_at,
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
		return rows
			.map((r) => mapRow(r, r.score))
			.filter((m) => !isNotSearchable(m));
	}

	private loadAll(scope: MemoryScope | "all"): MemoryRow[] {
		let sql = `
      SELECT id, type, content, scope, relevance_score, source_tool, source_session,
             metadata, created_at, updated_at, expires_at
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

		candidates.sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);

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
}

// ============================================================
// Kevin 0.8.0 — SharedLayer (F3, K8-016 … K8-020)
// ============================================================
// The two-directional bridge between the OKF file and the local
// store. Import may retire a memory — but only on an explicit
// committed tombstone. Export may write a file — but only through
// the one write path that has existed since v0.6.0 (D8-08).
//
// Every statement filters on `repo_id` (D8-02): there is no
// unscoped read or write of `shared_entries` or `okf_imports`.
// ============================================================

import { readFileSync } from "node:fs";
import type {
	ArtifactWriter,
	WriteOutcome,
	WritePlan,
	WriteRequest,
} from "./ArtifactWriter.js";
import { computeConfidence } from "./confidence.js";
import { fnv1a64 } from "./fingerprint.js";
import {
	MAX_ENTRIES,
	MAX_LINE_BYTES,
	OKF_VERSION,
	type OkfEntry,
	type ParseResult,
	canonicalize,
	computeEntryId,
	deriveConfidence,
	merge,
	parse,
	serialize,
} from "./okf.js";
import { uuidv7 } from "./uuid.js";

export interface ImportReport {
	path: string;
	/** null when the file does not exist. */
	fileHash: string | null;
	parsed: number;
	folded: number;
	rejected: number;
	/** rows inserted or updated in shared_entries. */
	imported: number;
	/** shared memories retired by an incoming tombstone. */
	tombstoned: number;
	/** true when fileHash matches the last okf_imports row. */
	skipped: boolean;
}

/**
 * A planned (or applied) export (K8-020 / plan §5.5). The refusal is
 * carried by the write plan itself — `outcome: "refused"` with both
 * hashes audited — so a refused plan is indistinguishable from a
 * written one until `outcome` is read.
 */
export interface ExportPlan {
	path: string;
	/** The whole-mode write request; applying re-plans through the single write funnel. */
	request: WriteRequest;
	/** The pure preview from planning time — diff and outcome, nothing written. */
	write: WritePlan;
	/** Entry ids in the merged corpus absent from the current file. */
	entriesAdded: number;
	/** Set by applyExport: the outcome of the actual write. */
	applied?: WriteOutcome;
}

interface MemoryRow {
	type: string;
	content: string;
	scope: string | null;
	evidence_count: number | null;
	recurrence_count: number | null;
	origin: string | null;
	created_at: string | null;
	curated: number | null;
}

/**
 * Project a local memory into its OKF candidate (K8-020): the
 * identifying triple (type, statement, scope) determines the
 * entry_id, so a re-export of the same memory is byte-identical.
 * created_at is normalized from SQLite's "YYYY-MM-DD HH:MM:SS" to
 * the file's ISO-8601 form, keeping join()'s min from flipping
 * formats across exports.
 */
function memoryToEntry(row: MemoryRow): OkfEntry {
	return {
		entry_id: computeEntryId(row.type, row.content, row.scope),
		type: row.type as OkfEntry["type"],
		statement: row.content,
		scope: row.scope,
		evidence: row.evidence_count ?? 0,
		recurrence: row.recurrence_count ?? 0,
		origin: row.origin ?? "pattern",
		author_hash: null,
		op: "assert",
		created_at: `${(row.created_at ?? "").replace(" ", "T")}Z`,
		supersedes: null,
	};
}

export class SharedLayer {
	private readonly store: StoreLike;
	private readonly repoId: string;
	private readonly projectId: string;
	private readonly version: string;
	private readonly writer: ArtifactWriter;

	constructor(deps: {
		store: StoreLike;
		repoId: string;
		projectId: string;
		version: string;
		writer: ArtifactWriter;
	}) {
		this.store = deps.store;
		this.repoId = deps.repoId;
		this.projectId = deps.projectId;
		this.version = deps.version;
		this.writer = deps.writer;
	}

	/**
	 * The single whole-file (mode `whole`) construction site in
	 * SharedLayer (K8-019 / K8-020, D8-08, asserted by
	 * tests/unit/single_write_path.test.ts): the OKF file is written
	 * through the ArtifactWriter's write funnel like every other file
	 * Kevin owns — there is no second write path.
	 */
	private wholeRequest(
		path: string,
		content: string,
		refusal?: string,
	): WriteRequest {
		return {
			path,
			mode: "whole",
			content,
			...(refusal !== undefined ? { refusal } : {}),
		};
	}

	/**
	 * Pure export planner (K8-020 / plan §5.5): reads the current file
	 * and merges the given local memories' projections into the corpus,
	 * producing a {@link WritePlan} — but writes nothing. Refusals are
	 * audited like any other write: `after === before`, both hashes
	 * recorded (D6-04). The refusal ladder, in the order the code
	 * evaluates it — file-side refusals first (not_okf, version_ahead,
	 * repo_mismatch), then candidate-side refusals in the loop order
	 * (line_too_long, below_floor, not_curated, unknown_entry), then
	 * too_many_entries and finally parse_damaged.
	 */
	planExport(memoryIds: string[], path: string): ExportPlan {
		const { exists, parsed } = this.readWithFlag(path);

		if (exists && parsed.version === 0) {
			return this.refused(path, "not_okf");
		}
		if (exists && parsed.version > OKF_VERSION) {
			return this.refused(path, "version_ahead");
		}
		if (parsed.repoId !== null && parsed.repoId !== this.repoId) {
			return this.refused(path, "repo_mismatch");
		}

		const candidates = this.candidateEntries(memoryIds);
		if (candidates.refusal !== null) {
			return this.refused(path, candidates.refusal);
		}

		const merged = merge(parsed.entries, candidates.entries);
		if (merged.length > MAX_ENTRIES) {
			return this.refused(path, "too_many_entries");
		}
		if (exists && parsed.rejected.length > 0) {
			return this.refused(path, "parse_damaged");
		}

		const content = serialize(merged, this.repoId, this.version);
		const existing = new Set(parsed.entries.map((e) => e.entry_id));
		const entriesAdded = merged.filter((e) => !existing.has(e.entry_id)).length;
		const request = this.wholeRequest(path, content);
		return { path, request, write: this.writer.plan(request), entriesAdded };
	}

	/**
	 * Tombstone-append planner (K8-020 / D8-09): emits one `tombstone`
	 * line per entry id, never deletes a line. The identifying triple is
	 * reconstructed from the local projection (a memory with
	 * `shared_entry_id`) so the line still passes parse's
	 * tamper-evident entry_id check; an id with no local projection is
	 * refused rather than emitting an invalid line.
	 */
	planTombstone(entryIds: string[], path: string): ExportPlan {
		const { exists, parsed } = this.readWithFlag(path);

		if (exists && parsed.version === 0) {
			return this.refused(path, "not_okf");
		}
		if (exists && parsed.version > OKF_VERSION) {
			return this.refused(path, "version_ahead");
		}
		if (parsed.repoId !== null && parsed.repoId !== this.repoId) {
			return this.refused(path, "repo_mismatch");
		}
		if (exists && parsed.rejected.length > 0) {
			return this.refused(path, "parse_damaged");
		}

		if (entryIds.length === 0) {
			const content = serialize(parsed.entries, this.repoId, this.version);
			const request = this.wholeRequest(path, content);
			return {
				path,
				request,
				write: this.writer.plan(request),
				entriesAdded: 0,
			};
		}
		const unique = [...new Set(entryIds)];
		const placeholders = unique.map(() => "?").join(", ");
		const rows = this.store
			.prepare(
				`SELECT type, content, scope, evidence_count, recurrence_count,
				        origin, created_at
				 FROM memories
				 WHERE shared_entry_id IN (${placeholders}) AND repo_id = ?`,
			)
			.all(...unique, this.repoId) as MemoryRow[];
		if (rows.length !== entryIds.length) {
			return this.refused(path, "unknown_entry");
		}
		const tombstones = rows.map((row) => ({
			...memoryToEntry(row),
			op: "tombstone" as const,
		}));
		const merged = merge(parsed.entries, tombstones);
		if (merged.length > MAX_ENTRIES) {
			return this.refused(path, "too_many_entries");
		}
		const content = serialize(merged, this.repoId, this.version);
		const existing = new Set(parsed.entries.map((e) => e.entry_id));
		const entriesAdded = merged.filter((e) => !existing.has(e.entry_id)).length;
		const request = this.wholeRequest(path, content);
		return { path, request, write: this.writer.plan(request), entriesAdded };
	}

	/**
	 * v0.8.0 (BUG-003) — heal a stale `#repo` header after a rekey.
	 * Rekey changes the scope the file is written under; a stale first
	 * line would make every later planExport/planTombstone refuse with
	 * repo_mismatch forever. Only the header line is replaced; the entry
	 * bytes, line endings and trailing newline are preserved. The write
	 * goes through the single funnel (D8-08). Returns true when the
	 * header was rewritten. Never throws: a missing or unreadable file
	 * is nothing to heal.
	 */
	healHeader(path: string, newRepoId: string): boolean {
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			return false;
		}
		const eol = text.includes("\r\n") ? "\r\n" : "\n";
		const lines = text.split(/\r?\n/);
		const header = `#repo ${newRepoId}`;
		const repoLine = lines.findIndex((l) => l.startsWith("#repo "));
		if (repoLine === -1 || lines[repoLine] === header) return false;
		lines[repoLine] = header;
		this.writer.write(this.wholeRequest(path, lines.join(eol)));
		return true;
	}

	/**
	 * Apply a previously planned export: the write goes through the
	 * single write funnel (re-planning against the file's current state),
	 * and the outcome is recorded on the returned plan (K8-020).
	 */
	applyExport(plan: ExportPlan): ExportPlan {
		return { ...plan, applied: this.writer.write(plan.request) };
	}

	/** Refusal plans are audited with both hashes (after === before). */
	private refused(path: string, reason: string): ExportPlan {
		const request = this.wholeRequest(path, "", reason);
		return {
			path,
			request,
			write: this.writer.plan(request),
			entriesAdded: 0,
		};
	}

	/**
	 * Convert the requested local memories into OKF candidates and run
	 * the candidate-side refusals — line_too_long, below_floor,
	 * not_curated — in plan §5.5 order.
	 */
	private candidateEntries(memoryIds: string[]): {
		entries: OkfEntry[];
		refusal: string | null;
	} {
		if (memoryIds.length === 0) {
			return { entries: [], refusal: null };
		}
		const placeholders = memoryIds.map(() => "?").join(", ");
		const rows = this.store
			.prepare(
				`SELECT type, content, scope, evidence_count, recurrence_count,
				        origin, created_at, curated
				 FROM memories WHERE id IN (${placeholders}) AND repo_id = ?`,
			)
			.all(...memoryIds, this.repoId) as MemoryRow[];
		// v0.8.0 (BUG-006) — every requested id must have a local
		// projection, exactly like planTombstone: a typo'd or foreign id
		// is refused instead of silently sharing the matching subset.
		if (rows.length !== memoryIds.length) {
			return { entries: [], refusal: "unknown_entry" };
		}
		const requiresApproval =
			this.setting("share_requires_approval", "1") === "1";
		const floor = Number.parseFloat(
			this.setting("shared_confidence_floor", "0.7"),
		);
		const clampedFloor = Number.isNaN(floor)
			? 0.7
			: Math.min(1, Math.max(0, floor));
		const entries: OkfEntry[] = [];
		for (const row of rows) {
			const entry = memoryToEntry(row);
			if (Buffer.byteLength(canonicalize(entry), "utf8") > MAX_LINE_BYTES) {
				return { entries: [], refusal: "line_too_long" };
			}
			if (computeConfidence(entry.evidence, entry.recurrence) < clampedFloor) {
				return { entries: [], refusal: "below_floor" };
			}
			if (requiresApproval && row.curated !== 1) {
				return { entries: [], refusal: "not_curated" };
			}
			entries.push(entry);
		}
		return { entries, refusal: null };
	}

	private setting(key: string, fallback: string): string {
		const row = this.store
			.prepare("SELECT value FROM kevin_settings WHERE key = ?")
			.get(key) as { value: string } | undefined;
		return row?.value ?? fallback;
	}

	private readWithFlag(path: string): { exists: boolean; parsed: ParseResult } {
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			return {
				exists: false,
				parsed: {
					version: 0,
					repoId: null,
					entries: [],
					rejected: [],
					folded: 0,
				},
			};
		}
		return { exists: true, parsed: parse(text) };
	}

	/**
	 * Read and parse the shared file. Total: a missing or unreadable
	 * file yields an empty ParseResult, never a throw (D8-14).
	 */
	read(path: string): ParseResult {
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			return {
				version: 0,
				repoId: null,
				entries: [],
				rejected: [],
				folded: 0,
			};
		}
		return parse(text);
	}

	/**
	 * Idempotent and cheap to call (K8-016 / plan §5.5): hash the file
	 * first and return `{ skipped: true }` when the hash matches the
	 * most recent `okf_imports` row for this repo_id — the session.idle
	 * path costs one readFileSync plus one hash on an unchanged
	 * repository. A missing file is not an error: it returns
	 * `fileHash: null`, `parsed: 0`, and still writes an audit row.
	 */
	import(path: string): ImportReport {
		let fileHash: string | null = null;
		let text: string;
		try {
			text = readFileSync(path, "utf8");
			fileHash = fnv1a64(text);
		} catch {
			fileHash = null;
			this.writeImportRow(path, null, 0, 0, 0, 0);
			return {
				path,
				fileHash: null,
				parsed: 0,
				folded: 0,
				rejected: 0,
				imported: 0,
				tombstoned: 0,
				skipped: false,
			};
		}

		const last = this.store
			.prepare(
				`SELECT file_hash FROM okf_imports
				 WHERE repo_id = ? ORDER BY imported_at DESC, rowid DESC LIMIT 1`,
			)
			.get(this.repoId) as { file_hash: string | null } | undefined;

		if (last !== undefined && last.file_hash === fileHash) {
			this.writeImportRow(path, fileHash, 0, 0, 0, 1);
			return {
				path,
				fileHash,
				parsed: 0,
				folded: 0,
				rejected: 0,
				imported: 0,
				tombstoned: 0,
				skipped: true,
			};
		}

		const result = parse(text);
		const imported = this.upsertEntries(result.entries);
		const tombstoned = this.projectEntries(result.entries);
		if (result.folded > 0) {
			// A persistently non-zero value is signal, not error: the team
			// is editing the same entries concurrently and the lattice is
			// absorbing it (K8-016).
			this.store
				.prepare(
					`INSERT INTO kevin_metrics (key, value, updated_at)
					 VALUES ('okf_merge_folds', ?, datetime('now'))
					 ON CONFLICT(key) DO UPDATE SET
					   value = value + excluded.value,
					   updated_at = datetime('now')`,
				)
				.run(result.folded);
		}
		this.writeImportRow(
			path,
			fileHash,
			result.entries.length,
			result.folded,
			result.rejected.length,
			0,
		);
		return {
			path,
			fileHash,
			parsed: result.entries.length,
			folded: result.folded,
			rejected: result.rejected.length,
			imported,
			tombstoned,
			skipped: false,
		};
	}

	private writeImportRow(
		path: string,
		fileHash: string | null,
		parsed: number,
		folded: number,
		rejected: number,
		skipped: number,
	): void {
		this.store
			.prepare(
				`INSERT INTO okf_imports
				 (id, repo_id, path, file_hash, entries_parsed, entries_folded,
				  entries_rejected, skipped)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				uuidv7(),
				this.repoId,
				path,
				fileHash,
				parsed,
				folded,
				rejected,
				skipped,
			);
	}

	/**
	 * Project every imported entry into memories (K8-017 / plan §5.5,
	 * D8-10): a shared memory IS a memory, so getRelevant(), rankScore(),
	 * the five gates, truth_penalty, ConflictDetector and every audit
	 * rollup keep working unchanged.
	 *
	 * - assert entries: inserted once, never updated — re-importing an
	 *   unchanged file must not create duplicates, bump evidence_count or
	 *   move updated_at. `fingerprint` is deliberately left NULL: it is a
	 *   different identity dimension (plan §3.3) and conflating it with
	 *   `shared_entry_id` would make the v0.4.0 supersede path fire on
	 *   unrelated entries (K8-017 acceptance).
	 * - tombstone entries: the ONE place in this codebase where the shared
	 *   layer may write memories.status. This is NOT a v0.7.0 Principle 24
	 *   violation: that principle forbids *contradiction* — a fuzzy
	 *   inference — from writing status, and a tombstone is the opposite:
	 *   an explicit, committed, human-reviewed decision that arrived
	 *   through a pull request (D8-09, plan §5.5).
	 *
	 * Returns the number of memories archived by tombstones.
	 */
	private projectEntries(entries: OkfEntry[]): number {
		const findMemory = this.store.prepare(
			`SELECT id FROM memories
		 WHERE shared_entry_id = ? AND repo_id = ? LIMIT 1`,
		);
		const insertMemory = this.store.prepare(
			`INSERT INTO memories
		 (id, type, content, scope, relevance_score, project_id, origin,
		  evidence_count, recurrence_count, created_at, updated_at, status,
		  curated, inferable, layer, repo_id, shared_entry_id)
		 VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?, datetime('now'),
		  datetime('now'), 'active', 1, 1, 'shared', ?, ?)`,
		);
		const tombstone = this.store.prepare(
			`UPDATE memories SET status = 'archived'
		 WHERE shared_entry_id = ? AND repo_id = ? AND layer = 'shared'
		   AND status = 'active'`,
		);
		const lastChanges = this.store.prepare("SELECT changes() AS c");
		let archived = 0;
		for (const e of entries) {
			if (e.op === "tombstone") {
				// Explicit committed decision — see the class comment above.
				tombstone.run(e.entry_id, this.repoId);
				archived += (lastChanges.get() as { c: number }).c;
				continue;
			}
			const existing = findMemory.get(e.entry_id, this.repoId) as
				| { id: string }
				| undefined;
			if (existing) continue;
			insertMemory.run(
				uuidv7(),
				e.type,
				e.statement,
				// memories.scope is CHECK-constrained to project/session; a
				// path-prefix scope from the file degrades to 'project'.
				e.scope === "project" || e.scope === "session" ? e.scope : "project",
				deriveConfidence(e),
				this.projectId,
				e.evidence,
				e.recurrence,
				this.repoId,
				e.entry_id,
			);
		}
		return archived;
	}

	/**
	 * Upsert every entry into shared_entries keyed on (repo_id,
	 * entry_id) — the UNIQUE index from migration 009 makes this an
	 * upsert rather than an append. `confidence` is the DERIVED value
	 * (deriveConfidence), never a transported float (plan §5.3).
	 * Returns the number of rows inserted or updated.
	 */
	private upsertEntries(entries: OkfEntry[]): number {
		const upsert = this.store.prepare(
			`INSERT INTO shared_entries
			 (id, repo_id, entry_id, type, statement, scope, confidence,
			  evidence, origin, author_hash, op, supersedes, created_at,
			  imported_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(repo_id, entry_id) DO UPDATE SET
			   type = excluded.type,
			   statement = excluded.statement,
			   scope = excluded.scope,
			   confidence = excluded.confidence,
			   evidence = excluded.evidence,
			   origin = excluded.origin,
			   author_hash = excluded.author_hash,
			   op = excluded.op,
			   supersedes = excluded.supersedes,
			   created_at = excluded.created_at,
			   imported_at = datetime('now')`,
		);
		let n = 0;
		for (const e of entries) {
			upsert.run(
				uuidv7(),
				this.repoId,
				e.entry_id,
				e.type,
				e.statement,
				e.scope,
				deriveConfidence(e),
				e.evidence,
				e.origin,
				e.author_hash,
				e.op,
				e.supersedes,
				e.created_at,
			);
			n++;
		}
		return n;
	}
}

/**
 * The Store surface SharedLayer needs. Kept structural so tests can
 * use the real Store without importing plugin internals.
 */
export interface StoreLike {
	prepare(sql: string): {
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		run(...params: unknown[]): void;
	};
}

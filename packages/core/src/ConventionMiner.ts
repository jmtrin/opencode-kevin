import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { fingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";

// v0.7.0 (K7-010/011 / plan §5.4, D7-10 / D7-11)
// ============================================================
// ConventionMiner — the project's history states its own rules.
//
// Two deterministic miners over the SAME `tool_calls` table PatternMiner
// reads, but over SUCCESSES and co-edits rather than failure shapes
// (Principle 25: a rule learned from success outranks a lesson learned from
// failure). Both count support in DISTINCT SESSIONS, never occurrences: a
// single pathological session that repeats something forty times must not
// manufacture a project-wide convention (D7-10).
//
// No LLM, no network, no heuristic scoring. Deterministic: no Math.random,
// no clock, no Object.keys ordering; ties are broken lexicographically.
//
// Fingerprints derive from the normalized STATEMENT text (D7-11), which makes
// them caller-supplied in the sense Principle 26 requires and gives idempotent
// refresh through MemoryService.save()'s existing supersede path.
// ============================================================

export interface MinedConvention {
	/** Caller-supplied, derived from the normalized statement (D7-11). */
	readonly fingerprint: string;
	/** Human-readable rule statement. */
	readonly statement: string;
	/** Distinct sessions in which the pattern held. */
	readonly support: number;
	readonly kind: "sequence" | "co_edit";
}

interface ToolCallRow {
	id: string;
	session_id: string;
	ts: string;
	tool: string;
	success: number;
	args_summary: string | null;
}

const DEFAULT_MIN_SUPPORT = 5;

export class ConventionMiner {
	private readonly metrics: Metrics | null;

	constructor(
		private readonly store: Store,
		private readonly memoryService: MemoryService,
		private readonly projectId: string,
		metrics?: Metrics | null,
	) {
		this.metrics = metrics ?? null;
		// `memoryService` is retained for emission (K7-012); mining itself is
		// store-only.
		void this.memoryService;
	}

	/** v0.7.0 (K7-010) — the `sequence` miner over successful tool_calls. */
	mineSequence(minSupport = DEFAULT_MIN_SUPPORT): MinedConvention[] {
		const rows = this.fetchToolCalls();
		if (rows.length === 0) return [];

		// Group successful calls by session in execution order (ts ASC, then id
		// as a deterministic tie-break).
		const bySession = new Map<string, ToolCallRow[]>();
		const sorted = [...rows]
			.filter((r) => r.success === 1)
			.sort((a, b) =>
				a.session_id === b.session_id
					? compareTs(a.ts, b.ts) || a.id.localeCompare(b.id)
					: a.session_id.localeCompare(b.session_id),
			);
		for (const r of sorted) {
			const list = bySession.get(r.session_id) ?? [];
			list.push(r);
			bySession.set(r.session_id, list);
		}

		// 2-grams and 3-grams of (tool, normalized first-arg path segment).
		type Cand = { key: string; statement: string; sessions: Set<string> };
		const map = new Map<string, Cand>();
		const record = (key: string, statement: string, sessionId: string) => {
			let cand = map.get(key);
			if (!cand) {
				cand = { key, statement, sessions: new Set<string>() };
				map.set(key, cand);
			}
			cand.sessions.add(sessionId);
		};

		for (const [sessionId, list] of bySession) {
			if (list.length < 2) continue;
			for (let i = 0; i < list.length - 1; i++) {
				const a = list[i];
				const b = list[i + 1];
				const aTok = tokenOf(a);
				const bTok = tokenOf(b);
				const key2 = `seq::${aTok}::${bTok}`;
				const stmt2 = statementForSequence(aTok, bTok);
				record(key2, stmt2, sessionId);

				if (i + 2 < list.length) {
					const c = list[i + 2];
					const cTok = tokenOf(c);
					const key3 = `seq::${aTok}::${bTok}::${cTok}`;
					const stmt3 = statementForSequence3(aTok, bTok, cTok);
					record(key3, stmt3, sessionId);
				}
			}
		}

		return this.materialize(map, minSupport, "sequence");
	}

	/** v0.7.0 (K7-011) — the `co_edit` miner over same-session file writes. */
	mineCoEdit(minSupport = DEFAULT_MIN_SUPPORT): MinedConvention[] {
		const rows = this.fetchToolCalls();
		if (rows.length === 0) return [];

		// Successful file writes (broad: any success call mentioning a path) per
		// session. Pairs span two different directory prefixes.
		const bySession = new Map<string, string[]>();
		const sorted = [...rows]
			.filter((r) => r.success === 1 && pathOf(r) !== null)
			.sort((a, b) =>
				a.session_id === b.session_id
					? compareTs(a.ts, b.ts) || a.id.localeCompare(b.id)
					: a.session_id.localeCompare(b.session_id),
			);
		for (const r of sorted) {
			const list = bySession.get(r.session_id) ?? [];
			list.push(pathOf(r) as string);
			bySession.set(r.session_id, list);
		}

		// Same-prefix pairs are a truism; only cross-prefix pairs are recorded.
		type Cand = { key: string; statement: string; sessions: Set<string> };
		const map = new Map<string, Cand>();
		const record = (key: string, statement: string, sessionId: string) => {
			let cand = map.get(key);
			if (!cand) {
				cand = { key, statement, sessions: new Set<string>() };
				map.set(key, cand);
			}
			cand.sessions.add(sessionId);
		};

		for (const [sessionId, paths] of bySession) {
			const unique = [...new Set(paths)];
			if (unique.length < 2) continue;
			// Bounded enumeration: a large session must not explode into an
			// O(n²) pair set. Cap distinct prefixes per session at 40.
			const limit = Math.min(unique.length, 40);
			for (let i = 0; i < limit; i++) {
				const pA = unique[i];
				for (let j = i + 1; j < limit; j++) {
					const pB = unique[j];
					const prefixA = dirOf(pA);
					const prefixB = dirOf(pB);
					if (prefixA === prefixB) continue;
					const [lo, hi] =
						prefixA < prefixB ? [prefixA, prefixB] : [prefixB, prefixA];
					const key = `coedit::${lo}::${hi}`;
					const stmt = `every new file under ${lo}/ is accompanied by a change under ${hi}/`;
					record(key, stmt, sessionId);
				}
			}
		}

		return this.materialize(map, minSupport, "co_edit");
	}

	/** v0.7.0 (K7-012) — mine both kinds in one call. */
	mine(minSupport = DEFAULT_MIN_SUPPORT): MinedConvention[] {
		return [
			...this.mineSequence(minSupport),
			...this.mineCoEdit(minSupport),
		].sort((a, b) => a.statement.localeCompare(b.statement));
	}

	/**
	 * v0.7.0 (K7-012 / plan §5.4, D7-11) — emit mined(conventions) as `rule`
	 * memories. Returns the number of memories created or refreshed and
	 * increments `conventions_mined`. Runs on session.idle only, behind
	 * convention_mining_enabled. The fingerprint derives from the statement,
	 * so a re-mine of an unchanged convention collides and supersedes.
	 */
	emit(conventions: MinedConvention[]): number {
		let emitted = 0;
		for (const c of conventions) {
			const derivedFingerprint = fingerprint(c.statement, this.projectId);
			// save() derives the fingerprint-based supersede/collision path for
			// `rule` types automatically, so re-emitting an unchanged convention
			// refreshes rather than duplicates.
			this.memoryService.save({
				type: "rule",
				origin: "pattern",
				scope: "project",
				projectId: this.projectId,
				fingerprint: derivedFingerprint,
				content: c.statement,
				relevanceScore: 0.5,
				sourceTool: "ConventionMiner",
			});
			this.metrics?.incr("conventions_mined", 1);
			emitted += 1;
		}
		return emitted;
	}

	private materialize(
		map: Map<string, { key: string; statement: string; sessions: Set<string> }>,
		minSupport: number,
		kind: "sequence" | "co_edit",
	): MinedConvention[] {
		const out: MinedConvention[] = [];
		for (const cand of map.values()) {
			if (cand.sessions.size < minSupport) continue;
			out.push({
				fingerprint: fingerprint(cand.statement, this.projectId),
				statement: cand.statement,
				support: cand.sessions.size,
				kind,
			});
		}
		// Deterministic order: lexicographic by statement (ties are resolved).
		return out.sort((a, b) => a.statement.localeCompare(b.statement));
	}

	private fetchToolCalls(): ToolCallRow[] {
		const rows = this.store
			.prepare(
				`SELECT id, session_id, ts, tool, success, args_summary
				 FROM tool_calls
				 WHERE project_id = ?
				 ORDER BY session_id, ts`,
			)
			.all(this.projectId) as ToolCallRow[];
		return rows;
	}
}

// ---------------------------------------------------------------------------
// Helpers — deterministic token/path extraction. Every value is normalized so
// the same underlying fact never collides via a JavaScript type difference.
// ---------------------------------------------------------------------------

/** `<tool>:<first path segment>` token for sequence mining. */
function tokenOf(r: ToolCallRow): string {
	const seg = firstPathSegment(r.args_summary);
	return `${r.tool}:${seg}`;
}

function compareTs(a: string, b: string): number {
	return a.localeCompare(b);
}

/** First path segment of the first path-like argument, else "*". */
function firstPathSegment(argsSummary: string | null): string {
	const paths = pathSegments(argsSummary);
	const first = paths[0];
	if (!first) return "*";
	return first.split("/").filter(Boolean)[0] ?? "*";
}

/** All path segments found in args_summary, in appearance order. */
function pathSegments(argsSummary: string | null): string[] {
	const text = argsSummary ?? "";
	const found: string[] = [];
	// Try JSON object string values first.
	try {
		const parsed = JSON.parse(text) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			for (const v of Object.values(parsed) as unknown[]) {
				if (typeof v === "string" && /\//.test(v) && !v.includes(" ")) {
					found.push(v.replace(/\\/g, "/").toLowerCase().trim());
				}
			}
		}
	} catch {
		/* not JSON */
	}
	if (found.length === 0) {
		const m = text.match(/[^\s"':,=]*\/[^\s"':,=]*/g);
		for (const tok of m ?? []) {
			found.push(tok.replace(/\\/g, "/").toLowerCase().trim());
		}
	}
	return found;
}

/** Directory of a path (drop the filename). `src/routes/user.ts` → `src/routes`. */
function dirOf(p: string): string {
	const segs = p.split("/").filter(Boolean);
	segs.pop();
	return segs.join("/") || "*";
}

/** A deterministic path for a call if it is a file write/read on disk. */
function pathOf(r: ToolCallRow): string | null {
	const segs = pathSegments(r.args_summary);
	return segs[0] ?? null;
}

function statementForSequence(a: string, b: string): string {
	return `every ${a} is immediately followed by ${b}`;
}

function statementForSequence3(a: string, b: string, c: string): string {
	return `every ${a} is followed by ${b} and then ${c}`;
}

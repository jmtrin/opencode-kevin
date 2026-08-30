// ============================================================
// Kevin 0.8.0 — OKF v2 codec (F2, K8-010 … K8-015)
// ============================================================
// The Open Kevin Format: the committed, shareable artifact of the
// shared layer (plan §3.3). Everything in this module is a pure
// function — no database, no filesystem, no clock. The format is
// the release: if `join()` is not a semilattice then silent git
// merges, order-independent imports and correct both-sides
// conflict resolution all evaporate.
//
// Entry ids are deliberately the THIRD fingerprint identity
// dimension in the codebase (v0.7.0's Principle 26; plan §3.3's
// table). The first is `fingerprint()` (error text, salted with
// `project_id`, normalized) and the second is the convention /
// decision fingerprints of v0.7.0 (derived from the normalized
// statement). This one is unsalted and un-normalized, and it is
// the ONLY cross-machine-stable dimension in the schema.
// ============================================================

import { computeConfidence } from "./confidence.js";
import { fnv1a64 } from "./fingerprint.js";

/** OKF v2 format version marker, written on the first header line. */
export const OKF_VERSION = 2;
/** v2.0.0 (K16-007) — OKF v3 marker */
export const OKF_V3 = 3;
export const OKF_VERSIONS = [2, 3] as const;
export type OkfVersion = (typeof OKF_VERSIONS)[number];

/** A single canonicalized entry line may not exceed this many bytes. */
export const MAX_LINE_BYTES = 4096;

/** A serialized corpus may not exceed this many entries. */
export const MAX_ENTRIES = 2000;

export type OkfOp = "assert" | "tombstone";

/**
 * A v2 entry. The field set is plan §5.3/§5.4: the two integer
 * counters (`evidence`, `recurrence`) are transported and
 * `confidence` is DERIVED at read time — the file contains no
 * floats at all, so two machines computing a confidence slightly
 * differently still emit byte-identical lines.
 */
export interface OkfEntry {
	entry_id: string;
	type: "decision" | "rule" | "pattern" | "solution";
	statement: string;
	scope: string | null;
	evidence: number;
	recurrence: number;
	origin: string;
	author_hash: string | null;
	op: OkfOp;
	created_at: string;
	supersedes: string | null;
}

const OKF_KEY_ORDER = [
	"author_hash",
	"created_at",
	"entry_id",
	"evidence",
	"op",
	"origin",
	"recurrence",
	"scope",
	"statement",
	"supersedes",
	"type",
] as const;

/**
 * Canonical JSON of an entry: keys in alphabetical order, no space
 * argument, integers only (no float is ever written — plan §5.3).
 * The object is constructed explicitly so the source object's
 * insertion order can never leak into the bytes.
 */
export function canonicalize(e: OkfEntry): string {
	const ordered: Record<string, unknown> = {};
	for (const key of OKF_KEY_ORDER) {
		ordered[key] = e[key];
	}
	return JSON.stringify(ordered);
}

/**
 * Emit the v2 file: three `#` header lines, then every entry sorted
 * ascending by `entry_id`, one per line, LF endings, exactly one
 * terminating newline. Entries over MAX_LINE_BYTES (measured in
 * BYTES — a Japanese statement passes a `.length` check and fails a
 * byte check) and corpora over MAX_ENTRIES are refused, not
 * truncated (plan §5.3, physical rules).
 */
export function serialize(
	entries: OkfEntry[],
	repoId: string,
	version: string,
	okfVersion: number = OKF_VERSION,
): string {
	if (entries.length > MAX_ENTRIES) {
		throw new Error(
			`okf: corpus of ${entries.length} entries exceeds MAX_ENTRIES (${MAX_ENTRIES})`,
		);
	}
	const sorted = [...entries].sort((a, b) =>
		a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0,
	);
	const lines: string[] = [
		`#okf ${okfVersion}`,
		`#repo ${repoId}`,
		`#generated-by opencode-kevin/${version}`,
	];
	for (const e of sorted) {
		const line = canonicalize(e);
		if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
			throw new Error(
				`okf: entry ${e.entry_id} canonicalizes to ${Buffer.byteLength(
					line,
					"utf8",
				)} bytes, over MAX_LINE_BYTES (${MAX_LINE_BYTES})`,
			);
		}
		lines.push(line);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Group both corpora by `entry_id`, fold each group through `join()`,
 * and return the result sorted ascending by `entry_id`. Order of the
 * inputs does not matter: join() is commutative, and the fold order is
 * the only place input order could leak in — it cannot, by algebra.
 */
export function merge(a: OkfEntry[], b: OkfEntry[]): OkfEntry[] {
	const byId = new Map<string, OkfEntry>();
	for (const e of [...a, ...b]) {
		const existing = byId.get(e.entry_id);
		byId.set(e.entry_id, existing ? join(existing, e) : e);
	}
	return [...byId.values()].sort((x, y) =>
		x.entry_id < y.entry_id ? -1 : x.entry_id > y.entry_id ? 1 : 0,
	);
}

/**
 * Derived, never serialized — reuses the v0.4.0 two-sided confidence
 * formula verbatim (plan §5.4). A lesson that keeps recurring is
 * DEMOTED rather than merely un-promoted; shared and local memories
 * are repriced identically by the same formula.
 */
export function deriveConfidence(e: OkfEntry): number {
	return computeConfidence(e.evidence, e.recurrence);
}

export interface RejectedLine {
	line: number;
	reason: string;
}

export interface ParseResult {
	version: number;
	repoId: string | null;
	/** Folded via join() and sorted ascending by entry_id. */
	entries: OkfEntry[];
	/** parse never throws; bad lines are reported. */
	rejected: RejectedLine[];
	/** Duplicate entry_ids collapsed by join(). */
	folded: number;
}

const OKF_TYPES = new Set(["decision", "rule", "pattern", "solution"]);

function pickMin(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a <= b ? a : b;
}

/**
 * v0.8.0 (K8-013 / plan §5.4, D8-13) — the field lattice. Every field
 * resolves through a max, a min, or an absorbing boolean OR over a
 * totally ordered set; there is no "prefer the newer" anywhere.
 * Precondition: `a.entry_id === b.entry_id`.
 */
export function join(a: OkfEntry, b: OkfEntry): OkfEntry {
	return {
		entry_id: a.entry_id,
		// Equal by construction unless a hash collision — resolve by
		// lexicographic min so the function stays total and deterministic.
		type: a.type <= b.type ? a.type : b.type,
		statement: a.statement <= b.statement ? a.statement : b.statement,
		scope: pickMin(a.scope, b.scope),
		evidence: Math.max(a.evidence, b.evidence),
		recurrence: Math.max(a.recurrence, b.recurrence),
		origin: a.origin <= b.origin ? a.origin : b.origin,
		author_hash: pickMin(a.author_hash, b.author_hash),
		// Tombstone absorbs: no undelete, no timestamp tiebreak (D8-09).
		op: a.op === "tombstone" || b.op === "tombstone" ? "tombstone" : "assert",
		// Birthday semantics: min is the only choice stable under replay.
		created_at: a.created_at <= b.created_at ? a.created_at : b.created_at,
		supersedes: pickMin(a.supersedes, b.supersedes),
	};
}

/**
 * parse() is a TOTAL function — it never throws, on any input,
 * including binary (D8-14). The file is expected to arrive damaged:
 * a conflict resolution leaves `<<<<<<< HEAD` markers, an editor
 * truncates the last line, a merge tool mangles an encoding. Every
 * unusable line becomes a `RejectedLine`; the good entries survive.
 *
 * Reason taxonomy (closed): not_okf, version_ahead, bad_json,
 * missing_field, wrong_type, id_mismatch, unknown_op, line_too_long,
 * corpus_too_large.
 */
export function parse(text: string): ParseResult {
	const rejected: RejectedLine[] = [];
	const reject = (line: number, reason: string): void => {
		rejected.push({ line, reason });
	};

	// A UTF-8 BOM breaks the `#okf ` prefix check; strip it first.
	const body = text.replace(/^\uFEFF/, "");
	const lines = body.split(/\r\n|\r|\n/);

	let version = 0;
	let repoId: string | null = null;
	if (!(lines[0]?.startsWith("#okf ") ?? false)) {
		reject(1, "not_okf");
		return { version, repoId, entries: [], rejected, folded: 0 };
	}
	const declared = Number(lines[0].slice(5));
	version = Number.isInteger(declared) && declared >= 0 ? declared : 0;
	if (version > OKF_V3) {
		// Guessing at a future format's semantics is how corpora get
		// corrupted — refuse the whole file, never a best-effort parse.
		return {
			version,
			repoId: null,
			entries: [],
			rejected: [{ line: 1, reason: "version_ahead" }],
			folded: 0,
		};
	}
	if (version !== OKF_VERSION && version !== OKF_V3) {
		reject(1, "not_okf");
		return { version, repoId: null, entries: [], rejected, folded: 0 };
	}
	if (lines[1]?.startsWith("#repo ")) {
		repoId = lines[1].slice(6) || null;
	}

	const byId = new Map<string, OkfEntry>();
	let folded = 0;
	let accepted = 0;
	for (let i = 2; i < lines.length; i++) {
		const line = lines[i];
		if (line === "") continue; // trailing newline / blank lines
		if (line.startsWith("#")) continue; // header/comment lines
		const lineNo = i + 1;
		if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
			reject(lineNo, "line_too_long");
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			reject(lineNo, "bad_json");
			continue;
		}
		if (typeof raw !== "object" || raw === null) {
			reject(lineNo, "bad_json");
			continue;
		}
		const o = raw as Record<string, unknown>;

		const missing = (k: string): boolean => o[k] === undefined;
		const wrong = (k: string, ok: (v: unknown) => boolean): boolean =>
			!missing(k) && !ok(o[k]);
		const stringField = (k: string): boolean =>
			!wrong(k, (v) => typeof v === "string");
		const nullableString = (k: string): boolean =>
			!wrong(k, (v) => v === null || typeof v === "string");
		const intField = (k: string): boolean =>
			!wrong(k, (v) => typeof v === "number" && Number.isInteger(v) && v >= 0);

		if (missing("entry_id")) reject(lineNo, "missing_field");
		else if (!stringField("entry_id")) reject(lineNo, "wrong_type");
		else if (missing("type")) reject(lineNo, "missing_field");
		else if (typeof o.type !== "string" || !OKF_TYPES.has(o.type))
			reject(lineNo, "wrong_type");
		else if (missing("statement")) reject(lineNo, "missing_field");
		else if (!stringField("statement")) reject(lineNo, "wrong_type");
		else if (!nullableString("scope")) reject(lineNo, "wrong_type");
		else if (missing("evidence")) reject(lineNo, "missing_field");
		else if (!intField("evidence")) reject(lineNo, "wrong_type");
		else if (missing("recurrence")) reject(lineNo, "missing_field");
		else if (!intField("recurrence")) reject(lineNo, "wrong_type");
		else if (missing("origin")) reject(lineNo, "missing_field");
		else if (!stringField("origin")) reject(lineNo, "wrong_type");
		else if (!nullableString("author_hash")) reject(lineNo, "wrong_type");
		else if (missing("op")) reject(lineNo, "missing_field");
		else if (o.op !== "assert" && o.op !== "tombstone")
			reject(lineNo, "unknown_op");
		else if (missing("created_at")) reject(lineNo, "missing_field");
		else if (!stringField("created_at")) reject(lineNo, "wrong_type");
		else if (!nullableString("supersedes")) reject(lineNo, "wrong_type");
		else {
			// The tamper-evident check: a hand-edited statement without
			// an updated entry_id is caught here, not silently ranked.
			const recomputed = computeEntryId(
				o.type as string,
				o.statement as string,
				(o.scope ?? null) as string | null,
			);
			if (recomputed !== o.entry_id) {
				reject(lineNo, "id_mismatch");
				continue;
			}
			const e: OkfEntry = {
				entry_id: o.entry_id as string,
				type: o.type as OkfEntry["type"],
				statement: o.statement as string,
				scope: (o.scope ?? null) as string | null,
				evidence: o.evidence as number,
				recurrence: o.recurrence as number,
				origin: o.origin as string,
				author_hash: (o.author_hash ?? null) as string | null,
				op: o.op as OkfOp,
				created_at: o.created_at as string,
				supersedes: (o.supersedes ?? null) as string | null,
			};
			const existing = byId.get(e.entry_id);
			if (existing) {
				byId.set(e.entry_id, join(existing, e));
				folded++;
				continue;
			}
			if (accepted >= MAX_ENTRIES) {
				reject(lineNo, "corpus_too_large");
				continue;
			}
			byId.set(e.entry_id, e);
			accepted++;
		}
	}

	const entries = [...byId.values()].sort((a, b) =>
		a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0,
	);
	return { version, repoId, entries, rejected, folded };
}

/**
 * Compute the identity of an OKF entry: `fnv1a64("okf:v2\0" + type +
 * "\0" + statement + "\0" + (scope ?? ""))`.
 *
 * D8-05 — deliberately NOT `fingerprint()`:
 *  - it salts with `project_id`, so every clone would produce a
 *    different id for the same rule, the shared file would accumulate
 *    one entry per developer per rule, and the merge fold would never
 *    once fire;
 *  - it runs `normalize()`, which lowercases and rewrites
 *    `path.ext:line:col` — both destructive for a curated statement,
 *    where casing and file paths carry meaning.
 *
 * NUL separators keep (`rule`, "ab", "c") distinct from
 * ("rule", "a", "bc") — plain concatenation could never.
 */
export function computeEntryId(
	type: string,
	statement: string,
	scope?: string | null,
): string {
	return fnv1a64(`okf:v2\u0000${type}\u0000${statement}\u0000${scope ?? ""}`);
}

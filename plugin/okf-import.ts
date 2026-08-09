import type { MemoryService } from "./MemoryService.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import { uuidv7 } from "./uuid.js";

const PAIR_RE = /^([a-z_]+):\s*(.*)$/i;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * v0.3.0 fix — A single parsed bundle entry. `evidence_count` and
 * `last_verified_at` are preserved across round-trips (export → import)
 * so causal confidence is not lost when knowledge is shared between
 * projects. v0.4.0 (BUG-008) — `recurrence_count` too, so the two-sided
 * v0.4.0 confidence demotion survives the round-trip.
 */
export interface ParsedEntry {
	id: string;
	type: string;
	content: string;
	fingerprint: string | null;
	evidence_count: number;
	/** v0.4.0 (BUG-008) — recurrence demotion, 0 when absent. */
	recurrence_count: number;
	last_verified_at: string | null;
}

/**
 * v0.3.0 fix — Clean state-machine parser for the frontmatter bundle
 * format produced by `okf-export.ts::exportOkf`. Each entry is:
 *
 *   ---
 *   id: <uuid>
 *   type: <decision|rule|pattern>
 *   confidence: 0.70
 *   evidence_count: 2
 *   last_verified_at: 2026-07-25 12:34:56
 *   fingerprint: <hex>
 *   created: 2026-07-25 12:00:00
 *   scope: project
 *   ---
 *
 *   <content body, may span multiple lines, may include `---` lines
 *    within — the body terminator is the NEXT top-level `---` followed
 *    by an `id:` line, or EOF>
 *
 * The previous implementation only ever flagged `inFm = true` once and
 * never reset `contentStarted` between entries, so 2..N entries were
 * silently dropped (bug #1). This rewrite handles arbitrary numbers of
 * consecutive frontmatter sections.
 */
export function parseMarkdownBundle(text: string): ParsedEntry[] {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const entries: ParsedEntry[] = [];

	let i = 0;
	let fm: Record<string, string> | null = null;
	let body: string[] = [];

	// True when we have just seen a `---` opener and are collecting
	// `key: value` pairs until the matching `---` closer.
	const isFmKey = (s: string): boolean => PAIR_RE.test(s) || s.trim() === "";

	while (i < lines.length) {
		const line = lines[i];
		// Seek an opening `---`.
		if (line.trim() !== "---") {
			i++;
			continue;
		}
		// Trivially empty bundle (just opener/closer with no keys) — skip.
		if (lines[i + 1]?.trim() === "---") {
			i += 2;
			continue;
		}
		// Begin frontmatter collection.
		fm = {};
		body = [];
		i++;
		let closed = false;
		while (i < lines.length) {
			const cur = lines[i];
			if (cur.trim() === "---") {
				closed = true;
				i++;
				break;
			}
			const m = cur.match(PAIR_RE);
			if (m) {
				fm[m[1].toLowerCase()] = m[2].trim();
			}
			i++;
		}
		if (!closed) break;
		if (!fm.id) continue;

		// Collect body until the next top-level `---` opener. The opener
		// is recognizable as `---` followed by an `id:` pair in the next
		// frontmatter block; we look ahead conservatively: a `---` line
		// immediately followed by a `key:` line is an opener, anything
		// else is body content.
		while (i < lines.length) {
			const cur = lines[i];
			if (cur.trim() === "---") {
				// peek the NEXT non-empty line — if it looks like a PAIR,
				// this `---` is an opener for the next entry, so stop body
				// here without consuming.
				let j = i + 1;
				while (j < lines.length && lines[j].trim() === "") j++;
				if (j < lines.length && isFmKey(lines[j]) && PAIR_RE.test(lines[j])) {
					break;
				}
				// Otherwise treat as body content (e.g. thematic break).
				body.push(cur);
				i++;
				continue;
			}
			body.push(cur);
			i++;
		}

		const content = body.join("\n").trim();
		if (!content) continue;
		const type = (fm.type ?? "context").toLowerCase();
		const id = ID_RE.test(fm.id) ? fm.id : uuidv7();
		const fp = fm.fingerprint ?? null;
		const evidenceCount = Number.parseInt(fm.evidence_count ?? "0", 10) || 0;
		const recurrenceCount =
			Number.parseInt(fm.recurrence_count ?? "0", 10) || 0;
		const lastVerified = fm.last_verified_at ?? null;
		entries.push({
			id,
			type,
			content,
			fingerprint: fp,
			evidence_count: evidenceCount,
			recurrence_count: recurrenceCount,
			last_verified_at: lastVerified,
		});
	}

	return entries;
}

/**
 * v0.3.0 fix — Fallback parser for the markdown-style `##` heading
 * format produced by `okf-export.ts::exportMarkdown`. The previous
 * version extracted `fingerprint: null` for every entry (regex was
 * pinned to 16 hex chars while actual fingerprints are variable
 * length) and contaminated `content` with the heading line and
 * metadata bullets. This version cleanly separates metadata bullets
 * (looking for `**ID:**`, `**Fingerprint:**`, `**Evidence count:**`,
 * `**Last verified:**`, `**Scope:**` prefixes) from the content
 * body, which starts after the first blank line following the bullet
 * block and runs until the trailing `---` separator (or EOF).
 */
export function parseMarkdownHeadings(text: string): ParsedEntry[] {
	const normalized = text.replace(/\r\n/g, "\n");
	// Split on `## ` headings; first chunk is the document preamble.
	const chunks = normalized.split(/^##\s+/m).slice(1);
	const entries: ParsedEntry[] = [];

	for (const chunk of chunks) {
		const lines = chunk.split("\n");
		const typeMatch = lines[0]?.match(/^([A-Za-z]+):\s*/);
		const type = typeMatch ? typeMatch[1].toLowerCase() : "context";

		const fm: Record<string, string> = {};
		let bodyStart = -1;
		// True once at least one `- **Key:**` bullet was consumed; the
		// body starts at the FIRST blank line AFTER the bullet block.
		// Blank lines before any bullet (e.g. right after the `##` heading)
		// must be skipped, not treated as body delimiters.
		let sawBullet = false;
		for (let k = 1; k < lines.length; k++) {
			const ln = lines[k];
			const bulletId = ln.match(/^- \*\*ID:\*\*\s*`([^`]+)`/);
			const bulletFp = ln.match(/^- \*\*Fingerprint:\*\*\s*`([a-f0-9]+)`/i);
			const bulletEv = ln.match(/^- \*\*Evidence count:\*\*\s*(\d+)/);
			const bulletRec = ln.match(/^- \*\*Recurrence count:\*\*\s*(\d+)/);
			const bulletLv = ln.match(/^- \*\*Last verified:\*\*\s*(.+)$/);
			if (bulletId) {
				fm.id = bulletId[1];
				sawBullet = true;
			} else if (bulletFp) {
				fm.fingerprint = bulletFp[1];
				sawBullet = true;
			} else if (bulletEv) {
				fm.evidence_count = bulletEv[1];
				sawBullet = true;
			} else if (bulletRec) {
				fm.recurrence_count = bulletRec[1];
				sawBullet = true;
			} else if (bulletLv) {
				fm.last_verified_at = bulletLv[1].trim();
				sawBullet = true;
			} else if (ln.trim() === "") {
				// First blank line after bullet block — body starts here.
				if (sawBullet) {
					bodyStart = k + 1;
					break;
				}
				// Leading blank line (right after the heading) — skip.
			} else {
				// Other bullets (e.g. `- **Confidence:**`, `- **Scope:**`)
				// are not captured — skip them; the bullet block ends at
				// the next blank line.
			}
		}
		if (bodyStart < 0) bodyStart = 1;

		const bodyLines: string[] = [];
		for (let k = bodyStart; k < lines.length; k++) {
			const ln = lines[k];
			if (ln.trim() === "---") break;
			bodyLines.push(ln);
		}
		const content = bodyLines.join("\n").trim();
		if (!content) continue;
		const id = fm.id && ID_RE.test(fm.id) ? fm.id : uuidv7();
		entries.push({
			id,
			type,
			content,
			fingerprint: fm.fingerprint ?? null,
			evidence_count: Number.parseInt(fm.evidence_count ?? "0", 10) || 0,
			recurrence_count: Number.parseInt(fm.recurrence_count ?? "0", 10) || 0,
			last_verified_at: fm.last_verified_at ?? null,
		});
	}
	return entries;
}

export interface ImportResult {
	imported: number;
	superseded: number;
}

const IMPORT_ALLOWED_TYPES = new Set([
	"decision",
	"rule",
	"pattern",
	"context",
]);

/**
 * v0.3.0 fix — Ingest a bundle (frontmatter OR markdown) into the
 * local SQLite store as `context` memories with `origin='imported'`.
 *
 * Fixes over the v0.3.0 baseline:
 *   * Multi-entry bundles now produce N imports instead of N=1 — the
 *     parser bug is closed.
 *   * `ParsedEntry.evidence_count` and `last_verified_at` are
 *     threaded through so causal confidence survives a round-trip.
 *   * `ImportResult.superseded` is populated using
 *     `countSupersedeCandidates`, which mirrors the supersede logic
 *     in `MemoryService.save()`. Previously it was hard-coded to 0.
 *   * Generated ids use `uuidv7()` (the project's id generator)
 *     instead of `crypto.randomUUID()` for consistency.
 */
export function importOkf(
	bundle: string,
	memoryService: MemoryService,
): ImportResult {
	let entries = parseMarkdownBundle(bundle);
	if (entries.length === 0) {
		entries = parseMarkdownHeadings(bundle);
	}

	let imported = 0;
	let superseded = 0;

	for (const entry of entries) {
		if (!IMPORT_ALLOWED_TYPES.has(entry.type)) continue;
		const fp =
			entry.fingerprint ?? computeFingerprint(entry.content, undefined);

		// Count rows that save() will mark as superseded (decision/rule
		// with the same fingerprint). The supersede update itself runs
		// inside MemoryService.save() in a single transaction; we count
		// here to surface the value to the caller.
		superseded += memoryService.countSupersedeCandidates(
			entry.type as "decision" | "rule",
			fp,
			null,
		);

		memoryService.save({
			type: entry.type as "decision" | "rule" | "pattern" | "context",
			// BUG-008 — preserve the bundle id so a round-trip (export →
			// import) keeps memory identity and `getById` stays stable.
			id: entry.id,
			// BUG-009 — the content is the bundle body verbatim. The old
			// code appended `[imported evidence_count=N, ...]`, which the
			// ContextInjector later injected verbatim into model prompts;
			// the values travel via the typed fields below instead.
			content: entry.content,
			scope: "project",
			origin: "imported",
			fingerprint: fp,
			evidenceCount:
				entry.evidence_count > 0 ? entry.evidence_count : undefined,
			// BUG-008 — restore the recurrence demotion so the re-imported
			// copy keeps the v0.4.0 two-sided confidence of the source.
			recurrenceCount:
				entry.recurrence_count > 0 ? entry.recurrence_count : undefined,
			lastVerifiedAt: entry.last_verified_at ?? undefined,
		});
		imported++;
	}

	return { imported, superseded };
}

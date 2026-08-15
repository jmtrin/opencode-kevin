import { homedir } from "node:os";
import { join } from "node:path";
import type { ArtifactWriter, WriteOutcome } from "./ArtifactWriter.js";
import { firstSentence } from "./Curator.js";
import type { Store } from "./Store.js";
import { normalize } from "./fingerprint.js";

/**
 * K6-017 — v0.6.0 pull — topic bundles for the pull channels (plan §5.6).
 *
 * Writes `~/.opencode-kevin/refs/<topic>.md` (one file per topic) and
 * `~/.opencode-kevin/skills/project-knowledge.md` (one file). Both go
 * through the `ArtifactWriter` — marker-scoped, atomic, hash-audited.
 * There is no direct raw file-write anywhere in this module (D6-01).
 *
 * Topic derivation is deterministic and semantic (D6-14): a topic is
 * `<type>-<dominant token>`, where the dominant token is the
 * highest-frequency non-stop-word token of the fingerprint-normalized
 * content across the memories in the group, ties broken lexicographically.
 * Topics are NEVER derived from a fingerprint prefix, and hash-like tokens
 * (hex-only, length >= 8) are excluded from the race entirely.
 *
 * Output ordering within each bundle is by memory id, matching §5.4.
 * Regeneration with unchanged inputs is a `noop` at the ArtifactWriter
 * level, so the "run twice, compare bytes" criterion holds for every
 * bundle.
 */

export interface MaterializedBundle {
	readonly topic: string;
	readonly path: string;
	readonly outcome: WriteOutcome;
}

export interface BundleTarget {
	readonly topic: string;
	readonly path: string;
}

export const SKILL_TOPIC = "project-knowledge";

/** Hash-like noise: FNV-1a output is 16 lowercase hex chars; an 8+ hex
 * token is indistinguishable from a fingerprint prefix and must never
 * become a topic (D6-14). */
const HEX_LIKE_RE = /^[0-9a-f]{8,}$/;

const TOKEN_RE = /[^a-z0-9]+/;

/** Conservative English function words; code-adjacent meaning-bearing
 * words (npm, ts2304, cargo...) are deliberately NOT stop-words. */
const STOP_WORDS = new Set([
	"a",
	"about",
	"after",
	"again",
	"all",
	"also",
	"an",
	"and",
	"any",
	"are",
	"as",
	"at",
	"be",
	"been",
	"before",
	"being",
	"but",
	"by",
	"can",
	"could",
	"did",
	"do",
	"does",
	"for",
	"from",
	"had",
	"has",
	"have",
	"he",
	"her",
	"his",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"may",
	"might",
	"more",
	"most",
	"must",
	"not",
	"of",
	"on",
	"one",
	"or",
	"our",
	"per",
	"shall",
	"she",
	"so",
	"than",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"through",
	"to",
	"too",
	"under",
	"up",
	"us",
	"via",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"who",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

interface CuratedRow {
	id: string;
	type: string;
	content: string;
}

/** Sanitize a memory type into a filesystem-safe topic prefix. */
function sanitizeType(type: string): string {
	const cleaned = type
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned === "" ? "memory" : cleaned;
}

function tokensOf(content: string): string[] {
	return normalize(content)
		.split(TOKEN_RE)
		.filter((t) => t !== "" && !STOP_WORDS.has(t) && !HEX_LIKE_RE.test(t));
}

/** Highest-frequency non-stop-word token, ties broken lexicographically
 * (smallest wins) so the result is stable. "" when every token is a
 * stop-word or hash-like noise. */
function dominantToken(rows: CuratedRow[]): string {
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const token of tokensOf(row.content)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}
	let best = "";
	let bestCount = 0;
	for (const [token, count] of counts) {
		if (count > bestCount || (count === bestCount && token < best)) {
			best = token;
			bestCount = count;
		}
	}
	return best;
}

function renderRows(rows: CuratedRow[]): string {
	const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
	const lines = sorted
		.map((row) => `- ${firstSentence(row.content)}`)
		.filter((line) => line !== "- ");
	return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export class Materializer {
	/** `root` is injectable for tests; production defaults to ~/.opencode-kevin. */
	private readonly root: string;

	constructor(
		private readonly store: Store,
		options: { root?: string } = {},
	) {
		this.root = options.root ?? join(homedir(), ".opencode-kevin");
	}

	/** The curated, active memories — the knowledge the pull channels publish. */
	private curatedRows(): CuratedRow[] {
		return this.store
			.prepare(
				`SELECT id, type, content FROM memories
				 WHERE status = 'active' AND curated = 1`,
			)
			.all() as CuratedRow[];
	}

	/** The rendered skill body over all curated memories; "" when empty. */
	skillBody(): string {
		return renderRows(this.curatedRows());
	}

	/** Group rows by type, deriving each type's topic from its own content. */
	private groupByTopic(
		rows: CuratedRow[],
	): { topic: string; rows: CuratedRow[] }[] {
		const byType = new Map<string, CuratedRow[]>();
		for (const row of rows) {
			const list = byType.get(row.type) ?? [];
			list.push(row);
			byType.set(row.type, list);
		}
		const groups: { topic: string; rows: CuratedRow[] }[] = [];
		for (const [type, typeRows] of byType) {
			const token = dominantToken(typeRows);
			if (token === "") continue;
			groups.push({
				topic: `${sanitizeType(type)}-${token}`,
				rows: typeRows,
			});
		}
		return groups.sort((a, b) => a.topic.localeCompare(b.topic));
	}

	/**
	 * The pull-channel targets: the skill file plus one ref file per topic.
	 * The order is deterministic (skill first, refs by topic).
	 */
	bundleTargets(): BundleTarget[] {
		const rows = this.curatedRows();
		const targets: BundleTarget[] = [];
		if (rows.length > 0 && renderRows(rows) !== "") {
			targets.push({
				topic: SKILL_TOPIC,
				path: join(this.root, "skills", "project-knowledge.md"),
			});
		}
		for (const group of this.groupByTopic(rows)) {
			if (renderRows(group.rows) === "") continue;
			targets.push({
				topic: group.topic,
				path: join(this.root, "refs", `${group.topic}.md`),
			});
		}
		return targets;
	}

	/**
	 * Regenerate every bundle through the ArtifactWriter (plan + apply).
	 * The only call site of `apply()` outside `kevin_approve` — D6-01's
	 * single write FUNCTION with two constrained targets: `kevin_approve`
	 * reaches `agents_md_path`, this module reaches `~/.opencode-kevin`
	 * only (D6-07; enforced by K6-020).
	 */
	materialize(writer: ArtifactWriter): MaterializedBundle[] {
		const pending: { topic: string; path: string; body: string }[] = [];
		const rows = this.curatedRows();
		const skillBody = renderRows(rows);
		if (skillBody !== "") {
			pending.push({
				topic: SKILL_TOPIC,
				path: join(this.root, "skills", "project-knowledge.md"),
				body: skillBody,
			});
		}
		for (const group of this.groupByTopic(rows)) {
			const body = renderRows(group.rows);
			if (body === "") continue;
			pending.push({
				topic: group.topic,
				path: join(this.root, "refs", `${group.topic}.md`),
				body,
			});
		}
		return pending.map((bundle) => ({
			topic: bundle.topic,
			path: bundle.path,
			outcome: writer.apply(writer.plan(bundle.path, bundle.body)),
		}));
	}
}

import type { Memory, MemoryService, MemoryType } from "./MemoryService.js";
import type { RepoTruth } from "./RepoTruth.js";
import type { Store } from "./Store.js";
import { normalize } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

export type ConflictKind = "repo_truth" | "decision_pair" | "temporal";

export interface Conflict {
	readonly id: string;
	readonly kind: ConflictKind;
	readonly memoryA: string;
	readonly memoryB?: string;
	readonly factId?: string;
	readonly detail: string;
}

export interface RepoTruthConflictInput {
	readonly memoryId: string;
	readonly factId?: string | null;
	readonly reasons: readonly string[];
}

interface MemoryRow {
	id: string;
	type: MemoryType;
	content: string;
	fingerprint: string | null;
}

interface ConflictRow {
	id: string;
	kind: ConflictKind;
	memory_a: string;
	memory_b: string | null;
	fact_id: string | null;
	detail: string | null;
	status: "open" | "acknowledged" | "resolved";
}

interface PolarityRule {
	positive: readonly string[];
	negative: readonly (readonly string[])[];
}

const POLARITY_RULES: readonly PolarityRule[] = [
	{
		positive: ["use"],
		negative: [
			["do", "not", "use"],
			["don't", "use"],
			["never", "use"],
		],
	},
	{ positive: ["always"], negative: [["never"]] },
	{ positive: ["required"], negative: [["forbidden"], ["not", "required"]] },
	{ positive: ["enable"], negative: [["disable"]] },
	{ positive: ["prefer"], negative: [["avoid"]] },
];

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"with",
	"we",
	"when",
	"where",
	"you",
]);

const POLARITY_WORDS = new Set([
	"use",
	"do",
	"not",
	// "don't" tokenizes to ["don", "t"] (see tokens()); the lexicon phrase
	// ["don't","use"] is matched by tokenizing the phrase the same way, so
	// both fragments must be excluded from subjects() too (K7-014).
	"don",
	"t",
	"never",
	"always",
	"required",
	"forbidden",
	"enable",
	"disable",
	"prefer",
	"avoid",
]);

export class ConflictDetector {
	private readonly metrics: Metrics | null;

	constructor(
		private readonly store: Store,
		private readonly projectId: string,
		metrics?: Metrics | null,
		private readonly repoTruth?: RepoTruth,
		private readonly memoryService?: MemoryService,
	) {
		this.metrics = metrics ?? null;
	}

	detect(repoTruthInput?: readonly RepoTruthConflictInput[]): Conflict[] {
		const detected: Conflict[] = [];
		detected.push(...this.detectRepoTruth(repoTruthInput));
		detected.push(...this.detectDecisionPairs());
		detected.push(...this.detectTemporal());
		return detected;
	}

	acknowledge(id: string): void {
		this.store
			.prepare(
				"UPDATE memory_conflicts SET status = 'acknowledged' WHERE id = ? AND project_id = ? AND status = 'open'",
			)
			.run(id, this.projectId);
	}

	/** Human-only operation. It resolves the conflict row, never a memory. */
	resolve(id: string, keepMemoryId: string): void {
		const row = this.store
			.prepare(
				`SELECT memory_a, memory_b FROM memory_conflicts
				 WHERE id = ? AND project_id = ? AND status <> 'resolved'`,
			)
			.get(id, this.projectId) as
			| { memory_a: string; memory_b: string | null }
			| undefined;
		if (!row) throw new Error(`conflict not found: ${id}`);
		if (keepMemoryId !== row.memory_a && keepMemoryId !== row.memory_b) {
			throw new Error("keep must identify one of the conflict memories");
		}
		this.store
			.prepare(
				"UPDATE memory_conflicts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND project_id = ?",
			)
			.run(id, this.projectId);
	}

	private detectRepoTruth(
		input?: readonly RepoTruthConflictInput[],
	): Conflict[] {
		const items = input ?? this.repoTruthInputs();
		const out: Conflict[] = [];
		for (const item of items) {
			for (const reason of item.reasons) {
				this.memoryService?.applyTruthPenalty(item.memoryId, 0.5, reason);
				const id = this.insertIfNew({
					kind: "repo_truth",
					memoryA: item.memoryId,
					memoryB: null,
					factId: item.factId ?? null,
					detail: reason,
				});
				if (id)
					out.push({
						id,
						kind: "repo_truth",
						memoryA: item.memoryId,
						factId: item.factId ?? undefined,
						detail: reason,
					});
			}
		}
		// v0.7.0 (D7-03) — "recoverable by re-scanning": a memory whose
		// contradiction has lapsed (the repo no longer contradicts it) is
		// de-ranked no longer. The conflict row stays open — resolution is
		// human-initiated only (D7-06) — but the score penalty lifts, so
		// fixing the repo genuinely recovers the memory. Runs only on the
		// production path (no explicit input): explicit-input callers control
		// every write themselves.
		if (!input && this.repoTruth && this.memoryService) {
			const penalized = this.store
				.prepare(
					"SELECT id FROM memories WHERE project_id = ? AND truth_penalty > 0 AND status = 'active'",
				)
				.all(this.projectId) as { id: string }[];
			for (const row of penalized) {
				const memory = this.memoryService.getById(row.id);
				if (!memory) continue;
				if ((this.repoTruth.contradictions(memory) ?? []).length === 0) {
					this.memoryService.applyTruthPenalty(row.id, 0, "");
				}
			}
		}
		return out;
	}

	private repoTruthInputs(): RepoTruthConflictInput[] {
		if (!this.repoTruth) return [];
		const rows = this.store
			.prepare(
				`SELECT id, type, content, scope, relevance_score, source_tool,
				 source_session, metadata, created_at, updated_at, expires_at,
				 project_id, fingerprint, origin, evidence_count, last_verified_at,
				 status, fix_args, ignored, superseded_by, feedback_positive,
				 feedback_negative, curated, curated_at, inferable,
				 truth_penalty, contradicted_at
				 FROM memories WHERE project_id = ? AND status = 'active'`,
			)
			.all(this.projectId) as Array<
			Record<string, unknown> & {
				id: string;
				type: MemoryType;
				content: string;
			}
		>;
		return rows.flatMap((row) => {
			const memory = row as unknown as Memory;
			const reasons = this.repoTruth?.contradictions(memory) ?? [];
			return reasons.length > 0 ? [{ memoryId: row.id, reasons }] : [];
		});
	}

	private detectDecisionPairs(): Conflict[] {
		const rows = this.store
			.prepare(
				`SELECT id, type, content, fingerprint FROM memories
				 WHERE project_id = ? AND status = 'active'
				 AND type IN ('decision', 'rule') ORDER BY id`,
			)
			.all(this.projectId) as MemoryRow[];
		const out: Conflict[] = [];
		for (let i = 0; i < rows.length; i++) {
			for (let j = i + 1; j < rows.length; j++) {
				const a = rows[i];
				const b = rows[j];
				if (!a || !b || a.fingerprint === b.fingerprint) continue;
				const pair = oppositePair(a.content, b.content);
				if (!pair) continue;
				const id = this.insertIfNew({
					kind: "decision_pair",
					memoryA: a.id,
					memoryB: b.id,
					factId: null,
					detail: pair,
				});
				if (id)
					out.push({
						id,
						kind: "decision_pair",
						memoryA: a.id,
						memoryB: b.id,
						detail: pair,
					});
			}
		}
		return out;
	}

	private detectTemporal(): Conflict[] {
		const rows = this.store
			.prepare(
				`SELECT m.id,
				 MAX(CASE WHEN i.outcome = 'effective' THEN i.injected_at END) AS effective_at,
				 MAX(CASE WHEN i.outcome = 'ineffective' THEN i.injected_at END) AS ineffective_at
				 FROM memories m JOIN kevin_injections i ON i.memory_id = m.id
				 WHERE m.project_id = ? AND m.status = 'active'
				 GROUP BY m.id
				 HAVING effective_at IS NOT NULL AND ineffective_at IS NOT NULL
				 AND ineffective_at > effective_at`,
			)
			.all(this.projectId) as Array<{
			id: string;
			effective_at: string;
			ineffective_at: string;
		}>;
		const out: Conflict[] = [];
		for (const row of rows) {
			const detail = `memory was effective at ${row.effective_at} and became ineffective at ${row.ineffective_at}`;
			const id = this.insertIfNew({
				kind: "temporal",
				memoryA: row.id,
				memoryB: null,
				factId: null,
				detail,
			});
			if (id) out.push({ id, kind: "temporal", memoryA: row.id, detail });
		}
		return out;
	}

	private insertIfNew(input: {
		kind: ConflictKind;
		memoryA: string;
		memoryB: string | null;
		factId: string | null;
		detail: string;
	}): string | null {
		const existing = this.store
			.prepare(
				`SELECT id FROM memory_conflicts
				 WHERE project_id = ? AND kind = ? AND memory_a = ?
				 AND (memory_b IS ? OR (memory_b IS NULL AND ? IS NULL))
				 AND (fact_id IS ? OR (fact_id IS NULL AND ? IS NULL))
				 AND status = 'open' LIMIT 1`,
			)
			.get(
				this.projectId,
				input.kind,
				input.memoryA,
				input.memoryB,
				input.memoryB,
				input.factId,
				input.factId,
			) as { id: string } | undefined;
		if (existing) return null;
		const id = uuidv7();
		this.store
			.prepare(
				`INSERT INTO memory_conflicts
				 (id, project_id, memory_a, memory_b, fact_id, kind, detail)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				this.projectId,
				input.memoryA,
				input.memoryB,
				input.factId,
				input.kind,
				input.detail,
			);
		this.metrics?.incr("conflicts_detected", 1);
		return id;
	}
}

function tokens(text: string): string[] {
	return normalize(text).match(/[a-z0-9@._/-]+/g) ?? [];
}

function hasPhrase(
	words: readonly string[],
	phrase: readonly string[],
): boolean {
	if (phrase.length === 1) return words.includes(phrase[0] ?? "");
	for (let i = 0; i <= words.length - phrase.length; i++) {
		if (phrase.every((word, offset) => words[i + offset] === word)) return true;
	}
	return false;
}

function polarity(
	text: string,
	rule: PolarityRule,
): { positive: boolean; negative: boolean } {
	const words = tokens(text);
	// Lexicon phrases are run through the same tokenizer as the text: "don't
	// use" → ["don","t","use"], which is exactly how the text's own apostrophe
	// is split, so a phrase never becomes unreachable (K7-014).
	const match = (phrase: readonly string[]): boolean =>
		hasPhrase(words, tokens(phrase.join(" ")));
	const negative = rule.negative.some(match);
	return { positive: !negative && match(rule.positive), negative };
}

function subjects(text: string): Set<string> {
	return new Set(
		tokens(text).filter(
			(token) => !STOP_WORDS.has(token) && !POLARITY_WORDS.has(token),
		),
	);
}

function oppositePair(a: string, b: string): string | null {
	const shared = [...subjects(a)].some((token) => subjects(b).has(token));
	if (!shared) return null;
	for (const rule of POLARITY_RULES) {
		const pa = polarity(a, rule);
		const pb = polarity(b, rule);
		if ((pa.positive && pb.negative) || (pa.negative && pb.positive)) {
			return `statements carry opposite ${rule.positive.join(" ")} polarity for shared subject ${shared}`;
		}
	}
	return null;
}

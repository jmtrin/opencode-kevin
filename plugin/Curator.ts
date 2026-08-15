import { homedir } from "node:os";
import { join } from "node:path";
import {
	type ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
} from "./ArtifactWriter.js";
import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { computeConfidence } from "./confidence.js";
import { normalize } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

/**
 * K6-012/013 — v0.6.0 pull — candidate selection, line rendering and the
 * proposal lifecycle (plan §5.4/§5.5).
 *
 * Deliberately fs-free: this module holds NO filesystem capability — reads
 * and writes are delegated to the `ArtifactWriter` at the call site (D6-01).
 */

export interface CurationCandidate {
	readonly memoryId: string;
	/** The single AGENTS.md bullet. */
	readonly line: string;
	readonly confidence: number;
	/** e.g. "verified 3×, last 2026-08-04". */
	readonly evidence: string;
}

export type ProposalKind = "agents_md" | "skill" | "reference";
export type ProposalStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "applied"
	| "superseded";
export type ProposalTransition = "approve" | "reject" | "apply" | "supersede";

/** Plan §5.4 — the row shape of §6's `curation_proposals` table, surfaced. */
export interface CurationProposal {
	readonly id: string;
	readonly kind: ProposalKind;
	readonly targetPath: string;
	readonly memoryIds: readonly string[];
	readonly proposedText: string;
	readonly diff: string;
	readonly status: ProposalStatus;
	readonly createdAt: string;
}

const MAX_CANDIDATE_LINES = 20;
const MAX_CANDIDATE_CHARS = 4000;
const CONFIDENCE_FLOOR = 0.6;
const MAX_SENTENCE_CHARS = 160;

interface CandidateRow {
	id: string;
	content: string;
	evidence_count: number;
	recurrence_count: number;
	feedback_positive: number;
	feedback_negative: number;
	last_verified_at: string | null;
	updated_at: string;
}

export function firstSentence(content: string): string {
	const match = content.match(/^[\s\S]*?(?=[.!?](?:\s|$)|\r?\n|$)/);
	const sentence = (match ? match[0] : content).trim();
	return sentence.slice(0, MAX_SENTENCE_CHARS);
}

function evidenceString(row: CandidateRow): string {
	const parts: string[] = [];
	if (row.evidence_count >= 2) {
		const last = row.last_verified_at
			? `, last ${row.last_verified_at.slice(0, 10)}`
			: "";
		parts.push(`verified ${row.evidence_count}×${last}`);
	}
	if (row.feedback_positive >= 1) {
		parts.push(`feedback ${row.feedback_positive}×`);
	}
	return parts.join(", ");
}

export class Curator {
	private readonly metrics: Metrics | null;

	constructor(
		private readonly store: Store,
		private readonly memoryService: MemoryService,
		private readonly projectId: string,
		metrics?: Metrics | null,
	) {
		this.metrics = metrics ?? null;
	}

	/**
	 * Plan §5.4 selection predicate — all clauses must hold, evaluated
	 * verbatim. The confidence floor cannot be expressed in SQL (it is the
	 * two-sided formula of `computeConfidence`), so the cheap clauses run
	 * in SQL and confidence is computed and filtered per row in JS.
	 *
	 * The floor is `confidence >= 0.6` where the feedback arm of D6-09 also
	 * clears it: `computeConfidence` credits one positive human verdict at
	 * 0.05 (K5-010), so a row with `feedback_positive = 1` and no causal
	 * evidence scores 0.55 — yet D6-09's warrant is "either the world
	 * verified it twice, or a human verified it once". The disjunction
	 * (K6-012 acceptance) is the floor's complement for the feedback arm.
	 *
	 * Ordered by `confidence DESC, updated_at DESC`, capped at 20 lines and
	 * 4000 characters of content, whichever binds first. The char budget
	 * counts the raw content length: rendered lines are truncated to 160
	 * chars, so a rendered-line budget could never bind before the line cap.
	 */
	candidates(limit?: number): CurationCandidate[] {
		const rows = this.store
			.prepare(
				`SELECT id, content, evidence_count, recurrence_count,
			        feedback_positive, feedback_negative,
			        last_verified_at, updated_at
			 FROM memories
			 WHERE status = 'active'
			   AND ignored = 0
			   AND curated = 0
			   AND (inferable IS NULL OR inferable != 1)
			   AND (evidence_count >= 2 OR feedback_positive >= 1)`,
			)
			.all() as CandidateRow[];
		const scored = rows
			.map((row) => ({
				row,
				confidence: computeConfidence(
					row.evidence_count ?? 0,
					row.recurrence_count ?? 0,
					row.feedback_positive ?? 0,
					row.feedback_negative ?? 0,
				),
			}))
			.filter(
				(s) => s.confidence >= CONFIDENCE_FLOOR || s.row.feedback_positive >= 1,
			)
			.sort(
				(a, b) =>
					b.confidence - a.confidence ||
					b.row.updated_at.localeCompare(a.row.updated_at),
			);

		const maxLines = limit ?? MAX_CANDIDATE_LINES;
		const result: CurationCandidate[] = [];
		let totalChars = 0;
		for (const s of scored) {
			if (result.length >= maxLines) break;
			if (totalChars + s.row.content.length > MAX_CANDIDATE_CHARS) break;
			const evidence = evidenceString(s.row);
			result.push({
				memoryId: s.row.id,
				line: `- ${firstSentence(s.row.content)} (${evidence})`,
				confidence: s.confidence,
				evidence,
			});
			totalChars += s.row.content.length;
		}
		return result;
	}

	/**
	 * Renders the block sorted by memory id (D6-10): confidence orders
	 * selection, id orders output. Adding one candidate to a set of ten
	 * must change exactly one line of the rendered block.
	 */
	renderBlock(candidates: CurationCandidate[]): string {
		const sorted = [...candidates].sort((a, b) =>
			a.memoryId.localeCompare(b.memoryId),
		);
		return `${sorted.map((c) => c.line).join("\n")}\n`;
	}

	/**
	 * Plan §5.4 — strict dry run (D5-08): plan only, never write. Returns a
	 * pending proposal per call, or [] when no candidate clears the floor.
	 *
	 * The proposal is a whole-block proposal: the persisted `proposed_text`
	 * is the merged block (current block in the file + new candidate lines),
	 * so approving it replaces the file block with exactly what was reviewed.
	 * The current block is learned from `plan().before` — the Curator has no
	 * fs capability, the writer reads (D6-01). Both plan calls are
	 * deterministic, so a second propose() with unchanged inputs reproduces
	 * the persisted diff byte-identically.
	 *
	 * A new proposal supersedes prior pending (or rejected) rows for the
	 * same (project_id, kind, target_path) triple — §5.5's regeneration
	 * arrow. Rows are never deleted (the audit trail is append-only).
	 *
	 * The schema's `memory_id` column is singular while a whole-block
	 * proposal carries several ids; the contributing ids are stored joined
	 * by "," (uuidv7 ids contain no comma) and split on read.
	 */
	propose(kind: ProposalKind, writer: ArtifactWriter): CurationProposal[] {
		const targetPath = this.targetPathFor(kind);
		const candidates = this.candidates();
		if (candidates.length === 0) return [];

		const readPlan = writer.plan(targetPath, this.renderBlock(candidates));
		const currentBlock = extractBlock(readPlan.before);
		// v0.7.0 (K7-013 / plan §4, D6-09) — de-duplicate against the WHOLE
		// file, not just the region between Kevin's markers. A convention the
		// user already wrote in their own words in their own section must not
		// be proposed back to them. The comparison is over the same normalized
		// tokens the fingerprint uses — no new similarity metric (D7-11).
		const entireFile = wholeFileLines(readPlan.before);
		const freshCandidates = candidates.filter(
			(candidate) => !entireFile.has(normalizeBullet(candidate.line)),
		);
		if (freshCandidates.length === 0 && currentBlock === "") return [];
		const newBlock = this.renderBlock(freshCandidates);
		const newLines = newBlock.split("\n").filter((l) => l !== "");
		const mergedBlock =
			newLines.length === 0
				? currentBlock
				: currentBlock === ""
					? `${newLines.join("\n")}\n`
					: `${currentBlock}${currentBlock.endsWith("\n") ? "" : "\n"}${newLines.join("\n")}\n`;
		// v0.7.0 (K7-013) — nothing new to propose: every candidate is already
		// in the file (inside or outside the markers). A vacuous proposal would
		// be noise; return none.
		const plan = writer.plan(targetPath, mergedBlock);

		const prior = this.store
			.prepare(
				`SELECT id FROM curation_proposals
				 WHERE project_id = ? AND kind = ? AND target_path = ?
				   AND status IN ('pending', 'rejected')`,
			)
			.all(this.projectId, kind, targetPath) as { id: string }[];
		for (const row of prior) {
			this.transition(row.id, "supersede");
		}

		const memoryIds = freshCandidates.map((c) => c.memoryId);
		const id = uuidv7();
		this.store
			.prepare(
				`INSERT INTO curation_proposals
				 (id, project_id, memory_id, kind, target_path,
				  proposed_text, diff, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
			)
			.run(
				id,
				this.projectId,
				memoryIds.join(","),
				kind,
				targetPath,
				mergedBlock,
				plan.diff,
			);
		this.metrics?.incr("proposals_created", 1);

		const row = this.store
			.prepare("SELECT created_at FROM curation_proposals WHERE id = ?")
			.get(id) as { created_at: string };
		return [
			{
				id,
				kind,
				targetPath,
				memoryIds,
				proposedText: mergedBlock,
				diff: plan.diff,
				status: "pending" as const,
				createdAt: row.created_at,
			},
		];
	}

	/**
	 * Plan §5.5 state machine, as explicit transitions with an exhaustive
	 * switch — an unknown transition or an illegal source state throws
	 * rather than silently no-oping. `decided_at` stamps approve/reject/
	 * supersede, `applied_at` stamps apply.
	 */
	transition(
		proposalId: string,
		transition: ProposalTransition,
	): ProposalStatus {
		const row = this.store
			.prepare("SELECT status FROM curation_proposals WHERE id = ?")
			.get(proposalId) as { status: string } | undefined;
		if (!row) {
			throw new Error(`proposal not found: ${proposalId}`);
		}
		const status = row.status;
		let next: ProposalStatus | null = null;
		switch (transition) {
			case "approve":
				if (status === "pending") next = "approved";
				break;
			case "reject":
				if (status === "pending") next = "rejected";
				break;
			case "apply":
				if (status === "approved") next = "applied";
				break;
			case "supersede":
				if (status === "pending" || status === "rejected") {
					next = "superseded";
				}
				break;
			default:
				throw new Error(`unknown transition: ${transition}`);
		}
		if (next === null) {
			throw new Error(`illegal transition: ${status} -> ${transition}`);
		}
		if (next === "applied") {
			this.store
				.prepare(
					"UPDATE curation_proposals SET status = 'applied', applied_at = datetime('now') WHERE id = ?",
				)
				.run(proposalId);
		} else {
			this.store
				.prepare(
					"UPDATE curation_proposals SET status = ?, decided_at = datetime('now') WHERE id = ?",
				)
				.run(next, proposalId);
		}
		return next;
	}

	/** Plan §5.6 target paths. agents_md is a setting; skill/reference live under ~/.opencode-kevin. */
	private targetPathFor(kind: ProposalKind): string {
		switch (kind) {
			case "agents_md":
				return this.memoryService.getSetting("agents_md_path", "AGENTS.md");
			case "skill":
				return join(
					homedir(),
					".opencode-kevin",
					"skills",
					"project-knowledge.md",
				);
			case "reference":
				return join(
					homedir(),
					".opencode-kevin",
					"refs",
					"project-knowledge.md",
				);
		}
	}
}

/** The block content currently between the markers, "" when absent or malformed. */
function extractBlock(before: string): string {
	const begin = before.indexOf(MARKER_BEGIN);
	const end = before.indexOf(MARKER_END);
	if (begin === -1 || end === -1 || end < begin) return "";
	return before
		.slice(begin + MARKER_BEGIN.length, end)
		.replace(/^\r?\n/, "")
		.replace(/\r?\n$/, "");
}

/**
 * v0.7.0 (K7-013 / plan §4) — the normalized set of bullet statements across
 * the WHOLE file, including any the user wrote outside Kevin's markers. Only
 * markdown bullets (`- ...`) are considered: prose and the marker lines are
 * never a candidate to propose back.
 */
function wholeFileLines(before: string): Set<string> {
	const set = new Set<string>();
	for (const line of before.split(/\r?\n/)) {
		if (line.trim().startsWith("-")) {
			set.add(normalizeBullet(line));
		}
	}
	return set;
}

/** Normalize a rendered bullet for de-duplication — strip the marker prefix. */
function normalizeBullet(line: string): string {
	const statement = line
		.replace(/^\s*-\s+/, "")
		.trim()
		.replace(/\s+\((?:verified|feedback)[^)]*\)\s*$/i, "");
	return normalize(statement);
}

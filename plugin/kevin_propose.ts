import type { ArtifactWriter } from "./ArtifactWriter.js";
import type { Curator, ProposalKind } from "./Curator.js";

/**
 * K6-014 — v0.6.0 pull — `kevin_propose` tool logic.
 *
 * Strict dry run in the exact sense of v0.5 `kevin_trace` (D5-08): creates
 * `pending` rows and returns their unified diffs. No disk write, no `curated`
 * flag, no metric beyond `proposals_created` (which `Curator.propose()`
 * itself increments).
 */

export interface ProposedChange {
	readonly id: string;
	readonly kind: ProposalKind;
	readonly targetPath: string;
	readonly memoryIds: readonly string[];
	readonly status: "pending";
	readonly createdAt: string;
	readonly diff: string;
}

export interface ProposeResult {
	readonly proposals: readonly ProposedChange[];
}

export function kevinPropose(
	curator: Curator,
	writer: ArtifactWriter,
	kind: ProposalKind,
): ProposeResult {
	const proposals = curator.propose(kind, writer);
	return {
		proposals: proposals.map((p) => ({
			id: p.id,
			kind: p.kind,
			targetPath: p.targetPath,
			memoryIds: [...p.memoryIds],
			status: "pending" as const,
			createdAt: p.createdAt,
			diff: p.diff,
		})),
	};
}

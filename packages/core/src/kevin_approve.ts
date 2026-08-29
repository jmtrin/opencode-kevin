import type { ArtifactWriter } from "./ArtifactWriter.js";
import type { Curator, ProposalStatus } from "./Curator.js";
import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";

/**
 * K6-014 — v0.6.0 pull — `kevin_approve` tool logic.
 *
 * The ONLY code path in the entire plugin that may call
 * `ArtifactWriter`'s apply method (D6-01; enforced by
 * tests/unit/single_write_path.test.ts).
 *
 * There is deliberately no "trusted mode" and no flag that skips the human:
 * the approval gate is the release's entire safety model.
 */

export interface ApproveArgs {
	readonly proposalId: string;
	readonly decision: "approve" | "reject";
}

export type ApproveResult =
	| {
			readonly proposalId: string;
			readonly status: "rejected";
	  }
	| {
			readonly proposalId: string;
			readonly status: "applied";
			readonly outcome: string;
			readonly curated: number;
	  }
	| {
			readonly error: "not_found" | "not_pending";
			readonly proposalId: string;
			readonly status?: ProposalStatus;
			readonly message: string;
	  };

interface ProposalRow {
	id: string;
	kind: string;
	target_path: string;
	proposed_text: string;
	memory_id: string;
	status: ProposalStatus;
}

export function kevinApprove(
	store: Store,
	memoryService: MemoryService,
	curator: Curator,
	writer: ArtifactWriter,
	metrics: Metrics | null,
	args: ApproveArgs,
): ApproveResult {
	const row = store
		.prepare(
			`SELECT id, kind, target_path, proposed_text, memory_id, status
			 FROM curation_proposals WHERE id = ?`,
		)
		.get(args.proposalId) as ProposalRow | undefined;
	if (!row) {
		return {
			error: "not_found",
			proposalId: args.proposalId,
			message: `No proposal with id "${args.proposalId}".`,
		};
	}
	if (row.status !== "pending") {
		return {
			error: "not_pending",
			proposalId: args.proposalId,
			status: row.status,
			message: `Proposal "${args.proposalId}" is ${row.status}, not pending.`,
		};
	}

	if (args.decision === "reject") {
		curator.transition(args.proposalId, "reject");
		metrics?.incr("proposals_rejected", 1);
		return { proposalId: args.proposalId, status: "rejected" };
	}

	// approve → apply → applied (plan §5.5). The proposed_text is re-planned
	// at approval time against the file as it is now; write() is atomic and
	// audits every outcome including noop. The disk write happens BEFORE the
	// state transitions: if write() throws (e.g. a filesystem error), the
	// proposal is still 'pending' and the human can retry or reject — a
	// row stuck in 'approved' with no file written would be a dead end,
	// since kevin_approve only accepts pending rows.
	const outcome = writer.write(
		{
			path: row.target_path,
			mode: "markers",
			content: row.proposed_text,
		},
		args.proposalId,
	);
	curator.transition(args.proposalId, "approve");
	curator.transition(args.proposalId, "apply");
	const memoryIds = row.memory_id.split(",").filter((s) => s.length > 0);
	const curated = memoryService.markCurated(memoryIds, sqliteNow());
	metrics?.incr("proposals_approved", 1);
	return {
		proposalId: args.proposalId,
		status: "applied",
		outcome,
		curated,
	};
}

function sqliteNow(): string {
	return new Date().toISOString().slice(0, 19).replace("T", " ");
}

import type { MemoryService } from "./MemoryService.js";
import type { RepoTruth } from "./RepoTruth.js";
import type { Store } from "./Store.js";

/**
 * v0.7.0 (K7-009 / plan §5.7) — `kevin_facts`.
 *
 * The user-facing answer to "why did Kevin stop suggesting that?". Lists the
 * repository facts the current project was scanned for and every memory that
 * was de-ranked by a contradiction, with its `truth_penalty`, `contradicted_at`
 * and the human-readable reasons. Pure read apart from the optional re-scan. No
 * LLM, no network, no hot-path cost.
 */
export interface KevinFactsDeps {
	store: Store;
	memoryService: MemoryService;
	repoTruth: RepoTruth;
	projectId: string;
}

export interface PenalizedMemory {
	id: string;
	type: string;
	truth_penalty: number;
	contradicted_at: string | null;
	reasons: string[];
}

export interface KevinFactsResult {
	project_id: string;
	scanned_at: string | null;
	truncated: { is_truncated: true; count: number } | { is_truncated: false };
	facts: { file: string; key_path: string; value: string }[];
	penalized: PenalizedMemory[];
}

export function buildKevinFacts(
	deps: KevinFactsDeps,
	refresh: boolean,
): KevinFactsResult {
	if (refresh) deps.repoTruth.scan();

	// Penalized memories: scoped to the project, only those with a penalty.
	const rows = deps.store
		.prepare(
			`SELECT id, type, truth_penalty, contradicted_at
			 FROM memories
			 WHERE project_id = ? AND truth_penalty > 0
			 ORDER BY created_at`,
		)
		.all(deps.projectId) as {
		id: string;
		type: string;
		truth_penalty: number;
		contradicted_at: string | null;
	}[];
	const penalized: PenalizedMemory[] = rows.map((r) => {
		const mem = deps.memoryService.getById(r.id);
		return {
			id: r.id,
			type: r.type,
			truth_penalty: r.truth_penalty,
			contradicted_at: r.contradicted_at,
			reasons: mem ? deps.repoTruth.contradictions(mem) : [],
		};
	});

	const stored = deps.repoTruth.facts();
	const truncatedFact = stored.find((f) => f.keyPath === "_truncated");
	const facts = stored
		.filter((f) => f.keyPath !== "_truncated")
		.map((f) => ({ file: f.file, key_path: f.keyPath, value: f.value }));

	const scanned_at = deps.repoTruth.scannedAt();

	return {
		project_id: deps.projectId,
		scanned_at,
		truncated: truncatedFact
			? { is_truncated: true, count: Number(truncatedFact.value) || 0 }
			: { is_truncated: false },
		facts,
		penalized,
	};
}

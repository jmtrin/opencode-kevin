import type { ConflictDetector } from "./ConflictDetector.js";
import type { Store } from "./Store.js";

export interface KevinConflictsDeps {
	store: Store;
	detector: ConflictDetector;
	projectId: string;
}

export type ConflictAction = "list" | "acknowledge" | "resolve";

export function executeKevinConflicts(
	deps: KevinConflictsDeps,
	action: ConflictAction,
	id?: string,
	keep?: string,
	requestedStatus?: "open" | "acknowledged" | "resolved",
): Record<string, unknown> {
	if (action === "acknowledge") {
		if (!id) return { error: "missing_id" };
		// Mirror resolve()'s honesty: acknowledging a nonexistent or foreign id
		// must not be reported as a success.
		const row = deps.store
			.prepare(
				"SELECT id FROM memory_conflicts WHERE id = ? AND project_id = ?",
			)
			.get(id, deps.projectId);
		if (!row) return { error: "not_found", id };
		deps.detector.acknowledge(id);
		return { id, status: "acknowledged" };
	}
	if (action === "resolve") {
		if (!id || !keep) return { error: "missing_id_or_keep" };
		const row = deps.store
			.prepare(
				"SELECT memory_a, memory_b FROM memory_conflicts WHERE id = ? AND project_id = ?",
			)
			.get(id, deps.projectId) as
			| { memory_a: string; memory_b: string | null }
			| undefined;
		if (!row) return { error: "not_found", id };
		if (keep !== row.memory_a && keep !== row.memory_b) {
			return { error: "invalid_keep", id, keep };
		}
		deps.detector.resolve(id, keep);
		return {
			id,
			status: "resolved",
			kept: keep,
			other: keep === row.memory_a ? row.memory_b : row.memory_a,
		};
	}
	const status = requestedStatus ?? "open";
	const rows = deps.store
		.prepare(
			`SELECT id, kind, memory_a, memory_b, fact_id, detail, status, detected_at
			 FROM memory_conflicts WHERE project_id = ? AND status = ?
			 ORDER BY detected_at, id`,
		)
		.all(deps.projectId, status) as Array<Record<string, unknown>>;
	const counts = deps.store
		.prepare(
			`SELECT status, COUNT(*) AS n FROM memory_conflicts
			 WHERE project_id = ? GROUP BY status`,
		)
		.all(deps.projectId) as { status: string; n: number }[];
	return {
		open: counts.find((row) => row.status === "open")?.n ?? 0,
		acknowledged: counts.find((row) => row.status === "acknowledged")?.n ?? 0,
		resolved: counts.find((row) => row.status === "resolved")?.n ?? 0,
		conflicts: rows,
	};
}

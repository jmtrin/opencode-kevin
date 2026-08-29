import type { MemoryService } from "./MemoryService.js";
import type { SharedLayer } from "./SharedLayer.js";
import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";
import { computeEntryId } from "./okf.js";

// v1.1.0 (K11-005 / plan §5.1, D11-02) — the missing lifecycle tool.

export interface ForgetInput {
	ids: string[];
	confirm?: boolean;
}

export interface Deps {
	store: Store;
	memoryService: MemoryService;
	sharedLayer: SharedLayer;
	okfPath: string;
	metrics: Metrics;
}

export interface ForgetResult {
	action: "forget";
	ok: boolean;
	dry_run: boolean;
	per_id: Array<{
		id: string;
		archived: boolean;
		reason?: string;
		tombstone?: { entry_id: string; planned: boolean; applied: boolean };
	}>;
	noop?: boolean;
	reason?: string;
}

export function handleForget(input: ForgetInput, deps: Deps): ForgetResult {
	// v1.1.0 — every invocation counts, including dry runs and refusals (K11-005)
	try {
		deps.metrics.incr("forget_requests_total", 1);
	} catch {
		// best-effort
	}

	if (!input.ids || input.ids.length === 0) {
		return {
			action: "forget",
			ok: false,
			dry_run: input.confirm !== true,
			per_id: [],
			reason: "no_ids",
		};
	}

	const isDry = input.confirm !== true;

	const per_id: ForgetResult["per_id"] = [];
	let anyChange = false;
	let anyTombstonePlanned = false;

	// Helper to compute entry_id for a memory row
	const getEntryId = (row: {
		type: string;
		content: string;
		scope: string | null;
		shared_entry_id: string | null;
	}): string => {
		if (row.shared_entry_id) return row.shared_entry_id;
		return computeEntryId(row.type, row.content, row.scope);
	};

	// For dry_run: just plan, mutate nothing
	if (isDry) {
		for (const id of input.ids) {
			const row = deps.store
				.prepare(
					"SELECT id, type, content, scope, status, layer, shared_entry_id FROM memories WHERE id = ?",
				)
				.get(id) as
				| {
						id: string;
						type: string;
						content: string;
						scope: string | null;
						status: string;
						layer: string | null;
						shared_entry_id: string | null;
				  }
				| undefined;
			if (!row) {
				per_id.push({ id, archived: false, reason: "not_found" });
				continue;
			}
			if (row.status === "archived") {
				// Idempotence: already archived
				const isShared = row.layer === "shared" || row.shared_entry_id !== null;
				if (isShared) {
					const entryId = getEntryId(row);
					try {
						const plan = deps.sharedLayer.planTombstone(
							[entryId],
							deps.okfPath,
						);
						const planned =
							plan.write.outcome !== "refused" && plan.entriesAdded > 0;
						// Already archived implies tombstone already applied, so planned should be false (noop)
						per_id.push({
							id,
							archived: false,
							reason: "already_archived",
							tombstone: { entry_id: entryId, planned: false, applied: false },
						});
						void plan;
						void planned;
					} catch {
						per_id.push({
							id,
							archived: false,
							reason: "already_archived",
							tombstone: { entry_id: entryId, planned: false, applied: false },
						});
					}
				} else {
					per_id.push({ id, archived: false, reason: "already_archived" });
				}
				continue;
			}
			// Would archive
			anyChange = true;
			const isShared = row.layer === "shared" || row.shared_entry_id !== null;
			if (isShared) {
				const entryId = getEntryId(row);
				let planned = false;
				try {
					const plan = deps.sharedLayer.planTombstone([entryId], deps.okfPath);
					// planTombstone returns ExportPlan with write outcome; if refused, planned false
					planned = plan.write.outcome !== "refused";
					anyTombstonePlanned = anyTombstonePlanned || planned;
					per_id.push({
						id,
						archived: true,
						tombstone: { entry_id: entryId, planned, applied: false },
					});
				} catch {
					per_id.push({
						id,
						archived: true,
						tombstone: { entry_id: entryId, planned: false, applied: false },
					});
				}
			} else {
				per_id.push({ id, archived: true });
			}
		}
		const noop = !anyChange;
		return {
			action: "forget",
			ok: true,
			dry_run: true,
			per_id,
			...(noop ? { noop: true } : {}),
		};
	}

	// Apply mode: confirm === true
	// We need to archive locally and publish tombstones through applyExport
	let partial = false;
	let appliedTombstones = 0;

	for (const id of input.ids) {
		const row = deps.store
			.prepare(
				"SELECT id, type, content, scope, status, layer, shared_entry_id FROM memories WHERE id = ?",
			)
			.get(id) as
			| {
					id: string;
					type: string;
					content: string;
					scope: string | null;
					status: string;
					layer: string | null;
					shared_entry_id: string | null;
			  }
			| undefined;
		if (!row) {
			per_id.push({ id, archived: false, reason: "not_found" });
			continue;
		}
		if (row.status === "archived") {
			const isShared = row.layer === "shared" || row.shared_entry_id !== null;
			if (isShared) {
				const entryId = getEntryId(row);
				per_id.push({
					id,
					archived: false,
					reason: "already_archived",
					tombstone: { entry_id: entryId, planned: false, applied: false },
				});
			} else {
				per_id.push({ id, archived: false, reason: "already_archived" });
			}
			continue;
		}

		// Archive locally in a transaction
		let archived = false;
		try {
			deps.store.transaction(() => {
				deps.store
					.prepare(
						`UPDATE memories SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status != 'archived'`,
					)
					.run(id);
				const changes = deps.store.prepare("SELECT changes() AS c").get() as {
					c: number;
				};
				if (changes.c > 0) archived = true;
			});
		} catch (e) {
			per_id.push({ id, archived: false, reason: "db_error" });
			partial = true;
			continue;
		}

		anyChange = anyChange || archived;
		const isShared = row.layer === "shared" || row.shared_entry_id !== null;
		if (!isShared) {
			per_id.push({ id, archived });
			continue;
		}

		const entryId = getEntryId(row);
		// Plan tombstone
		let plan: ReturnType<SharedLayer["planTombstone"]> | undefined;
		try {
			plan = deps.sharedLayer.planTombstone([entryId], deps.okfPath);
		} catch (e) {
			// plan failure: rollback DB archive for this id (best-effort)
			try {
				deps.store
					.prepare(
						`UPDATE memories SET status = 'active', archived_at = NULL WHERE id = ?`,
					)
					.run(id);
			} catch {}
			per_id.push({
				id,
				archived: false,
				reason: "plan_failed",
				tombstone: { entry_id: entryId, planned: false, applied: false },
			});
			partial = true;
			continue;
		}

		if (plan.write.outcome === "refused") {
			// Refusal reasons are reused verbatim (repo_mismatch, unknown_entry)
			const reason = (plan.write as { reason?: string }).reason ?? "refused";
			per_id.push({
				id,
				archived,
				reason,
				tombstone: { entry_id: entryId, planned: false, applied: false },
			});
			// DB archive already done; keep it (local archive is independent of shared refusal)
			continue;
		}

		// Apply through single write funnel
		try {
			const applied = deps.sharedLayer.applyExport(plan);
			const wasWritten = applied.applied === "written";
			const wasNoop = applied.applied === "noop";
			if (wasWritten) appliedTombstones++;
			// per_id tombstone: planned true if not refused, applied true only if written
			per_id.push({
				id,
				archived,
				tombstone: {
					entry_id: entryId,
					planned: true,
					applied: wasWritten,
				},
			});
			void wasNoop;
		} catch (e) {
			// v1.1.0 — failure mid-way: transaction rollback restores DB; already-applied OKF write is reported honestly
			// For this id, DB was already archived, but file write failed. We attempt to rollback DB for this id.
			try {
				deps.store
					.prepare(
						`UPDATE memories SET status = 'active', archived_at = NULL WHERE id = ?`,
					)
					.run(id);
				archived = false;
			} catch {}
			per_id.push({
				id,
				archived: false,
				reason: "partial",
				tombstone: { entry_id: entryId, planned: true, applied: false },
			});
			partial = true;
			// Continue to next id? According spec, failure mid-way reports ok:false reason partial
			// We keep processing remaining ids? For now we continue but mark partial.
		}
	}

	// Metrics: increment forget_tombstones_published by applied count (only when written, not noop)
	if (appliedTombstones > 0) {
		try {
			deps.metrics.incr("forget_tombstones_published", appliedTombstones);
		} catch {}
	}

	const noop = !anyChange && per_id.every((p) => p.archived === false);
	if (partial) {
		return {
			action: "forget",
			ok: false,
			dry_run: false,
			per_id,
			reason: "partial",
			...(noop ? { noop: true } : {}),
		};
	}
	return {
		action: "forget",
		ok: true,
		dry_run: false,
		per_id,
		...(noop ? { noop: true } : {}),
	};
}

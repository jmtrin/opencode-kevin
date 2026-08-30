// K16-017 — Idle sync orchestrator (runs on session.idle, not hot path)
// K21-005 — deletion sync: archived + tombstone when a source file disappears
import type { SharedLayer } from "../SharedLayer.js";
import type { Store } from "../Store.js";
import { fingerprint } from "../fingerprint.js";
import { collectDeletions } from "./deletion.js";
import type {
	MemorySource,
	SourceEntry,
	SourceSyncResult,
} from "./MemorySource.js";

export interface SyncDeps {
	store: Store;
	sources: MemorySource[];
	metrics?: { incr(key: string, by?: number): void };
	sharedLayer?: SharedLayer;
	okfPath?: string;
}

function dedupKey(e: SourceEntry): string {
	// lower precedence wins attribution: fingerprint over normalized statement + scope
	return fingerprint(`${e.type}\0${e.statement}\0${e.scope ?? ""}`);
}

function isDeletionSyncEnabled(store: Store): boolean {
	try {
		const row = store
			.prepare("SELECT value FROM kevin_settings WHERE key = 'source_deletion_sync'")
			.get() as { value: string } | undefined;
		return row?.value === "1";
	} catch {
		return false;
	}
}

export async function idleSync(deps: SyncDeps): Promise<SourceSyncResult[]> {
	const results: SourceSyncResult[] = [];
	const seen = new Set<string>();
	// Pre-populate dedup with existing memories fingerprints (lowest precedence already wins)
	try {
		const rows = deps.store
			.prepare("SELECT fingerprint FROM memories")
			.all() as { fingerprint: string | null }[];
		for (const r of rows) if (r.fingerprint) seen.add(r.fingerprint);
	} catch {}

	for (const src of deps.sources.sort((a, b) => a.precedence - b.precedence)) {
		if (!src.enabled()) {
			results.push({
				source: src.name,
				fetched: 0,
				dedupSkipped: 0,
				inserted: 0,
			});
			continue;
		}
		let entries: SourceEntry[] = [];
		let fetchOk = true;
		try {
			entries = await src.fetch();
		} catch {
			fetchOk = false;
			entries = [];
		}
		// current fingerprints for deletion diff (raw, before dedup)
		const currentFps = new Set<string>();
		for (const e of entries) currentFps.add(dedupKey(e));

		let dedupSkipped = 0;
		let inserted = 0;
		for (const e of entries) {
			const fp = dedupKey(e);
			if (seen.has(fp)) {
				dedupSkipped++;
				continue;
			}
			seen.add(fp);
			// Insert as memory with source provenance (K21-005: source column)
			// Use relevance_score (not confidence) per schema; source col added in 015.
			// Normalize scope: null → 'project' (schema CHECK)
			const normScope = e.scope ?? "project";
			try {
				try {
					deps.store
						.prepare(
							`INSERT OR IGNORE INTO memories (id, project_id, type, content, scope, fingerprint, relevance_score, origin, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
						)
						.run(
							`src-${fp.slice(0, 12)}-${src.name}`,
							"default",
							e.type,
							e.statement,
							normScope,
							fp,
							0.5,
							"agent",
							src.name,
						);
				} catch {
					// pre-015 DB without source column: store source in source_tool as fallback
					deps.store
						.prepare(
							`INSERT OR IGNORE INTO memories (id, project_id, type, content, scope, fingerprint, relevance_score, origin, source_tool, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
						)
						.run(
							`src-${fp.slice(0, 12)}-${src.name}`,
							"default",
							e.type,
							e.statement,
							normScope,
							fp,
							0.5,
							"agent",
							src.name,
						);
				}
				inserted++;
			} catch {
				dedupSkipped++;
			}
		}
		if (dedupSkipped > 0)
			deps.metrics?.incr("source_dedup_skips_total", dedupSkipped);
		if (inserted > 0) deps.metrics?.incr("source_syncs_total", 1);

		// K21-005 — deletion sync: if a previously-saved memory from this source
		// is no longer in the current fetch, archive it (+ tombstone if exported).
		// Gated by source_deletion_sync='1' (opt-in in 2.1.0, D21-03).
		// Only run when fetch succeeded; transient errors must not mass-archive.
		if (fetchOk && isDeletionSyncEnabled(deps.store)) {
			try {
				let prevRows: { id: string; fingerprint: string | null; shared_entry_id: string | null; layer: string | null }[] = [];
				try {
					prevRows = deps.store
						.prepare(
							"SELECT id, fingerprint, shared_entry_id, layer FROM memories WHERE source = ? AND status != 'archived' AND fingerprint IS NOT NULL",
						)
						.all(src.name) as typeof prevRows;
				} catch {
					// pre-015 DB: source column missing → use source_tool as provenance
					try {
						prevRows = deps.store
							.prepare(
								"SELECT id, fingerprint, shared_entry_id, layer FROM memories WHERE source_tool = ? AND status != 'archived' AND fingerprint IS NOT NULL",
							)
							.all(src.name) as typeof prevRows;
					} catch {
						prevRows = [];
					}
				}
				const prevFps = new Set<string>();
				const rowByFp = new Map<string, { id: string; shared_entry_id: string | null; layer: string | null }>();
				for (const r of prevRows) {
					if (!r.fingerprint) continue;
					prevFps.add(r.fingerprint);
					// keep first id per fingerprint
					if (!rowByFp.has(r.fingerprint)) rowByFp.set(r.fingerprint, { id: r.id, shared_entry_id: r.shared_entry_id, layer: r.layer });
				}
				const deletions = collectDeletions(prevFps, currentFps, src.name);
				for (const d of deletions) {
					const info = rowByFp.get(d.fingerprint);
					if (!info) continue;
					// archive locally
					try {
						deps.store
							.prepare(
								"UPDATE memories SET status='archived', archived_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status!='archived'",
							)
							.run(info.id);
						const ch = deps.store.prepare("SELECT changes() AS c").get() as { c: number };
						if (ch.c === 0) continue;
					} catch {
						continue;
					}
					// tombstone if ever exported (shared layer)
					const isShared = info.layer === "shared" || info.shared_entry_id !== null;
					if (isShared && deps.sharedLayer && deps.okfPath) {
						try {
							const entryId = info.shared_entry_id as string;
							if (entryId) {
								const plan = deps.sharedLayer.planTombstone([entryId], deps.okfPath);
								if (plan.write.outcome !== "refused") {
									deps.sharedLayer.applyExport(plan);
								}
							}
						} catch {
							// best-effort, never throw
						}
					} else if (!isShared && deps.sharedLayer && deps.okfPath) {
						// For non-shared memories that were previously exported via shared_entries check
						// we attempt tombstone via content-derived entry_id only if a shared entry exists
						try {
							const row = deps.store
								.prepare("SELECT entry_id FROM shared_entries WHERE statement = (SELECT content FROM memories WHERE id=?) LIMIT 1")
								.get(info.id) as { entry_id: string } | undefined;
							if (row?.entry_id) {
								const plan = deps.sharedLayer.planTombstone([row.entry_id], deps.okfPath);
								if (plan.write.outcome !== "refused") deps.sharedLayer.applyExport(plan);
							}
						} catch {}
					}
					try {
						if (deps.metrics) {
							deps.metrics.incr("source_deletions_total" as unknown as never, 1);
						} else {
							deps.store
								.prepare(
									`INSERT INTO kevin_metrics (key, value, updated_at) VALUES ('source_deletions_total', 1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = value + 1, updated_at = datetime('now')`,
								)
								.run();
						}
					} catch {}
				}
			} catch {
				// best-effort, never break sync
			}
		}

		results.push({
			source: src.name,
			fetched: entries.length,
			dedupSkipped,
			inserted,
		});
	}
	return results;
}

// K16-017 — Idle sync orchestrator (runs on session.idle, not hot path)
import type { Store } from "../Store.js";
import { fingerprint } from "../fingerprint.js";
import type {
	MemorySource,
	SourceEntry,
	SourceSyncResult,
} from "./MemorySource.js";

export interface SyncDeps {
	store: Store;
	sources: MemorySource[];
	metrics?: { incr(key: string, by?: number): void };
}

function dedupKey(e: SourceEntry): string {
	// lower precedence wins attribution: fingerprint over normalized statement + scope
	return fingerprint(`${e.type}\0${e.statement}\0${e.scope ?? ""}`);
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
		const entries = await src.fetch().catch(() => [] as SourceEntry[]);
		let dedupSkipped = 0;
		let inserted = 0;
		for (const e of entries) {
			const fp = dedupKey(e);
			if (seen.has(fp)) {
				dedupSkipped++;
				continue;
			}
			seen.add(fp);
			// Insert as memory with source provenance (simplified)
			try {
				deps.store
					.prepare(
						`INSERT OR IGNORE INTO memories (id, project_id, type, content, scope, fingerprint, confidence, origin, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
					)
					.run(
						`src-${fp.slice(0, 12)}-${src.name}`,
						"default",
						e.type,
						e.statement,
						e.scope,
						fp,
						0.5,
						src.name,
						src.name,
					);
				inserted++;
			} catch {
				dedupSkipped++;
			}
		}
		if (dedupSkipped > 0)
			deps.metrics?.incr("source_dedup_skips_total", dedupSkipped);
		if (inserted > 0) deps.metrics?.incr("source_syncs_total", 1);
		results.push({
			source: src.name,
			fetched: entries.length,
			dedupSkipped,
			inserted,
		});
	}
	return results;
}

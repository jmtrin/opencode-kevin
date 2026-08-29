// v1.1.0 (K11-002 / plan §5.3, D11-06) — single registry for column probes.
// Every hasXColumn helper delegates here; exported names survive so call sites
// and tests do not churn. Caching is per Store instance via WeakMap.
import type { Store } from "./Store.js";

const cache = new WeakMap<Store, Map<string, boolean>>();

export function hasColumn(
	store: Store,
	table: string,
	column: string,
): boolean {
	const byStore = cache.get(store);
	const key = `${table}.${column}`;
	if (byStore?.get(key) === true) return true;
	try {
		store.prepare(`SELECT ${column} FROM ${table} LIMIT 0`).get();
		let m = byStore;
		if (!m) {
			m = new Map<string, boolean>();
			cache.set(store, m);
		}
		m.set(key, true);
		return true;
	} catch {
		return false;
	}
}

// v1.1.0 (K11-011 / plan §5.5, D11-06) — named helpers delegating to the registry
export function hasIgnoredColumn(store: Store): boolean {
	return hasColumn(store, "memories", "ignored");
}
export function hasCuratedColumn(store: Store): boolean {
	return hasColumn(store, "memories", "curated");
}
export function hasTruthColumns(store: Store): boolean {
	return hasColumn(store, "memories", "truth_penalty");
}
export function hasRepoIdColumn(store: Store): boolean {
	return hasColumn(store, "memories", "repo_id");
}
export function hasLayerColumn(store: Store): boolean {
	return hasColumn(store, "memories", "layer");
}
export function hasRecurrenceColumn(store: Store): boolean {
	return hasColumn(store, "memories", "recurrence_count");
}
export function hasArchivedColumn(store: Store): boolean {
	return hasColumn(store, "memories", "archived_at");
}
export function hasFeedbackColumns(store: Store): boolean {
	return hasColumn(store, "memories", "feedback_positive");
}
export function hasFeedbackTable(store: Store): boolean {
	try {
		store.prepare("SELECT COUNT(*) FROM memory_feedback LIMIT 0").get();
		return true;
	} catch {
		return false;
	}
}

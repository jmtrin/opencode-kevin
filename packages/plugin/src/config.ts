/**
 * v2.2.0 (K22-002 / plan §4.1, D22-02) — public plugin metadata subpath.
 *
 * The plugin entrypoint (`index.ts`, the host-loaded `main` module) exports
 * exactly the factory (`KevinPlugin` + `default`) and nothing else: the
 * legacy OpenCode loader passes EVERY entrypoint export through
 * `getServerPlugin` and throws `TypeError: Plugin export is not a function`
 * on the first non-function value (BUG-01/02/03). Everything that used to
 * be re-exported from the entrypoint lives here instead, exposed to
 * consumers as the additive subpath `@jmtrin/opencode-kevin/config`
 * (C-06 safe: `name`, `main`, `exports["."]`, `exports["./tui"]` untouched).
 *
 * Import-time safety: this module performs no I/O on import. `performRekey`
 * takes its `Store` as a parameter; importing this module never opens a
 * database (plan §6.6).
 */
import { hasRepoIdColumn } from "@jmtrin/kevin-core";
import type { Store } from "@jmtrin/kevin-core";

// v2.2.0 (K22-002/K22-007) — single source is @jmtrin/kevin-core
// (`packages/core/src/index.ts`). Re-exported here for the `./config`
// subpath consumers; never re-declared (BUG-11: two declarations drift).
// Provenance by version (from the pre-split adapter declaration):
// v0.4.0 base keys (K4-021) · v0.5.0 +deterministic_retrieval,
// pre_prompt_budget_tokens, archive_after_days (K5-003) · v0.6.0 +curation
// keys (K6-003) · v0.7.0 +repo_truth, convention_mining, conflict_detection,
// error_lesson_mode (K7-003) · v0.8.0 +shared_layer keys (K8-003) · v0.9.0
// +hook_liveness, native_registration, host_probe_history,
// dead_hook_report_threshold (K9-003) · v1.0.0 +perf keys (K10-005) ·
// v1.2.0 +tui_snapshots_enabled, runtime-seeded (K12-001) · v1.4.0 +mcp trio,
// seeded by migration 013 for metrics but by 016 for settings, see K22-005
// (K14-006) · v1.5.0 +skills trio, runtime-seeded (K15-001) · v2.0.0
// +sources keys + okf_write_version + source_deletion_sync (K16-013;
// import_host_memory retired via REMOVED_SETTINGS below).
export { KEVIN_CONFIG_KEYS } from "@jmtrin/kevin-core";

// v2.0.0 (K16-004 / plan §5.1) — removed settings contract.
// Moved verbatim from index.ts in v2.2.0 (K22-002); this is its only home.
export const REMOVED_SETTINGS = {
	import_host_memory: {
		since: "2.0.0",
		replacement: "sources_enabled + source_claude_memory/source_codex_memories",
	},
} as const;

// v0.7.0 (K7-003 / plan §5.6, D7-12) — the explicit VALUE domain for
// `error_lesson_mode`. The setting is TEXT and must be compared with
// `=== "triage_only"`, never by truthiness; the domain here is enforced by
// `kevin_config set` so a typo (`"triage"`, `"0"`, `"false"`) is rejected
// at the surface rather than silently changing every installation's
// behaviour on the next reflection.
// v2.2.0 (K22-002/K22-007) — single source is @jmtrin/kevin-core;
// re-exported here for `./config` consumers (BUG-11).
export { ERROR_LESSON_MODE_VALUES } from "@jmtrin/kevin-core";

/**
 * Plugin release version — single source is @jmtrin/kevin-core
 * (B-003 drift fix). Imported here for `./config` consumers; the
 * entrypoint imports it directly from core for internal use.
 */
export { KEVIN_VERSION } from "@jmtrin/kevin-core";

// v0.8.0 (K8-009 / plan §5.1, D8-03) — `kevin_project rekey`.
// Moved verbatim from index.ts in v2.2.0 (K22-002): exporting it from the
// entrypoint made the host invoke it as a SECOND plugin factory with
// plugin input in place of a store (BUG-02). The only call site is the `kevin_project` tool handler in index.ts; the
// acceptance for K8-009 asserts exactly that by source scan
// (see tests/integration/rekey.test.ts "source scan").
// Re-keying is explicit, human-confirmed, and transactional — it never runs
// at init, on session.idle, or from a migration hook, because silently
// merging two corpora in a monorepo is unrecoverable and undiffable.
export interface RekeyCounts {
	memories: number;
	shared_entries: number;
	okf_imports: number;
}

export interface RekeyResult {
	action: "rekey";
	ok: boolean;
	reason?: string;
	/** Present on a dry run (no `confirm`): nothing was mutated. */
	dry_run?: boolean;
	/** The resolved id the corpus would move to. */
	to_repo_id?: string;
	/** Per source repo_id, the rows that would move (from-value → counts). */
	from?: Record<string, RekeyCounts>;
	/** Total rows that would move, per table. */
	rows?: RekeyCounts;
	/** A monorepo collision was detected (refused unless `force`). */
	collision?: boolean;
	/** Present on a successful confirmed run. */
	rekeyed?: boolean;
}

const REKEY_TABLES = ["memories", "shared_entries", "okf_imports"] as const;

export function performRekey(
	store: Store,
	toRepoId: string,
	opts: { confirm: boolean; force?: boolean },
): RekeyResult {
	if (!/^[0-9a-f]{16}$/.test(toRepoId))
		return {
			action: "rekey",
			ok: false,
			reason: "invalid repo_id",
		} as RekeyResult;
	// The 009 migration carries the repo_id column AND the shared-layer
	// tables; without it there is nothing to re-key.
	if (!hasRepoIdColumn(store)) {
		return {
			action: "rekey",
			ok: false,
			// v2.2.0 (K22-007) — English-only user-visible strings (was Spanish).
			reason:
				"migration 009 has not been applied: no repo_id column exists (nor shared_entries/okf_imports) to re-key against",
		};
	}

	// Rows that would move: every scoped row stored under a repo_id
	// different from the target. NULL-repo_id rows are global by design
	// and never move.
	const groupRows = (table: string): { repo_id: string; c: number }[] =>
		store
			.prepare(
				`SELECT repo_id, COUNT(*) AS c FROM ${table}
				 WHERE repo_id IS NOT NULL AND repo_id != ? GROUP BY repo_id`,
			)
			.all(toRepoId) as { repo_id: string; c: number }[];

	const from: Record<string, RekeyCounts> = {};
	const rows: RekeyCounts = {
		memories: 0,
		shared_entries: 0,
		okf_imports: 0,
	};
	for (const table of REKEY_TABLES) {
		for (const r of groupRows(table)) {
			rows[table] += r.c;
			from[r.repo_id] ??= {
				memories: 0,
				shared_entries: 0,
				okf_imports: 0,
			};
			from[r.repo_id][table] = r.c;
		}
	}
	const total = rows.memories + rows.shared_entries + rows.okf_imports;
	if (total === 0) {
		return {
			action: "rekey",
			ok: true,
			rekeyed: false,
			to_repo_id: toRepoId,
			rows,
			from,
		};
	}

	// Monorepo collision (D8-03): rows already at the target repo_id
	// belong to a different project_id set than the rows that would move.
	// shared_entries and okf_imports carry no project_id, so memories is
	// the only witness.
	const pidSet = (sql: string, ...params: unknown[]): Set<string> => {
		const out = new Set<string>();
		for (const r of store.prepare(sql).all(...params) as {
			project_id: string | null;
		}[]) {
			if (r.project_id !== null) out.add(r.project_id);
		}
		return out;
	};
	const targetPids = pidSet(
		"SELECT DISTINCT project_id FROM memories WHERE repo_id = ?",
		toRepoId,
	);
	const movePids = pidSet(
		"SELECT DISTINCT project_id FROM memories WHERE repo_id IS NOT NULL AND repo_id != ?",
		toRepoId,
	);
	const collision =
		targetPids.size > 0 &&
		!(
			movePids.size === targetPids.size &&
			[...movePids].every((p) => targetPids.has(p))
		);

	if (!opts.confirm) {
		return {
			action: "rekey",
			ok: true,
			dry_run: true,
			to_repo_id: toRepoId,
			rows,
			from,
			collision,
		};
	}
	if (collision && opts.force !== true) {
		return {
			action: "rekey",
			ok: false,
			// v2.2.0 (K22-007) — English-only user-visible strings (was Spanish).
			reason:
				"monorepo collision: the target repo_id already holds memories from a different project_id set; pass force: true only if you want to merge them",
			to_repo_id: toRepoId,
			rows,
			collision: true,
		};
	}

	// One transaction: the row moves and the rekey_events counter move
	// together — a mid-way failure rolls both back and the database is
	// completely unchanged.
	try {
		store.transaction(() => {
			for (const table of REKEY_TABLES) {
				store
					.prepare(
						`UPDATE ${table} SET repo_id = ?
						 WHERE repo_id IS NOT NULL AND repo_id != ?`,
					)
					.run(toRepoId, toRepoId);
			}
			store
				.prepare(
					`INSERT INTO kevin_metrics (key, value, updated_at)
					 VALUES ('rekey_events', 1, datetime('now'))
					 ON CONFLICT(key) DO UPDATE SET
					   value = value + 1,
					   updated_at = datetime('now')`,
				)
				.run();
		});
	} catch (err) {
		return {
			action: "rekey",
			ok: false,
			// v2.2.0 (K22-007) — English-only user-visible strings (was Spanish).
			reason: `rekey failed and was fully rolled back: ${(err as { message?: string })?.message ?? "unknown error"}`,
		};
	}
	return {
		action: "rekey",
		ok: true,
		rekeyed: true,
		to_repo_id: toRepoId,
		rows,
		from,
	};
}

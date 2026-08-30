import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { Archiver } from "@jmtrin/kevin-core";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { CausalChain } from "@jmtrin/kevin-core";
import { handleBridgeCommand } from "@jmtrin/kevin-core";
import { ConflictDetector } from "@jmtrin/kevin-core";
import { type ChatMessage, ContextInjector } from "@jmtrin/kevin-core";
import { ConventionMiner } from "@jmtrin/kevin-core";
import { Curator } from "@jmtrin/kevin-core";
import { writeDashboard } from "@jmtrin/kevin-core";
import { Feedback } from "@jmtrin/kevin-core";
import { HookLiveness } from "@jmtrin/kevin-core";
import { InjectionLedger } from "@jmtrin/kevin-core";
import { Materializer, SKILL_TOPIC } from "@jmtrin/kevin-core";
import {
	type Memory,
	MemoryService,
	type SlimMemory,
	type SlimMemoryWithEvidence,
	hasRepoIdColumn,
} from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { PatternMiner } from "@jmtrin/kevin-core";
import { ERROR_LINE_RE, Reflector, STRONG_ERROR_RE } from "@jmtrin/kevin-core";
import * as RepoIdentity from "@jmtrin/kevin-core";
import type { IdentitySource, ResolvedIdentity } from "@jmtrin/kevin-core";
import { RepoTruth } from "@jmtrin/kevin-core";
import { Retrospective } from "@jmtrin/kevin-core";
import { type ImportReport, SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { ToolCallObserver } from "@jmtrin/kevin-core";
import {
	deleteMailbox,
	processActions,
	readMailbox,
	writeResults,
} from "@jmtrin/kevin-core";
import { flushSnapshots } from "@jmtrin/kevin-core";
import { probe } from "./capabilities.js";
import { computeConfidence, type KevinEnv, exportMigrationsDir, composeIdlePipeline, KEVIN_VERSION } from "@jmtrin/kevin-core";
import { contractDigest, describeContract } from "@jmtrin/kevin-core";
import { fingerprint } from "@jmtrin/kevin-core";
import { probeHost, summarize } from "./host.js";
import { kevinApprove } from "@jmtrin/kevin-core";
import { buildAudit } from "@jmtrin/kevin-core";
import { buildKevinBench } from "@jmtrin/kevin-core";
import { executeKevinConflicts } from "@jmtrin/kevin-core";
import { buildKevinContract } from "@jmtrin/kevin-core";
import { buildDoctor } from "@jmtrin/kevin-core";
import { buildKevinFacts } from "@jmtrin/kevin-core";
import { handleForget } from "@jmtrin/kevin-core";
import { handleNative } from "@jmtrin/kevin-core";
import { kevinPropose } from "@jmtrin/kevin-core";
import { kevinPublish } from "@jmtrin/kevin-core";
import { kevinWhy } from "@jmtrin/kevin-core";
import type { WhyResult } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import { attachNative } from "./native.js";
import { exportMarkdown, exportOkf } from "@jmtrin/kevin-core";
import { importOkf } from "@jmtrin/kevin-core";
import { Perf } from "@jmtrin/kevin-core";
import { uuidv7 } from "@jmtrin/kevin-core";

export interface KevinPluginOptions {
	dbPath?: string;
	migrationsDir?: string;
	retrospectivesDir?: string;
	throttleMs?: number;
	/** v0.6.0 (K6-018) - test-only override for the pull-bundle root. */
	materializerRoot?: string;
	/** v0.7.0 (K7-009) - repository root RepoTruth scans. Defaults to
	 * `process.cwd()`. Test-only override so a fixture project can stand in
	 * for the working directory. */
	projectRoot?: string;
}

// v0.6.0 (K6-019) — process-global set of reference topics already
// registered with the host this process. Keeps re-registration idempotent
// across sessions within one process: a topic registered once is never
// added twice, so `references_registered` never doubles.
const registeredReferences = new Set<string>();

/**
 * v0.4.0 (K4-021) — settings surfaced by `kevin_config` (plan §8.8).
 * Unknown keys are rejected on `set` unless `strict: false`.
 */
export const KEVIN_CONFIG_KEYS = [
	"quality_gate_enabled",
	"lesson_snippet_injection",
	"patternminer_enabled",
	"cross_project_enabled",
	"llm_reflection_enabled",
	"tool_calls_dedup_enabled",
	// v0.5.0 (K5-003 / plan §8.13) — omitting these makes `kevin_config set`
	// return { error: "unknown_key" } while `kevin_config list` still shows
	// the keys seeded by migration 006.
	"deterministic_retrieval",
	"pre_prompt_budget_tokens",
	"archive_after_days",
	// v0.6.0 (K6-003 / plan §8.14) — the five keys seeded by migration 007
	// section 5. Omitting these makes `kevin_config set` return
	// { error: "unknown_key" } while `kevin_config list` still shows them.
	"curation_enabled",
	"agents_md_path",
	"skill_emission_enabled",
	"reference_emission_enabled",
	"injection_confidence_floor",
	// v0.7.0 (K7-003 / plan §8.10) — the four keys seeded by migration 008
	// section 5. Three feature flags plus the error lesson mode enum.
	// Omitting these makes `kevin_config set` return { error: "unknown_key" }
	// while `kevin_config list` still shows them.
	"repo_truth_enabled",
	"convention_mining_enabled",
	"conflict_detection_enabled",
	"error_lesson_mode",
	// v0.8.0 (K8-003 / plan §8.10) — the five keys seeded by migration 009
	// section 5. Omitting these makes `kevin_config set` return
	// { error: "unknown_key" } while `kevin_config list` still shows them.
	// shared_layer_enabled must be compared with === "1" (it is TEXT, and
	// '0' is truthy); shared_confidence_floor is a string read with
	// Number.parseFloat and clamped to [0, 1] (conventions, §2).
	"shared_layer_enabled",
	"okf_path",
	"share_requires_approval",
	"author_identity_mode",
	"shared_confidence_floor",
	// v0.9.0 (K9-003 / plan §8.10) — the four keys seeded by migration 010
	// section 5. Omitting these makes `kevin_config set` return
	// { error: "unknown_key" } while `kevin_config list` still shows them.
	// hook_liveness_enabled and the two registration/history flags must be
	// compared with === "1" (they are TEXT, and '0' is truthy);
	// dead_hook_report_threshold is a string read with Number.parseInt and
	// clamped to [1, 1000], NaN defaulting to 3 (conventions, §2; D9-09).
	"hook_liveness_enabled",
	"native_registration_enabled",
	"host_probe_history_enabled",
	"dead_hook_report_threshold",
	// v1.0.0 (K10-005 / plan §6) — the four keys seeded by migration 011
	// section 4. Omitting these makes `kevin_config set` return
	// { error: "unknown_key" } while `kevin_config list` still shows them.
	"perf_enabled",
	"perf_ring_capacity",
	"perf_flush_on_idle",
	"contract_report_enabled",
	// v1.2.0 (K12-001 / plan §4) — the single setting seeded by runtime
	// (no migration this release). Omitting makes `kevin_config set`
	// return { error: "unknown_key" } while `kevin_config list` still
	// shows it.
	"tui_snapshots_enabled",
	// v1.4.0 (K14-006 / plan §4) — the three MCP bridge settings seeded by migration 013
	// Omitting makes `kevin_config set` return { error: "unknown_key" } while list shows them.
	"mcp_write_enabled",
	"mcp_approve_enabled",
	"mcp_repo_override",
	// v1.5.0 (K15-001 / plan §4) — the four Diaspora settings (no migration this release)
	// skills_canonical_dir is a path, others are TEXT flags compared with === "1".
	"skills_canonical_dir",
	"skills_mirror_claude",
	"skills_mirror_cursor",
	// v2.0.0 (K16-013 / plan §4.4) — Commonwealth settings (retirement of import_host_memory handled via removals)
	"sources_enabled",
	"source_claude_memory",
	"source_codex_memories",
	"source_opencode_native",
	"okf_write_version",
	"source_deletion_sync",
] as const;
// v2.0.0 (K16-004 / plan §5.1) — removed settings contract
export const REMOVED_SETTINGS = {
	import_host_memory: {
		since: "2.0.0",
		replacement: "sources_enabled + source_claude_memory/source_codex_memories",
	},
} as const;

// v1.1.0 (K11-007 / D11-08) — no new settings in 1.1.0; thresholds are constants (D11-03)

// v0.7.0 (K7-003 / plan §5.6, D7-12) — the explicit VALUE domain for
// `error_lesson_mode`. The setting is TEXT and must be compared with
// `=== "triage_only"`, never by truthiness; the domain here is enforced by
// `kevin_config set` so a typo (`"triage"`, `"0"`, `"false"`) is rejected
// at the surface rather than silently changing every installation's
// behaviour on the next reflection.
export const ERROR_LESSON_MODE_VALUES = ["all", "triage_only"] as const;

/** Plugin release version — single source is @jmtrin/kevin-core (B-003 drift fix). */
export { KEVIN_VERSION };

function resolveMigrationsDir(): string {
	// K13-008 (D13-04): migrations now owned by @jmtrin/kevin-core.
	// Explicit option is handled at call site (opts.migrationsDir ?? resolve...),
	// so this helper only resolves the core location.
	// 1. Installed layout: walk-up via require.resolve (reuses host.ts strategy)
	try {
		const pkgJson = createRequire(import.meta.url).resolve(
			"@jmtrin/kevin-core/package.json",
		);
		const cand = join(dirname(pkgJson), "dist", "migrations");
		if (existsSync(cand)) return cand;
	} catch {}
	// 2. Workspace sources: delegate to core's own resolver (handles both
	//    src via tsx and dist after build).
	try {
		const dir = exportMigrationsDir();
		if (existsSync(dir)) return dir;
	} catch {}
	// 3. Monorepo fallback probes (dev without build)
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "..", "..", "core", "dist", "migrations"),
		join(here, "..", "..", "core", "migrations"),
		join(here, "..", "migrations"),
		join(here, "..", "..", "migrations"),
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return join(here, "..", "..", "core", "migrations");
}

// v0.8.0 (K8-009 / plan §5.1, D8-03) — `kevin_project rekey`.
// The only call site in this file is the `kevin_project` tool handler; the
// acceptance for K8-009 asserts exactly that by source scan. Re-keying is
// explicit, human-confirmed, and transactional — it never runs at init, on
// session.idle, or from a migration hook, because silently merging two
// corpora in a monorepo is unrecoverable and undiffable.
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
	if (!/^[0-9a-f]{16}$/.test(toRepoId)) return { action: "rekey", ok: false, reason: "invalid repo_id" } as RekeyResult;
	// The 009 migration carries the repo_id column AND the shared-layer
	// tables; without it there is nothing to re-key.
	if (!hasRepoIdColumn(store)) {
		return {
			action: "rekey",
			ok: false,
			reason:
				"la migracion 009 no se ha aplicado: no existe repo_id (ni shared_entries/okf_imports) sobre el que re-key",
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
			reason:
				"monorepo collision: el repo_id destino ya contiene memorias de un conjunto de project_id distinto; pasa force: true solo si quieres fusionarlos",
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
			reason: `rekey fallo y se revirtio completamente: ${(err as { message?: string })?.message ?? "unknown error"}`,
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

export const KevinPlugin: Plugin = async (input, options) => {
	const opts = (options ?? {}) as KevinPluginOptions;
	const dbPath = opts.dbPath ?? join(homedir(), ".opencode-kevin", "kevin.db");
	if (dbPath !== ":memory:") {
		const dbDir = dirname(dbPath);
		if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
	}
	const store = new Store({ path: dbPath });
	const migrationsDir = opts.migrationsDir ?? resolveMigrationsDir();
	await new Migrate(store, migrationsDir).run();
	// v1.2.0 (K12-001 / D12-??) — no migration this release: ensure the
	// new setting exists with its default so `kevin_config list` shows it
	// on a database that was already at 012.
	try {
		store
			.prepare(
				"INSERT OR IGNORE INTO kevin_settings (key, value) VALUES (?, ?)",
			)
			.run("tui_snapshots_enabled", "1");
	} catch {
		// pre-003 DB without kevin_settings — nothing to seed
	}
	// v1.5.0 (K15-001) — Diaspora settings: ensure defaults on existing DBs.
	// v2.0.0: import_host_memory retired — seeded via 014 translation then deleted; no longer seeded here.
	try {
		const ins = store.prepare(
			"INSERT OR IGNORE INTO kevin_settings (key, value) VALUES (?, ?)",
		);
		ins.run("skills_canonical_dir", ".agents/skills");
		ins.run("skills_mirror_claude", "0");
		ins.run("skills_mirror_cursor", "0");
	} catch {
		// pre-003 DB without kevin_settings — nothing to seed
	}
	const metrics = new Metrics(store);
	// v0.4.0 (K4-019): the plugin hooks expose no project field, so the
	// project id is derived once from the plugin host's working directory
	// (plan §5.7 fallback; D2-11 project scoping wired into the live path).
	// v0.8.0 (K8-006 / plan §5.1): the repository identity resolves once at
	// init, next to the project id, and never on a hot path.
	// v0.9.0 (K9-004/K9-006 / plan §5.1-5.2, D9-12/D9-13): the host surface
	// is probed once at construction — frozen, never re-probed — and feeds
	// the identity chain as the third source, above `path` and below
	// `declared`/`remote`.
	const host = await probeHost(input);
	const identity = RepoIdentity.resolve(process.cwd(), host);
	const projectId = identity.projectId;
	const repoId = identity.repoId;
	const identitySource = identity.source;
	const identityEvidence = identity.evidence;
	// v0.8.0 (BUG-001/002) — the SESSION identity: what the shared layer
	// bridge, MemoryService, Curator and the tools actually use. It is
	// derived once at init and only moves when kevin_project rekey
	// succeeds (the rows move with it). kevin_status and the audit
	// rollups report THIS id, never a fresh per-call resolve — a
	// mid-session `git remote add` changes what the identity WILL be,
	// not what the session is scoped on.
	let sessionIdentity: ResolvedIdentity = identity;
	const memoryService = new MemoryService(store, metrics, repoId);
	// v0.9.0 (K9-008 / plan §5.1, D9-08) — host probe history: one
	// host_probes row per construction when host_probe_history_enabled
	// is explicitly '1' (TEXT comparison — truthiness would fire on
	// '0'). Append-only and unbounded by design: off by default, one
	// row per process start, no retention policy.
	if (memoryService.getSetting("host_probe_history_enabled", "0") === "1") {
		store
			.prepare(
				`INSERT INTO host_probes
				 (id, plugin_version, flavour, has_shell, v2_skill, v2_reference, notes)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				uuidv7(),
				host.pluginVersion,
				host.flavour,
				host.hasShell ? 1 : 0,
				host.v2.skill ? 1 : 0,
				host.v2.reference ? 1 : 0,
				host.notes.join("\n"),
			);
	}
	// v0.9.0 (K9-009 / plan §5.3, D9-07/D9-08) — hook liveness. Wraps every
	// hook with a success-path recorder; counters persist on the
	// metrics.flush() cadence. Explicit === "1" TEXT comparison
	// (kevin_settings.value is TEXT).
	const liveness = new HookLiveness(store, {
		enabled: memoryService.getSetting("hook_liveness_enabled", "1") === "1",
		thresholdText: memoryService.getSetting("dead_hook_report_threshold", "3"),
		pluginVersion: host.pluginVersion,
	});
	// v1.0.0 (K10-012 / plan §5.2) — the performance instrument. Measures
	// how long each hook holds the host into per-scope ring buffers that
	// only reach the store at session.idle (D10-11: no perf_samples write
	// anywhere else). perf_enabled uses the explicit === "1" TEXT
	// comparison; the capacity string goes through the parse guard/clamp.
	const perf = new Perf({
		enabled: memoryService.getSetting("perf_enabled", "1") === "1",
		capacity: memoryService.getSetting("perf_ring_capacity", "") ?? "",
	});
	// v0.7.0 (K7-009 / plan §5.1, D7-13) — the repository truth scanner reads
	// the JSON project files. Runs once at init, gated by repo_truth_enabled.
	const projectRoot = opts.projectRoot ?? process.cwd();
	const materializerRoot =
		opts.materializerRoot ?? join(homedir(), ".opencode-kevin");
	const kevinEnv: KevinEnv = { projectRoot, dataRoot: materializerRoot };
	const repoTruth = new RepoTruth(store, projectId, projectRoot, metrics);
	if (memoryService.getSetting("repo_truth_enabled", "0") === "1") {
		try {
			repoTruth.scan();
		} catch {
			// A scan failure at init must not prevent the plugin from loading.
		}
	}
	const observer = new ToolCallObserver(store, metrics);
	// v0.3.0 fix — Prepared UPDATE used by Reflector.onLinkError to stamp
	// tool_calls.error_fingerprint with the stderr-based fingerprint the
	// matching error memory uses. Closes the feedback-loop fingerprint
	// mismatch (plan §B6.10 / bug #2): without this, the recurrence
	// queries in boostPositiveReflectors / penalizeRecurringReflectors
	// never match because tool_calls.fingerprint is keyed on
	// `${tool}|${args}|${success}` (set by ToolCallObserver) while error
	// memories use a hash of stderr/stdout (set by Reflector). The
	// callback is a no-op for legacy rows without an id column.
	const linkErrorStmt = store.prepare(
		"UPDATE tool_calls SET error_fingerprint = ? WHERE id = ?",
	);
	const reflector = new Reflector(
		memoryService,
		{
			throttleMs: opts.throttleMs,
			onLinkError: (callID, fp) => {
				linkErrorStmt.run(fp, callID);
			},
		},
		metrics,
	);
	// v0.4.0 (K4-017): the single injection path. The inline transform/
	// compacting logic was removed; the ContextInjector now owns the whole
	// pipeline (QualityGate admission + snippet payload + ledger rows),
	// so ledger and injector share the same store.
	const ledger = new InjectionLedger(store, metrics);
	const injector = new ContextInjector(memoryService, metrics, ledger);
	// v0.5.0 (K5-009/011 / plan §5.3) — human feedback component behind the
	// `kevin_feedback` tool; 'ignore' verdicts also stamp memories.ignored.
	const feedback = new Feedback(store, metrics);
	// v0.5.0 (K5-012 / plan §5.4) — retires stale memories at session.idle.
	const archiver = new Archiver(store, memoryService, metrics);
	const retrospective = new Retrospective(
		store,
		memoryService,
		{
			dir: opts.retrospectivesDir,
		},
		metrics,
		kevinEnv,
	);
	const patternMiner = new PatternMiner(store, memoryService, metrics);
	const conventionMiner = new ConventionMiner(
		store,
		memoryService,
		projectId,
		metrics,
	);
	const conflictDetector = new ConflictDetector(
		store,
		projectId,
		metrics,
		repoTruth,
		memoryService,
	);
	const causalChain = new CausalChain(store, memoryService, metrics);
	// v0.6.0 (K6-014 / plan §5.4-5.5, D6-01) — the single write path: the
	// ArtifactWriter is constructed here and only `kevin_approve` may call
	// `apply()`. `kevin_propose` reaches the file only through `plan()`.
	const writer = new ArtifactWriter(store, projectId, metrics);
	// v0.8.0 (K8-020/021 / plan §5.5) — the shared layer bridge, built
	// once at init next to the writer. okf_path resolves against
	// projectRoot at call time; the writer is the only write path
	// (D8-08).
	let sharedLayer = new SharedLayer({
		store,
		repoId,
		projectId,
		version: KEVIN_VERSION,
		writer,
	});
	// v0.8.0 (K8-022 / plan §5.5) — the shared layer re-read. sync is
	// deliberately narrow: re-read a file that is already on disk —
	// one read plus one hash on an unchanged repository (the
	// okf_imports hash skip), and nothing else. No fetch, no push, no
	// remote, no poll (D8-01, Principle 30). Reachable only from the
	// kevin_sync tool and session.idle, never from a hot-path hook.
	function syncSharedLayer(): ImportReport {
		const okfPath = join(
			projectRoot,
			memoryService.getSetting("okf_path", ".kevin/knowledge.okf"),
		);
		const report = sharedLayer.import(okfPath);
		metrics.incr("shared_entries_imported", report.imported);
		return report;
	}
	let curator = new Curator(store, memoryService, projectId, metrics, repoId, kevinEnv);
	// v0.6.0 (K6-017/018 / plan §5.6-5.7, D6-13) — pull-channel bundles and
	// the v2 domain probe. `probe()` runs ONCE at init and the result is
	// held; probing per-event is a hot-path cost for a value that cannot
	// change within a process (K6-016). The Materializer writes next to its
	// targets, so the bundle directories are created here at init.
	mkdirSync(join(materializerRoot, "skills"), { recursive: true });
	mkdirSync(join(materializerRoot, "refs"), { recursive: true });
	const capabilities = probe(input);
	// v1.2.0 (K12-012 / D12-03) — permission.ask probe (best-effort, additive).
	// When the host exposes permission.ask, the presence is noted; absence is silent no-op.
	// No new setting — bounded to tui_snapshots_enabled host-support check per spec.
	void capabilities.permissionAsk;
	const materializer = new Materializer(store, { root: materializerRoot }, kevinEnv);
	// v0.9.0 (K9-016 / plan §5.4, D9-10) — native registration replaces
	// file emission. When attachNative returns a registration for a
	// surface, the corresponding *_emission_enabled path is skipped for
	// that surface only. The guard lives in Materializer.
	try {
		const nativeReg = await attachNative(host, {
			materializer,
			settings: memoryService,
			store,
		});
		if (nativeReg) {
			materializer.markNativeRegistered("skill", nativeReg.registered.skill);
			materializer.markNativeRegistered(
				"reference",
				nativeReg.registered.reference,
			);
		}
	} catch {
		// attachNative never throws (D9-12) — guard against unexpected rejection.
	}
	// v0.6.0 (K6-018 / plan §8.14, D6-13) — skill emission at session
	// start, behind the capability probe AND `skill_emission_enabled`
	// (default '0'). Both no-op paths are silent: "unavailable" (v1 host)
	// vs "off" (setting) are distinguished in kevin_audit (K6-023).
	if (
		capabilities.skills &&
		memoryService.getSetting("skill_emission_enabled", "0") === "1"
	) {
		try {
			const body = materializer.skillBody();
			if (body !== "") {
				materializer.materialize(writer);
				const skill = (input as Record<string, unknown>).skill as
					| { source?: unknown }
					| undefined;
				const registration = (skill?.source as (body: string) => unknown)(body);
				if (
					registration &&
					typeof (registration as { dispose?: unknown }).dispose === "function"
				) {
					metrics.incrRegistered("skills_registered", 1);
				}
			}
		} catch {
			// best-effort: a throwing host registration is caught, the
			// session continues, and no metric is incremented
		}
	}
	// v0.6.0 (K6-019 / plan §5.7-5.8, D6-13) — reference emission at
	// session start, same degradation contract as the skill block: silent
	// no-op when the capability is absent or the setting is '0'. One
	// `@kevin/<topic>` mention per materialized ref topic, registered with
	// a `{ local }` source — the only source kind this release can
	// truthfully claim (K6-019).
	if (
		capabilities.references &&
		memoryService.getSetting("reference_emission_enabled", "0") === "1"
	) {
		try {
			materializer.materialize(writer);
			const reference = (input as Record<string, unknown>).reference as
				| { add?: unknown }
				| undefined;
			if (typeof reference?.add === "function") {
				for (const target of materializer
					.bundleTargets()
					.filter((t) => t.topic !== SKILL_TOPIC)) {
					if (registeredReferences.has(target.topic)) continue;
					const registration = (
						reference.add as (
							name: string,
							source: { local: string },
						) => unknown
					)(`@kevin/${target.topic}`, { local: target.path });
					if (
						registration &&
						typeof (registration as { dispose?: unknown }).dispose ===
							"function"
					) {
						registeredReferences.add(target.topic);
						metrics.incrRegistered("references_registered", 1);
					}
				}
			}
		} catch {
			// best-effort: a throwing host registration is caught, the
			// session continues, and no metric is incremented
		}
	}
	let currentSessionId: string | null = null;

	// v1.0.0 (K10-013 / D10-08) — set on the first tool completion of a
	// session; consumed at idle to arm the deferred-dispose marker.
	let sessionRecordedWork = false;
	// BUG-011 — process-global last derived query. Cleared on
	// `session.idle`; the per-session map below is the preferred source.
	let lastUserQuery: string | null = null;
	// v0.4.0 (K4-018) — compaction may fire without a recent chat.message
	// (auto-compact after a long tool turn, resumed sessions). Keep the
	// last derived query PER SESSION so the compacting hook can always
	// resolve a query for the session it runs in.
	const lastUserQueryBySession = new Map<string, string>();
	const pending = new Set<Promise<unknown>>();
	const toolCache = new Map<string, { tool: string; argsSummary: string }>();
	const TOOL_CACHE_MAX = 500;
	function fireAndForget(p: Promise<unknown>): void {
		const tracked = p.catch(() => {});
		pending.add(tracked);
		tracked.finally(() => {
			pending.delete(tracked);
		});
	}
	function rememberToolCall(
		callID: string,
		tool: string,
		args: Record<string, unknown> | undefined,
	): void {
		if (toolCache.size >= TOOL_CACHE_MAX) {
			const oldest = toolCache.keys().next().value;
			if (oldest) toolCache.delete(oldest);
		}
		toolCache.set(callID, {
			tool,
			argsSummary: observer.summarizeArgs(args ?? {}),
		});
	}
	function pickExitCode(meta: Record<string, unknown>): number | undefined {
		for (const k of ["exitCode", "exit_code", "exit"]) {
			const v = meta[k];
			if (typeof v === "number") return v;
		}
		return undefined;
	}

	function handleToolFailed(
		callID: string,
		sessionID: string,
		errorMessage: string,
	): void {
		const cached = toolCache.get(callID);
		toolCache.delete(callID);
		if (!cached) return;
		const errorType = observer.inferErrorType(errorMessage, "", undefined);
		fireAndForget(
			reflector.invoke({
				toolName: cached.tool,
				argsSummary: cached.argsSummary,
				stderr: errorMessage,
				stdout: "",
				exitCode: undefined,
				errorType,
				sessionId: sessionID,
				callID,
				projectId,
			}),
		);
	}

	// v0.9.0 (K9-009 / plan §5.3) — the hooks object is wrapped here at the
	// point of return: transparent (identical keys/arity/returns/errors),
	// recording fires on the success path only. With hook_liveness_enabled
	// '0' the wrapper returns this same object untouched.
	return liveness.wrap({
		tool: {
			kevin_save: tool({
				description:
					"Guarda una memoria en el conocimiento persistente de Kevin (error, pattern, decision o context).",
				args: {
					type: tool.schema.enum([
						"error",
						"pattern",
						"decision",
						"context",
						"rule",
						"solution",
					]),
					content: tool.schema.string().min(1),
					scope: tool.schema.enum(["project", "session"]).default("project"),
					metadata: tool.schema
						.record(tool.schema.string(), tool.schema.unknown())
						.optional(),
					relevanceScore: tool.schema.number().min(0).max(1).optional(),
					sourceTool: tool.schema.string().optional(),
					sourceSession: tool.schema.string().optional(),
				},
				async execute(args) {
					const id = memoryService.save({
						type: args.type,
						content: args.content,
						scope: args.scope,
						metadata: args.metadata,
						relevanceScore: args.relevanceScore,
						sourceTool: args.sourceTool,
						sourceSession: args.sourceSession,
					});
					return { title: "Memoria guardada", output: JSON.stringify({ id }) };
				},
			}),
			kevin_query: tool({
				description:
					"Busca memorias por texto (FTS5). Retorna JSON con [{id,type,scope,score,snippet}] (slim, v0.2.0). Con full=true retorna [{id,type,content,scope,...}] (legacy v0.1.x).",
				args: {
					query: tool.schema.string().min(1),
					type: tool.schema
						.enum([
							"error",
							"pattern",
							"decision",
							"context",
							"rule",
							"solution",
						])
						.optional(),
					limit: tool.schema.number().int().positive().default(10),
					full: tool.schema
						.boolean()
						.optional()
						.describe(
							"Cuando true, retorna el contenido completo (v0.1.x). Default false (slim).",
						),
					evidence: tool.schema
						.boolean()
						.optional()
						.describe(
							"Cuando true, incluye confidence, evidence_count y last_verified_at en el payload slim (v0.3.0).",
						),
				},
				async execute(args) {
					const memories = memoryService.query({
						text: args.query,
						type: args.type,
						limit: args.limit,
						full: args.full === true,
						// BUG-001 — pass the flag through so the slim mapper
						// can include the evidence fields (the old code cast
						// SlimMemory rows to Memory and read undefined fields).
						evidence: args.evidence === true,
					});
					const rows =
						args.full === true
							? (memories as unknown as Memory[]).map((m) => ({
									id: m.id,
									type: m.type,
									content: m.content,
									scope: m.scope,
								}))
							: (memories as SlimMemory[]).map((m) => {
									const base = {
										id: m.id,
										type: m.type,
										scope: m.scope,
										score: m.score,
										snippet: m.snippet,
									};
									if (args.evidence === true) {
										// SlimMemoryWithEvidence — carried by the
										// mapper, no per-row getById needed.
										const ev = m as SlimMemoryWithEvidence;
										return {
											...base,
											confidence: ev.confidence ?? null,
											evidence_count: ev.evidence_count ?? null,
											last_verified_at: ev.last_verified_at ?? null,
										};
									}
									return base;
								});
					return {
						title: "Resultados query",
						output: JSON.stringify(rows),
					};
				},
			}),
			kevin_get: tool({
				description:
					"Recupera una memoria completa por su id (v0.2.0 — progressive disclosure). Util cuando kevin_query retorna un snippet slim y necesitas el contenido completo.",
				args: {
					id: tool.schema.string().min(1),
				},
				async execute(args) {
					const mem = memoryService.getById(args.id);
					if (mem === null) {
						return {
							title: "No encontrada",
							output: JSON.stringify({
								error: "not_found",
								id: args.id,
							}),
						};
					}
					return {
						title: "Memoria encontrada",
						output: JSON.stringify({
							id: mem.id,
							type: mem.type,
							content: mem.content,
							scope: mem.scope,
							relevanceScore: mem.relevanceScore,
							sourceTool: mem.sourceTool ?? null,
							sourceSession: mem.sourceSession ?? null,
							createdAt: mem.createdAt,
							updatedAt: mem.updatedAt,
							expiresAt: mem.expiresAt ?? null,
							projectId: mem.projectId ?? null,
							fingerprint: mem.fingerprint ?? null,
							origin: mem.origin ?? null,
							metadata: mem.metadata ?? null,
							// BUG-010 — v0.3/v0.4 evidence fields so kevin_get
							// is the full-fidelity read path (mapRow already
							// computes confidence via computeConfidence).
							confidence: mem.confidence ?? null,
							evidence_count: mem.evidenceCount ?? null,
							recurrence_count: mem.recurrenceCount ?? null,
							last_verified_at: mem.lastVerifiedAt ?? null,
							status: mem.status ?? "active",
							fix_args: mem.fixArgs ?? null,
						}),
					};
				},
			}),
			kevin_recall: tool({
				description:
					"Recupera memorias relevantes (greedy fill por budget de tokens). Opcional query; sin query retorna todas del scope.",
				args: {
					query: tool.schema.string().optional(),
					limit: tool.schema.number().int().positive().default(5),
					scope: tool.schema
						.enum(["project", "session", "all"])
						.optional()
						.describe("project | session | all (default all)"),
				},
				async execute(args) {
					const memories = memoryService.getRelevant({
						query: args.query,
						maxTokens: args.limit * 500,
						scope: args.scope ?? "all",
					});
					return {
						title: "Memorias relevantes",
						output: JSON.stringify(
							memories.map((m) => ({
								id: m.id,
								type: m.type,
								content: m.content,
								scope: m.scope,
							})),
						),
					};
				},
			}),
			kevin_status: tool({
				description:
					"Retorna conteos de memorias, tool_calls y retrospectives en la DB de Kevin.",
				args: {},
				async execute() {
					const memoryCount = store
						.prepare("SELECT COUNT(*) as c FROM memories")
						.get() as { c: number };
					const toolCallCount = store
						.prepare("SELECT COUNT(*) as c FROM tool_calls")
						.get() as { c: number };
					const retroCount = store
						.prepare("SELECT COUNT(*) as c FROM retrospectives")
						.get() as { c: number };
					// v0.2.0 (K2-014): origin breakdown + metrics snapshot.
					const originRows = store
						.prepare(
							`SELECT origin, COUNT(*) as c
							 FROM memories
							 GROUP BY origin`,
						)
						.all() as { origin: string | null; c: number }[];
					const byOrigin: Record<string, number> = {};
					for (const r of originRows) {
						byOrigin[r.origin ?? "agent"] = r.c;
					}
					const memoriesReflector = byOrigin.reflector ?? 0;
					const memoriesAgent = byOrigin.agent ?? 0;
					const memoriesPattern = byOrigin.pattern ?? 0;
					const memoriesCausal = byOrigin.causal ?? 0;
					// v0.4.0 (K4-024): per-origin recurrence_count totals
					// (plan §8.8 — honest negative-evidence breakdown).
					// Best-effort: DBs pre-005 lack the column; the rest of
					// the block must still work (same pattern as
					// ledger.settle in session.idle).
					let recurrenceByOrigin: Record<string, number> = {};
					try {
						const recRows = store
							.prepare(
								`SELECT origin, SUM(recurrence_count) as c
								 FROM memories
								 GROUP BY origin`,
							)
							.all() as { origin: string | null; c: number }[];
						for (const r of recRows) {
							recurrenceByOrigin[r.origin ?? "agent"] = r.c;
						}
					} catch {
						recurrenceByOrigin = {};
					}
					// v0.5.0 (K5-021 / plan §5.7) — lifecycle counts; best-effort
					// on pre-006 DBs (columns may be missing).
					let memoriesIgnored = 0;
					let memoriesArchived = 0;
					try {
						memoriesIgnored = (
							store
								.prepare("SELECT COUNT(*) as c FROM memories WHERE ignored = 1")
								.get() as { c: number }
						).c;
					} catch {
						memoriesIgnored = 0;
					}
					try {
						memoriesArchived = (
							store
								.prepare(
									"SELECT COUNT(*) as c FROM memories WHERE status = 'archived'",
								)
								.get() as { c: number }
						).c;
					} catch {
						memoriesArchived = 0;
					}
					// v0.6.0 (K6-024) — v0.6 fields: schema version, curation
					// switch, the two emission states (three-state, same
					// contract as kevin_audit K6-023) and the pending
					// proposal count. Omitted on pre-007 databases (best-
					// effort, same omission contract as kevin_audit's
					// channels/curation blocks): a status that cannot answer
					// "what is the curation pipeline doing?" must not fake it.
					let v06:
						| {
								schema_version: string;
								curation_enabled: string;
								skill_emission: "on" | "off" | "unavailable";
								reference_emission: "on" | "off" | "unavailable";
								proposals_pending: number;
						  }
						| undefined;
					try {
						store.prepare("SELECT 1 FROM curation_proposals LIMIT 1").get();
						const versionRow = store
							.prepare(
								"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
							)
							.get() as { version: string } | undefined;
						const settingsRows = store
							.prepare("SELECT key, value FROM kevin_settings")
							.all() as { key: string; value: string }[];
						const statusSettings: Record<string, string> = {};
						for (const r of settingsRows) {
							statusSettings[r.key] = r.value;
						}
						const emission = (
							capable: boolean,
							value: string | undefined,
						): "on" | "off" | "unavailable" => {
							if (!capable) return "unavailable";
							return value === "1" ? "on" : "off";
						};
						const pendingRow = store
							.prepare(
								"SELECT COUNT(*) as c FROM curation_proposals WHERE status = 'pending'",
							)
							.get() as { c: number };
						v06 = {
							schema_version: versionRow?.version ?? "000",
							curation_enabled: statusSettings.curation_enabled ?? "0",
							skill_emission: emission(
								capabilities.skills,
								statusSettings.skill_emission_enabled,
							),
							reference_emission: emission(
								capabilities.references,
								statusSettings.reference_emission_enabled,
							),
							proposals_pending: pendingRow.c,
						};
					} catch {
						v06 = undefined;
					}
					let v07:
						| {
								schema_version: string;
								facts_scanned: number;
								open_conflicts: number;
								penalized_memories: number;
								error_lesson_mode: string;
						  }
						| undefined;
					try {
						v07 = {
							schema_version:
								(
									store
										.prepare(
											"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
										)
										.get() as { version: string } | undefined
								)?.version ?? "000",
							facts_scanned: metrics.get("repo_facts_scanned"),
							open_conflicts: (
								store
									.prepare(
										"SELECT COUNT(*) AS c FROM memory_conflicts WHERE status = 'open'",
									)
									.get() as { c: number }
							).c,
							penalized_memories: metrics.get("memories_contradicted"),
							error_lesson_mode: memoryService.getSetting(
								"error_lesson_mode",
								"all",
							),
						};
					} catch {
						v07 = undefined;
					}
					// v0.8.0 (K8-025 / plan §5.8) — identity and shared-layer
					// fields. repo_id is always a derived hash (never a raw
					// remote URL — the "declared" source pins the .kevin/
					// project.json id, "remote" hashes the normalized origin
					// URL, "path" falls back to the project fingerprint).
					// identity_source tells the user which of the three won.
					// shared_layer_enabled is the config key read from
					// kevin_settings (default "0"); shared_entries counts the
					// active (asserted) entries for this repo — best-effort
					// on pre-009 DBs, which have no shared layer at all.
					// BUG-001: the SESSION identity (init-time, moved only by
					// a successful rekey) — not a fresh per-call resolve, so
					// the count always agrees with what kevin_share/kevin_sync
					// actually read and write.
					const identity = sessionIdentity;
					let v08:
						| {
								repo_id: string;
								identity_source: IdentitySource;
								shared_layer_enabled: string;
								shared_entries: number;
						  }
						| undefined;
					try {
						v08 = {
							repo_id: identity.repoId,
							identity_source: identity.source,
							shared_layer_enabled: memoryService.getSetting(
								"shared_layer_enabled",
								"0",
							),
							shared_entries: (
								store
									.prepare(
										"SELECT COUNT(*) AS c FROM shared_entries WHERE repo_id = ? AND op = 'assert'",
									)
									.get(identity.repoId) as { c: number }
							).c,
						};
					} catch {
						v08 = undefined;
					}
					return {
						title: "Estado de Kevin",
						output: JSON.stringify({
							memories: memoryCount.c,
							// v0.6.0 (K6-020) — tool ladder 13 → 16
							// (13 v0.5 + kevin_propose + kevin_approve +
							// kevin_publish). The frozen ladder is verified
							// monotone across releases; K6-024 extends this
							// block with the remaining v0.6 fields. v0.8.0
							// (K8-025) — 18 v0.7 + kevin_project +
							// kevin_native = 23. v1.0.0 (K10-018) — +kevin_contract +kevin_bench = 25.
							// v1.1.0 (K11-007) — +kevin_forget = 26.
							tool_count: 26,
							v07,
							memories_reflector: memoriesReflector,
							memories_agent: memoriesAgent,
							memories_pattern: memoriesPattern,
							memories_causal: memoriesCausal,
							tool_calls: toolCallCount.c,
							retrospectives: retroCount.c,
							metrics: metrics.snapshot(),
							// v0.4.0 (K4-008): precision block. The
							// human-facing "patterns promoted" reading is
							// `patterns_promoted_new` (K4-009 corrected the
							// inflated `patterns_causal` counter; its key
							// stays frozen in metrics for compatibility).
							precision_rate: metrics.precisionRate(),
							injections_total: metrics.get("injections_total"),
							injections_effective: metrics.get("injections_effective"),
							injections_ineffective: metrics.get("injections_ineffective"),
							patterns_promoted_new: metrics.get("patterns_promoted_new"),
							// v0.4.0 (K4-024): per-origin recurrence totals.
							recurrence_by_origin: recurrenceByOrigin,
							// v0.5.0 (K5-021 / plan §5.7) — glassbox fields.
							injections_inconclusive: metrics.get("injections_inconclusive"),
							coverage_rate: metrics.coverageRate(),
							blocked: metrics.blockedSnapshot(),
							memories_ignored: memoriesIgnored,
							memories_archived: memoriesArchived,
							feedback: {
								positive: metrics.get("feedback_positive_total"),
								negative: metrics.get("feedback_negative_total"),
							},
							// v0.6.0 (K6-024) — omitted on pre-007 DBs.
							v06,
							// v0.8.0 (K8-025) — omitted on pre-009 DBs.
							v08,
							// v0.9.0 (K9-008 / plan §5.1) — one-line host
							// summary: version, flavour, shell, v2 flags;
							// no paths, no ids (charset-safe for log lines).
							host_summary: summarize(host),
						}),
					};
				},
			}),
			kevin_project: tool({
				description:
					"Identidad de repositorio (v0.8.0, K8-008/009 / plan §5.8): show reporta repoId, source, evidence, projectId, los conteos de memorias bajo cada scope y rekey_available (true cuando el corpus esta almacenado bajo un scope distinto del resuelto); init escribe .kevin/project.json fijando el id derivado (refusa si ya existe); rekey mueve el corpus entero al repo_id resuelto en UNA transaccion — sin confirm: true es un dry run que no muta nada, y la colision monorepo se rechaza salvo force: true.",
				args: {
					action: tool.schema.enum(["show", "init", "rekey"]),
					confirm: tool.schema.boolean().optional(),
					force: tool.schema.boolean().optional(),
				},
				async execute(args) {
					// v0.8.0 (K8-008) — identity resolves against the boot
					// project root (the directory the plugin was wired with),
					// never against the host's cwd.
					const identity = RepoIdentity.resolve(projectRoot);
					if (args.action === "init") {
						const res = RepoIdentity.initProjectFile(projectRoot, writer);
						return {
							title: "Kevin project.json",
							output: JSON.stringify(
								res.ok
									? {
											action: "init",
											written: true,
											path: res.path,
											id: res.id,
											created_at: res.createdAt,
											generator: "opencode-kevin/0.9.0",
										}
									: {
											action: "init",
											written: false,
											path: res.path,
											reason: res.reason,
										},
							),
						};
					}
					if (args.action === "rekey") {
						// v0.8.0 (K8-009 / plan §5.1, D8-03) — the only call
						// site of performRekey in this codebase (asserted by
						// source scan in the K8-009 acceptance).
						const res = performRekey(store, identity.repoId, {
							confirm: args.confirm === true,
							force: args.force === true,
						});
						// v0.8.0 (BUG-002) — a successful rekey moves the
						// rows to the freshly resolved id; the session must
						// follow, or kevin_share/kevin_sync/retrieval stay
						// scoped on the old id until a restart. The bridge,
						// MemoryService and Curator are rebuilt on the new id
						// in the same breath the rows move — there is never
						// a window in which the session and the store
						// disagree. A dry run or a refusal mutates nothing.
						if (res.ok && !res.dry_run) {
							const live = RepoIdentity.resolve(projectRoot);
							sessionIdentity = live;
							memoryService.setRepoId(live.repoId);
							sharedLayer = new SharedLayer({
								store,
								repoId: live.repoId,
								projectId: live.projectId,
								version: KEVIN_VERSION,
								writer,
							});
							curator = new Curator(
								store,
								memoryService,
								projectId,
								metrics,
								live.repoId,
								kevinEnv,
							);
							// v0.8.0 (BUG-003) — heal the OKF file header.
							// Rekey changes the scope the file is written
							// under; a stale `#repo` first line would make
							// every later planExport/planTombstone refuse
							// with repo_mismatch forever. The heal lives in
							// SharedLayer so the whole-file construction
							// stays at its single allowed site (D8-08).
							try {
								sharedLayer.healHeader(
									join(
										projectRoot,
										memoryService.getSetting(
											"okf_path",
											".kevin/knowledge.okf",
										),
									),
									live.repoId,
								);
							} catch {
								// Missing or unreadable file — nothing to heal.
							}
						}
						return {
							title: "Kevin project rekey",
							output: JSON.stringify(res),
						};
					}
					// show.
					const withRepoColumn = hasRepoIdColumn(store);
					const memoriesTotal = (
						store.prepare("SELECT COUNT(*) AS c FROM memories").get() as {
							c: number;
						}
					).c;
					const memoriesUnderRepo = withRepoColumn
						? (
								store
									.prepare(
										"SELECT COUNT(*) AS c FROM memories WHERE repo_id = ?",
									)
									.get(identity.repoId) as { c: number }
							).c
						: 0;
					const memoriesUnderProject = (
						store
							.prepare(
								"SELECT COUNT(*) AS c FROM memories WHERE project_id = ?",
							)
							.get(identity.projectId) as { c: number }
					).c;
					// v0.8.0 (K8-008) — rekey_available: rows whose current
					// scope differs from the resolved repo_id. On an
					// unmigrated corpus the stored scope is project_id, so a
					// git remote present (repoId != path fingerprint) reports
					// true without the 009 column existing.
					const differentlyScoped = withRepoColumn
						? (
								store
									.prepare(
										"SELECT COUNT(*) AS c FROM memories WHERE repo_id IS NOT NULL AND repo_id != ?",
									)
									.get(identity.repoId) as { c: number }
							).c
						: (
								store
									.prepare(
										"SELECT COUNT(*) AS c FROM memories WHERE project_id IS NOT NULL AND project_id != ?",
									)
									.get(identity.repoId) as { c: number }
							).c;
					return {
						title: "Identidad de repositorio",
						output: JSON.stringify({
							action: "show",
							repo_id: identity.repoId,
							source: identity.source,
							evidence: identity.evidence,
							project_id: identity.projectId,
							memories_total: memoriesTotal,
							memories_repo_id: memoriesUnderRepo,
							memories_project_id: memoriesUnderProject,
							rekey_available: differentlyScoped > 0,
							project_json: existsSync(
								join(projectRoot, ".kevin", "project.json"),
							)
								? "present"
								: "absent",
						}),
					};
				},
			}),
			kevin_audit: tool({
				description:
					'Auditoria de solo lectura de la DB (v0.5.0, glassbox; v0.6.0 añade channels y curation): memorias por status/origin/type, salud de inyecciones (precision/coverage), contadores bloqueados, feedback por verdicto, tokens inyectados, comparativa push vs pull (channels) y scoreboard de curacion (curation). Sin writes, sin LLM. En DBs pre-006 devuelve los bloques computables con "partial": true; en pre-007 omite channels y curation. verbose añade el bloque settings.',
				args: {
					verbose: tool.schema.boolean().default(false),
				},
				async execute(args) {
					// v0.6.0 (K6-023 / plan §5.8) — capabilities come from the
					// probe() run ONCE at init, so kevin_audit can report the
					// three emission states ("unavailable" vs "off" vs "on").
					// v0.7.0 (K7-019 / K7-006) — projectId scopes the `truth`
					// block; on a pre-008 DB the block is omitted, partial:true.
					// v0.8.0 (K8-007 / plan §5.7) — the penalized-memory rollup
					// scopes on repoId once the 009 column exists.
					const report = buildAudit(
						store,
						metrics,
						capabilities,
						projectId,
						sessionIdentity.repoId,
						undefined,
						kevinEnv,
					);
					const payload = args.verbose
						? report
						: { ...report, settings: undefined };
					return {
						title: "Auditoria de Kevin",
						output: JSON.stringify(payload),
					};
				},
			}),
			// v0.9.0 (K9-018 / plan §5.5, D9-09) — kevin_doctor: pure
			// reads, no writes, no probe re-run, no model call. The host
			// block comes from the frozen init-time probe, hooks from the
			// persisted hook_liveness table, native from the last
			// registration per surface, verdict from reduceVerdict.
			kevin_doctor: tool({
				description:
					"Doctor de Kevin (v0.9.0): salud del host, hooks, dependencias y registros nativos. Solo lectura, sin LLM ni writes, invocable en cualquier momento. Devuelve host (version, flavour, shell, v2), hooks ordenados dead primero, dependencies (zod_copies), native (enabled, registered/verified por surface), verdict (healthy|degraded|unknown) y reason. Output pensado para pegar en un issue: sin filesystem paths ni session ids.",
				args: {},
				async execute() {
					const report = buildDoctor(store, host, memoryService, {}, kevinEnv);
					return {
						title: "Doctor de Kevin",
						output: JSON.stringify(report),
					};
				},
			}),
			// v0.9.0 (K9-019 / plan §5.5, D9-12) — kevin_native: inspect
			// and toggle native_registration_enabled. enable/disable write
			// kevin_settings only and never re-attach — the probe is
			// frozen for the process lifetime, so a restart is the
			// requirement for the change to take effect. `enable` on a
			// host without the v2 subpath succeeds and reports the
			// registration as inert: the setting is a statement of intent.
			kevin_native: tool({
				description:
					"Registros nativos v2 (v0.9.0): show reporta el setting native_registration_enabled, si el host resuelto expone el subpath v2 (effective) y las ultimas filas de native_registrations por surface; enable/disable escriben el setting ('1'/'0' TEXT) y NO re-adjuntan — el probe es frozen para la vida del proceso, un restart del host es el requisito para que el cambio tenga efecto; enable en un host sin subpath v2 exito con registration inert.",
				args: {
					action: tool.schema
						.enum(["show", "enable", "disable"])
						.default("show"),
				},
				async execute(args) {
					const report = handleNative(args.action, {
						host,
						store,
						settings: memoryService,
					});
					return {
						title: "Kevin native",
						output: JSON.stringify(report),
					};
				},
			}),
			// v1.0.0 (K10-018 / plan §5.6) — kevin_contract: the frozen
			// surface, inspectable at runtime rather than only at test
			// time. Read-only; summary by default, one clause's full value
			// with clause+format:'full'. Unknown clause ids are a
			// structured error, never a throw.
			kevin_contract: tool({
				description:
					"Contrato publico de Kevin (v1.0.0): version, digest y por clausula id/titulo/estabilidad/since/deprecacion. clause:'C-0N' con format:'full' retorna el valor completo de esa clausula (marcadores, tool names, settings keys, metric keys, entry points, schema, invariantes). Solo lectura, sin LLM ni red.",
				args: {
					clause: tool.schema
						.string()
						.optional()
						.describe("Id de clausula (ej. 'C-01'). Sin clause: resumen."),
					format: tool.schema
						.enum(["summary", "full"])
						.optional()
						.describe(
							"summary (default): una linea por clausula. full: valores completos (requiere clause para una clausula; solo devuelve resumen enriquecido si se omite).",
						),
				},
				async execute(args) {
					const result = buildKevinContract(
						{ packageVersion: KEVIN_VERSION },
						args,
					);
					return {
						title: "Contrato de Kevin",
						output: JSON.stringify(result),
					};
				},
			}),
			// v1.0.0 (K10-019 / plan §5.6) — kevin_bench: reports what
			// `npm run bench` recorded in bench_runs. It NEVER runs the
			// benchmark from inside a live session.
			kevin_bench: tool({
				description:
					"Resultados del benchmark de retrieval (v1.0.0). status: si hay corridas, digest del corpus mas reciente y si coincide con el corpus en disco. last: los cuatro brazos (none/recent-k/random-k/kevin) con precision@5, recall@5 y MRR de la ultima corrida. NUNCA ejecuta el benchmark — corre 'npm run bench' fuera de la sesion.",
				args: {
					action: tool.schema
						.enum(["status", "last"])
						.describe("status | last"),
				},
				async execute(args) {
					const result = buildKevinBench({ store }, args, kevinEnv);
					return {
						title: "Benchmark de Kevin",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_retrospective: tool({
				description:
					"Genera un retrospective markdown para una sesion (resume tools que fallaron y lecciones aprendidas).",
				args: {
					session_id: tool.schema.string().optional(),
				},
				async execute(args) {
					const sid = args.session_id ?? currentSessionId;
					if (!sid) {
						return {
							title: "Retrospective omitido",
							output: JSON.stringify({
								message:
									"No hay session_id activo. Pasa session_id explicitamente.",
							}),
						};
					}
					const filePath = await retrospective.generate(sid);
					return filePath
						? {
								title: "Retrospective generado",
								output: JSON.stringify({ file_path: filePath }),
							}
						: {
								title: "Retrospective omitido",
								output: JSON.stringify({
									message:
										"No hubo fallos en la sesion; nada que retrospectar.",
								}),
							};
				},
			}),
			kevin_why: tool({
				description:
					"Explica por que Kevin recuerda un hecho (v0.3.0). Retorna summary, confidence, trace de eventos y related_rules.",
				args: {
					query: tool.schema.string().min(1),
				},
				async execute(args) {
					const result = kevinWhy(store, args.query);
					if (!result) {
						return {
							title: "Sin explicacion",
							output: JSON.stringify({
								message: `No causal patterns found for "${args.query}".`,
							}),
						};
					}
					return {
						title: "Explicacion causal",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_feedback: tool({
				description:
					"Reporta juicio humano sobre una memoria (v0.5.0). verdict: useful | wrong | outdated | ignore. 'ignore' excluye la memoria de retrieval e inyeccion (D5-07); los demas ajustan confidence via computeConfidence (D5-02).",
				args: {
					memory_id: tool.schema.string().min(1),
					verdict: tool.schema
						.enum(["useful", "wrong", "outdated", "ignore"])
						.describe(
							"useful: la memoria ayudo. wrong: era incorrecta. outdated: ya no aplica. ignore: no volver a mostrarla.",
						),
					note: tool.schema.string().optional(),
					session_id: tool.schema.string().optional(),
				},
				async execute(args) {
					const memory = memoryService.getById(args.memory_id);
					if (!memory) {
						return {
							title: "Feedback no registrado",
							output: JSON.stringify({
								message: `No memory found for id "${args.memory_id}".`,
							}),
						};
					}
					try {
						const feedbackId = feedback.record({
							memoryId: args.memory_id,
							verdict: args.verdict,
							sessionId: args.session_id ?? currentSessionId ?? null,
							note: args.note,
						});
						const counts = feedback.countsFor(args.memory_id);
						return {
							title: "Feedback registrado",
							output: JSON.stringify({
								feedback_id: feedbackId,
								memory_id: args.memory_id,
								verdict: args.verdict,
								counters: counts,
								ignored:
									args.verdict === "ignore" ? true : memory.ignored === true,
							}),
						};
					} catch (err) {
						return {
							title: "Feedback no registrado",
							output: JSON.stringify({
								message: err instanceof Error ? err.message : String(err),
							}),
						};
					}
				},
			}),
			kevin_trace: tool({
				description:
					"Predice que memorias se inyectarian en el prompt para una query (v0.5.0, dry-run estricto). Retorna el plan: items admitidos/bloqueados con su razon, tokens totales estimados. NO inyecta, NO mueve contadores, NO muta el seen-set, NO hace bump de relevancia (D5-08). Si omites query, usa la ultima query derivada de la sesion.",
				args: {
					query: tool.schema.string().optional(),
					session_id: tool.schema.string().optional(),
					tag: tool.schema
						.enum(["context", "memory"])
						.default("context")
						.describe(
							"context = pre-prompt (cap por setting pre_prompt_budget_tokens, default 900), memory = compacting (cap 2000)",
						),
					cap: tool.schema.number().int().positive().optional(),
				},
				async execute(args) {
					const sid = args.session_id ?? currentSessionId ?? "";
					const query =
						args.query ??
						(sid ? (lastUserQueryBySession.get(sid) ?? null) : null) ??
						lastUserQuery;
					if (!query) {
						return {
							title: "Trace sin query",
							output: JSON.stringify({
								message:
									"No query derivada disponible. Pasa query explicitamente.",
							}),
						};
					}
					const plan = injector.plan(query, {
						tag: args.tag,
						cap: args.cap,
						sessionId: sid,
					});
					return {
						title: "Plan de inyeccion (dry-run)",
						output: JSON.stringify(plan),
					};
				},
			}),
			kevin_export: tool({
				description:
					"Exporta memorias curadas (decision, rule, pattern) como markdown, OKF o MIF (v1.5.0). v0.3.0.",
				args: {
					format: tool.schema
						.enum(["okf", "markdown", "mif"])
						.default("okf")
						.describe("okf | markdown | mif"),
					redact_pii: tool.schema.boolean().optional().default(false).describe("Cuando true, aplica redaccion SECRET_PATTERNS sobre el contenido (MIF honour-when-flagged, defecto false para preservar 1.x)"),
				},
				async execute(args) {
					// v1.5.0 (K15-009) — MIF branch
					if ((args.format as string) === "mif") {
						const { toMif } = await import("@jmtrin/kevin-core");
						const rows = store.prepare("SELECT * FROM memories WHERE status='active'").all() as unknown as import("@jmtrin/kevin-core").Memory[];
						// scope filter to projectId like okf-export does? Use same as exportOkf: filter by project_id = ?
						const scoped = projectId ? rows.filter((r: unknown) => (r as { project_id?: string }).project_id === projectId || (r as { project_id?: string }).project_id === projectId) : rows;
						const envelope = toMif(scoped as never, { redactPii: args.redact_pii === true });
						try { metrics.incr("mif_exports_total" as never, 1); } catch {}
						return { title: "Export completado", output: JSON.stringify(envelope, null, 2) };
					}
					const output =
						args.format === "markdown"
							? exportMarkdown(store, projectId)
							: exportOkf(store, projectId);
					return {
						title: "Export completado",
						output,
					};
				},
			}),
			kevin_import: tool({
				description:
					"Importa un bundle markdown de conocimiento (v0.3.0) o MIF / host memories (v2.0.0 retira import_host_memory; requiere sources_enabled=1 + source_claude_memory/codex-memories=1).",
				args: {
					bundle: tool.schema.string().optional(),
					format: tool.schema.enum(["okf", "markdown", "mif"]).optional().describe("okf | markdown | mif (mif requiere bundle JSON)"),
					source: tool.schema.enum(["bundle", "claude-memory", "codex-memories"]).optional().describe("bundle (default) | claude-memory | codex-memories (requiere gate)"),
				},
				async execute(args) {
					const src = (args.source as string) ?? "bundle";
					if (src === "claude-memory" || src === "codex-memories") {
						const { importHostMemories } = await import("@jmtrin/kevin-core");
						const report = importHostMemories({ store, memoryService, metrics: metrics as unknown as import("@jmtrin/kevin-core").Metrics, env: kevinEnv, source: src as "claude-memory" | "codex-memories" });
						if (report.error === "disabled") {
							return { title: "Import no realizado (gate deshabilitado)", output: JSON.stringify({ error: "disabled", hint: report.hint }) };
						}
						return { title: "Import completado", output: JSON.stringify(report) };
					}
					if ((args.format as string) === "mif") {
						if (!args.bundle) return { title: "Import error", output: JSON.stringify({ error: "missing_bundle", hint: "bundle requerido para formato mif" }) };
						try {
							const env = JSON.parse(args.bundle);
							const { fromMif } = await import("@jmtrin/kevin-core");
							const { candidates } = fromMif(env);
							let imported = 0;
							let duplicates = 0;
							for (const c of candidates) {
								const fp = c.content ? (await import("@jmtrin/kevin-core")).fingerprint(c.content) : "";
								const exists = store.prepare("SELECT 1 FROM memories WHERE fingerprint = ? LIMIT 1").get(fp);
								if (exists) { duplicates++; continue; }
								memoryService.save({ type: (c.type as "context"|"rule"|"pattern"|"decision") ?? "context", content: c.content, scope: "project", origin: "imported", fingerprint: fp, metadata: c.metadata as unknown as Record<string, unknown> });
								imported++;
							}
							try { metrics.incr("mif_imports_total" as never, 1); } catch {}
							return { title: "Import completado", output: JSON.stringify({ imported, duplicates, unknownFieldsPreserved: candidates[0]?.unknownFields ? Object.keys(candidates[0].unknownFields) : [] }) };
						} catch (e) {
							return { title: "Import error", output: JSON.stringify({ error: "bad_json", message: (e as Error).message }) };
						}
					}
					if (!args.bundle) return { title: "Import error", output: JSON.stringify({ error: "missing_bundle" }) };
					const result = importOkf(args.bundle, memoryService);
					return {
						title: "Import completado",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_sources: tool({
				description:
					"Fuentes de memoria (v2.0.0): lista estado de cada MemorySource (enabled, precedence, last_sync). Solo lectura.",
				args: {
					action: tool.schema.enum(["list"]).default("list").describe("list"),
				},
				async execute(_args) {
					const settings: Record<string, string> = {};
					try {
						const rows = store
							.prepare(
								"SELECT key, value FROM kevin_settings WHERE key LIKE 'source%' OR key='sources_enabled' OR key='okf_write_version'",
							)
							.all() as { key: string; value: string }[];
						for (const r of rows) settings[r.key] = r.value;
					} catch {}
					let sources: unknown[] = [];
					try {
						sources = store
							.prepare(
								"SELECT name, enabled, precedence FROM memory_sources ORDER BY precedence",
							)
							.all();
					} catch {
						sources = [
							{ name: "opencode-plugin", enabled: 1, precedence: 10 },
							{
								name: "claude-memory",
								enabled: Number(
									settings["source_claude_memory"] === "1" ? 1 : 0,
								),
								precedence: 20,
							},
							{
								name: "codex-memories",
								enabled: Number(
									settings["source_codex_memories"] === "1" ? 1 : 0,
								),
								precedence: 30,
							},
							{
								name: "opencode-native",
								enabled: Number(
									settings["source_opencode_native"] === "1" ? 1 : 0,
								),
								precedence: 40,
							},
						];
					}
					return {
						title: "Fuentes de memoria",
						output: JSON.stringify({
							sources_enabled: settings["sources_enabled"] ?? "1",
							sources,
						}),
					};
				},
			}),
			kevin_config: tool({
				description:
					"Lee o modifica settings de Kevin sin SQL (v0.4.0). list: todas las settings de kevin_settings. set: upsert de una key conocida (rechaza keys desconocidas salvo strict:false).",
				args: {
					action: tool.schema.enum(["list", "set"]).describe("list | set"),
					key: tool.schema
						.string()
						.optional()
						.describe("Clave a modificar (action=set)."),
					value: tool.schema
						.string()
						.optional()
						.describe("Nuevo valor (action=set). Default '1'."),
					strict: tool.schema
						.boolean()
						.default(true)
						.optional()
						.describe(
							"Con strict=true (default) se rechazan keys desconocidas.",
						),
				},
				async execute(args) {
					if (args.action === "list") {
						const rows = store
							.prepare("SELECT key, value FROM kevin_settings ORDER BY key")
							.all() as { key: string; value: string }[];
						const settings: Record<string, string> = {};
						for (const r of rows) settings[r.key] = r.value;
						return {
							title: "Configuracion de Kevin",
							output: JSON.stringify(settings),
						};
					}
					if (!args.key) {
						return {
							title: "kevin_config",
							output: JSON.stringify({
								error: "missing_key",
								action: "set",
							}),
						};
					}
					// v2.0.0 (K16-004) — removed keys return structured removed_in_2.0.0 before unknown_key
					if (args.key in REMOVED_SETTINGS) {
						const meta =
							REMOVED_SETTINGS[
								args.key as keyof typeof REMOVED_SETTINGS
							];
						return {
							title: "kevin_config",
							output: JSON.stringify({
								error: "removed_in_2.0.0",
								key: args.key,
								replacement: meta.replacement,
								since: meta.since,
							}),
						};
					}
					const known = (KEVIN_CONFIG_KEYS as readonly string[]).includes(
						args.key,
					);
					if (!known && args.strict !== false) {
						return {
							title: "kevin_config",
							output: JSON.stringify({
								error: "unknown_key",
								key: args.key,
								known_keys: [...KEVIN_CONFIG_KEYS],
							}),
						};
					}
					const value = args.value ?? "1";
					// v0.7.0 (K7-003 / plan §5.6, D7-12) — `error_lesson_mode`
					// is a TEXT enum with a tiny explicit domain. Reject a
					// value outside `all` / `triage_only` with a structured
					// error so a typo cannot silently change every
					// installation's reflection behaviour.
					if (args.key === "error_lesson_mode") {
						const allowed = ERROR_LESSON_MODE_VALUES as readonly string[];
						if (!allowed.includes(value)) {
							return {
								title: "kevin_config",
								output: JSON.stringify({
									error: "invalid_value",
									key: args.key,
									value,
									allowed_values: allowed,
								}),
							};
						}
					}
					store
						.prepare(
							`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
							 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
						)
						.run(args.key, value);
					return {
						title: "kevin_config",
						output: JSON.stringify({ ok: true, key: args.key, value }),
					};
				},
			}),
			kevin_facts: tool({
				description:
					"Reporta la verdad del repositorio (v0.7.0): los hechos escaneados del proyecto actual y las memorias de-rankadas por contradiccion, con penalti y razones. refresh:true fuerza un re-scan (salta el skip de mtime); por defecto lee los hechos almacenados. Solo lectura salvo el re-scan opcional. Sin LLM ni red.",
				args: {
					refresh: tool.schema
						.boolean()
						.default(false)
						.optional()
						.describe(
							"true: fuerza el re-scan de package.json/tsconfig.json. false (default): lee hechos almacenados.",
						),
				},
				async execute(args) {
					const result = buildKevinFacts(
						{ store, memoryService, repoTruth, projectId },
						args.refresh ?? false,
					);
					return {
						title: "Hechos del repositorio (v0.7.0)",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_conflicts: tool({
				description:
					"Lista, reconoce o resuelve conflictos detectados de Kevin.",
				args: {
					action: tool.schema.enum(["list", "acknowledge", "resolve"]),
					id: tool.schema.string().optional(),
					keep: tool.schema.string().optional(),
					status: tool.schema
						.enum(["open", "acknowledged", "resolved"])
						.optional(),
				},
				async execute(args) {
					const result = executeKevinConflicts(
						{ store, detector: conflictDetector, projectId },
						args.action,
						args.id,
						args.keep,
						args.status,
					);
					return {
						title: "Conflictos de Kevin",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_propose: tool({
				description:
					"Genera propuestas de curacion (dry-run estricto, v0.6.0): crea filas pending y retorna sus diffs unificados. NO escribe en disco, NO marca memorias curadas (D5-08/D6-01).",
				args: {
					kind: tool.schema
						.enum(["agents_md", "skill", "reference"])
						.default("agents_md")
						.describe(
							"agents_md: bloque en AGENTS.md. skill/reference: canales pull (v0.6.0).",
						),
				},
				async execute(args) {
					const result = kevinPropose(curator, writer, args.kind);
					return {
						title: "Propuestas de curacion (dry-run)",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_publish: tool({
				description:
					"Regenera los bundles pull bajo ~/.opencode-kevin/ (v0.6.0): skills/project-knowledge.md y refs/<topic>.md. Reporta por bundle el outcome (written/noop/refused) y el estado de emision (on/off/unavailable). Solo escribe via ArtifactWriter y solo a paths del Materializer (D6-07); agents_md_path es inalcanzable.",
				args: {},
				async execute() {
					const result = kevinPublish({
						materializer,
						writer,
						memoryService,
						capabilities,
					});
					return {
						title: "Bundles publicados",
						output: JSON.stringify(result),
					};
				},
			}),
			// v1.1.0 (K11-007 / plan §5.1, D11-02) — kevin_forget: closes the sharing lifecycle.
			kevin_forget: tool({
				description:
					"Olvida memorias y publica tombstones en la capa compartida (v1.1.0, K11-005/006 / plan §5.1): dry-run por defecto — sin confirm no muta nada y devuelve el plan (archived, tombstone planned); con confirm:true archiva localmente (status='archived') y, cuando la memoria proyecta a la capa compartida (layer='shared' o shared_entry_id), publica un tombstone via el unico write path (SharedLayer.applyExport, D8-08). Segunda invocacion identica reporta noop.",
				args: {
					ids: tool.schema.array(tool.schema.string()).min(1),
					confirm: tool.schema.boolean().optional(),
				},
				async execute(args) {
					const okfPath = join(
						projectRoot,
						memoryService.getSetting("okf_path", ".kevin/knowledge.okf"),
					);
					const result = handleForget(
						{ ids: args.ids, confirm: args.confirm },
						{ store, memoryService, sharedLayer, okfPath, metrics },
					);
					return {
						title: result.dry_run
							? "Plan de olvido (dry-run)"
							: "Olvido aplicado",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_approve: tool({
				description:
					"Aprueba o rechaza una propuesta de curacion (v0.6.0). reject: marca rejected, nada toca disco. approve: aplica el diff (unico call site de ArtifactWriter.apply, D6-01), marca applied y cura las memorias contribuyentes. Solo acepta propuestas pending.",
				args: {
					proposal_id: tool.schema.string().min(1),
					decision: tool.schema
						.enum(["approve", "reject"])
						.default("approve")
						.describe("approve | reject"),
				},
				async execute(args) {
					const result = kevinApprove(
						store,
						memoryService,
						curator,
						writer,
						metrics,
						{
							proposalId: args.proposal_id,
							decision: args.decision,
						},
					);
					return {
						title:
							"status" in result && result.status === "rejected"
								? "Propuesta rechazada"
								: "status" in result && result.status === "applied"
									? "Propuesta aplicada"
									: "Propuesta no procesada",
						output: JSON.stringify(result),
					};
				},
			}),
			// v0.8.0 (K8-021 / plan §5.5) — kevin_share. The dry run is the
			// default: nothing is written until the diff is shown. The
			// write itself goes through the single funnel (applyExport),
			// and shared_entries_exported counts only entries actually
			// added to the file.
			kevin_share: tool({
				description:
					"Comparte memorias locales al archivo OKF compartido (v0.8.0, K8-021 / plan 5.5): dry-run por defecto - sin memory_ids selecciona toda memoria curated=1 en o sobre shared_confidence_floor no ya compartida, y devuelve el plan con su diff sin escribir nada. confirm: true escribe via el unico write path (ArtifactWriter, D8-08); con share_requires_approval='1' (default) ademas se requiere confirm para escribir y las memorias no curadas se rechazan con not_curated; las que no alcanzan el floor se rechazan con below_floor; compartir la misma memoria dos veces es un noop en el segundo intento. Nunca escribe otro fichero que no sea okf_path.",
				args: {
					memory_ids: tool.schema.array(tool.schema.string()).optional(),
					dry_run: tool.schema.boolean().optional(),
					confirm: tool.schema.boolean().optional(),
				},
				async execute(args) {
					const okfPath = join(
						projectRoot,
						memoryService.getSetting("okf_path", ".kevin/knowledge.okf"),
					);
					const requiresApproval =
						memoryService.getSetting("share_requires_approval", "1") === "1";
					const dryRun = args.dry_run ?? true;
					const confirm = args.confirm ?? false;
					const floor = Number.parseFloat(
						memoryService.getSetting("shared_confidence_floor", "0.7"),
					);
					const clampedFloor = Number.isNaN(floor)
						? 0.7
						: Math.min(1, Math.max(0, floor));

					const ids: string[] =
						args.memory_ids !== undefined && args.memory_ids.length > 0
							? args.memory_ids
							: (
									store
										.prepare(
											`SELECT id, evidence_count, recurrence_count
											 FROM memories
											 WHERE layer = 'local' AND curated = 1
											   AND shared_entry_id IS NULL AND repo_id = ?`,
										)
										.all(sessionIdentity.repoId) as Array<{
										id: string;
										evidence_count: number | null;
										recurrence_count: number | null;
									}>
								)
									.filter(
										(row) =>
											computeConfidence(
												row.evidence_count ?? 0,
												row.recurrence_count ?? 0,
											) >= clampedFloor,
									)
									.map((row) => row.id);

					const plan = sharedLayer.planExport(ids, okfPath);
					if (plan.write.outcome === "refused") {
						return {
							title: "Exportacion rechazada",
							output: JSON.stringify({
								refused: plan.write.reason,
								okf_path: okfPath,
							}),
						};
					}
					const base = {
						memory_ids: ids,
						entries_added: plan.entriesAdded,
						okf_path: okfPath,
						diff: plan.write.diff,
					};
					if (dryRun) {
						return {
							title: "Plan de exportacion (dry-run)",
							output: JSON.stringify({ ...base, dry_run: true }),
						};
					}
					if (requiresApproval && !confirm) {
						return {
							title: "Confirmacion requerida",
							output: JSON.stringify({
								...base,
								dry_run: true,
								confirm_required: true,
							}),
						};
					}
					// The writer's atomic temp file lives next to the target,
					// so the .kevin directory must exist before the write
					// (same prep as RepoIdentity.initProjectFile).
					mkdirSync(dirname(okfPath), { recursive: true });
					const applied = sharedLayer.applyExport(plan);
					if (applied.applied === "written") {
						metrics.incr("shared_entries_exported", plan.entriesAdded);
					}
					return {
						title:
							applied.applied === "noop"
								? "Nada nuevo que compartir"
								: "Exportacion aplicada",
						output: JSON.stringify({
							...base,
							outcome: applied.applied,
						}),
					};
				},
			}),
			// v0.8.0 (K8-022 / plan §5.5) — kevin_sync. The name and the
			// scope are deliberately narrow: "sync" means re-reading a
			// file that is already on disk. Manual invocation works
			// regardless of shared_layer_enabled; the automatic idle
			// re-read below is the one gated by the flag.
			kevin_sync: tool({
				description:
					"Re-lee el archivo OKF compartido ya en disco (v0.8.0, K8-022 / plan 5.5): importa las entradas del archivo okf_path al store compartido y reporta el ImportReport (parsed/folded/rejected/imported/tombstoned/skipped). No hay fetch, push, remoto ni polling (D8-01, Principle 30). Funciona con shared_layer_enabled en '0'; la sincronizacion automatica en session.idle esta gated por shared_layer_enabled === '1' y nunca corre en hot paths.",
				args: {},
				async execute() {
					return {
						title: "Sincronizacion compartida",
						output: JSON.stringify(syncSharedLayer()),
					};
				},
			}),
		},

		"tool.execute.before": async (hookInput, output) => {
			// v1.0.0 (K10-012) — perf measures the synchronous hold time;
			// HookLiveness wraps the outside of this handler (compose,
			// never merge — D10-09).
			perf.measure("tool.execute.before", () => {
				rememberToolCall(
					hookInput.callID,
					hookInput.tool,
					output.args as Record<string, unknown> | undefined,
				);
				observer.onBefore(
					{
						tool: hookInput.tool,
						args: output.args as Record<string, unknown>,
						sessionId: hookInput.sessionID,
						callID: hookInput.callID,
						projectId,
					},
					{},
				);
			});
		},

		"tool.execute.after": async (hookInput, output) => {
			perf.measure("tool.execute.after", () => {
				sessionRecordedWork = true;
				// v0.9.0 (K9-010 / plan §5.3) — checkpoint: the session reached a
				// model turn, so the system prompt was assembled and
				// `experimental.chat.system.transform` MUST have been offered.
				// Deduped per session inside HookLiveness.expect.
				if (hookInput.sessionID) {
					liveness.expect(
						"experimental.chat.system.transform",
						hookInput.sessionID,
					);
				}
				const meta = (output.metadata ?? {}) as Record<string, unknown>;
				const outputText = String(output.output ?? "");
				const stderr = String(meta.stderr ?? "");
				const stdout = String(meta.stdout ?? outputText);
				const exitCode = pickExitCode(meta);
				let success: boolean;
				if (meta.success === false) {
					success = false;
				} else if (exitCode !== undefined) {
					success = exitCode === 0;
				} else if (stderr.length > 0 && ERROR_LINE_RE.test(stderr)) {
					success = false;
				} else {
					const stream = stdout.length > 0 ? stdout : outputText;
					success = !(stream.length > 0 && STRONG_ERROR_RE.test(stream));
				}
				observer.onAfter(
					{
						tool: hookInput.tool,
						args: hookInput.args as Record<string, unknown>,
						sessionId: hookInput.sessionID,
						callID: hookInput.callID,
						projectId,
					},
					{ success, stdout, stderr, exitCode },
				);
				if (!success) {
					const errorType = observer.inferErrorType(stderr, stdout, exitCode);
					fireAndForget(
						reflector.invoke({
							toolName: hookInput.tool,
							argsSummary: observer.summarizeArgs(
								hookInput.args as Record<string, unknown>,
							),
							stderr,
							stdout,
							exitCode,
							errorType,
							sessionId: hookInput.sessionID,
							callID: hookInput.callID,
							projectId,
						}),
					);
				} else {
					causalChain.onSuccess(
						hookInput.tool,
						hookInput.args as Record<string, unknown>,
						projectId,
						hookInput.sessionID,
					);
				}
			});
		},

		"chat.message": async (hookInput, output) => {
			const rawText = output.parts
				.map((p) => p as { type?: string; text?: string })
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join(" ");
			const trimmed = rawText.trim();
			// v1.2.0 (K12-018 / D12-09) — chat-command bridge BEFORE deriveQuery.
			// Valid commands are SWALLOWED (parts cleared) and never reach the model.
			// Must run outside perf.measure so early return actually exits the hook.
			if (trimmed.length > 0) {
				try {
					const bridgeDeps = {
						getPending: () => {
							try {
								const maybe = (
									curator as unknown as { pending?: () => unknown[] }
								).pending;
								if (typeof maybe === "function") {
									const rows = maybe.call(curator) as {
										id: string;
										proposed_text?: string;
										proposedText?: string;
									}[];
									return rows.map((p) => ({
										id: p.id,
										proposedText: String(
											p.proposed_text ?? p.proposedText ?? "",
										),
									}));
								}
							} catch {}
							try {
								const rows = store
									.prepare(
										"SELECT id, proposed_text FROM curation_proposals WHERE status = 'pending'",
									)
									.all() as { id: string; proposed_text: string }[];
								return rows.map((r) => ({
									id: r.id,
									proposedText: r.proposed_text,
								}));
							} catch {
								return [];
							}
						},
						approve: (id: string) =>
							kevinApprove(store, memoryService, curator, writer, metrics, {
								proposalId: id,
								decision: "approve",
							}),
						reject: (id: string, note?: string) =>
							kevinApprove(store, memoryService, curator, writer, metrics, {
								proposalId: id,
								decision: "reject",
							}) && void note,
						acknowledge: (conflictId: string) => {
							try {
								const cd = conflictDetector as unknown as {
									acknowledge?: (id: string) => unknown;
									resolve?: (id: string, keep: string) => unknown;
								};
								if (typeof cd.acknowledge === "function")
									cd.acknowledge(conflictId);
								else if (typeof cd.resolve === "function")
									cd.resolve(conflictId, "a");
							} catch {}
						},
						metrics,
					};
					const br = handleBridgeCommand(trimmed, bridgeDeps as never);
					if (br.handled) {
						try {
							(output as { parts: unknown[] }).parts = [];
						} catch {}
						return;
					}
				} catch {
					// best-effort — bridge failure must not break chat flow
				}
			}
			perf.measure("chat.message", () => {
				if (trimmed.length > 0) {
					const derived = injector.deriveQuery([
						{ role: "user", content: rawText },
					]);
					lastUserQuery = derived.length > 0 ? derived : null;
					if (hookInput.sessionID && lastUserQuery) {
						lastUserQueryBySession.set(hookInput.sessionID, lastUserQuery);
					}
				}
			});
		},

		"experimental.chat.system.transform": async (hookInput, output) => {
			perf.measure("chat.system.transform", () => {
				// BUG-011 — prefer the per-session query so a new session whose
				// first transform fires before any chat.message cannot reuse the
				// previous session's query (the global is cleared on idle).
				const query =
					lastUserQueryBySession.get(hookInput.sessionID ?? "") ??
					lastUserQuery;
				if (!query) return;
				const suggestion = injector.generateSuggestion();
				if (suggestion) output.system.push(suggestion);
				injector.onSystemTransform(
					{
						sessionID: hookInput.sessionID ?? undefined,
						messages: [{ role: "user", content: query }],
					},
					output,
				);
			});
		},

		"experimental.session.compacting": async (hookInput, output) => {
			perf.measure("session.compacting", () => {
				// v0.4.0 (K4-018) — plan §5.6: compaction often fires with no
				// recent chat.message (auto-compact after a long tool turn,
				// resumed sessions). Resolve a query per session first, then
				// the global fallback, then any messages the runtime may
				// provide (defensive — the current SDK contract only exposes
				// sessionID).
				// BUG-012 — the HITL suggestion fires AT MOST ONCE per session:
				// whichever hook (transform or compacting) runs first consumes
				// the pending recurrence signal (generateSuggestion resets it).
				const suggestion = injector.generateSuggestion();
				if (suggestion) output.context.push(suggestion);
				const sid = hookInput.sessionID;
				const sessionQuery = lastUserQueryBySession.get(sid) ?? lastUserQuery;
				const runtimeMessages = (hookInput as { messages?: ChatMessage[] })
					.messages;
				const messages =
					sessionQuery != null
						? [{ role: "user" as const, content: sessionQuery }]
						: (runtimeMessages ?? []);
				injector.onCompacting(
					{
						sessionID: sid,
						messages,
					},
					output,
				);
			});
		},

		event: async ({ event }: { event: unknown }) => {
			const type = (event as { type?: string }).type;
			const props =
				(event as { properties?: Record<string, unknown> }).properties ?? {};
			if (type === "session.idle") {
				// v1.0.0 (K10-012) — the idle branch measures under
				// "session.idle" (150/600 ms budget); every other branch
				// measures under "event" (5/25 ms). Recording idle's ~150 ms
				// under "event" would make that budget permanently breached
				// and therefore ignored.
				const sid = props.sessionID as string | undefined;
				await perf.measureAsync("session.idle", async () => {
					if (sid) {
						toolCache.clear();
						// BUG-011 — the session is done: drop the global query
						// so the next session cannot reuse it.
						lastUserQuery = null;
						// K13-010 (D13-07) — single ORDER via composeIdlePipeline.
						// Ledger/archiver/reflectors/pattern are the hand-synced core;
						// adapter and replay both consume IDLE_STEP_ORDER so re-order is visible in both.
						await composeIdlePipeline({
							"ledger.settle": () => { ledger.settle(sid); },
							"archiver.run": () => { archiver.run(); },
							retrospective: () => {
								fireAndForget(retrospective.generate(sid));
							},
							"reflectors.boost": () => { memoryService.boostPositiveReflectors(sid); },
							"reflectors.penalize": () => {
								const recurred = memoryService.penalizeRecurringReflectors(sid);
								injector.setRecurrences(recurred, sid);
							},
							"patternMiner.mine": () => { patternMiner.mine(projectId); },
						});
						// v0.7.0 (K7-012/K7-016) + causalChain — folded into the single ORDER via composeIdlePipeline (K13-010)
						await composeIdlePipeline({
							"conventionMiner.mine": () => {
								if (memoryService.getSetting("convention_mining_enabled", "0") === "1") {
									const conventions = conventionMiner.mine();
									conventionMiner.emit(conventions);
								}
							},
							"conflictDetector.detect": () => {
								if (memoryService.getSetting("conflict_detection_enabled", "0") === "1") {
									conflictDetector.detect();
								}
							},
							"causalChain.onSessionIdle": () => {
								fireAndForget(Promise.resolve().then(() => causalChain.onSessionIdle(sid)).catch(() => {}));
							},
						});
						// v1.2.0 (K12-007/K12-011 / D12-05) — TUI mailbox: actions→curate ordering.
						// Process mailbox BEFORE curator.propose so a fresh proposal created this idle
						// is NOT visible to a stale token (D12-04). Best-effort, never breaks idle.
						try {
							const mb = readMailbox(materializerRoot);
							if (mb.actions.length) {
								const tuiDeps = {
									getPending: () => {
										try {
											const maybe = (
												curator as unknown as { pending?: () => unknown[] }
											).pending;
											if (typeof maybe === "function") {
												const rows = maybe.call(curator) as {
													id: string;
													proposed_text?: string;
													proposedText?: string;
												}[];
												return rows.map((p) => ({
													id: p.id,
													proposedText: String(
														p.proposed_text ?? p.proposedText ?? "",
													),
												}));
											}
										} catch {}
										try {
											const rows = store
												.prepare(
													"SELECT id, proposed_text FROM curation_proposals WHERE status = 'pending'",
												)
												.all() as { id: string; proposed_text: string }[];
											return rows.map((r) => ({
												id: r.id,
												proposedText: r.proposed_text,
											}));
										} catch {
											return [];
										}
									},
									approve: (id: string) =>
										kevinApprove(
											store,
											memoryService,
											curator,
											writer,
											metrics,
											{
												proposalId: id,
												decision: "approve",
											},
										),
									reject: (id: string, _note?: string) =>
										kevinApprove(
											store,
											memoryService,
											curator,
											writer,
											metrics,
											{
												proposalId: id,
												decision: "reject",
											},
										),
									acknowledge: (conflictId: string) => {
										const cd = conflictDetector as unknown as {
											acknowledge?: (id: string) => unknown;
										};
										if (typeof cd.acknowledge === "function")
											cd.acknowledge(conflictId);
									},
									metrics,
								};
								const tuiResults = processActions(mb.actions, tuiDeps as never);
								writeResults(materializerRoot, tuiResults);
								deleteMailbox(materializerRoot);
							}
						} catch {
							// best-effort
						}
						// v0.6.0 (K6-015 / plan §8.14) — session-idle curation
						// generation. Dry-run only: `propose()` calls `plan()`
						// and never `apply()`, so nothing here can touch disk
						// (D6-01). Guarded by curation_enabled (TEXT compare)
						// and a 1-hour throttle persisted in kevin_settings.
						try {
							if (memoryService.getSetting("curation_enabled", "1") === "1") {
								const CURATION_THROTTLE_MS = 3_600_000;
								const last = memoryService.getSetting("last_curation_at", "");
								if (
									last === "" ||
									Date.now() - Date.parse(last) > CURATION_THROTTLE_MS
								) {
									curator.propose("agents_md", writer);
									store
										.prepare(
											`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
										 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
										)
										.run("last_curation_at", new Date().toISOString());
								}
							}
						} catch {
							// best-effort, same pattern as ledger.settle — a
							// curation failure must not break the idle path
						}
						// v0.8.0 (K8-022 / plan §5.5) — the shared layer
						// re-read at idle. Gated by shared_layer_enabled ===
						// "1", a TEXT comparison: '0' is a truthy string, so a
						// truthiness check would turn the release on for every
						// installation that upgrades. Never wired into
						// tool.execute.*, chat.message, system.transform or
						// session.compacting — the hot-path rule is absolute;
						// the file-hash skip is what makes the idle cost one
						// read plus one hash on an unchanged repository.
						try {
							if (
								memoryService.getSetting("shared_layer_enabled", "0") === "1"
							) {
								syncSharedLayer();
							}
						} catch {
							// best-effort, same pattern as ledger.settle — a
							// sync failure must not break the idle path
						}
						// v1.2.0 (K12-003/K12-011/K12-017 / D12-05) — snapshot flush gated by tui_snapshots_enabled.
						// Order: actions→curate→syncSharedLayer→snapshots (D12-05) — snapshots reflect post-action truth.
						try {
							if (
								memoryService.getSetting("tui_snapshots_enabled", "1") === "1"
							) {
								// Proposals
								let proposals: import("@jmtrin/kevin-core").ProposalView[] = [];
								try {
									const rawPending = (() => {
										try {
											const maybe = (
												curator as unknown as { pending?: () => unknown[] }
											).pending;
											if (typeof maybe === "function")
												return maybe.call(curator) as unknown[];
										} catch {}
										return store
											.prepare(
												"SELECT id, kind, target_path, proposed_text, diff, memory_id, created_at FROM curation_proposals WHERE status = 'pending' ORDER BY created_at",
											)
											.all() as unknown[];
									})();
									const { proposalToken } = await import("@jmtrin/kevin-core");
									proposals = (rawPending as unknown[]).map((r) => {
										const row = r as Record<string, unknown>;
										const id = String(row.id ?? "");
										const proposed = String(
											row.proposed_text ?? row.proposedText ?? "",
										);
										return {
											id,
											kind: String(row.kind ?? "agents_md"),
											target_path: String(
												row.target_path ?? row.targetPath ?? "AGENTS.md",
											),
											diff: String(row.diff ?? ""),
											memory_ids: String(
												row.memory_id ?? (row.memoryIds as string) ?? "",
											)
												.split(",")
												.filter((s) => s.length > 0),
											created_at: String(
												row.created_at ??
													row.createdAt ??
													new Date().toISOString(),
											),
											token: (
												proposalToken as (a: string, b: string) => string
											)(id, proposed),
										};
									});
								} catch {}
								// Conflicts
								let conflicts: import("@jmtrin/kevin-core").ConflictView[] = [];
								try {
									const maybe = (
										conflictDetector as unknown as {
											openConflicts?: () => unknown[];
										}
									).openConflicts;
									if (typeof maybe === "function") {
										const raw = maybe.call(conflictDetector) as unknown[];
										conflicts = raw.map((c) => {
											const row = c as Record<string, unknown>;
											return {
												id: String(row.id ?? ""),
												kind: String(row.kind ?? ""),
												a_summary: String(row.a_summary ?? row.aSummary ?? ""),
												b_summary: String(row.b_summary ?? row.bSummary ?? ""),
												opened_at: String(
													row.opened_at ??
														row.openedAt ??
														new Date().toISOString(),
												),
											};
										});
									}
								} catch {
									conflicts = [];
								}
								// Health
								let health: import("@jmtrin/kevin-core").HealthView;
								try {
									const doc = buildDoctor(store, host, memoryService, {}, kevinEnv);
									let perfRows: import("@jmtrin/kevin-core").HealthView["perf"] =
										[];
									try {
										const stats = (
											perf as unknown as { stats?: () => unknown[] }
										).stats?.();
										if (Array.isArray(stats)) {
											perfRows = stats.map((p) => {
												const row = p as Record<string, unknown>;
												const budget = row.budget as
													| Record<string, unknown>
													| undefined;
												return {
													scope: String(row.scope ?? ""),
													p95: Number(row.p95 ?? 0),
													budget_p95: Number(
														budget?.p95Ms ??
															row.budget_p95 ??
															row.budgetP95 ??
															0,
													),
													within_budget: Boolean(
														row.withinBudget ?? row.within_budget ?? true,
													),
												};
											});
										}
									} catch {
										perfRows = [];
									}
									let digest = "unknown";
									try {
										digest = contractDigest(describeContract());
									} catch {}
									health = {
										verdict: doc.verdict,
										reason: doc.reason,
										hooks: doc.hooks.map((h) => ({
											hook: h.hook,
											state: h.state,
											fire_count: h.fire_count,
											expected_count: h.expected_count,
										})),
										perf: perfRows,
										contract_digest: digest,
										counters: metrics.snapshot() as Record<string, number>,
									};
								} catch {
									health = {
										verdict: "unknown",
										reason: "health unavailable",
										hooks: [],
										perf: [],
										contract_digest: "unknown",
										counters: {},
									};
								}
								flushSnapshots({
									root: materializerRoot,
									proposals,
									conflicts,
									health,
									metrics,
									version: KEVIN_VERSION,
								});
								try {
									writeDashboard(materializerRoot, {
										generatedAt: new Date().toISOString(),
										proposals,
										conflicts,
										health,
									});
								} catch {}
							}
						} catch {
							// best-effort — snapshot failure must not break idle
						}
						// v1.5.0 (K15-007) — skill bundle refresh after snapshots flush
						try {
							const manifestPath = join(materializerRoot, "skills-manifest.json");
							const shouldRefresh = memoryService.getSetting("skills_mirror_claude", "0") === "1" || memoryService.getSetting("skills_mirror_cursor", "0") === "1" || memoryService.getSetting("skills_canonical_dir", ".agents/skills") !== "" || existsSync(manifestPath);
							// spec: run when ANY skill setting is on OR manifest exists; canonical_dir always set so we check manifest existence as primary gate plus mirror flags
							const hasManifest = existsSync(manifestPath);
							const mirrorActive = memoryService.getSetting("skills_mirror_claude", "0") === "1" || memoryService.getSetting("skills_mirror_cursor", "0") === "1";
							if (hasManifest || mirrorActive) {
								const { refreshSkillBundle } = await import("@jmtrin/kevin-core");
								const bundles = materializer.topicBundles();
								const canonicalDir = memoryService.getSetting("skills_canonical_dir", ".agents/skills");
								const mirrors: Array<"claude"|"cursor"> = [];
								if (memoryService.getSetting("skills_mirror_claude", "0") === "1") mirrors.push("claude");
								if (memoryService.getSetting("skills_mirror_cursor", "0") === "1") mirrors.push("cursor");
								refreshSkillBundle({ projectRoot, canonicalDir, mirrors, topics: bundles, repoId: sessionIdentity.repoId, manifestPath, metrics: metrics as unknown as { incr: (k:string)=>void } });
							}
						} catch {
							// best-effort
						}
						// v1.0.0 (K10-013 / D10-08) — the session recorded work:
						// arm the deferred dispose settlement. The ISO timestamp
						// lets the next session.start compare it against
						// hook_liveness.last_seen_at for dispose.
						if (sessionRecordedWork) {
							try {
								store
									.prepare(
										"INSERT INTO kevin_settings (key, value) VALUES ('last_session_recorded_work', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
									)
									.run(new Date().toISOString());
							} catch {
								// best-effort: arming must not break idle
							}
							sessionRecordedWork = false;
						}
					}
				});
				metrics.flush();
				// v1.0.0 (K10-012 / plan §5.2, D10-11) — the idle perf_samples
				// write (the dispose hook holds the other one), gated by
				// perf_flush_on_idle (TEXT compare; the fallback matches the
				// migration-seeded default '1').
				if (memoryService.getSetting("perf_flush_on_idle", "1") === "1") {
					try {
						perf.flush(store);
					} catch {
						// best-effort: pre-011 DBs have no perf_samples table
					}
				}
				liveness.flush();
				return;
			}
			perf.measure("event", () => {
				if (type === "session.created") {
					const info = props.info as { id?: string } | undefined;
					if (info?.id) {
						currentSessionId = info.id;
						// BUG-011 — a fresh session must not inherit the
						// previous session's derived query (the global may
						// still hold it if no idle fired).
						lastUserQueryBySession.delete(info.id);
						// v0.4.0 (K4-017) — plan §5.1 rule 3: the per-session
						// seen-set resets when a session is created.
						injector.onSessionCreated(info.id);
						// v1.0.0 (K10-013 / plan §5.3, D10-08) — deferred
						// dispose settlement. The previous session recorded
						// work but the process never came back through
						// `dispose` (crash or hard kill): settle it HERE,
						// at the start of the next session, because dispose
						// cannot be settled within the session that observes
						// it. One settlement per work marker; a first-ever
						// run has no marker and never reports dead. The
						// threshold semantics stay with expect(): unknown
						// until expected_count crosses the threshold.
						try {
							const marker = memoryService.getSetting(
								"last_session_recorded_work",
								"",
							);
							if (marker !== "") {
								let fired = true;
								try {
									const row = store
										.prepare(
											"SELECT last_seen_at FROM hook_liveness WHERE hook = 'dispose'",
										)
										.get() as { last_seen_at: string | null } | undefined;
									const last = row?.last_seen_at ?? null;
									fired = last !== null && last > marker;
								} catch {
									// pre-010 DB without hook_liveness: treat as
									// no evidence of a fire, same as a crash.
									fired = false;
								}
								if (!fired) {
									liveness.expect("dispose", `miss:${marker}`);
									store
										.prepare(
											"UPDATE kevin_metrics SET value = value + 1 WHERE key = 'dispose_misses_total'",
										)
										.run();
								}
								store
									.prepare(
										"UPDATE kevin_settings SET value = '' WHERE key = 'last_session_recorded_work'",
									)
									.run();
							}
						} catch {
							// best-effort: settlement must not break session start
						}
					}
				} else if (type === "session.next.tool.failed") {
					const callID = props.callID as string | undefined;
					const sessionID = props.sessionID as string | undefined;
					const error = props.error as { message?: string } | undefined;
					if (callID && sessionID && error?.message) {
						handleToolFailed(callID, sessionID, error.message);
					}
				} else if (type === "session.next.tool.success") {
					const callID = props.callID as string | undefined;
					if (callID) toolCache.delete(callID);
				}
			});
		},

		dispose: async () => {
			// v1.0.0 (K10-013 / plan §5.3) — the seventh instrumented hook.
			// HookLiveness.wrap (outside) records the fire only if the
			// delegate completes; Perf.measureAsync (inside) times it even
			// on throw.
			try {
				await perf.measureAsync("dispose", async () => {
					try {
						await Promise.allSettled([...pending]);
					} finally {
						// v1.0.0 (K10-013) — record the fire and persist it now:
						// this is the last write of the process.
						liveness.recordDispose();
						// v1.0.0 (K10-013) — record the successful fire and
						// disarm any pending deferred-settlement marker: a
						// clean dispose is exactly what the next session's
						// settlement check looks for.
						store
							.prepare(
								"UPDATE kevin_metrics SET value = value + 1 WHERE key = 'dispose_fires_total'",
							)
							.run();
						try {
							store
								.prepare(
									"UPDATE kevin_settings SET value = '' WHERE key = 'last_session_recorded_work'",
								)
								.run();
						} catch {
							// best-effort: legacy DBs without kevin_settings
						}
					}
				});
			} finally {
				// v1.0.0 review fix — persist the final period (including this
				// dispose sample, recorded by measureAsync above) BEFORE the
				// closes; otherwise the dispose budget could never be verified
				// by bench:check because its samples died with the ring.
				try {
					perf.flush(store);
				} catch {
					// best-effort: pre-011 DBs have no perf_samples table
				}
				metrics.close();
				store.close();
			}
		},
	} as Hooks);
};

export default KevinPlugin;

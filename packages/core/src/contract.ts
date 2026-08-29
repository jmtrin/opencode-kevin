// v1.0.0 (K10-006 / plan §5.1) — the surface, as data.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { MARKER_BEGIN, MARKER_END } from "./ArtifactWriter.js";
import { resolveEnv, type KevinEnv } from "./env.js";
import { METRIC_KEY_LABELS } from "./Retrospective.js";
import { fnv1a64 } from "./fingerprint.js";
import { KEVIN_CONFIG_KEYS, KEVIN_VERSION } from "./index.js";
import { MAX_ENTRIES, MAX_LINE_BYTES } from "./okf.js";

/**
 * K13-012 (D13-05) — scanRoots plumbing. Resolves monorepo vs packed locations.
 * Monorepo: [packages/plugin/src, packages/core/src] when both dirs exist on disk.
 * Packed: walk-up via require.resolve for @jmtrin/kevin-core and @jmtrin/opencode-kevin.
 * Clause VALUES are unchanged; this only provides the roots future parsers would scan.
 * Uses KevinEnv for cwd (K13-006) — defaults via resolveEnv — env.ts is the only
 * core file allowed to call process cwd.
 */
export function resolveScanRoots(env?: KevinEnv): string[] {
	const cwd = resolveEnv(env).projectRoot;
	const monorepoCore = join(cwd, "packages", "core", "src");
	const monorepoPlugin = join(cwd, "packages", "plugin", "src");
	if (existsSync(monorepoCore) && existsSync(monorepoPlugin)) {
		return [monorepoPlugin, monorepoCore];
	}
	// Packed mode — locate installed packages
	const req = createRequire(import.meta.url);
	const roots: string[] = [];
	try {
		const corePkg = req.resolve("@jmtrin/kevin-core/package.json");
		const cand = join(dirname(corePkg), "dist");
		if (existsSync(cand)) roots.push(cand);
	} catch {}
	try {
		const pluginPkg = req.resolve("@jmtrin/opencode-kevin/package.json");
		const cand = join(dirname(pluginPkg), "dist", "plugin");
		if (existsSync(cand)) roots.push(cand);
	} catch {}
	if (roots.length > 0) return roots;
	// Fallback to monorepo relative (even if not yet built)
	return [monorepoPlugin, monorepoCore];
}

export const CONTRACT_VERSION = 1;

export type Stability = "frozen" | "forward-only";

export interface ContractClause {
	readonly id: string;
	readonly title: string;
	readonly stability: Stability;
	readonly since: string;
	readonly deprecated?: string;
	readonly replacement?: string;
	readonly value: unknown;
}

export interface PublicContract {
	readonly contractVersion: number;
	readonly clauses: readonly ContractClause[];
}

export interface ContractInput {
	readonly packageName?: string;
	readonly packageVersion?: string;
	/** K13-012 (D13-05) — scan roots for source parsers. Monorepo mode:
	 *  [packages/plugin/src, packages/core/src]; packed mode resolves
	 *  installed locations via walk-up. Clause VALUES untouched. */
	readonly scanRoots?: readonly string[];
}

// Tool names — the live source of truth for C-03. Any rename here must
// flow to the contract (K10-006 AC: renaming a tool changes C-03).
// Keep this array adjacent to the actual tool registrations in index.ts
// (checked by a test that parses both files).
export const CONTRACT_TOOL_NAMES: readonly string[] = [
	"kevin_save",
	"kevin_query",
	"kevin_get",
	"kevin_recall",
	"kevin_status",
	"kevin_project",
	"kevin_audit",
	"kevin_doctor",
	"kevin_native",
	"kevin_retrospective",
	"kevin_why",
	"kevin_feedback",
	"kevin_trace",
	"kevin_export",
	"kevin_import",
	"kevin_config",
	"kevin_facts",
	"kevin_conflicts",
	"kevin_propose",
	"kevin_publish",
	"kevin_approve",
	"kevin_share",
	"kevin_sync",
] as const;

/**
 * v1.0.0 (K10-018/K10-019 / plan §5.6) — tools added AFTER the initial
 * freeze, each carrying the `since` the deprecation policy requires. A
 * 1.x addition without an entry here fails the contract test as
 * added_bare.
 */
export const CONTRACT_TOOL_ADDITIONS: readonly {
	name: string;
	since: string;
}[] = [
	{ name: "kevin_bench", since: "1.0.0" },
	{ name: "kevin_contract", since: "1.0.0" },
	{ name: "kevin_forget", since: "1.1.0" },
];

/**
 * v1.1.0 (K11-007 / plan §5.1, D11-01) — metric keys added after the freeze,
 * each carrying the `since` the deprecation policy requires (C-05).
 */
export const CONTRACT_METRIC_ADDITIONS: readonly {
	name: string;
	since: string;
}[] = [
	{ name: "bench_regression_failures", since: "1.1.0" },
	{ name: "forget_requests_total", since: "1.1.0" },
	{ name: "forget_tombstones_published", since: "1.1.0" },
	// v1.2.0 (K12-001 / plan §4, D12-??) — surface metrics (no migration this release)
	{ name: "tui_snapshots_flushed", since: "1.2.0" },
	{ name: "tui_actions_invoked", since: "1.2.0" },
	// v1.4.0 (K14-006 / plan §4.3) — MCP bridge metrics (seeded by 013)
	{ name: "mcp_requests_total", since: "1.4.0" },
	{ name: "mcp_reads_served", since: "1.4.0" },
	{ name: "mcp_writes_accepted", since: "1.4.0" },
	{ name: "mcp_writes_refused", since: "1.4.0" },
	{ name: "mcp_errors_total", since: "1.4.0" },
	// v1.5.0 (K15-001 / plan §4) — Diaspora metrics; lazy-incr.
	{ name: "mif_exports_total", since: "1.5.0" },
	{ name: "mif_imports_total", since: "1.5.0" },
	{ name: "skills_emitted_total", since: "1.5.0" },
];

/**
 * v1.4.0 (K14-006 / plan §4.3) — config keys added after the freeze,
 * each carrying the `since` the deprecation policy requires (C-04).
 */
export const CONTRACT_CONFIG_ADDITIONS: readonly {
	name: string;
	since: string;
}[] = [
	{ name: "mcp_approve_enabled", since: "1.4.0" },
	{ name: "mcp_repo_override", since: "1.4.0" },
	{ name: "mcp_write_enabled", since: "1.4.0" },
	// v1.5.0 (K15-001 / plan §4) — Diaspora settings; since 1.5.0.
	{ name: "import_host_memory", since: "1.5.0" },
	{ name: "skills_canonical_dir", since: "1.5.0" },
	{ name: "skills_mirror_claude", since: "1.5.0" },
	{ name: "skills_mirror_cursor", since: "1.5.0" },
];

/**
 * v1.0.0 (K10-027 / plan §5.7) — the C-09 boundary addition. Stored is
 * not trusted: anything reaching an artifact or a prompt is escaped at
 * the single write path, according to its container.
 */
export const BOUNDARY_INVARIANT =
	"untrusted-input escaping at the single write path";

// For canonical JSON: sort keys recursively, no floats.
function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value))
			throw new Error("contract: non-integer number in canonical JSON");
		return String(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export function describeContract(_input?: ContractInput): PublicContract {
	// K13-012 plumbing — resolve scan roots for future parsers, but VALUES stay untouched (D13-05).
	const _scanRoots = _input?.scanRoots ?? resolveScanRoots();
	void _scanRoots;
	// Derive clause values from live source wherever possible (plan §5.1).
	// C-03 members added after the freeze carry their `since` as objects;
	// the original frozen set stays plain strings.
	const toolAdditions = [...CONTRACT_TOOL_ADDITIONS].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const toolValue = {
		tools: [[...CONTRACT_TOOL_NAMES].sort(), toolAdditions].flat(),
	};
	// v1.4.0 — config keys added after freeze carry `since` (C-04)
	const configAdditions = [...CONTRACT_CONFIG_ADDITIONS].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const baseConfigKeys = [...KEVIN_CONFIG_KEYS]
		.filter((k) => !configAdditions.some((a) => a.name === k))
		.sort();
	const settingValue = { keys: [...baseConfigKeys, ...configAdditions].flat() };
	// v1.1.0 — metric keys added after freeze carry `since` (C-05)
	const metricAdditions = [...CONTRACT_METRIC_ADDITIONS].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const baseMetricKeys = Object.keys(METRIC_KEY_LABELS)
		.filter((k) => !metricAdditions.some((a) => a.name === k))
		.sort();
	const metricValue = { keys: [...baseMetricKeys, ...metricAdditions].flat() };

	const clauses: ContractClause[] = [
		{
			id: "C-01",
			title: "AGENTS.md marker pair",
			stability: "frozen",
			since: "0.6.0",
			value: {
				markers: [MARKER_BEGIN, MARKER_END],
				splice_rule: "bytes outside markers preserved verbatim",
			},
		},
		{
			id: "C-02",
			title: "OKF v2 wire format",
			stability: "frozen",
			since: "0.8.0",
			value: {
				header_lines: 3,
				field_order: ["entry_id", "type", "content", "scope", "created_at"],
				entry_id_derivation: "fnv1a64 over canonical field ordering",
				eol: "LF",
				integers_only: true,
				sort_order: "entry_id ascending",
				max_line_bytes: MAX_LINE_BYTES,
				max_entries: MAX_ENTRIES,
			},
		},
		{
			id: "C-03",
			title: "Tool names and argument shapes",
			stability: "frozen",
			since: "0.2.0",
			value: toolValue,
		},
		{
			id: "C-04",
			title: "Setting keys, types and defaults",
			stability: "frozen",
			since: "0.2.0",
			value: settingValue,
		},
		{
			id: "C-05",
			title: "Metric key names",
			stability: "frozen",
			since: "0.2.0",
			value: metricValue,
		},
		{
			id: "C-06",
			title: "Package entry points",
			stability: "frozen",
			since: "0.1.0",
			value: {
				name: "@jmtrin/opencode-kevin",
				main: "dist/plugin/index.js",
				types: "dist/plugin/index.d.ts",
				exports_order: ["types", "import"],
				engines: ">=22.5.0",
			},
		},
		{
			id: "C-07",
			title: "Database schema",
			stability: "forward-only",
			since: "0.1.0",
			value: {
				schema_version: "013",
				migrations_forward_only: true,
			},
		},
		{
			id: "C-08",
			title: "Filesystem locations",
			stability: "frozen",
			since: "0.2.0",
			value: {
				db: "~/.opencode-kevin/kevin.db",
				refs: "refs/",
				skills: "skills/",
				okf: ".kevin/knowledge.okf",
			},
		},
		{
			id: "C-09",
			title: "Behavioural invariants",
			stability: "frozen",
			since: "0.8.0",
			value: {
				invariants: [
					"zero process spawns",
					"zero network calls",
					"no raw author email written",
					"single write path: ArtifactWriter is the only artifact writer",
				],
				// v1.0.0 (K10-027 / plan §5.7) — the untrusted-input boundary
				// joins the clause as an addition carrying its `since`; the
				// frozen invariant strings above are untouched.
				boundary: [{ name: BOUNDARY_INVARIANT, since: "1.0.0" }],
			},
		},
	];
	return { contractVersion: CONTRACT_VERSION, clauses };
}

export function contractDigest(c: PublicContract): string {
	const payload = canonicalJson(c.clauses);
	return fnv1a64(payload);
}

export type ContractDiffKind =
	| "removed"
	| "changed"
	| "added_ok"
	| "added_bare";

export interface ContractDiff {
	readonly clauseId: string;
	readonly path: string;
	readonly kind: ContractDiffKind;
	readonly remedy: string;
}

function valueMembers(value: unknown): Map<string, unknown> {
	// Normalize clause value into a flat member map for diffing.
	// If value is { tools: [...] } => members are tool names.
	// If { keys: [...] } => member per key.
	// Otherwise flatten object keys.
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (Array.isArray(obj.tools)) {
			const m = new Map<string, unknown>();
			for (const t of obj.tools) {
				if (typeof t === "string") m.set(t, undefined);
				else if (
					t !== null &&
					typeof t === "object" &&
					"name" in (t as Record<string, unknown>)
				)
					m.set((t as Record<string, unknown>).name as string, t);
			}
			return m;
		}
		if (Array.isArray(obj.keys)) {
			const m = new Map<string, unknown>();
			for (const k of obj.keys) {
				if (typeof k === "string") m.set(k, undefined);
				else if (
					k !== null &&
					typeof k === "object" &&
					"name" in (k as Record<string, unknown>)
				)
					m.set((k as Record<string, unknown>).name as string, k);
			}
			return m;
		}
		if (Array.isArray(obj.markers) || Array.isArray(obj.invariants)) {
			const arr = (obj.markers ?? obj.invariants) as string[];
			const m = new Map<string, unknown>();
			for (const v of arr) m.set(v, v);
			// v1.0.0 (K10-027) — boundary additions sit beside the frozen
			// invariant strings and carry their `since` like tool additions.
			if (Array.isArray(obj.boundary)) {
				for (const b of obj.boundary) {
					if (
						b !== null &&
						typeof b === "object" &&
						"name" in (b as Record<string, unknown>)
					)
						m.set((b as Record<string, unknown>).name as string, b);
				}
			}
			return m;
		}
		// Generic object: each key is a member
		const m = new Map<string, unknown>();
		for (const [k, v] of Object.entries(obj)) m.set(k, v);
		return m;
	}
	return new Map([["value", value]]);
}

export function diffContract(
	golden: PublicContract,
	live: PublicContract,
): readonly ContractDiff[] {
	const diffs: ContractDiff[] = [];
	const goldenById = new Map(golden.clauses.map((c) => [c.id, c]));
	const liveById = new Map(live.clauses.map((c) => [c.id, c]));

	// Removed clauses
	for (const g of golden.clauses) {
		if (!liveById.has(g.id)) {
			diffs.push({
				clauseId: g.id,
				path: g.id,
				kind: "removed",
				remedy: `Clause ${g.id} was removed. Revert, or open a 2.0.0.`,
			});
		}
	}
	// Added clauses — check since
	for (const l of live.clauses) {
		if (!goldenById.has(l.id)) {
			const hasSince =
				typeof (l as ContractClause).since === "string" &&
				(l as ContractClause).since.length > 0;
			diffs.push({
				clauseId: l.id,
				path: l.id,
				kind: hasSince ? "added_ok" : "added_bare",
				remedy: hasSince
					? `Clause ${l.id} was added with since. Allowed in 1.x.`
					: `Clause ${l.id} was added without since. Add since or revert, or open a 2.0.0.`,
			});
		}
	}
	// Within-clause diff
	for (const g of golden.clauses) {
		const l = liveById.get(g.id);
		if (!l) continue;
		const gMembers = valueMembers(g.value);
		const lMembers = valueMembers(l.value);
		// Normalize members: for arrays we care about set equality
		for (const [mem, _gv] of gMembers) {
			if (!lMembers.has(mem)) {
				diffs.push({
					clauseId: g.id,
					path: `${g.id}.${mem}`,
					kind: "removed",
					remedy: `Member ${mem} in ${g.id} was removed. Revert, or open a 2.0.0.`,
				});
			} else {
				const lv = lMembers.get(mem);
				const gv = gMembers.get(mem);
				if (JSON.stringify(lv) !== JSON.stringify(gv)) {
					// Member present on both sides but its value moved (e.g. an
					// addition object whose `since` was edited). Report it here,
					// at member granularity, instead of letting it fall through
					// to the coarser clause-level check below.
					diffs.push({
						clauseId: g.id,
						path: `${g.id}.${mem}`,
						kind: "changed",
						remedy: `Member ${mem} in ${g.id} changed. Revert, or open a 2.0.0.`,
					});
				}
			}
		}
		for (const [mem, _lv] of lMembers) {
			if (!gMembers.has(mem)) {
				const liveVal = l.value as Record<string, unknown>;
				// Check if the live member carries `since` (additions may ride
				// in the keys, tools or boundary arrays — K10-018/K10-027).
				const lists = [liveVal.keys, liveVal.tools, liveVal.boundary];
				let hasSince = false;
				for (const list of lists) {
					if (!Array.isArray(list)) continue;
					const entry = (list as unknown[]).find((e) => {
						if (typeof e === "string") return e === mem;
						if (
							e !== null &&
							typeof e === "object" &&
							"name" in (e as Record<string, unknown>)
						)
							return (e as Record<string, unknown>).name === mem;
						return false;
					}) as Record<string, unknown> | string | undefined;
					if (
						entry !== null &&
						typeof entry === "object" &&
						typeof (entry as Record<string, unknown>).since === "string"
					) {
						hasSince = true;
						break;
					}
				}
				diffs.push({
					clauseId: g.id,
					path: `${g.id}.${mem}`,
					kind: hasSince ? "added_ok" : "added_bare",
					remedy: hasSince
						? `Member ${mem} in ${g.id} was added with since. Allowed in 1.x.`
						: `Member ${mem} in ${g.id} was added without since. Add since or revert, or open a 2.0.0.`,
				});
			}
		}
		// Also compare clause-level metadata that is not in valueMembers (e.g., package version in C-06)
		// If the whole value JSON differs but members didn't capture it (e.g., name change), mark changed.
		if (JSON.stringify(g.value) !== JSON.stringify(l.value)) {
			// Only emit clause-level changed if no finer-grained diff already emitted for this clause
			const hasFiner = diffs.some(
				(d) => d.clauseId === g.id && d.path !== g.id,
			);
			if (!hasFiner) {
				diffs.push({
					clauseId: g.id,
					path: g.id,
					kind: "changed",
					remedy: `Clause ${g.id} changed. Revert, or open a 2.0.0.`,
				});
			}
		}
	}

	diffs.sort((a, b) =>
		a.clauseId === b.clauseId
			? a.path.localeCompare(b.path)
			: a.clauseId.localeCompare(b.clauseId),
	);
	return diffs;
}

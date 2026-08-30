import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Memory } from "./MemoryService.js";
import type { Store } from "./Store.js";
import { fingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

// v0.7.0 (K7-005 / plan §5.1, D7-01 / D7-13)
// ============================================================
// RepoTruth — repository as ground truth.
//
// Reads EXACTLY two files from the project root, both JSON:
//   package.json  and  tsconfig.json
// That is the whole read set (D7-01). There is no TOML/YAML parser
// and no new runtime dependency in this release; each file costs one
// JSON.parse inside a try/catch that returns [] on ANY failure.
//
// Bounds (D7-13): a hard cap of 500 facts per project. When the cap
// is hit, extraction stops at a deterministic point and the
// truncation is RECORDED as a repo_facts row with key_path='_truncated'
// and value='<total extractable keys>'. A silent truncation would turn
// every dropped fact into a false contradiction.
// ============================================================

const MAX_FACTS_PER_PROJECT = 500;

export interface RepoFact {
	/** "package.json" | "tsconfig.json" */
	readonly file: string;
	/** "scripts.test", "dependencies.zod", "compilerOptions.strict" */
	readonly keyPath: string;
	/** always stringified */
	readonly value: string;
}

export interface RepoFactRow extends RepoFact {
	id: string;
	projectId: string;
	fingerprint: string;
	sourceMtime: string | null;
	scannedAt: string;
}

function stringifyScalar(v: unknown): string | null {
	switch (typeof v) {
		case "string":
			return v;
		case "number":
		case "boolean":
			return String(v);
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Extraction — bounded and explicit. The extractor NEVER recurses into
// arbitrary nested objects: compilerOptions scalars are taken one level
// deep, and include/exclude are joined deterministically into one value.
// ---------------------------------------------------------------------------

function extractFromPackageJson(parsed: unknown): RepoFact[] {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return [];
	}
	const pkg = parsed as Record<string, unknown>;
	const out: RepoFact[] = [];

	const push = (keyPath: string, value: string): void => {
		out.push({ file: "package.json", keyPath, value });
	};

	// Group order: name, version, packageManager, type, then engines.*,
	// scripts.*, dependencies.* / devDependencies.* / optionalDependencies.*.
	for (const key of ["name", "version", "packageManager", "type"]) {
		const v = stringifyScalar(pkg[key]);
		if (v !== null) push(key, v);
	}

	// engines.* — scalars one level deep.
	if (typeof pkg.engines === "object" && pkg.engines !== null) {
		const engines = pkg.engines as Record<string, unknown>;
		for (const k of Object.keys(engines)) {
			const v = stringifyScalar(engines[k]);
			if (v !== null) push(`engines.${k}`, v);
		}
	}

	// scripts.* — every key and its value.
	if (typeof pkg.scripts === "object" && pkg.scripts !== null) {
		const scripts = pkg.scripts as Record<string, unknown>;
		for (const k of Object.keys(scripts)) {
			const v = stringifyScalar(scripts[k]);
			if (v !== null) push(`scripts.${k}`, v);
		}
	}

	// dependencies.* / devDependencies.* / optionalDependencies.* — package
	// name and version range.
	for (const group of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
	]) {
		if (typeof pkg[group] === "object" && pkg[group] !== null) {
			const map = pkg[group] as Record<string, unknown>;
			for (const k of Object.keys(map)) {
				const v = stringifyScalar(map[k]);
				if (v !== null) push(`${group}.${k}`, v);
			}
		}
	}

	return out;
}

function joinDeterministic(list: unknown): string | null {
	if (!Array.isArray(list)) return null;
	// Deterministic: sort so the joined value is stable across runs and
	// independent of source ordering.
	const strs: string[] = [];
	for (const item of list) {
		const s = stringifyScalar(item);
		if (s !== null) strs.push(s);
	}
	strs.sort();
	return strs.join(" ");
}

function extractFromTsconfig(parsed: unknown): RepoFact[] {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return [];
	}
	const cfg = parsed as Record<string, unknown>;
	const out: RepoFact[] = [];

	// compilerOptions.* — scalar values one level deep (string, number,
	// boolean). Nested objects under compilerOptions are deliberately not
	// walked (D7-01 keeps the extractor flat).
	const options = cfg.compilerOptions;
	if (typeof options === "object" && options !== null) {
		const rec = options as Record<string, unknown>;
		for (const key of Object.keys(rec)) {
			const v = stringifyScalar(rec[key]);
			if (v !== null)
				out.push({
					file: "tsconfig.json",
					keyPath: `compilerOptions.${key}`,
					value: v,
				});
		}
	}

	// include / exclude — joined deterministically into a single value.
	for (const listKey of ["include", "exclude"]) {
		const joined = joinDeterministic(cfg[listKey]);
		if (joined !== null) {
			out.push({ file: "tsconfig.json", keyPath: listKey, value: joined });
		}
	}

	return out;
}

/**
 * v0.7.0 (K7-006 / plan §5.2) — read a fact file safely. Returns `null`
 * when the file is missing, unreadable, malformed JSON, or parses to a
 * non-object — the caller treats that as "no facts". The extra non-object
 * guard is load-bearing: `typeof null === 'object'`, so a bare `null`,
 * array or number must not be treated as a valid fact source.
 */
function readJsonFile(filePath: string): unknown | null {
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function normalizedKeyPath(fact: RepoFact): string {
	// The stringified `include`/`exclude` may contain spaces; the key path
	// itself is `"include"`/`"exclude"`, which is already stable. This helper
	// exists so a single deterministic key is used for fingerprinting.
	return fact.keyPath;
}

export class RepoTruth {
	private readonly metrics: Metrics | null;

	private hasTable = true;
	private readonly lastMtimes = new Map<string, string | null>();
	private readonly lastFacts = new Map<string, RepoFact[]>();
	private lastScanAt: string | null = null;

	// v0.7.0 (K7-007 / plan §5.1, D7-05) — the dependency packages that were
	// present at the immediately-preceding scan, keyed by project_id. Check 2
	// (missing dependency) fires only for a package that *disappeared* — it
	// must have existed at the previous scan. In-memory: contradictions() runs
	// on demand in the same process that produced the scans.
	private readonly prevDeps = new Map<string, Set<string>>();

	constructor(
		private readonly store: Store,
		private readonly projectId: string,
		private readonly projectRoot: string,
		metrics?: Metrics | null,
	) {
		this.metrics = metrics ?? null;
	}

	private ensureTables(): void {
		if (!this.hasTable) return;
		try {
			const row = this.store
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repo_facts'",
				)
				.get() as { name: string } | undefined;
			if (!row) this.hasTable = false;
		} catch {
			// Pre-008 database: repo_facts does not exist. Degrade gracefully —
			// scan() becomes a no-op and facts() returns [] rather than throwing.
			this.hasTable = false;
		}
	}

	/**
	 * v0.7.0 (K7-005/006 / plan §5.1-5.2, D7-13) — refresh the repository
	 * truth. The steady state of an idle session is two `stat` calls: a file
	 * whose `source_mtime` is unchanged is NOT re-parsed (no JSON.parse, no
	 * readFileSync). A changed file replaces that file's facts for THIS
	 * project only; a file no longer present has its facts removed for this
	 * project only. The project-wide 500-fact cap is applied to the combined,
	 * deterministically-ordered fact set and the truncation is recorded, never
	 * silent. Returns the project's stored fact view after the scan (including
	 * a `_truncated` row when the cap was hit), so repeated scans of unchanged
	 * files return identical results.
	 */
	scan(_now?: Date): RepoFact[] {
		this.ensureTables();
		if (!this.hasTable) return [];

		const mtimes = this.fileMtimes();
		const ordered: RepoFact[] = [];
		const fileMtimeToStore: Record<string, string | null> = {};
		const existingTruncation = this.storedTruncation();
		const forceFullScan =
			existingTruncation !== null &&
			["package.json", "tsconfig.json"].some((file) => {
				const current = mtimes[file];
				if (current === null) {
					return (
						this.hasStoredFileFacts(file) ||
						(this.lastMtimes.has(file) && this.lastMtimes.get(file) !== null)
					);
				}
				return this.getStoredMtime(file) !== current;
			});
		let parsedAny = false;
		let changedAny = false;

		// Deterministic order: package.json first, then tsconfig.json; within
		// each group, source key order for a freshly parsed file and stored
		// order (by key_path) for an unchanged file.
		for (const file of ["package.json", "tsconfig.json"]) {
			const current = mtimes[file];
			if (current === null) {
				// File gone: it contributes no facts and its rows are dropped.
				fileMtimeToStore[file] = null;
				if (
					this.hasStoredFileFacts(file) ||
					(this.lastMtimes.has(file) && this.lastMtimes.get(file) !== null)
				) {
					changedAny = true;
				}
				continue;
			}
			const stored = this.getStoredMtime(file);
			let facts: RepoFact[];
			if (!forceFullScan && stored === current) {
				// Unchanged: reuse stored facts, no parsing.
				facts = this.lastFacts.get(file) ?? this.storedFileFacts(file);
				fileMtimeToStore[file] = stored;
			} else {
				facts = this.extractFile(file);
				parsedAny = true;
				changedAny = true;
				fileMtimeToStore[file] = current;
			}
			ordered.push(...facts);
		}
		if (!changedAny) return this.currentScanFacts();

		// Bound the combined set at the documented cap; record any truncation.
		const total =
			existingTruncation !== null && !parsedAny
				? existingTruncation
				: ordered.length;
		let toPersist = ordered.slice(0, MAX_FACTS_PER_PROJECT);
		if (total > MAX_FACTS_PER_PROJECT) {
			toPersist = toPersist.concat({
				file: "package.json",
				keyPath: "_truncated",
				value: String(total),
			});
		}

		// Record which dependency packages ARE present right now (the state
		// this scan is about to replace) so check 2 can tell a disappeared
		// dependency from one that was never present (K7-007 / D7-05).
		this.prevDeps.set(this.projectId, this.currentDepPackages());

		this.persistAll(toPersist, fileMtimeToStore);
		for (const file of ["package.json", "tsconfig.json"]) {
			this.lastFacts.set(
				file,
				toPersist.filter(
					(fact) => fact.file === file && fact.keyPath !== "_truncated",
				),
			);
		}
		for (const file of ["package.json", "tsconfig.json"]) {
			this.lastMtimes.set(file, mtimes[file]);
		}
		this.lastScanAt = (_now ?? new Date()).toISOString();
		if (parsedAny) {
			this.metrics?.incr("repo_facts_scanned", this.storedFactCount());
		}
		// Return the correctly-bounded fact set in deterministic source order
		// (package.json then tsconfig.json, group order then source key order),
		// so the returned keys are stable and match the documented extraction.
		return toPersist;
	}

	private hasStoredFileFacts(file: string): boolean {
		const row = this.store
			.prepare(
				`SELECT 1 AS present FROM repo_facts
				 WHERE project_id = ? AND file = ?
				 LIMIT 1`,
			)
			.get(this.projectId, file) as { present: number } | undefined;
		return row !== undefined;
	}

	private currentScanFacts(): RepoFact[] {
		const facts = [
			...(this.lastFacts.get("package.json") ??
				this.storedFileFacts("package.json")),
			...(this.lastFacts.get("tsconfig.json") ??
				this.storedFileFacts("tsconfig.json")),
		];
		const truncated = this.storedTruncation();
		return truncated === null
			? facts
			: facts.slice(0, MAX_FACTS_PER_PROJECT).concat({
					file: "package.json",
					keyPath: "_truncated",
					value: String(truncated),
				});
	}

	private storedFileFacts(file: string): RepoFact[] {
		const rows = this.store
			.prepare(
				`SELECT file, key_path AS keyPath, value
				 FROM repo_facts
				 WHERE project_id = ? AND file = ? AND key_path <> '_truncated'
				 ORDER BY id`,
			)
			.all(this.projectId, file) as {
			file: string;
			keyPath: string;
			value: string;
		}[];
		return rows;
	}

	private getStoredMtime(file: string): string | null {
		const row = this.store
			.prepare(
				`SELECT source_mtime AS m
				 FROM repo_facts
				 WHERE project_id = ? AND file = ? AND key_path <> '_truncated'
				 LIMIT 1`,
			)
			.get(this.projectId, file) as { m: string | null } | undefined;
		return row?.m ?? this.lastMtimes.get(file) ?? null;
	}

	private persistAll(
		facts: RepoFact[],
		fileMtimeToStore: Record<string, string | null>,
	): void {
		const delAll = this.store.prepare(
			"DELETE FROM repo_facts WHERE project_id = ?",
		);
		const insert = this.store.prepare(
			`INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint, source_mtime, scanned_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
		);
		this.store.transaction(() => {
			delAll.run(this.projectId);
			for (const fact of facts) {
				const mtime =
					fact.keyPath === "_truncated"
						? (fileMtimeToStore["package.json"] ?? null)
						: (fileMtimeToStore[fact.file] ?? null);
				insert.run(
					uuidv7(),
					this.projectId,
					fact.file,
					fact.keyPath,
					fact.value,
					fingerprint(normalizedKeyPath(fact), this.projectId),
					mtime,
				);
			}
		});
	}

	private storedFactCount(): number {
		const row = this.store
			.prepare(
				`SELECT COUNT(*) AS c FROM repo_facts
				 WHERE project_id = ? AND key_path <> '_truncated'`,
			)
			.get(this.projectId) as { c: number };
		return row.c;
	}

	private storedTruncation(): number | null {
		const row = this.store
			.prepare(
				`SELECT value FROM repo_facts
				 WHERE project_id = ? AND key_path = '_truncated'
				 LIMIT 1`,
			)
			.get(this.projectId) as { value: string } | undefined;
		if (!row) return null;
		const count = Number(row.value);
		return Number.isFinite(count) && count > MAX_FACTS_PER_PROJECT
			? count
			: null;
	}

	/**
	 * v0.7.0 (K7-006 / plan §5.2) — extract a file's facts WITHOUT writing
	 * anything. Used by scan to keep a single source of truth for extraction.
	 */
	private extractFile(file: string): RepoFact[] {
		const filePath = join(this.projectRoot, file);
		const parsed = readJsonFile(filePath);
		if (parsed === null) return [];
		if (file === "package.json") return extractFromPackageJson(parsed);
		if (file === "tsconfig.json") return extractFromTsconfig(parsed);
		return [];
	}

	private fileMtimes(): Record<string, string | null> {
		const out: Record<string, string | null> = {};
		for (const file of ["package.json", "tsconfig.json"]) {
			try {
				const st = statSync(join(this.projectRoot, file));
				// Include size alongside mtime so a same-tick rewrite with
				// different bytes is still detected on Windows where mtime
				// granularity is ~15ms. The stored string is compared as an
				// opaque token, so legacy rows (bare mtime) will mismatch once
				// and trigger a re-parse.
				out[file] = `${String(st.mtimeMs)}:${String(st.size)}`;
			} catch {
				out[file] = null;
			}
		}
		return out;
	}

	/**
	 * v0.7.0 (K7-006 / plan §5.2, D7-02) — the project-scoped stored facts.
	 * Every read filters on `project_id`, so a second project's facts never
	 * leak into this project's view.
	 */
	facts(): RepoFact[] {
		this.ensureTables();
		if (!this.hasTable) return [];
		const rows = this.store
			.prepare(
				`SELECT file, key_path AS keyPath, value
				 FROM repo_facts
				 WHERE project_id = ?
				 ORDER BY file, key_path`,
			)
			.all(this.projectId) as {
			file: string;
			keyPath: string;
			value: string;
		}[];
		return rows;
	}

	/** v0.7.0 (K7-009) — human-readable fact rows for `kevin_facts`. */
	storeFacts(): RepoFactRow[] {
		this.ensureTables();
		if (!this.hasTable) return [];
		const rows = this.store
			.prepare(
				`SELECT id, project_id AS projectId, file, key_path AS keyPath, value,
						fingerprint, source_mtime AS sourceMtime, scanned_at AS scannedAt
				 FROM repo_facts
				 WHERE project_id = ?
				 ORDER BY file, key_path`,
			)
			.all(this.projectId) as RepoFactRow[];
		return rows;
	}

	/** Timestamp of the latest scan in this process or persisted facts. */
	scannedAt(): string | null {
		if (this.lastScanAt) return this.lastScanAt;
		this.ensureTables();
		if (!this.hasTable) return null;
		const row = this.store
			.prepare(
				"SELECT MAX(scanned_at) AS scannedAt FROM repo_facts WHERE project_id = ?",
			)
			.get(this.projectId) as { scannedAt: string | null } | undefined;
		return row?.scannedAt ?? null;
	}

	/**
	 * v0.7.0 (K7-007 / plan §5.1, D7-05) — exact-match contradiction detection:
	 * the three and only three checks. Each returns a human-readable reason;
	 * empty when consistent. Pure read — writes nothing (K7-008 and K7-014 own
	 * the penalty and conflict-row writes).
	 */
	contradictions(memory: Memory): string[] {
		this.ensureTables();
		if (!this.hasTable) return [];
		const reasons: string[] = [];
		const current = this.facts();
		reasons.push(...this.checkMissingScripts(memory, current));
		reasons.push(...this.checkMissingDependencies(memory, current));
		reasons.push(...this.checkChangedCompilerOptions(memory, current));
		return reasons;
	}

	private checkMissingScripts(memory: Memory, current: RepoFact[]): string[] {
		const scriptNames = referencedScripts(memory.content);
		const present = new Set(
			current
				.filter(
					(f) => f.file === "package.json" && f.keyPath.startsWith("scripts."),
				)
				.map((f) => f.keyPath.slice("scripts.".length)),
		);
		const reasons: string[] = [];
		for (const name of scriptNames) {
			if (!present.has(name)) {
				reasons.push(
					`\`${scriptInvocation(name)}\` is referenced but \`scripts.${name}\` does not exist in this project`,
				);
			}
		}
		return reasons;
	}

	private checkMissingDependencies(
		memory: Memory,
		current: RepoFact[],
	): string[] {
		const packages = referencedPackages(memory.content);
		if (packages.length === 0) return [];
		// Packages currently declared as dependencies, keyed by name.
		const present = new Set<string>();
		for (const f of current) {
			if (
				!f.keyPath.startsWith("dependencies.") &&
				!f.keyPath.startsWith("devDependencies.") &&
				!f.keyPath.startsWith("optionalDependencies.")
			) {
				continue;
			}
			const name = f.keyPath.slice(f.keyPath.indexOf(".") + 1);
			present.add(name);
		}
		const previous = this.prevDeps.get(this.projectId) ?? new Set<string>();
		const reasons: string[] = [];
		for (const pkg of packages) {
			// Fire only for a DISAPPEARED dependency: absent now but present at
			// the previous scan. A package that was never a dependency is not a
			// contradiction (D7-05 — mention is not assertion).
			if (!present.has(pkg) && previous.has(pkg)) {
				reasons.push(
					`dependency \`${pkg}\` is referenced but no longer declared in dependencies/devDependencies/optionalDependencies`,
				);
			}
		}
		return reasons;
	}

	private checkChangedCompilerOptions(
		memory: Memory,
		current: RepoFact[],
	): string[] {
		const assertions = compilerOptionAssertions(memory.content);
		if (assertions.size === 0) return [];
		const facts = new Map<string, string>();
		for (const f of current) {
			if (
				f.file === "tsconfig.json" &&
				f.keyPath.startsWith("compilerOptions.")
			) {
				facts.set(f.keyPath.slice("compilerOptions.".length), f.value);
			}
		}
		const reasons: string[] = [];
		for (const [option, asserted] of assertions) {
			const factValue = facts.get(option);
			if (factValue === undefined) continue;
			const currentBool = normalizeBool(factValue);
			const assertedBool = normalizeBool(asserted);
			if (
				assertedBool !== null &&
				currentBool !== null &&
				assertedBool !== currentBool
			) {
				reasons.push(
					`\`compilerOptions.${option}\` is asserted as \`${asserted}\` but the current value is \`${factValue}\``,
				);
			}
		}
		return reasons;
	}

	private currentDepPackages(): Set<string> {
		const out = new Set<string>();
		const rows = this.store
			.prepare(
				`SELECT key_path AS keyPath FROM repo_facts
				 WHERE project_id = ? AND (key_path LIKE 'dependencies.%' OR key_path LIKE 'devDependencies.%' OR key_path LIKE 'optionalDependencies.%')`,
			)
			.all(this.projectId) as { keyPath: string }[];
		for (const r of rows) {
			out.add(r.keyPath.slice(r.keyPath.indexOf(".") + 1));
		}
		return out;
	}
}

// v0.7.0 (K7-007 / plan §5.1, D7-05) — pure, exact-match helpers. No fuzzy
// similarity, no edit distance, no substring-implies-assertion.

/** `npm run lint`, `pnpm run test`, `yarn build` → the script names. */
function referencedScripts(content: string): string[] {
	const out: string[] = [];
	const re =
		/\b(?:npm|pnpm)\s+run\s+([A-Za-z0-9_.:@/\-]+)|\byarn\s+([A-Za-z0-9_.:@/\-]+)/g;
	let m = re.exec(content);
	while (m !== null) {
		const name = m[1] ?? m[2];
		if (name) out.push(name);
		m = re.exec(content);
	}
	return [...new Set(out)];
}

function scriptInvocation(name: string): string {
	return `npm run ${name}`;
}

/** Package names the memory asserts as in-use/dependencies. */
function referencedPackages(content: string): string[] {
	const out: string[] = [];
	const re =
		/\b(?:use[s]?|need[s]?|require[s]?|depends?\s+on|instal?l|dependencies?)\s+(?:the\s+)?(?:package\s+)?[`'"]?([@]?[A-Za-z0-9][A-Za-z0-9._\-@/]*)/gi;
	let m = re.exec(content);
	while (m !== null) {
		const pkg = (m[1] ?? "").replace(/[`'",.;:)]+$/, "");
		if (pkg) out.push(pkg);
		m = re.exec(content);
	}
	return [...new Set(out)];
}

/** `compilerOptions.strict` mentions with the polarity the memory asserts. */
function compilerOptionAssertions(content: string): Map<string, string> {
	const out = new Map<string, string>();
	const optionRe = /compilerOptions\.([A-Za-z0-9_]+)/g;
	let m = optionRe.exec(content);
	while (m !== null) {
		const option = m[1] ?? "";
		// The asserted polarity is read from the nearest boolean token within
		// the following 3 words (e.g. "strict is false", "strict: true").
		const tail = content.slice(m.index).slice(0, 40);
		const polarity = tail.match(/\b(true|false|on|off|enabled|disabled)\b/i);
		if (polarity) out.set(option, polarity[1] ?? "");
		m = optionRe.exec(content);
	}
	return out;
}

/** Interpret a stringified value as a boolean, or null when it is not one. */
function normalizeBool(v: string): boolean | null {
	const s = v.trim().toLowerCase();
	if (s === "true" || s === "on" || s === "enabled" || s === "1") return true;
	if (s === "false" || s === "off" || s === "disabled" || s === "0")
		return false;
	return null;
}

export { MAX_FACTS_PER_PROJECT };

/**
 * K9-004 — v0.9.0 native — host probe (plan §5.1, D9-12).
 *
 * Kevin stops assuming the host and asks it instead. `probeHost()` inspects the
 * plugin input and the resolved `@opencode-ai/plugin` package and answers four
 * questions once per process: what plugin version is actually installed, which
 * v1+v2 surface exists, what project context the host already knows, and
 * whether a shell was handed over.
 *
 * Contract (plan §5.1 / §4 traps 24-26):
 * - Never throws: every read is guarded, every failure appends to `notes` and
 *   yields a conservative `false`. A throw during construction takes down the
 *   host's plugin load — strictly worse than any missing feature.
 * - Duck-typed: only `typeof` and `in` checks, never `instanceof`, never a cast
 *   to a host class.
 * - The v2 probe is a dynamic `await import()` of the v2/promise subpath inside
 *   a try. Rejection is the answer (a pre-v2 package). When it resolves we record
 *   which domains are actually exposed rather than assuming both — the promise
 *   subpath exports `define` at runtime and its `skill`/`reference` domains are
 *   compile-time types, so domain availability is verified against the resolved
 *   package's own declaration files.
 * - Runs once: the result is cached and frozen. A capability that appears
 *   mid-session is indistinguishable from a bug (D9-12).
 * - `pluginVersion` comes from the resolved package's `package.json` — never
 *   from the declared range, which plan §3.4 showed to be untrustworthy.
 * - The v2 subpath string itself lives in native.ts (K9-013 containment): this
 *   module only ever names it through the imported symbol.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** v0.9.0 (K9-004 / plan §5.1, D9-12) */
export type HostFlavour = "v1-only" | "v1+v2";

/** v0.9.0 (K9-004 / plan §5.1) */
export interface HostProject {
	readonly id: string | null;
	readonly worktree: string | null;
	readonly directory: string | null;
}

/** v0.9.0 (K9-004 / plan §5.1) */
export interface HostSurface {
	/** Resolved `version` from the installed package's package.json, or null. */
	readonly pluginVersion: string | null;
	readonly flavour: HostFlavour;
	readonly project: HostProject;
	/** The host handed over `input.$` (BunShell). Zero-spawn remains a choice. */
	readonly hasShell: boolean;
	/** Which v2 domains the resolved package actually exposes. */
	readonly v2: {
		readonly skill: boolean;
		readonly reference: boolean;
	};
	/** Every degraded read is explained here; never empty on a degraded probe. */
	readonly notes: readonly string[];
}

// v0.9.0 (K9-013 / plan §5.4, D9-11) — the only file allowed to name the v2
// subpath is plugin/native.ts; this module uses the exported symbol.
import { V2_SPECIFIER } from "./native.js";

let cachedSurface: HostSurface | null = null;

/**
 * v0.9.0 (K9-004 / plan §5.1, D9-12)
 * `importV2` is a test seam; production callers omit it and the real
 * `await import()` runs inside the try.
 */
export async function probeHost(
	input: unknown,
	options?: { importV2?: () => Promise<unknown> },
): Promise<HostSurface> {
	if (cachedSurface !== null) {
		return cachedSurface;
	}
	const notes: string[] = [];
	const project = readProject(input, notes);
	const hasShell = readShell(input, notes);
	const v2 = await probeV2(notes, options?.importV2);
	const pluginVersion = readPluginVersion(notes);
	const surface: HostSurface = Object.freeze({
		pluginVersion,
		flavour: v2 === null ? "v1-only" : "v1+v2",
		project: Object.freeze(project),
		hasShell,
		v2: Object.freeze({
			skill: v2?.skill ?? false,
			reference: v2?.reference ?? false,
		}),
		notes: Object.freeze(notes),
	});
	cachedSurface = surface;
	return surface;
}

/**
 * v0.9.0 (K9-004) — test hook. probeHost caches its result (probe once, freeze,
 * restart to re-probe); tests reset between cases.
 */
export function resetHostProbeCache(): void {
	cachedSurface = null;
}

/**
 * v0.9.0 (K9-004 / plan §5.1) — one stable paragraph: version, flavour and the
 * domain flags. No paths, no identifiers; safe to paste into an issue report.
 */
export function summarize(s: HostSurface): string {
	const version = s.pluginVersion ?? "unknown";
	const shell = s.hasShell ? "yes" : "no";
	const skill = s.v2.skill ? "yes" : "no";
	const reference = s.v2.reference ? "yes" : "no";
	return `host plugin ${version}, flavour ${s.flavour}, shell ${shell}, v2 skill ${skill}, v2 reference ${reference}`;
}

function readProject(input: unknown, notes: string[]): HostProject {
	let id: string | null = null;
	let worktree: string | null = null;
	let directory: string | null = null;
	if (typeof input === "object" && input !== null) {
		const record = input as Record<string, unknown>;
		const project = record.project;
		if (typeof project === "object" && project !== null) {
			const p = project as Record<string, unknown>;
			id = typeof p.id === "string" ? (p.id as string) : null;
			worktree = typeof p.worktree === "string" ? (p.worktree as string) : null;
			directory =
				typeof p.directory === "string" ? (p.directory as string) : null;
		}
		// PluginInput also carries top-level worktree/directory; fall back to
		// them when the project object does not.
		if (worktree === null && typeof record.worktree === "string") {
			worktree = record.worktree as string;
		}
		if (directory === null && typeof record.directory === "string") {
			directory = record.directory as string;
		}
		if (id === null && worktree === null && directory === null) {
			notes.push("no project context on the plugin input (D9-12)");
		}
	} else {
		notes.push(
			"plugin input is not an object — host fields unavailable (D9-12)",
		);
	}
	return { id, worktree, directory };
}

function readShell(input: unknown, notes: string[]): boolean {
	if (typeof input !== "object" || input === null) {
		return false;
	}
	const shell = (input as Record<string, unknown>).$;
	const present =
		(typeof shell === "object" && shell !== null) ||
		typeof shell === "function";
	if (!present) {
		notes.push(
			"no shell ($) handed over — zero process-launching stays a decision (D9-12)",
		);
	}
	return present;
}

/**
 * v0.9.0 (K9-004 / plan §5.1, D9-11/D9-12)
 * Returns null when the v2 surface is absent; otherwise the domain flags
 * verified against the resolved package's own declaration files.
 */
async function probeV2(
	notes: string[],
	importV2?: () => Promise<unknown>,
): Promise<{ skill: boolean; reference: boolean } | null> {
	let mod: unknown;
	try {
		mod = importV2
			? await importV2()
			: await import(/* @vite-ignore */ V2_SPECIFIER);
	} catch {
		notes.push(
			`${V2_SPECIFIER} import rejected — this host package predates the v2 subpath (D9-11)`,
		);
		return null;
	}
	if (typeof mod !== "object" || mod === null) {
		notes.push(
			"v2/promise resolved to a non-object module — treated as v1-only (D9-12)",
		);
		return null;
	}
	if (typeof (mod as Record<string, unknown>).define !== "function") {
		notes.push(
			"v2/promise resolved but exposes no define — treated as v1-only (D9-12)",
		);
		return null;
	}
	const root = resolvePluginRoot(notes);
	if (root === null) {
		notes.push(
			"v2/promise resolved but the package root is unreachable — v2 domains unverified (D9-12)",
		);
		return { skill: false, reference: false };
	}
	// The promise subpath ships skill/reference as declaration files; record
	// what is actually there rather than assuming both (plan §5.1).
	return {
		skill: existsSync(join(root, "dist", "v2", "promise", "skill.d.ts")),
		reference: existsSync(
			join(root, "dist", "v2", "promise", "reference.d.ts"),
		),
	};
}

function readPluginVersion(notes: string[]): string | null {
	const root = resolvePluginRoot(notes);
	if (root === null) {
		return null;
	}
	try {
		const pkg = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as { version?: unknown };
		if (typeof pkg.version === "string" && pkg.version.length > 0) {
			return pkg.version;
		}
		notes.push("resolved plugin package.json declares no version (K9-004)");
		return null;
	} catch {
		notes.push("resolved plugin package.json unreadable (K9-004)");
		return null;
	}
}

/**
 * v0.9.0 (K9-004 / plan §5.1) — the installed package's directory, found by
 * the most reliable strategy that works in this runtime. Never throws.
 */
function resolvePluginRoot(notes: string[]): string | null {
	// 1. import.meta.resolve: the true resolved copy (Node >= 20.6, Bun).
	const resolveMeta = (
		import.meta as { resolve?: (specifier: string) => string }
	).resolve;
	if (typeof resolveMeta === "function") {
		try {
			const url = resolveMeta("@opencode-ai/plugin");
			const root = packageRootOf(url, notes);
			if (root !== null) {
				return root;
			}
		} catch {
			// unsupported in this runtime — next strategy
		}
	}
	// 2. createRequire: hosts that ship a "require" condition (this package
	//    exports only "import", so this is a forward-compat strategy).
	try {
		const resolve = createRequire(import.meta.url).resolve(
			`${V2_SPECIFIER}/index.js`,
		);
		const root = packageRootOf(resolve, notes);
		if (root !== null) {
			return root;
		}
	} catch {
		// not resolvable via require — next strategy
	}
	// 3. Walk up from cwd looking for a node_modules copy (works in the repo
	//    and in typical host layouts; best effort, guarded).
	let dir = process.cwd();
	for (let depth = 0; depth < 10; depth += 1) {
		const candidate = join(dir, "node_modules", "@opencode-ai", "plugin");
		if (existsSync(join(candidate, "package.json"))) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	notes.push("resolved plugin package root not reachable (K9-004)");
	return null;
}

/** Accepts a file URL or a plain path to a file inside the package. */
function packageRootOf(file: string, notes: string[]): string | null {
	try {
		const path = file.startsWith("file:")
			? fileURLToPath(file)
			: file.replace(/\\/g, "/");
		// dist/index.js → dist → root; dist/v2/promise/index.js → three levels.
		const candidates = [
			dirname(path),
			dirname(dirname(path)),
			dirname(dirname(dirname(path))),
		];
		for (const candidate of candidates) {
			if (existsSync(join(candidate, "package.json"))) {
				return candidate;
			}
		}
	} catch {
		notes.push(
			"could not map the resolved plugin file to its package root (K9-004)",
		);
	}
	return null;
}

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactWriter } from "./ArtifactWriter.js";
import { fingerprint, fnv1a64 } from "./fingerprint.js";
import type { HostSurface } from "./host.js";

// ============================================================
// Kevin 0.8.0 — RepoIdentity (K8-005/K8-006 / plan §5.1, D8-04)
// v0.9.0 — host identity source (K9-006 / plan §5.2, D9-13)
// ============================================================
// Repository-derived identity that survives a clone. Two clones
// of the same remote must agree on one `repo_id` even though
// `process.cwd()` differs.
//
// This file deliberately contains no process-launching calls (D8-01)
// and no `new URL()` — the scp-style `git@host:path` form that git
// accepts and roughly half of all clones use rejects URL parsing
// (K8-005).
// ============================================================

// Comment lines git accepts inside a config section: `#` and `;`.
const COMMENT_RE = /^[#;]/;

// A declared id must be exactly 16 lowercase hex characters (K8-006).
const DECLARED_ID_RE = /^[0-9a-f]{16}$/;

const PROJECT_JSON_PATH = join(".kevin", "project.json");
const GIT_CONFIG_PATH = join(".git", "config");

/**
 * The four sources `resolve()` tries, in order (plan §5.2, D9-13).
 */
export type IdentitySource = "declared" | "remote" | "host" | "path";

/**
 * The outcome of resolving a repository identity.
 */
export interface ResolvedIdentity {
	/** The repository-scoped id every Team scope is keyed on. */
	repoId: string;
	/** Which source produced `repoId`. */
	source: IdentitySource;
	/**
	 * A short, non-secret description of how the id was derived,
	 * surfaced by `kevin_project show`. Never contains a credential
	 * or an absolute path.
	 */
	evidence: string;
	/** The v0.7.0 project scope, always returned regardless of source. */
	projectId: string;
}

/**
 * Read the first `url = …` value inside `[remote "<name>"]` of a
 * `.git/config`-style INI text.
 *
 * Line-oriented reader, not an INI library: tracks the current
 * `[section "sub"]` header, tolerates tabs, spaces around `=`,
 * CRLF, and comment lines. Returns `null` on anything unrecognised
 * and never throws — on any input, including binary.
 */
export function parseGitConfigRemote(
	text: string,
	name = "origin",
): string | null {
	// Never throw on any input, including binary and huge strings.
	if (typeof text !== "string" || text.length === 0) return null;

	const lines = text.split(/\r\n|\n|\r/);
	let currentSection: string | null = null;
	let currentSub: string | null = null;

	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) continue;
		if (COMMENT_RE.test(line)) continue;

		// Section header: `[section "sub"]` or `[section]`.
		if (line.startsWith("[")) {
			const header = line.slice(1, line.indexOf("]"));
			if (header === null) return null;
			const q = header.indexOf('"');
			if (q === -1) {
				currentSection = header.trim();
				currentSub = null;
			} else {
				currentSection = header.slice(0, q).trim();
				const sub = header.slice(q + 1, header.lastIndexOf('"'));
				currentSub = sub;
			}
			continue;
		}

		if (currentSection !== "remote") continue;

		const eq = line.indexOf("=");
		if (eq === -1) return null;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (key !== "url") continue;
		if (currentSub === name) return value;
	}
	return null;
}

/**
 * Fold the URL shapes git accepts into one canonical string.
 *
 * Steps, in order (K8-005):
 *   1. strip a trailing `.git`;
 *   2. strip a `scheme://` prefix;
 *   3. strip everything up to and including the last `@` in the
 *      authority (userinfo and embedded credentials — a token must
 *      never reach a hash that lands in a committed file, D8-04);
 *   4. strip a numeric port (`:8443`, `:443`, …) so the same repo
 *      served over different transports folds to one id;
 *   5. rewrite the scp-style `host:path` separator to `host/path`;
 *   6. strip a trailing `/`;
 *   7. lowercase the whole result.
 *
 * Returns `null` when the result contains no `/` (e.g. a local
 * path remote) — the caller falls through to the path source.
 */
export function normalizeRemote(url: string): string | null {
	if (typeof url !== "string" || url.length === 0) return null;

	// 1. Strip a trailing `.git` (case-insensitive for file names
	//    like `App.GIT`; hosts are lowercased later anyway).
	let s = url.replace(/\.git$/i, "");

	// 2. Strip a `scheme://` prefix — any scheme, including
	//    `ssh://`, `https://`, `git://`, `file://`. A `file://`
	//    remote collapses to a local path and will fall through.
	s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");

	// 3. Strip userinfo: everything up to and including the last
	//    `@` in the authority. `https://user:token@host/…` and
	//    `ssh://git@host/…` both lose the credential half here,
	//    before anything else can retain a copy.
	const at = s.lastIndexOf("@");
	if (at !== -1) s = s.slice(at + 1);

	// 4. Strip a numeric port: `https://host:8443/org/repo`, `host:8443/
	//    org/repo` and `host/org/repo` are the same repository served
	//    over different transports — they must fold to one id or the
	//    team silently splits by transport form. The scp-style
	//    `host:path` form (path not starting with digits) is rewritten
	//    by the step below.
	s = s.replace(/^([^/]+):(\d+)(\/|$)/, "$1$3");

	// 5. scp-style `host:path` → `host/path`. The first `:` that
	//    remains is the separator; everything after it is the path.
	//    After step 3 there is no userinfo `:` left to confuse it.
	const colon = s.indexOf(":");
	if (colon !== -1) {
		s = `${s.slice(0, colon)}/${s.slice(colon + 1)}`;
	}

	// 6. Strip a trailing `/`.
	s = s.replace(/\/+$/, "");

	// 7. Lowercase.
	s = s.toLowerCase();

	if (s.length === 0) return null;

	// Anything without a `/` is a bare host or a bare local name,
	// not a remote repository path — the caller falls through.
	if (!s.includes("/")) return null;

	// A leading `/` means the remote is a local filesystem path
	// (e.g. `/srv/git/bare.git` or a `file://` remote) — plan §5.1's
	// fifth fixture — and the caller falls through to source 3.
	if (s.startsWith("/")) return null;

	return s;
}

/**
 * Derive a repository id from a normalized remote (K8-006).
 *
 * The domain prefix means a repo id can never collide with a memory
 * fingerprint computed over the same string, and it leaves room to
 * version the derivation later.
 */
export function computeRepoId(normalized: string): string {
	return fnv1a64(`okf:repo:v1\u0000${normalized}`);
}

/**
 * Resolve the repository identity for `cwd`, trying the four
 * sources in order (plan §5.2, D9-13):
 *
 *   1. `declared` — `.kevin/project.json` → `id` (validated as
 *      exactly 16 lowercase hex characters; anything else is ignored
 *      and falls through, because a hand-edited garbage id in a
 *      committed file would otherwise scope a whole team's corpus
 *      onto a typo);
 *   2. `remote` — `.git/config` → `[remote "origin"] url`,
 *      normalized and hashed;
 *   3. `host` — the value the host resolved for this directory,
 *      `host.project.worktree` first, `host.project.directory` as
 *      fallback; both empty or absent falls through to `path`.
 *      This is strictly better than `process.cwd()` — the host's own
 *      ToolContext documents "prefer this over `process.cwd()`" —
 *      but it sits below the explicit sources, because monorepos and
 *      D8-03's confirmed re-keying depend on `.kevin/project.json`
 *      winning;
 *   4. `path` — `fingerprint(cwd)`, the v0.7.0 behaviour, preserved
 *      exactly when `host` is absent.
 *
 * Never throws: a directory that is not a git repository, an
 * unreadable `.git/config`, a malformed `project.json`, and a host
 * with no usable project fields all fall through to source 4.
 * `projectId` is always returned alongside `repoId`, regardless of
 * which source won.
 */
export function resolve(cwd: string, host?: HostSurface): ResolvedIdentity {
	const projectId = fingerprint(cwd);

	// 1. Declared.
	try {
		const raw = readFileSync(join(cwd, PROJECT_JSON_PATH), "utf8");
		const parsed = JSON.parse(raw) as { id?: unknown };
		if (typeof parsed.id === "string" && DECLARED_ID_RE.test(parsed.id)) {
			return {
				repoId: parsed.id,
				source: "declared",
				evidence: ".kevin/project.json#id",
				projectId,
			};
		}
	} catch {
		// Missing, unreadable, or malformed — fall through.
	}

	// 2. Remote.
	try {
		const config = readFileSync(join(cwd, GIT_CONFIG_PATH), "utf8");
		const url = parseGitConfigRemote(config);
		const normalized = url === null ? null : normalizeRemote(url);
		if (normalized !== null) {
			return {
				repoId: computeRepoId(normalized),
				source: "remote",
				evidence: `remote:${normalized}`,
				projectId,
			};
		}
	} catch {
		// Unreadable or missing — fall through.
	}

	// 3. Host — the value the host already resolved for this
	//    directory (D9-13), inserted above `path` and below the two
	//    explicit sources. `worktree` first, `directory` as fallback;
	//    both empty or absent falls through. The chosen value feeds
	//    the unchanged `computeRepoId()` — this chain changes which
	//    string is hashed, never how.
	const worktree = host?.project?.worktree;
	if (typeof worktree === "string" && worktree.length > 0) {
		return {
			repoId: computeRepoId(worktree),
			source: "host",
			evidence: "host:worktree",
			projectId,
		};
	}
	const directory = host?.project?.directory;
	if (typeof directory === "string" && directory.length > 0) {
		return {
			repoId: computeRepoId(directory),
			source: "host",
			evidence: "host:directory",
			projectId,
		};
	}

	// 4. Path — the v0.7.0 behaviour, preserved exactly.
	return { repoId: projectId, source: "path", evidence: "cwd", projectId };
}

/**
 * The outcome of `initProjectFile` (K8-008).
 */
export interface InitProjectResult {
	/** Whether the file was written. */
	ok: boolean;
	/** The absolute path the file was written to, or refused. */
	path: string;
	/** Human-readable refusal reason when `ok` is false. */
	reason?: string;
	/** The pinned id when the file was written. */
	id?: string;
	/** The ISO-8601 Z timestamp written into the file. */
	createdAt?: string;
}

/**
 * Write `.kevin/project.json` pinning the repository identity (K8-008
 * / plan §5.8). The id comes from the current `resolve(cwd)` — so `init`
 * in a repository with a remote *pins* the remote-derived id, which is
 * the point: it survives the organisation renaming the repo (a remote
 * URL change would otherwise silently re-scope the corpus).
 *
 * The file is `{"id": "<16 hex>", "created_at": "<ISO-8601 Z>",
 * "generator": "opencode-kevin/0.8.0"}` with sorted keys and a
 * terminating newline (deterministic bytes, the codec discipline of
 * plan §7.3). `init` refuses when the file already exists: overwriting
 * it re-scopes a team's corpus, and that is `rekey`'s job (K8-009),
 * with a confirmation.
 *
 * NOTE (K8-019): the write goes through `ArtifactWriter` in whole-file
 * mode — `.kevin/project.json` is a Kevin-owned file, and D8-08 leaves
 * no scenario in which a second raw write path is acceptable (asserted
 * by tests/unit/single_write_path.test.ts).
 */
export function initProjectFile(
	cwd: string,
	writer: ArtifactWriter,
): InitProjectResult {
	const path = join(cwd, PROJECT_JSON_PATH);
	try {
		readFileSync(path, "utf8");
		return {
			ok: false,
			path,
			reason: `.kevin/project.json already exists — overwriting it would re-scope the corpus; use "kevin_project rekey" instead`,
		};
	} catch {
		// Absent or unreadable — proceed.
	}

	const id = resolve(cwd).repoId;
	const createdAt = new Date().toISOString();
	const payload = `${JSON.stringify({
		created_at: createdAt,
		generator: "opencode-kevin/0.9.0",
		id,
	})}\n`;
	try {
		mkdirSync(join(cwd, ".kevin"), { recursive: true });
		const outcome = writer.write({ path, mode: "whole", content: payload });
		if (outcome !== "written") {
			return {
				ok: false,
				path,
				reason: `could not write .kevin/project.json: ${outcome}`,
			};
		}
		return { ok: true, path, id, createdAt };
	} catch (err) {
		return {
			ok: false,
			path,
			reason: `could not write .kevin/project.json: ${(err as { message?: string })?.message ?? "unknown error"}`,
		};
	}
}

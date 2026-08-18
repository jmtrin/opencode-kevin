import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "../../plugin/RepoIdentity.js";
import { Store } from "../../plugin/Store.js";
import { fingerprint } from "../../plugin/fingerprint.js";
import { KevinPlugin } from "../../plugin/index.js";
import { computeEntryId } from "../../plugin/okf.js";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-rekey-session-"));
	drops = [];
});

afterEach(() => {
	for (const d of [...drops, tmpRoot]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of readdirSync(join(process.cwd(), "migrations"))) {
		if (file.startsWith("00") || file === "009_v08_team.sql") {
			copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
		}
	}
	return dir;
}

function makeCtx(sess: string): ToolContext {
	return {
		sessionID: sess,
		messageID: "m",
		agent: "test",
		directory: tmpRoot,
		worktree: tmpRoot,
		abort: new AbortController().signal,
		metadata() {},
		ask() {
			return Promise.resolve();
		},
	};
}

async function boot(
	projectRoot: string,
	dbPath: string,
): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: projectRoot } as PluginInput, {
		dbPath,
		migrationsDir: makeMigrationsDir(),
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		projectRoot,
	});
}

const REMOTE_FIXTURE = `[core]
	repositoryformatversion = 0
[remote "origin"]
	url = https://user:ghp_fake_token@github.com/acme/app.git
	fetch = +refs/heads/*:refs/remotes/origin/*
`;

function writeGitRemote(projectRoot: string): void {
	mkdirSync(join(projectRoot, ".git"), { recursive: true });
	writeFileSync(join(projectRoot, ".git", "config"), REMOTE_FIXTURE);
}

// The plugin resolves the session identity once at init against the
// process working directory (K4-019 / K8-006) — the same id the SharedLayer
// bridge, MemoryService and Curator are built with.
const SESSION_ID = resolve(process.cwd()).repoId;

// Seed a curated local memory under the session id — the exact shape
// kevin_share's no-memory_ids auto-selection looks for.
function seedCuratedLocal(dbPath: string, id: string): void {
	const s = new Store({ path: dbPath });
	s.prepare(
		`INSERT INTO memories
		 (id, type, content, scope, relevance_score, project_id, evidence_count,
		  recurrence_count, created_at, updated_at, status, curated, inferable,
		  origin, layer, repo_id)
		 VALUES (?, 'rule', ?, 'project', 0.3, ?, 6, 0, datetime('now'),
		  datetime('now'), 'active', 1, 1, 'pattern', 'local', ?)`,
	).run(id, `local rule ${id}`, resolve(process.cwd()).projectId, SESSION_ID);
	s.close();
}

async function runShare(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_share.execute(
		{ dry_run: true } as never,
		makeCtx("share-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

async function runRekey(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	confirm: boolean,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_project.execute(
		{ action: "rekey", confirm } as never,
		makeCtx("rekey-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

async function runStatus(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
): Promise<{ v08: { repo_id: string } }> {
	const r = await hooks.tool?.kevin_status.execute({}, makeCtx("st-sess"));
	return JSON.parse((r as { output: string }).output) as {
		v08: { repo_id: string };
	};
}

describe("BUG-001/002 — the session identity follows a confirmed rekey", () => {
	it("kevin_share keeps seeing the corpus in-session: dry-run rekey leaves the session untouched, confirmed rekey aligns it", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);
		const live = resolve(projectRoot);
		expect(live.source).toBe("remote");

		seedCuratedLocal(dbPath, "m-share-1");

		// Pre-rekey: auto-selection finds the memory under the session id.
		const before = await runShare(hooks);
		expect(before.dry_run).toBe(true);
		expect(before.memory_ids as string[]).toContain("m-share-1");

		// Dry run: nothing mutates, the session stays on the old id.
		const dry = await runRekey(hooks, false);
		expect(dry.ok).toBe(true);
		expect(dry.dry_run).toBe(true);
		expect((await runStatus(hooks)).v08.repo_id).toBe(SESSION_ID);

		// Confirmed rekey: rows move AND the session follows them.
		const res = await runRekey(hooks, true);
		expect(res.ok).toBe(true);
		expect(res.rekeyed).toBe(true);
		expect((await runStatus(hooks)).v08.repo_id).toBe(live.repoId);

		// The regression: kevin_share must still see the corpus after the
		// rekey — before the fix it queried the stale init-time id and the
		// plugin was blind to its own corpus until a restart.
		const after = await runShare(hooks);
		expect(after.dry_run).toBe(true);
		expect(after.memory_ids as string[]).toContain("m-share-1");
		await hooks.dispose?.();
	});
});

describe("BUG-003 — a confirmed rekey heals a stale #repo file header", () => {
	it("rewrites only the header line, preserving entry bytes and line endings, and un-blocks the channel", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);
		const live = resolve(projectRoot);
		const stored = fingerprint(projectRoot);

		// A file committed under the path identity: stale header, CRLF
		// endings, one valid entry line.
		const okfDir = join(projectRoot, ".kevin");
		mkdirSync(okfDir, { recursive: true });
		const entryLine = `{"entry_id":"${computeEntryId("rule", "team rule", null)}","type":"rule","statement":"team rule","scope":null,"evidence":4,"recurrence":0,"origin":"pattern","author_hash":null,"op":"assert","created_at":"2026-08-18T00:00:00Z","supersedes":null}`;
		writeFileSync(
			join(okfDir, "knowledge.okf"),
			`#okf 2\r\n#repo ${stored}\r\n#generated-by opencode-kevin/0.8.0\r\n${entryLine}\r\n`,
		);
		seedCuratedLocal(dbPath, "m-share-2");

		// Pre-rekey the bridge is on the session id and the file claims the
		// path id: the export must refuse with repo_mismatch.
		const refused = await runShare(hooks);
		expect(refused.refused).toBe("repo_mismatch");

		// Confirmed rekey heals the header to the new scope.
		const res = await runRekey(hooks, true);
		expect(res.ok).toBe(true);
		const healed = readFileSync(join(okfDir, "knowledge.okf"), "utf8");
		const lines = healed.split("\r\n");
		expect(lines[1]).toBe(`#repo ${live.repoId}`);
		expect(lines[0]).toBe("#okf 2");
		expect(lines[2]).toBe("#generated-by opencode-kevin/0.8.0");
		expect(lines[3]).toBe(entryLine);
		// EOL preserved, single trailing newline preserved.
		expect(healed.endsWith("\r\n")).toBe(true);
		expect(healed).toContain(`${entryLine}\r\n`);
		expect(healed).not.toContain("\n\n");

		// The channel is live again: no repo_mismatch, entry lands in the plan.
		const after = await runShare(hooks);
		expect(after.refused).toBeUndefined();
		expect(after.memory_ids as string[]).toContain("m-share-2");
		await hooks.dispose?.();
	});
});

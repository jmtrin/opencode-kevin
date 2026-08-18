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
import { MemoryService } from "../../plugin/MemoryService.js";
import { resolve } from "../../plugin/RepoIdentity.js";
import { Store } from "../../plugin/Store.js";
import { fingerprint } from "../../plugin/fingerprint.js";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-rekey-"));
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

// Seed rows under the single-machine configuration: both columns scoped on
// the path fingerprint (what migration 009's back-fill leaves behind).
function seedUnderFingerprint(
	dbPath: string,
	projectId: string,
	n: number,
): void {
	const s = new Store({ path: dbPath });
	const svc = new MemoryService(s, null, projectId);
	for (let i = 0; i < n; i++) {
		svc.save({
			type: "decision",
			content: `project row ${i}`,
			scope: "project",
			projectId,
		});
	}
	s.close();
}

// A repo_id NULL row — global by design, must never move on rekey.
function seedGlobalRow(dbPath: string): void {
	const s = new Store({ path: dbPath });
	const svc = new MemoryService(s, null, null);
	svc.save({ type: "rule", content: "global row", scope: "project" });
	s.close();
}

function seedSharedAndImport(dbPath: string, repoId: string): void {
	const s = new Store({ path: dbPath });
	s.prepare(
		`INSERT INTO shared_entries
		 (id, repo_id, entry_id, type, statement, created_at)
		 VALUES ('se-1', ?, 'entry-1', 'decision', 'shared decision', datetime('now'))`,
	).run(repoId);
	s.prepare(
		`INSERT INTO okf_imports (id, repo_id, path) VALUES ('oi-1', ?, '.kevin/knowledge.okf')`,
	).run(repoId);
	s.close();
}

function scopedCounts(
	dbPath: string,
	repoId: string,
): {
	memories: number;
	shared_entries: number;
	okf_imports: number;
	global: number;
} {
	const s = new Store({ path: dbPath });
	const c = (sql: string, ...params: unknown[]): number =>
		(s.prepare(sql).get(...params) as { c: number }).c;
	const out = {
		memories: c("SELECT COUNT(*) AS c FROM memories WHERE repo_id = ?", repoId),
		shared_entries: c(
			"SELECT COUNT(*) AS c FROM shared_entries WHERE repo_id = ?",
			repoId,
		),
		okf_imports: c(
			"SELECT COUNT(*) AS c FROM okf_imports WHERE repo_id = ?",
			repoId,
		),
		global: c("SELECT COUNT(*) AS c FROM memories WHERE repo_id IS NULL"),
	};
	s.close();
	return out;
}

function rekeyEvents(dbPath: string): number {
	const s = new Store({ path: dbPath });
	const row = s
		.prepare("SELECT value AS v FROM kevin_metrics WHERE key = 'rekey_events'")
		.get() as { v: number } | undefined;
	s.close();
	return row?.v ?? 0;
}

async function runRekey(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	args: { action: "rekey"; confirm?: boolean; force?: boolean },
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_project.execute(
		args as never,
		makeCtx("rekey-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K8-009 — kevin_project rekey (plan §5.1, D8-03)", () => {
	it("dry run without confirm reports per-table counts, from which value to which, and mutates nothing", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);

		const identity = resolve(projectRoot);
		expect(identity.source).toBe("remote");
		const stored = fingerprint(projectRoot);
		seedUnderFingerprint(dbPath, stored, 3);
		seedGlobalRow(dbPath);
		seedSharedAndImport(dbPath, stored);

		const res = await runRekey(hooks, { action: "rekey" });
		expect(res.ok).toBe(true);
		expect(res.dry_run).toBe(true);
		expect(res.rekeyed).toBeUndefined();
		expect(res.to_repo_id).toBe(identity.repoId);
		expect(res.rows).toEqual({
			memories: 3,
			shared_entries: 1,
			okf_imports: 1,
		});
		// From which value: the stored fingerprint; nothing stored elsewhere.
		expect(res.from).toEqual({
			[stored]: { memories: 3, shared_entries: 1, okf_imports: 1 },
		});
		expect(res.collision).toBe(false);

		// Nothing mutated, rekey_events untouched.
		const after = scopedCounts(dbPath, stored);
		expect(after).toEqual({
			memories: 3,
			shared_entries: 1,
			okf_imports: 1,
			global: 1,
		});
		expect(scopedCounts(dbPath, identity.repoId)).toEqual({
			memories: 0,
			shared_entries: 0,
			okf_imports: 0,
			global: 1,
		});
		expect(rekeyEvents(dbPath)).toBe(0);
	});

	it("confirmed rekey moves memories, shared_entries and okf_imports in one transaction and increments rekey_events by exactly 1", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);

		const identity = resolve(projectRoot);
		const stored = fingerprint(projectRoot);
		seedUnderFingerprint(dbPath, stored, 3);
		seedGlobalRow(dbPath);
		seedSharedAndImport(dbPath, stored);

		const res = await runRekey(hooks, {
			action: "rekey",
			confirm: true,
		});
		expect(res.ok).toBe(true);
		expect(res.rekeyed).toBe(true);
		expect(res.dry_run).toBeUndefined();

		const after = scopedCounts(dbPath, identity.repoId);
		expect(after).toEqual({
			memories: 3,
			shared_entries: 1,
			okf_imports: 1,
			global: 1,
		});
		// The global NULL row never moved.
		expect(scopedCounts(dbPath, stored)).toEqual({
			memories: 0,
			shared_entries: 0,
			okf_imports: 0,
			global: 1,
		});
		expect(rekeyEvents(dbPath)).toBe(1);

		// A second confirmed run has nothing to move and does not double-count.
		const res2 = await runRekey(hooks, {
			action: "rekey",
			confirm: true,
		});
		expect(res2.ok).toBe(true);
		expect(res2.rekeyed).toBe(false);
		expect((res2.rows as { memories: number }).memories).toBe(0);
		expect(rekeyEvents(dbPath)).toBe(1);
	});

	it("an injected mid-way failure leaves the database completely unchanged and rekey_events at 0", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);

		const identity = resolve(projectRoot);
		const stored = fingerprint(projectRoot);
		seedUnderFingerprint(dbPath, stored, 3);
		seedSharedAndImport(dbPath, stored);

		// The third statement of the rekey transaction raises — the whole
		// transaction (including the memories UPDATE) must roll back.
		const s = new Store({ path: dbPath });
		s.exec(
			`CREATE TRIGGER fail_rekey BEFORE UPDATE ON okf_imports
			 BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
		);
		s.close();

		const res = await runRekey(hooks, {
			action: "rekey",
			confirm: true,
		});
		expect(res.ok).toBe(false);
		expect(res.reason).toContain("revirtio");
		expect(rekeyEvents(dbPath)).toBe(0);
		const after = scopedCounts(dbPath, stored);
		expect(after).toEqual({
			memories: 3,
			shared_entries: 1,
			okf_imports: 1,
			global: 0,
		});
	});

	it("refuses a monorepo collision unless force is passed, and then merges", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath);

		const identity = resolve(projectRoot);
		const stored = fingerprint(projectRoot);
		seedUnderFingerprint(dbPath, stored, 2);
		// Rows already under the target repo_id, belonging to another
		// project_id set — the monorepo witness.
		const s = new Store({ path: dbPath });
		s.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, relevance_score, project_id, fingerprint,
			  origin, evidence_count, status, created_at, updated_at, layer, repo_id)
			 VALUES ('m-target-1', 'decision', 'other corpus', 'project', 0.5, 'corpus-a',
			  NULL, 'agent', 1, 'active', datetime('now'), datetime('now'), 'local', ?)`,
		).run(identity.repoId);
		s.close();

		const refused = await runRekey(hooks, {
			action: "rekey",
			confirm: true,
		});
		expect(refused.ok).toBe(false);
		expect(refused.collision).toBe(true);
		expect(refused.reason).toContain("monorepo");
		expect(rekeyEvents(dbPath)).toBe(0);
		// Nothing moved.
		expect(scopedCounts(dbPath, stored).memories).toBe(2);

		// The explicit second flag overrides the refusal.
		const forced = await runRekey(hooks, {
			action: "rekey",
			confirm: true,
			force: true,
		});
		expect(forced.ok).toBe(true);
		expect(forced.rekeyed).toBe(true);
		const merged = scopedCounts(dbPath, identity.repoId);
		expect(merged.memories).toBe(3);
		expect(rekeyEvents(dbPath)).toBe(1);
	});

	it("no code path outside the kevin_project tool handler calls performRekey (source scan)", () => {
		const pluginDir = join(process.cwd(), "plugin");
		const hits: Record<string, number> = {};
		for (const f of readdirSync(pluginDir)) {
			if (!f.endsWith(".ts")) continue;
			const src = readFileSync(join(pluginDir, f), "utf8");
			const n = src.match(/performRekey\(/g)?.length ?? 0;
			if (n > 0) hits[f] = n;
		}
		// Exactly two occurrences, both in index.ts: the export definition
		// and the single call inside the kevin_project tool handler.
		expect(hits).toEqual({ "index.ts": 2 });
	});
});

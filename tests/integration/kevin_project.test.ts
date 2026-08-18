import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../../plugin/ArtifactWriter.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { initProjectFile, resolve } from "../../plugin/RepoIdentity.js";
import { Store } from "../../plugin/Store.js";
import { fingerprint } from "../../plugin/fingerprint.js";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-project-"));
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

function makeMigrationsDir(include009: boolean): string {
	const dir = join(tmpRoot, "migrations");
	mkdirSync(dir, { recursive: true });
	const files = [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	];
	if (include009) files.push("009_v08_team.sql");
	for (const file of files) {
		copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
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
	migrationsDir: string,
): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: projectRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		projectRoot,
	});
}

// A git remote with embedded credentials — the token must never surface.
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

async function runShow(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_project.execute(
		{ action: "show" } as never,
		makeCtx("proj-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K8-008 — .kevin/project.json + kevin_project show/init (plan §5.8)", () => {
	it("show on an unmigrated corpus with a git remote reports rekey_available and never leaks secrets", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath, makeMigrationsDir(false));

		const before = resolve(projectRoot);
		expect(before.source).toBe("remote");
		seedUnderFingerprint(dbPath, fingerprint(projectRoot), 3);

		const report = await runShow(hooks);
		expect(report.action).toBe("show");
		expect(report.source).toBe("remote");
		expect(report.repo_id).toBe(before.repoId);
		expect(report.evidence).toBe("remote:github.com/acme/app");
		expect(report.project_id).toBe(before.projectId);
		expect(report.memories_total).toBe(3);
		// Unmigrated corpus: nothing stored under repo_id yet.
		expect(report.memories_repo_id).toBe(0);
		expect(report.memories_project_id).toBe(3);
		expect(report.rekey_available).toBe(true);
		expect(report.project_json).toBe("absent");

		// Never a credential, an absolute path, or a raw remote URL.
		const raw = JSON.stringify(report);
		expect(raw).not.toContain("ghp_fake_token");
		expect(raw).not.toContain("token");
		expect(raw).not.toContain("user:");
		expect(raw).not.toContain("github.com/acme/app.git");
		expect(raw).not.toContain(projectRoot);
		expect(raw).not.toContain(tmpRoot);
	});

	it("show on a 009-migrated corpus scoped on the path fingerprint reports rekey_available when a remote is present, false when there is none", async () => {
		const withRemote = mkdtempSync(join(tmpRoot, "remote"));
		drops.push(withRemote);
		writeGitRemote(withRemote);
		const dbRemote = join(tmpRoot, "kevin-remote.db");
		const hooksRemote = await boot(
			withRemote,
			dbRemote,
			makeMigrationsDir(true),
		);
		seedUnderFingerprint(dbRemote, fingerprint(withRemote), 4);
		const reportRemote = await runShow(hooksRemote);
		// Back-filled rows sit under repo_id = project_id = fingerprint,
		// which differs from the remote-derived id.
		expect(reportRemote.memories_total).toBe(4);
		expect(reportRemote.memories_repo_id).toBe(0);
		expect(reportRemote.rekey_available).toBe(true);

		const noRemote = mkdtempSync(join(tmpRoot, "plain"));
		drops.push(noRemote);
		const dbPlain = join(tmpRoot, "kevin-plain.db");
		const hooksPlain = await boot(noRemote, dbPlain, makeMigrationsDir(true));
		seedUnderFingerprint(dbPlain, fingerprint(noRemote), 2);
		const reportPlain = await runShow(hooksPlain);
		// No remote: resolved repoId === path fingerprint === stored scope.
		expect(reportPlain.source).toBe("path");
		expect(reportPlain.memories_repo_id).toBe(2);
		expect(reportPlain.memories_project_id).toBe(2);
		expect(reportPlain.rekey_available).toBe(false);
	});

	it("init writes a sorted-keys file with terminating newline and pins the resolved id; a second init refuses and writes nothing", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot, dbPath, makeMigrationsDir(false));

		const before = resolve(projectRoot);
		const r = await hooks.tool?.kevin_project.execute(
			{ action: "init" } as never,
			makeCtx("init-sess"),
		);
		const out = JSON.parse((r as { output: string }).output) as Record<
			string,
			unknown
		>;
		expect(out.written).toBe(true);
		expect(out.id).toBe(before.repoId);
		expect(out.generator).toBe("opencode-kevin/0.8.0");

		const filePath = join(projectRoot, ".kevin", "project.json");
		const raw = readFileSync(filePath, "utf8");
		expect(raw.endsWith("\n")).toBe(true);
		// Sorted keys: created_at < generator < id.
		const parsed = JSON.parse(raw) as Record<string, string>;
		expect(Object.keys(parsed)).toEqual(["created_at", "generator", "id"]);
		expect(parsed.id).toBe(before.repoId);
		expect(parsed.generator).toBe("opencode-kevin/0.8.0");
		expect(parsed.created_at).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		);

		// Pinning must not change the resolved value; the source flips to
		// declared and outranks the remote.
		const after = resolve(projectRoot);
		expect(after.source).toBe("declared");
		expect(after.repoId).toBe(before.repoId);

		// Second init refuses and writes nothing.
		const beforeBytes = readFileSync(filePath, "utf8");
		const r2 = await hooks.tool?.kevin_project.execute(
			{ action: "init" } as never,
			makeCtx("init2-sess"),
		);
		const out2 = JSON.parse((r2 as { output: string }).output) as Record<
			string,
			unknown
		>;
		expect(out2.written).toBe(false);
		expect(out2.reason).toContain("rekey");
		expect(readFileSync(filePath, "utf8")).toBe(beforeBytes);

		// show now reports declared + present.
		const report = await runShow(hooks);
		expect(report.source).toBe("declared");
		expect(report.project_json).toBe("present");
	});

	it("initProjectFile refuses when the file already exists and writes nothing (direct unit path)", () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		writeGitRemote(projectRoot);
		const store = new Store({ path: ":memory:" });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
			"007_v06_pull.sql",
		]) {
			store.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
		}
		const writer = new ArtifactWriter(store, "test-project");
		const first = initProjectFile(projectRoot, writer);
		expect(first).toMatchObject({ ok: true });
		expect(first.id).toBe(resolve(projectRoot).repoId);
		const second = initProjectFile(projectRoot, writer);
		expect(second.ok).toBe(false);
		expect(second.reason).toContain("rekey");
		const raw = readFileSync(
			join(projectRoot, ".kevin", "project.json"),
			"utf8",
		);
		expect(raw).toBe(
			`${JSON.stringify({
				created_at: first.createdAt,
				generator: "opencode-kevin/0.8.0",
				id: first.id,
			})}\n`,
		);
	});
});

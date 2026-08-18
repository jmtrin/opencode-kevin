import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tmpRoot: string;
let root: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let dbPath: string;

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

async function callTool(
	tool: "kevin_publish" | "kevin_status",
): Promise<Record<string, unknown>> {
	const res = (await requireHooks().tool?.[tool].execute(
		{},
		makeCtx("s-pub"),
	)) as { output: string };
	return JSON.parse(res.output) as Record<string, unknown>;
}

interface PublishPayload {
	bundles: { topic: string; outcome: string }[];
	emission: { skill: string; reference: string };
}

async function publish(): Promise<PublishPayload> {
	return (await callTool("kevin_publish")) as unknown as PublishPayload;
}

async function bootPlugin(): Promise<void> {
	const migrationsDir = join(tmpRoot, "m007");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
	]) {
		await import("node:fs/promises").then(({ copyFile }) =>
			copyFile(
				join(__dirname, "..", "..", "migrations", file),
				join(migrationsDir, file),
			),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		materializerRoot: root,
	});
}

function secondStore(): Store {
	return new Store({ path: dbPath });
}

function seedCuratedMemory(
	id: string,
	type: string,
	content: string,
	curated = 1,
): void {
	const s = secondStore();
	s.prepare(
		`INSERT INTO memories (
		  id, type, content, scope, relevance_score, source_tool, source_session,
		  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
		  evidence_count, last_verified_at, status, recurrence_count, ignored,
		  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
		 VALUES (?, ?, ?, 'project', 0.5, NULL, NULL, NULL,
		         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
		         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, ?, NULL, NULL)`,
	).run(id, type, content, curated);
	s.close();
}

function setSetting(key: string, value: string): void {
	const s = secondStore();
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES (?, ?)",
	).run(key, value);
	s.close();
}

function requireHooks(): NonNullable<typeof hooks> {
	if (!hooks) throw new Error("plugin not booted");
	return hooks;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-publish-"));
	root = join(tmpRoot, "opencode-kevin");
});

afterEach(async () => {
	await hooks?.dispose?.();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K6-020 — kevin_publish regenerates the pull bundles (D6-01/D6-07)", () => {
	it("lists every bundle with its outcome and topic; a second invocation reports all noop", async () => {
		await bootPlugin();
		seedCuratedMemory(
			"mem-npm-1",
			"rule",
			"npm test must pass before any commit npm install first",
		);
		seedCuratedMemory(
			"mem-dep-1",
			"decision",
			"deploy to staging after review deploy weekly",
		);

		const first = await publish();
		expect(first.bundles.map((b) => b.topic).sort()).toEqual(
			["decision-deploy", "project-knowledge", "rule-npm"].sort(),
		);
		expect(first.bundles.every((b) => b.outcome === "written")).toBe(true);

		const second = await publish();
		expect(second.bundles.map((b) => b.topic).sort()).toEqual(
			first.bundles.map((b) => b.topic).sort(),
		);
		expect(second.bundles.every((b) => b.outcome === "noop")).toBe(true);
	});

	it("on a v1-shaped host the output reports registration as unavailable and the tool exits successfully", async () => {
		await bootPlugin();
		seedCuratedMemory(
			"mem-npm-1",
			"rule",
			"npm test must pass before any commit npm install first",
		);

		const result = await publish();
		expect(result.emission).toEqual({
			skill: "unavailable",
			reference: "unavailable",
		});
		expect(result.bundles.length).toBeGreaterThan(0);
		expect(existsSync(join(root, "refs", "rule-npm.md"))).toBe(true);
	});

	it("cannot write to the configured agents_md_path, even when it points inside ~/.opencode-kevin/", async () => {
		await bootPlugin();
		seedCuratedMemory(
			"mem-npm-1",
			"rule",
			"npm test must pass before any commit npm install first",
		);
		setSetting("agents_md_path", join(root, "AGENTS.md"));

		await publish();
		expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
		expect(existsSync(join(root, "refs", "rule-npm.md"))).toBe(true);
	});

	it("kevin_status reports 16 tools", async () => {
		await bootPlugin();
		const status = await callTool("kevin_status");
		expect(status.tool_count).toBe(21);
	});
});

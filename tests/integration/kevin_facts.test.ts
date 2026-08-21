import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { RepoTruth } from "../../plugin/RepoTruth.js";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";
import { buildKevinFacts } from "../../plugin/kevin_facts.js";
import { Metrics } from "../../plugin/metrics.js";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-facts-"));
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
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	]) {
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
): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: projectRoot } as PluginInput, {
		dbPath: ":memory:",
		migrationsDir: makeMigrationsDir(),
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		projectRoot,
	});
}

async function runFacts(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	refresh: boolean,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_facts.execute(
		{ refresh } as never,
		makeCtx("facts-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K7-009 — kevin_facts tool", () => {
	it("registers the tool and the ladder is at 25 tools (v1.0.0 adds kevin_contract, kevin_bench)", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const hooks = await boot(projectRoot);
		expect(hooks.tool?.kevin_facts).toBeDefined();
		const toolNames = Object.keys(hooks.tool ?? {});
		expect(toolNames).toContain("kevin_facts");
		expect(toolNames).toHaveLength(25);
	});

	it("default invocation reads stored facts and performs no JSON.parse; refresh:true re-scans", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj2"));
		drops.push(projectRoot);
		writeFileSync(
			join(projectRoot, "package.json"),
			JSON.stringify({ scripts: { test: "vitest run" } }),
		);
		writeFileSync(
			join(projectRoot, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		const hooks = await boot(projectRoot);
		// The root scan is disabled by default (repo_truth_enabled = '0'), so
		// no facts are stored until an explicit refresh. Each test call does
		// exactly one JSON.parse — reading the tool output JSON. A default
		// call therefore yields exactly ONE parse; a refresh:true call yields
		// THREE (the output read plus the two fixture files).
		const spy = vi.spyOn(JSON, "parse");
		spy.mockClear();
		const first = await runFacts(hooks, false);
		expect(spy).toHaveBeenCalledTimes(1); // only the output read, no file scan
		expect((first.facts as unknown[]).length).toBe(0);
		// Default again: still no file scan.
		spy.mockClear();
		await runFacts(hooks, false);
		expect(spy).toHaveBeenCalledTimes(1);

		// refresh:true performs exactly two MORE parses (the two files).
		spy.mockClear();
		const refreshed = await runFacts(hooks, true);
		expect(spy).toHaveBeenCalledTimes(3); // output read + package.json + tsconfig.json
		spy.mockRestore();
		const keys = (refreshed.facts as { key_path: string }[]).map(
			(f) => f.key_path,
		);
		expect(keys).toContain("scripts.test");
	});

	it("penalized lists only memories with truth_penalty > 0 and includes their reasons", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, makeMigrationsDir()).run();
		const metrics = new Metrics(store);
		const svc = new MemoryService(store, metrics);
		const projectRoot = mkdtempSync(join(tmpRoot, "proj3"));
		drops.push(projectRoot);
		// scripts.lint deliberately absent so the memory is contradicted.
		writeFileSync(
			join(projectRoot, "package.json"),
			JSON.stringify({ name: "x" }),
		);
		const truth = new RepoTruth(store, "proj-p", projectRoot);
		truth.scan();

		svc.save({
			id: "mem-lint",
			type: "decision",
			content: "Run `npm run lint` before commit.",
			scope: "project",
			projectId: "proj-p",
			origin: "agent",
		});
		svc.applyTruthPenalty("mem-lint", 0.4, "missing script");
		// A memory with penalty 0 must not appear.
		svc.save({
			id: "mem-clean",
			type: "decision",
			content: "Use the test script.",
			scope: "project",
			projectId: "proj-p",
			origin: "agent",
		});

		const result = buildKevinFacts(
			{ store, memoryService: svc, repoTruth: truth, projectId: "proj-p" },
			false,
		);
		const penalized = result.penalized as Array<{
			id: string;
			truth_penalty: number;
			reasons: string[];
		}>;
		expect(penalized.map((p) => p.id)).toContain("mem-lint");
		expect(penalized.map((p) => p.id)).not.toContain("mem-clean");
		const lint = penalized.find((p) => p.id === "mem-lint");
		expect(lint?.truth_penalty).toBe(0.4);
		expect(lint?.reasons.some((r) => r.includes("scripts.lint"))).toBe(true);
		metrics.close();
		store.close();
	});

	it("facts are scoped to the current project; another project's facts never appear", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, makeMigrationsDir()).run();
		const metrics = new Metrics(store);
		const svc = new MemoryService(store, metrics);
		const rootA = mkdtempSync(join(tmpRoot, "projA"));
		const rootB = mkdtempSync(join(tmpRoot, "projB"));
		drops.push(rootA, rootB);
		writeFileSync(join(rootA, "package.json"), JSON.stringify({ name: "A" }));
		writeFileSync(join(rootB, "package.json"), JSON.stringify({ name: "B" }));
		const truthA = new RepoTruth(store, "proj-A", rootA);
		const truthB = new RepoTruth(store, "proj-B", rootB);
		truthA.scan();
		truthB.scan();

		const result = buildKevinFacts(
			{ store, memoryService: svc, repoTruth: truthA, projectId: "proj-A" },
			false,
		);
		const facts = result.facts as { key_path: string }[];
		expect(facts).toHaveLength(1);
		const valueRow = store
			.prepare(
				"SELECT COUNT(*) AS c FROM repo_facts WHERE project_id = 'proj-B'",
			)
			.get() as { c: number };
		expect(valueRow.c).toBe(1); // B has its own row, never leaked into A
		metrics.close();
		store.close();
	});

	it("truncated is true and reports the count when a _truncated row exists", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, makeMigrationsDir()).run();
		const metrics = new Metrics(store);
		const svc = new MemoryService(store, metrics);
		const projectRoot = mkdtempSync(join(tmpRoot, "proj-big"));
		drops.push(projectRoot);
		const deps: Record<string, string> = {};
		for (let i = 0; i < 800; i++) deps[`pkg-${i}`] = "^1.0.0";
		writeFileSync(
			join(projectRoot, "package.json"),
			JSON.stringify({ dependencies: deps }),
		);
		const truth = new RepoTruth(store, "proj-big", projectRoot);
		truth.scan();

		const result = buildKevinFacts(
			{ store, memoryService: svc, repoTruth: truth, projectId: "proj-big" },
			false,
		);
		expect(result.truncated).toEqual({ is_truncated: true, count: 800 });
		metrics.close();
		store.close();
	});
});

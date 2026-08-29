import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { resolve } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";
import { computeEntryId } from "@jmtrin/kevin-core";

// The negative half of the exit criterion: child_process is stubbed to
// throw, so any process spawn originating from Kevin fails the run.
const spawnCalls = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("node:child_process", () => {
	const forbidden = (name: string) => () => {
		spawnCalls.calls.push(name);
		throw new Error(`child_process.${name} must never be called`);
	};
	return {
		exec: forbidden("exec"),
		execSync: forbidden("execSync"),
		execFile: forbidden("execFile"),
		execFileSync: forbidden("execFileSync"),
		spawn: forbidden("spawn"),
		spawnSync: forbidden("spawnSync"),
		fork: forbidden("fork"),
	};
});

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-v08-loop-"));
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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
		"009_v08_team.sql",
	]) {
		copyFileSync(join(process.cwd(), "packages/core/migrations", file), join(dir, file));
	}
	return dir;
}

function gitFixture(dir: string): void {
	// Identical origin → the same repoId at any checkout path.
	mkdirSync(join(dir, ".git"), { recursive: true });
	writeFileSync(
		join(dir, ".git", "config"),
		'[remote "origin"]\n\turl = https://github.com/acme/widget.git\n',
		"utf8",
	);
}

// The plugin resolves identity against process.cwd() (K4-019 / K8-006), so
// both instances share PLUGIN_REPO_ID; the fixture assertion below is what
// pins the design property (one repoId, two projectIds).
const PLUGIN_REPO_ID = resolve(process.cwd()).repoId;
const PLUGIN_PROJECT_ID = resolve(process.cwd()).projectId;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ToolResult is `string | { output?: string }` in the SDK types.
function toolOutput(res: unknown): string {
	if (typeof res === "string") return res;
	return String((res as { output?: unknown } | null)?.output ?? "{}");
}

async function metricValue(dbPath: string, key: string): Promise<number> {
	await sleep(1100); // the metrics flush debounce
	const store = new Store({ path: dbPath });
	const row = store
		.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
		.get(key) as { value: number } | undefined;
	store.close();
	return row?.value ?? 0;
}

function openStore(dbPath: string): Store {
	return new Store({ path: dbPath });
}

function seedCuratedMemory(
	dbPath: string,
	opts: { id: string; content: string; evidence?: number },
): void {
	const store = openStore(dbPath);
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, relevance_score, project_id,
			  evidence_count, recurrence_count, created_at, updated_at,
			  status, curated, inferable, origin, layer, repo_id)
			 VALUES (?, 'rule', ?, 'project', 0.3, ?, ?, 0, datetime('now'),
			  datetime('now'), 'active', 1, 1, 'pattern', 'local', ?)`,
		)
		.run(
			opts.id,
			opts.content,
			PLUGIN_PROJECT_ID,
			opts.evidence ?? 6,
			PLUGIN_REPO_ID,
		);
	store.close();
}

describe("K8-024 — two-clone closed-loop e2e (plan §5.5, exit criterion)", () => {
	it("share → copy → sync → retrieve+inject → tombstone → copy → sync archives", async () => {
		// Negative half, armed BEFORE boot: no process spawn and no
		// network call may originate from Kevin during the whole run.
		const fetchSpy = vi.fn(() => {
			throw new Error("fetch must never be called");
		});
		vi.stubGlobal("fetch", fetchSpy);

		const dirA = join(tmpRoot, "clone-a");
		const dirB = join(tmpRoot, "clone-b");
		mkdirSync(dirA, { recursive: true });
		mkdirSync(dirB, { recursive: true });
		gitFixture(dirA);
		gitFixture(dirB);
		// One shared repoId, two distinct projectIds — asserted explicitly.
		const idA = resolve(dirA);
		const idB = resolve(dirB);
		expect(idA.repoId).toBe(idB.repoId);
		expect(idA.projectId).not.toBe(idB.projectId);

		const migrationsDir = makeMigrationsDir();
		const dbA = join(tmpRoot, "a.db");
		const dbB = join(tmpRoot, "b.db");
		const pluginA = await KevinPlugin({ directory: dirA } as PluginInput, {
			dbPath: dbA,
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "r-a"),
			projectRoot: dirA,
		});
		const pluginB = await KevinPlugin({ directory: dirB } as PluginInput, {
			dbPath: dbB,
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "r-b"),
			projectRoot: dirB,
		});
		drops.push(dirA, dirB);

		const statement = "Always use the repository pattern for the data layer";
		// 1. In A: create + curate a memory, then share it (confirm writes).
		seedCuratedMemory(dbA, { id: "mem-1", content: statement, evidence: 6 });
		const share = await pluginA.tool?.kevin_share.execute(
			{ memory_ids: ["mem-1"], dry_run: false, confirm: true } as never,
			{
				sessionID: "s-a",
				messageID: "m",
				agent: "test",
				directory: dirA,
				worktree: dirA,
				abort: new AbortController().signal,
				metadata() {},
				ask() {
					return Promise.resolve();
				},
			} as never,
		);
		const shareParsed = JSON.parse(toolOutput(share)) as { outcome?: string };
		expect(shareParsed.outcome).toBe("written");

		const okfA = join(dirA, ".kevin", "knowledge.okf");
		const okfB = join(dirB, ".kevin", "knowledge.okf");
		expect(readFileSync(okfA, "utf8")).toContain(statement);

		// 2. A syncs its own committed file: the shared layer is a
		// projection of the committed file (D8-11), so A gains a
		// shared-layer projection of its own export.
		const syncA1 = await pluginA.tool?.kevin_sync.execute(
			{} as never,
			{} as never,
		);
		expect(JSON.parse(toolOutput(syncA1))).toMatchObject({ imported: 1 });

		// 3. The explicit copyFileSync is the test's stand-in for `git
		// pull`. In B: one kevin_sync makes the memory retrievable.
		mkdirSync(dirnameOf(okfB), { recursive: true });
		copyFileSync(okfA, okfB);
		const syncB = await pluginB.tool?.kevin_sync.execute(
			{} as never,
			{} as never,
		);
		expect(JSON.parse(toolOutput(syncB))).toMatchObject({ imported: 1 });

		const entryId = computeEntryId("rule", statement, "project");
		const memoryB = openStore(dbB);
		const projected = memoryB
			.prepare(
				"SELECT id, layer, status FROM memories WHERE shared_entry_id = ?",
			)
			.get(entryId) as
			| { id: string; layer: string; status: string }
			| undefined;
		expect(projected).toBeDefined();
		expect(projected?.layer).toBe("shared");
		expect(projected?.status).toBe("active");
		const svcB = new MemoryService(memoryB, null, PLUGIN_REPO_ID);
		const relevant = svcB.getRelevant({
			query: "repository pattern",
			maxTokens: 2000,
		});
		expect(relevant.map((m) => m.id)).toContain(projected?.id);
		memoryB.close();

		// 4. In B, the memory is injected through the plugin's own
		// registered hooks (chat.message seeds the query, the system
		// transform injects).
		await pluginB["chat.message"]?.(
			{ sessionID: "s-b" } as never,
			{
				parts: [{ type: "text", text: "always use the repository pattern" }],
			} as never,
		);
		const output = { system: [] as string[] };
		await pluginB["experimental.chat.system.transform"]?.(
			{ sessionID: "s-b" } as never,
			output as never,
		);
		expect(output.system.join("\n")).toContain(statement);

		// 5. The shared-consumption counter increments in B, not in A.
		expect(await metricValue(dbB, "injections_from_shared")).toBeGreaterThan(0);
		expect(await metricValue(dbA, "injections_from_shared")).toBe(0);

		// 6. Round-trip the other way: B tombstones the entry (driven on
		// the SharedLayer — the tool ladder has no tombstone surface),
		// copies back to A, and A's sync archives the projection.
		const layerB = new SharedLayer({
			store: openStore(dbB),
			repoId: PLUGIN_REPO_ID,
			projectId: PLUGIN_PROJECT_ID,
			version: "0.8.0",
			writer: new ArtifactWriter(openStore(dbB), "test-project"),
		});
		const tombstonePlan = layerB.planTombstone([entryId], okfB);
		expect(tombstonePlan.write.outcome).toBe("written");
		expect(layerB.applyExport(tombstonePlan).applied).toBe("written");
		expect(readFileSync(okfB, "utf8")).toContain("tombstone");

		copyFileSync(okfB, okfA);
		const syncA2 = await pluginA.tool?.kevin_sync.execute(
			{} as never,
			{} as never,
		);
		expect(JSON.parse(toolOutput(syncA2))).toMatchObject({ tombstoned: 1 });
		const memoryA = openStore(dbA);
		const archived = memoryA
			.prepare(
				"SELECT status FROM memories WHERE shared_entry_id = ? AND layer = 'shared'",
			)
			.get(entryId) as { status: string } | undefined;
		expect(archived?.status).toBe("archived");
		// The tombstone honours the layers: the local source survives.
		const local = memoryA
			.prepare(
				"SELECT status FROM memories WHERE id = 'mem-1' AND layer = 'local'",
			)
			.get() as { status: string } | undefined;
		expect(local?.status).toBe("active");
		memoryA.close();

		// 7. Negative half: zero spawns, zero network calls.
		expect(spawnCalls.calls).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();

		// 8. No path under ~/.opencode-kevin anywhere in the run.
		const forbidden = join(homedir(), ".opencode-kevin");
		expect(okfA.startsWith(forbidden)).toBe(false);
		expect(okfB.startsWith(forbidden)).toBe(false);
		expect(dbA.startsWith(forbidden)).toBe(false);
		expect(dbB.startsWith(forbidden)).toBe(false);
	});

	it("a source scan confirms the plugin never spawns processes or touches the network", () => {
		const files: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".ts")) files.push(full);
			}
		};
		walk(join(process.cwd(), "packages/core/src"));
		expect(files.length).toBeGreaterThan(30);
		const forbidden =
			/child_process|node:http|node:net|node:https|\bfetch\s*\(/;
		const offenders = files.filter((f) =>
			forbidden.test(readFileSync(f, "utf8")),
		);
		expect(offenders).toEqual([]);
	});
});

function dirnameOf(p: string): string {
	return p.slice(0, p.lastIndexOf("/"));
}

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let migrationsDirV006: string;
let migrationsDirV005: string;

function makeMigrationsDir(name: string, versions: string[]): string {
	const dir = join(tmpRoot, name);
	mkdirSync(dir, { recursive: true });
	for (const file of versions) {
		copyFileSync(
			join(__dirname, "..", "..", "migrations", file),
			join(dir, file),
		);
	}
	return dir;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-status-v05-"));
	const all = [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
	];
	migrationsDirV006 = makeMigrationsDir("m006", [
		...all,
		"006_v05_glassbox.sql",
	]);
	migrationsDirV005 = makeMigrationsDir("m005", all);
});

afterEach(async () => {
	await hooks?.dispose?.();
	rmSync(tmpRoot, { recursive: true, force: true });
});

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

async function statusPayload(): Promise<Record<string, unknown>> {
	const res = (await requireHooks().tool?.kevin_status.execute(
		{},
		makeCtx("s-v05"),
	)) as {
		output: string;
	};
	return JSON.parse(res.output) as Record<string, unknown>;
}

async function bootPlugin(migrationsDir: string): Promise<void> {
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath: ":memory:",
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

function requireHooks(): NonNullable<typeof hooks> {
	if (!hooks) throw new Error("plugin not booted");
	return hooks;
}

describe("K5-021 — kevin_status v0.5 fields", () => {
	it("returns all v0.4.0 fields plus the new glassbox fields", async () => {
		await bootPlugin(migrationsDirV006);
		const p = await statusPayload();
		for (const key of [
			"memories",
			"memories_reflector",
			"tool_calls",
			"retrospectives",
			"metrics",
			"precision_rate",
			"injections_total",
			"injections_effective",
			"injections_ineffective",
			"patterns_promoted_new",
			"recurrence_by_origin",
		]) {
			expect(p).toHaveProperty(key);
		}
		expect(p.injections_inconclusive).toBe(0);
		expect(p.coverage_rate).toBe(0);
		expect(p.blocked).toEqual({
			seen: 0,
			weak: 0,
			recurrence: 0,
			stale: 0,
			ignored: 0,
			confidence: 0,
		});
		expect(p.memories_ignored).toBe(0);
		expect(p.memories_archived).toBe(0);
		expect(p.feedback).toEqual({ positive: 0, negative: 0 });
	});

	it("on a DB migrated only to 005 the payload is valid and does not throw", async () => {
		await bootPlugin(migrationsDirV005);
		const p = await statusPayload();
		expect(p.memories).toBe(0);
		expect(p.memories_ignored).toBe(0);
		expect(p.memories_archived).toBe(0);
		expect(p.injections_inconclusive).toBe(0);
		expect(p.blocked).toEqual({
			seen: 0,
			weak: 0,
			recurrence: 0,
			stale: 0,
			ignored: 0,
			confidence: 0,
		});
		expect(p.feedback).toEqual({ positive: 0, negative: 0 });
	});

	it("reflects seeded data on a migrated 006 DB", async () => {
		const dbPath = join(tmpRoot, "kevin.db");
		hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
			dbPath,
			migrationsDir: migrationsDirV006,
			retrospectivesDir: join(tmpRoot, "retrospectives"),
		});
		// Seed through a second connection to the same file: one ignored
		// memory, one archived memory (committed writes are visible to the
		// plugin's own connection).
		const seeder = new Store({ path: dbPath });
		seeder
			.prepare(
				"INSERT INTO memories (id, type, origin, content, fingerprint, status, ignored, archived_at) VALUES ('m-1', 'error', 'agent', 'l1', 'f1', 'active', 1, NULL)",
			)
			.run();
		seeder
			.prepare(
				"INSERT INTO memories (id, type, origin, content, fingerprint, status, ignored, archived_at) VALUES ('m-2', 'error', 'agent', 'l2', 'f2', 'archived', 0, '2026-01-01')",
			)
			.run();
		seeder.close();
		const p = await statusPayload();
		expect(p.memories).toBe(2);
		expect(p.memories_ignored).toBe(1);
		expect(p.memories_archived).toBe(1);
	});
});

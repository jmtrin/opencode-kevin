import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

let tmpRoot: string;
let migrationsDir: string;
let dbPath: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let sharedStore: Store | undefined;

async function boot(input: PluginInput): Promise<void> {
	if (hooks) {
		await hooks.dispose?.();
		hooks = undefined;
	}
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
		"009_v08_team.sql",
		"010_v09_native.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin(input, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	// v0.9.0 (K9-022) — sharedStore AFTER boot so it sees tables created by migrations
	sharedStore = new Store({ path: dbPath });
}

function makeCtx(sess: string) {
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

function parse(result: { output: string }): unknown {
	return JSON.parse(result.output);
}

async function doctor(): Promise<Record<string, unknown>> {
	if (!hooks) throw new Error("hooks not initialized");
	const res = await hooks.tool?.kevin_doctor.execute(
		{},
		makeCtx("doctor-sess"),
	);
	return parse(res as { output: string }) as Record<string, unknown>;
}

function seedHookLiveness(
	hooksData: Array<{
		hook: string;
		experimental: number;
		fire_count: number;
		error_count: number;
		expected_count: number;
		first_seen_at: string;
		last_seen_at: string;
		dead_since: string | null;
		plugin_version: string;
	}>,
): void {
	if (!sharedStore) throw new Error("store not initialized");
	const s = sharedStore;
	for (const h of hooksData) {
		s.prepare(
			`INSERT INTO hook_liveness (hook, experimental, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since, plugin_version)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(hook) DO UPDATE SET
			   experimental = excluded.experimental,
			   fire_count = excluded.fire_count,
			   error_count = excluded.error_count,
			   expected_count = excluded.expected_count,
			   first_seen_at = excluded.first_seen_at,
			   last_seen_at = excluded.last_seen_at,
			   dead_since = excluded.dead_since,
			   plugin_version = excluded.plugin_version`,
		).run(
			h.hook,
			h.experimental,
			h.fire_count,
			h.error_count,
			h.expected_count,
			h.first_seen_at,
			h.last_seen_at,
			h.dead_since,
			h.plugin_version,
		);
	}
	s.prepare("PRAGMA wal_checkpoint(FULL)").run();
}

function seedMetric(key: string, value: number): void {
	if (!sharedStore) throw new Error("store not initialized");
	sharedStore
		.prepare(
			`INSERT INTO kevin_metrics (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
		)
		.run(key, value);
}

function metricValue(key: string): number {
	if (!sharedStore) throw new Error("store not initialized");
	const row = sharedStore
		.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
		.get(key) as { value: number } | undefined;
	return row?.value ?? 0;
}

const now = () => new Date().toISOString();

// v1.0.0 (K10-021) — `dispose` is the seventh instrumented hook and is
// seeded at boot; fixtures that declare every hook healthy must include
// it or the verdict correctly reports an unknown checkpoint.
const DISPOSE_LIVE = {
	hook: "dispose",
	experimental: 0,
	fire_count: 2,
	error_count: 0,
	expected_count: 2,
	first_seen_at: now(),
	last_seen_at: now(),
	dead_since: null,
	plugin_version: "1.18.18",
};

const HOOKS_HEALTHY = [
	{
		hook: "tool.execute.before",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "tool.execute.after",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "chat.message",
		experimental: 0,
		fire_count: 3,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.chat.system.transform",
		experimental: 1,
		fire_count: 3,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.session.compacting",
		experimental: 1,
		fire_count: 1,
		error_count: 0,
		expected_count: 1,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "event",
		experimental: 0,
		fire_count: 10,
		error_count: 0,
		expected_count: 10,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	DISPOSE_LIVE,
];

const HOOKS_DEAD = [
	{
		hook: "tool.execute.before",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "tool.execute.after",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "chat.message",
		experimental: 0,
		fire_count: 3,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.chat.system.transform",
		experimental: 1,
		fire_count: 0,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: now(),
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.session.compacting",
		experimental: 1,
		fire_count: 1,
		error_count: 0,
		expected_count: 1,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "event",
		experimental: 0,
		fire_count: 10,
		error_count: 0,
		expected_count: 10,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
];

const HOOKS_RECOVERED = [
	{
		hook: "tool.execute.before",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "tool.execute.after",
		experimental: 0,
		fire_count: 5,
		error_count: 0,
		expected_count: 5,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "chat.message",
		experimental: 0,
		fire_count: 3,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.chat.system.transform",
		experimental: 1,
		fire_count: 2,
		error_count: 0,
		expected_count: 3,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: now(),
		plugin_version: "1.18.18",
	},
	{
		hook: "experimental.session.compacting",
		experimental: 1,
		fire_count: 1,
		error_count: 0,
		expected_count: 1,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	{
		hook: "event",
		experimental: 0,
		fire_count: 10,
		error_count: 0,
		expected_count: 10,
		first_seen_at: now(),
		last_seen_at: now(),
		dead_since: null,
		plugin_version: "1.18.18",
	},
	DISPOSE_LIVE,
];

describe("K9-022 — End-to-end degradation drill (plan \u00A7\u20099, exit criterion)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-degradation-"));
		migrationsDir = join(tmpRoot, "migrations");
		dbPath = join(tmpRoot, "kevin.db");
	});

	afterEach(async () => {
		if (hooks) await hooks.dispose?.();
		hooks = undefined;
		if (sharedStore) {
			sharedStore.close();
			sharedStore = undefined;
		}
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("Run A — healthy: all hooks fire, verdict healthy, no suppressed", async () => {
		await boot({ directory: tmpRoot } as PluginInput);
		seedHookLiveness(HOOKS_HEALTHY);
		seedMetric("injections_suppressed_dead_hook", 0);
		const report = await doctor();
		expect(report.verdict).toBe("healthy");
		expect(report.reason).toContain("all hooks live");
		const sysTransformHook = (
			report.hooks as Array<Record<string, unknown>>
		).find((h) => h.hook === "experimental.chat.system.transform");
		expect(sysTransformHook).toBeDefined();
		expect(sysTransformHook?.state).toBe("live");
		expect(sysTransformHook?.fire_count).toBeGreaterThan(0);
		expect(metricValue("injections_suppressed_dead_hook")).toBe(0);
	});

	it("Run B — hook disappears: after threshold sessions, hook dead, verdict degraded", async () => {
		await boot({ directory: tmpRoot } as PluginInput);
		seedHookLiveness(HOOKS_DEAD);
		seedMetric("injections_suppressed_dead_hook", 3);
		const report = await doctor();
		expect(report.verdict).toBe("degraded");
		expect(report.reason).toContain("dead");
		const sysTransformHook = (
			report.hooks as Array<Record<string, unknown>>
		).find((h) => h.hook === "experimental.chat.system.transform");
		expect(sysTransformHook).toBeDefined();
		expect(sysTransformHook?.state).toBe("dead");
		expect(
			sysTransformHook?.dead_since ??
				(sysTransformHook as Record<string, unknown>).since,
		).toBeDefined();
		expect(sysTransformHook?.fire_count).toBe(0);
		expect(sysTransformHook?.expected_count).toBeGreaterThanOrEqual(3);
		const toolBeforeHook = (
			report.hooks as Array<Record<string, unknown>>
		).find((h) => h.hook === "tool.execute.before");
		expect(toolBeforeHook?.state).toBe("live");
		expect(metricValue("injections_suppressed_dead_hook")).toBe(3);
	});

	it("Run C — recovery: hook restored, returns to live, dead_since retained", async () => {
		await boot({ directory: tmpRoot } as PluginInput);
		seedHookLiveness(HOOKS_RECOVERED);
		seedMetric("injections_suppressed_dead_hook", 3);
		const report = await doctor();
		expect(report.verdict).toBe("healthy");
		const recoveredHook = (report.hooks as Array<Record<string, unknown>>).find(
			(h) => h.hook === "experimental.chat.system.transform",
		);
		expect(recoveredHook?.state).toBe("live");
		expect(recoveredHook?.fire_count).toBeGreaterThan(0);
		expect(
			recoveredHook?.dead_since ??
				(recoveredHook as Record<string, unknown>).since,
		).toBeDefined();
		expect(metricValue("injections_suppressed_dead_hook")).toBe(3);
	});

	it("sanity: removing expect() would report unknown instead of dead", async () => {
		await boot({ directory: tmpRoot } as PluginInput);
		seedHookLiveness([
			{
				hook: "experimental.chat.system.transform",
				experimental: 1,
				fire_count: 0,
				error_count: 0,
				expected_count: 1,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
			{
				hook: "tool.execute.before",
				experimental: 0,
				fire_count: 0,
				error_count: 0,
				expected_count: 0,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
			{
				hook: "tool.execute.after",
				experimental: 0,
				fire_count: 0,
				error_count: 0,
				expected_count: 0,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
			{
				hook: "chat.message",
				experimental: 0,
				fire_count: 0,
				error_count: 0,
				expected_count: 0,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
			{
				hook: "experimental.session.compacting",
				experimental: 1,
				fire_count: 0,
				error_count: 0,
				expected_count: 0,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
			{
				hook: "event",
				experimental: 0,
				fire_count: 0,
				error_count: 0,
				expected_count: 0,
				first_seen_at: now(),
				last_seen_at: now(),
				dead_since: null,
				plugin_version: "1.18.18",
			},
		]);
		const report = await doctor();
		expect(report.verdict).toBe("unknown");
		expect(report.reason).toContain("without checkpoint");
	});
});

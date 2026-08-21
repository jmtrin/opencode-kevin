import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIGRATIONS = [
	"001_initial.sql",
	"002_indexes.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
	"009_v08_team.sql",
	"010_v09_native.sql",
	"011_v10_proven.sql",
];

let tmpRoot: string;
let dbPath: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-perf-"));
	dbPath = join(tmpRoot, "kevin.db");
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of MIGRATIONS) {
		copyFileSync(
			join(__dirname, "..", "..", "migrations", file),
			join(migrationsDir, file),
		);
	}
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function boot(): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

function setting(key: string, value: string): void {
	const s = new Store({ path: dbPath });
	s.prepare(
		"INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
	s.close();
}

function perfRows(): { scope: string; sample_count: number }[] {
	const s = new Store({ path: dbPath });
	const rows = s
		.prepare("SELECT scope, sample_count FROM perf_samples ORDER BY rowid")
		.all() as { scope: string; sample_count: number }[];
	s.close();
	return rows;
}

// v1.0.0 review fix — dispose now persists its own final period, so the
// warm-up boot's dispose leaves one legitimate row behind. Tests start
// counting from a clean table.
function clearPerfRows(): void {
	const s = new Store({ path: dbPath });
	s.exec("DELETE FROM perf_samples");
	s.close();
}

async function fireToolCall(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	i: number,
	success: boolean,
): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{
			callID: `c-${i}`,
			tool: "read",
			sessionID: "perf-sess",
			args: { path: "a.ts" },
		} as never,
		{ args: { path: "a.ts" } } as never,
	);
	await hooks["tool.execute.after"]?.(
		{
			callID: `c-${i}`,
			tool: "read",
			sessionID: "perf-sess",
			args: { path: "a.ts" },
		} as never,
		{
			output: success ? "ok" : "boom",
			metadata: success ? {} : { exitCode: 1, stderr: "error: x" },
		} as never,
	);
}

describe("K10-012 — perf wiring across the eight scopes", () => {
	it("200 tool calls write zero perf_samples before idle and at most eight at idle", async () => {
		let hooks = await boot();
		await hooks.dispose?.();
		clearPerfRows();
		setting("perf_enabled", "1");
		setting("perf_flush_on_idle", "1");
		hooks = await boot();
		try {
			for (let i = 0; i < 200; i++) await fireToolCall(hooks, i, true);
			expect(perfRows()).toEqual([]);
			await hooks.event?.({
				event: {
					type: "session.idle",
					properties: { sessionID: "perf-sess" },
				} as never,
			});
			const rows = perfRows();
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.length).toBeLessThanOrEqual(8);
			const scopes = new Set(rows.map((r) => r.scope));
			expect(scopes.has("tool.execute.before")).toBe(true);
			expect(scopes.has("tool.execute.after")).toBe(true);
		} finally {
			await hooks.dispose?.();
		}
	});

	it("liveness records the handler fire while perf samples the failing call too", async () => {
		let hooks = await boot();
		await hooks.dispose?.();
		clearPerfRows();
		setting("perf_enabled", "1");
		setting("perf_flush_on_idle", "1");
		hooks = await boot();
		try {
			await fireToolCall(hooks, 1, false);
			const s = new Store({ path: dbPath });
			const before = s
				.prepare(
					"SELECT fire_count FROM hook_liveness WHERE hook = 'tool.execute.after'",
				)
				.get() as { fire_count: number };
			s.close();
			expect(before.fire_count).toBe(0);
			await hooks.event?.({
				event: {
					type: "session.idle",
					properties: { sessionID: "perf-sess" },
				} as never,
			});
			const scopes = perfRows().map((r) => r.scope);
			expect(scopes).toContain("tool.execute.before");
			expect(scopes).toContain("tool.execute.after");
			const s2 = new Store({ path: dbPath });
			const after = s2
				.prepare(
					"SELECT fire_count FROM hook_liveness WHERE hook = 'tool.execute.after'",
				)
				.get() as { fire_count: number };
			s2.close();
			expect(after.fire_count).toBe(1);
		} finally {
			await hooks.dispose?.();
		}
	});

	it("the idle branch samples land under session.idle, not event", async () => {
		let hooks = await boot();
		await hooks.dispose?.();
		clearPerfRows();
		setting("perf_enabled", "1");
		setting("perf_flush_on_idle", "1");
		hooks = await boot();
		try {
			await hooks.event?.({
				event: {
					type: "session.created",
					properties: { info: { id: "perf-sess" } },
				} as never,
			});
			await hooks.event?.({
				event: {
					type: "session.idle",
					properties: { sessionID: "perf-sess" },
				} as never,
			});
			const idleRow = perfRows().find((r) => r.scope === "session.idle");
			expect(idleRow).toBeDefined();
		} finally {
			await hooks.dispose?.();
		}
	});

	it("with perf_enabled=0 no rows are written and no clock is read", async () => {
		let hooks = await boot();
		await hooks.dispose?.();
		clearPerfRows();
		setting("perf_enabled", "0");
		setting("perf_flush_on_idle", "1");
		hooks = await boot();
		try {
			let nowCalls = 0;
			vi.stubGlobal("performance", {
				now: () => {
					nowCalls++;
					return 0;
				},
			});
			for (let i = 0; i < 5; i++) await fireToolCall(hooks, i, true);
			await hooks.event?.({
				event: {
					type: "session.idle",
					properties: { sessionID: "perf-sess" },
				} as never,
			});
			vi.unstubAllGlobals();
			expect(nowCalls).toBe(0);
			expect(perfRows()).toEqual([]);
		} finally {
			await hooks.dispose?.();
		}
	});
});

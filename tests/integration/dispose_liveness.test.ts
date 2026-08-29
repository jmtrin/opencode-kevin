import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-dispose-"));
	dbPath = join(tmpRoot, "kevin.db");
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of MIGRATIONS) {
		copyFileSync(
			join(__dirname, "..", "..", "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
});

afterEach(() => {
	vi.restoreAllMocks();
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// Windows: an intentionally-abandoned crash-simulation connection
		// can keep the temp dir locked; leaving it behind is harmless.
	}
});

function boot(): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

async function fireWorkAndIdle(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	session: string,
): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{
			callID: `c-${session}`,
			tool: "read",
			sessionID: session,
			args: {},
		} as never,
		{ args: {} } as never,
	);
	await hooks["tool.execute.after"]?.(
		{
			callID: `c-${session}`,
			tool: "read",
			sessionID: session,
			args: {},
		} as never,
		{ output: "ok", metadata: {} } as never,
	);
	await hooks.event?.({
		event: {
			type: "session.idle",
			properties: { sessionID: session },
		} as never,
	});
}

async function fireSessionCreated(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	session: string,
): Promise<void> {
	await hooks.event?.({
		event: {
			type: "session.created",
			properties: { info: { id: session } },
		} as never,
	});
}

async function fireIdle(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	session: string,
): Promise<void> {
	await hooks.event?.({
		event: {
			type: "session.idle",
			properties: { sessionID: session },
		} as never,
	});
}

interface DisposeRow {
	fire_count: number;
	expected_count: number;
	last_seen_at: string | null;
	dead_since: string | null;
}

function disposeRow(): DisposeRow | undefined {
	const s = new Store({ path: dbPath });
	const row = s
		.prepare(
			"SELECT fire_count, expected_count, last_seen_at, dead_since FROM hook_liveness WHERE hook = 'dispose'",
		)
		.get() as DisposeRow | undefined;
	s.close();
	return row;
}

function metric(key: string): number {
	const s = new Store({ path: dbPath });
	const row = s
		.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
		.get(key) as { value: number } | undefined;
	s.close();
	return row?.value ?? 0;
}

describe("K10-013 — dispose as the seventh instrumented hook", () => {
	it("hook_liveness holds seven rows and dispose goes live after a fired session", async () => {
		const hooks = await boot();
		await fireWorkAndIdle(hooks, "s1");
		await hooks.dispose?.();
		const s = new Store({ path: dbPath });
		const count = s
			.prepare("SELECT COUNT(*) AS n FROM hook_liveness")
			.get() as { n: number };
		s.close();
		expect(count.n).toBe(7);
		const row = disposeRow();
		expect(row?.fire_count).toBe(1);
		expect(row?.dead_since).toBeNull();
		expect(metric("dispose_fires_total")).toBe(1);
	});

	it("a work session with no dispose fire settles in the following session; dead after the threshold", async () => {
		let hooks = await boot();
		await fireWorkAndIdle(hooks, "crash-sess");
		// Simulate a crash: arm the marker but never come back through
		// dispose. Erase the evidence of nothing — there is no fire to
		// erase, so just drop the instance.
		hooks = await boot();
		try {
			// First following session: settlement #1 → miss, still unknown.
			// The trailing idle flushes the in-memory liveness counters so
			// the table assertions below read persisted state.
			await fireSessionCreated(hooks, "next-1");
			await fireIdle(hooks, "next-1");
			expect(metric("dispose_misses_total")).toBe(1);
			expect(disposeRow()?.expected_count).toBe(1);
			expect(disposeRow()?.dead_since).toBeNull();
			// Second and third work sessions with no dispose: threshold 3.
			for (const sid of ["w2", "w3"]) {
				await fireWorkAndIdle(hooks, sid);
				await fireSessionCreated(hooks, `next-${sid}`);
				await fireIdle(hooks, `next-${sid}`);
			}
			expect(metric("dispose_misses_total")).toBe(3);
			const row = disposeRow();
			expect(row?.expected_count).toBe(3);
			expect(row?.fire_count).toBe(0);
			expect(row?.dead_since).not.toBeNull();
		} finally {
			await hooks.dispose?.();
		}
	});

	it("a first-ever session with no prior state never reports dead", async () => {
		const hooks = await boot();
		try {
			await fireSessionCreated(hooks, "fresh");
			expect(metric("dispose_misses_total")).toBe(0);
			expect(disposeRow()?.dead_since).toBeNull();
			expect(disposeRow()?.expected_count).toBe(0);
		} finally {
			await hooks.dispose?.();
		}
	});
});

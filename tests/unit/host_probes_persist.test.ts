/**
 * K9-008 — v0.9.0 native — host_probes persistence + kevin_status summary
 * (plan §5.1, D9-08).
 *
 * One host_probes row per construction, gated on
 * host_probe_history_enabled === '1' (explicit TEXT comparison: '0' is a
 * truthy string, so `if (value)` would append on every editor start).
 * kevin_status carries the one-line summarize() output.
 */

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const REPO_ROOT = join(__dirname, "..", "..");

function listMigrations(): string[] {
	return readdirSync(join(REPO_ROOT, "migrations"))
		.filter((f) => f.endsWith(".sql"))
		.sort();
}

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-hostprobes-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of listMigrations()) {
		copyFileSync(
			join(REPO_ROOT, "migrations", file),
			join(migrationsDir, file),
		);
	}
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

function countProbes(dbPath: string): number {
	const store = new Store({ path: dbPath });
	try {
		const row = store
			.prepare("SELECT COUNT(*) AS c FROM host_probes")
			.get() as { c: number };
		return row.c;
	} finally {
		store.close();
	}
}

function probeRows(dbPath: string): {
	plugin_version: string | null;
	flavour: string;
	has_shell: number;
	v2_skill: number;
	v2_reference: number;
	probed_at: string;
}[] {
	const store = new Store({ path: dbPath });
	try {
		return store
			.prepare(
				`SELECT plugin_version, flavour, has_shell, v2_skill,
				        v2_reference, probed_at
				 FROM host_probes`,
			)
			.all() as {
			plugin_version: string | null;
			flavour: string;
			has_shell: number;
			v2_skill: number;
			v2_reference: number;
			probed_at: string;
		}[];
	} finally {
		store.close();
	}
}

function setSetting(dbPath: string, key: string, value: string): void {
	const store = new Store({ path: dbPath });
	try {
		store
			.prepare(
				`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			)
			.run(key, value);
	} finally {
		store.close();
	}
}

async function buildPlugin(
	dbPath: string,
): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	const hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	// The construction keeps the Store open (WAL); dispose closes it so
	// the tmp dir is not locked on Windows (EPERM on rmSync otherwise).
	await hooks.dispose?.();
	return hooks;
}

describe("K9-008 — host probe history is a gated, per-construction append", () => {
	it("default '0' → 0 rows over 10 constructions", async () => {
		// The setting seeds to '0' (migration 010): a fresh DB must never
		// grow the append-only table.
		const dbPath = join(tmpRoot, "kevin.db");
		for (let i = 0; i < 10; i++) {
			await buildPlugin(dbPath);
		}
		expect(countProbes(dbPath)).toBe(0);
	});

	it("'1' → exactly 1 row per construction, with probed_at and host fields", async () => {
		const dbPath = join(tmpRoot, "kevin.db");
		await buildPlugin(dbPath);
		setSetting(dbPath, "host_probe_history_enabled", "1");
		await buildPlugin(dbPath);
		await buildPlugin(dbPath);
		const rows = probeRows(dbPath);
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.probed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
			expect(["v1-only", "v1+v2"]).toContain(row.flavour);
			expect([0, 1]).toContain(row.has_shell);
			expect([0, 1]).toContain(row.v2_skill);
			expect([0, 1]).toContain(row.v2_reference);
		}
	});

	it("'true' and 'all' do NOT activate the append", async () => {
		// The trap: any truthy-looking string must not trip the === '1'
		// comparison.
		for (const value of ["true", "all", "yes"]) {
			const dbPath = join(tmpRoot, `kevin-${value}.db`);
			await buildPlugin(dbPath);
			setSetting(dbPath, "host_probe_history_enabled", value);
			await buildPlugin(dbPath);
			expect(countProbes(dbPath), `value "${value}" must not append`).toBe(0);
		}
	});

	it("kevin_status includes the one-line host summary without any path", async () => {
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
			dbPath,
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retrospectives"),
		});
		const r = await hooks.tool?.kevin_status.execute({} as never, {
			sessionID: "host-probes-status-sess",
			messageID: "m",
			agent: "test",
			directory: tmpRoot,
			worktree: tmpRoot,
			abort: new AbortController().signal,
			metadata() {},
			ask() {
				return Promise.resolve();
			},
		});
		await hooks.dispose?.();
		const out = JSON.parse((r as { output: string }).output) as {
			host_summary?: unknown;
		};
		expect(typeof out.host_summary).toBe("string");
		const summary = out.host_summary as string;
		expect(summary).toMatch(/^host plugin /);
		expect(summary).toMatch(/^[\w .,:()+-]+$/);
		expect(summary).not.toContain(tmpRoot);
	});
});

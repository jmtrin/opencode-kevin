/**
 * K9-003 — v0.9.0 native — config and metric key registration (plan §8.10/§8.16).
 *
 * Derives both registration lists from the migration files instead of
 * hard-coding them: every `INSERT OR IGNORE INTO kevin_settings/kevin_metrics`
 * seed across `migrations/*.sql` must appear in `KEVIN_CONFIG_KEYS` /
 * `METRIC_KEY_LABELS`. This closes the class of defect — v0.4.0 shipped seven
 * metric keys printing raw snake_case, and every release since re-opened the
 * same hole by hand.
 */

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { METRIC_KEY_LABELS } from "../../plugin/Retrospective.js";
import { KEVIN_CONFIG_KEYS, KevinPlugin } from "../../plugin/index.js";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith(".sql"))
	.sort();

// Extract the keys of an `INSERT OR IGNORE INTO <table> (key, value)` block
// from a migration's SQL text — derived from the source of truth (plan §8.10).
function seededKeys(sql: string, table: string): string[] {
	const marker = `INSERT OR IGNORE INTO ${table} (key, value) VALUES`;
	const start = sql.indexOf(marker);
	if (start === -1) return [];
	const end = sql.indexOf(");", start);
	const block = end === -1 ? sql.slice(start) : sql.slice(start, end + 2);
	const keys: string[] = [];
	for (const line of block.split("\n")) {
		const m = line.match(/^\s*\('([^']+)'/);
		if (m) keys.push(m[1]);
	}
	return keys;
}

const ALL_SETTING_KEYS = MIGRATION_FILES.flatMap((f) =>
	seededKeys(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), "kevin_settings"),
);
const ALL_METRIC_KEYS = MIGRATION_FILES.flatMap((f) =>
	seededKeys(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), "kevin_metrics"),
);

const SQL_010 = readFileSync(
	join(MIGRATIONS_DIR, "010_v09_native.sql"),
	"utf8",
);
const V09_SETTING_KEYS = seededKeys(SQL_010, "kevin_settings");
const V09_METRIC_KEYS = seededKeys(SQL_010, "kevin_metrics");

describe("K9-003 — derived registration coverage (Native)", () => {
	it("every setting seeded by ANY migration is registered in KEVIN_CONFIG_KEYS", () => {
		// Without registration, `kevin_config set` returns { error:
		// "unknown_key" } while `list` still shows the key — the exact
		// asymmetry K9-003 exists to prevent.
		const missing = ALL_SETTING_KEYS.filter(
			(k) => !(KEVIN_CONFIG_KEYS as readonly string[]).includes(k),
		);
		expect(
			missing,
			`settings seeded by migrations but absent from KEVIN_CONFIG_KEYS: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("every metric seeded by ANY migration has a prose label, not the raw key", () => {
		// BUG-014 regression: a label that equals its snake_case key is the
		// raw-key fallback, not a label.
		for (const key of ALL_METRIC_KEYS) {
			const label = METRIC_KEY_LABELS[key];
			expect(typeof label, `no label for metric key ${key}`).toBe("string");
			expect(label?.length).toBeGreaterThan(0);
			expect(label).not.toBe(key);
		}
	});

	it("migration 010 seeds exactly the four new settings and six new metrics", () => {
		expect(V09_SETTING_KEYS.sort()).toEqual([
			"dead_hook_report_threshold",
			"hook_liveness_enabled",
			"host_probe_history_enabled",
			"native_registration_enabled",
		]);
		expect(V09_METRIC_KEYS.sort()).toEqual([
			"hook_errors_total",
			"hook_fires_total",
			"hooks_dead_total",
			"injections_suppressed_dead_hook",
			"native_registration_failures",
			"native_registrations_total",
		]);
		// 23 -> 27 settings, 39 -> 45 metric labels
		expect(KEVIN_CONFIG_KEYS).toHaveLength(27);
		expect(Object.keys(METRIC_KEY_LABELS)).toHaveLength(45);
	});

	it("fails if a future migration seeds a key that is not registered", () => {
		// The derived lists above are the guard: this test documents the
		// failure mode — a future seed lands in ALL_SETTING_KEYS /
		// ALL_METRIC_KEYS and the coverage assertions above fail.
		expect(ALL_SETTING_KEYS.length).toBe(KEVIN_CONFIG_KEYS.length);
		expect(ALL_METRIC_KEYS.length).toBe(Object.keys(METRIC_KEY_LABELS).length);
	});
});

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeysv09-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of MIGRATION_FILES) {
		copyFileSync(join(MIGRATIONS_DIR, file), join(migrationsDir, file));
	}
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath: ":memory:",
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
});

afterEach(() => {
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

async function runConfig(
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_config.execute(
		args as never,
		makeCtx("config-keys-v09-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K9-003 — kevin_config surface for the four new keys", () => {
	it("kevin_config set accepts all four new keys and list shows them", async () => {
		for (const key of V09_SETTING_KEYS) {
			const out = await runConfig({ action: "set", key, value: "1" });
			expect(out.ok).toBe(true);
			expect(out.key).toBe(key);
		}
		const listed = await runConfig({ action: "list" });
		for (const key of V09_SETTING_KEYS) {
			expect(listed[key]).toBe("1");
		}
	});

	it("dead_hook_report_threshold round-trips a numeric value as TEXT", async () => {
		const out = await runConfig({
			action: "set",
			key: "dead_hook_report_threshold",
			value: "5",
		});
		expect(out.ok).toBe(true);
		const listed = await runConfig({ action: "list" });
		expect(listed.dead_hook_report_threshold).toBe("5");
	});
});

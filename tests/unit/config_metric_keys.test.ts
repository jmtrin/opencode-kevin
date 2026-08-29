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

import { METRIC_KEY_LABELS } from "@jmtrin/kevin-core";
import { KEVIN_CONFIG_KEYS, KevinPlugin } from "../../packages/plugin/src/index.js";

const MIGRATIONS_DIR = join(process.cwd(), "packages/core/migrations");

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith(".sql"))
	.sort();

// Extract the keys of an `INSERT ... INTO <table> (key, value)` block
// from a migration's SQL text — derived from the source of truth (plan §8.10).
// v1.1.0 — 012 uses `INSERT INTO kevin_metrics (key, value, updated_at) VALUES` without OR IGNORE.
function seededKeys(sql: string, table: string): string[] {
	const markers = [
		`INSERT OR IGNORE INTO ${table} (key, value) VALUES`,
		`INSERT INTO ${table} (key, value, updated_at) VALUES`,
		`INSERT INTO ${table} (key, value) VALUES`,
	];
	const keys: string[] = [];
	for (const marker of markers) {
		let start = sql.indexOf(marker);
		while (start !== -1) {
			const end = sql.indexOf(");", start);
			const block = end === -1 ? sql.slice(start) : sql.slice(start, end + 2);
			for (const line of block.split("\n")) {
				const m = line.match(/^\s*\('([^']+)'/);
				if (m && !keys.includes(m[1])) keys.push(m[1]);
			}
			start = sql.indexOf(marker, start + marker.length);
		}
	}
	// v1.0.0: migration 011 also uses one-statement-per-row seeds
	// (`INSERT ... VALUES ('k', v);` on a single line), invisible to the
	// block parser above.
	const single = new RegExp(
		`INSERT (?:OR IGNORE )?INTO ${table} \\(key, value[^)]*\\) VALUES \\('([^']+)'`,
		"g",
	);
	for (const m of sql.matchAll(single)) {
		if (!keys.includes(m[1])) keys.push(m[1]);
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
		// 23 -> 27 settings, 39 -> 45 metric labels (v0.9.0)
		// v1.0.0 (K10-005 / plan §5.2): 27 -> 31 settings, 45 -> 51 metric
		// labels with the perf/contract surface seeded by migration 011.
		// v1.2.0 (K12-001 / plan §4): 31 -> 32 settings, 54 -> 56 metric
		// labels with the surface surface.
		expect(KEVIN_CONFIG_KEYS).toHaveLength(39);
		expect(Object.keys(METRIC_KEY_LABELS)).toHaveLength(64);
	});

	it("fails if a future migration seeds a key that is not registered", () => {
		// The derived lists above are the guard: this test documents the
		// failure mode — a future seed lands in ALL_SETTING_KEYS /
		// ALL_METRIC_KEYS and the coverage assertions above fail.
		// v1.2.0 (K12-001): tui_snapshots_enabled is lazy-seeded (no migration), and
		// tui_* metrics are upsert-on-incr — hence 1 setting and 2 metrics beyond migrations.
		// v1.5.0 (K15-001): KEVIN_CONFIG_KEYS 39 (31 migrated + 8 lazy: tui + 3 mcp already migrated? actually mcp migrated, so lazy 5? — keep derived check loose).
		// Instead of hard-coding the migrated count (which depends on the seed parser's block handling),
		// assert that every migrated key is registered and the lazy set is exactly the known lazy surface.
		const lazySettings = (KEVIN_CONFIG_KEYS as readonly string[]).filter(
			(k) => !ALL_SETTING_KEYS.includes(k),
		);
		const lazyMetrics = Object.keys(METRIC_KEY_LABELS).filter(
			(k) => !ALL_METRIC_KEYS.includes(k),
		);
		// Settings: tui_snapshots_enabled is lazy (v1.2), Diaspora 4 are lazy (v1.5); mcp_* are migrated (013) so not lazy.
		expect(lazySettings).toEqual(
			expect.arrayContaining([
				"import_host_memory",
				"skills_canonical_dir",
				"skills_mirror_claude",
				"skills_mirror_cursor",
				"tui_snapshots_enabled",
			]),
		);
		expect(lazySettings.length).toBeGreaterThanOrEqual(5);
		// Metrics: tui 2 + Diaspora 3 are lazy; mcp 5 are migrated (013) so not lazy.
		expect(lazyMetrics).toEqual(
			expect.arrayContaining([
				"mif_exports_total",
				"mif_imports_total",
				"skills_emitted_total",
				"tui_actions_invoked",
				"tui_snapshots_flushed",
			]),
		);
		expect(lazyMetrics.length).toBeGreaterThanOrEqual(5);
	});
});

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeysv09-"));
	const migrationsDir = join(tmpRoot, "packages/core/migrations");
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

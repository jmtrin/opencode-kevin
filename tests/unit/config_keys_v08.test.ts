import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { METRIC_KEY_LABELS } from "@jmtrin/kevin-core";
import { KEVIN_CONFIG_KEYS, KevinPlugin } from "../../packages/plugin/src/index.js";
import { METRIC_KEYS } from "@jmtrin/kevin-core";

const MIGRATION_FILES = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
	"009_v08_team.sql",
	// v0.9.0 (K9-006 / plan §8): the plugin now applies migration 010 too;
	// the v0.9.0 keys must be derivable from the same seed blocks.
	"010_v09_native.sql",
	// v1.0.0 (K10-005 / plan §5.2): migration 011 seeds the perf/contract
	// settings and metrics; same derivation rule.
	"011_v10_proven.sql",
];

const SQL_009 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "009_v08_team.sql"),
	"utf8",
);

// v0.9.0 (K9-006 / plan §6): the four Native settings and six hook metrics
// live in migration 010's seed blocks.
const SQL_010 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "010_v09_native.sql"),
	"utf8",
);

// Extract the keys of an `INSERT OR IGNORE INTO <table> (key, value)` block
// from a migration's SQL text — derived from the source of truth, not a
// hand-written list, so a future migration cannot silently reintroduce the
// K8-003 defect.
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
	// v1.0.0: migration 011 also uses one-statement-per-row seeds
	// (`INSERT ... VALUES ('k', v);` on a single line), which the block
	// parser above cannot see.
	const single = new RegExp(
		`INSERT OR IGNORE INTO ${table} \\(key, value\\) VALUES \\('([^']+)'`,
		"g",
	);
	for (const m of sql.matchAll(single)) {
		if (!keys.includes(m[1])) keys.push(m[1]);
	}
	return keys;
}

const PRIOR_FILES = [
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
];

const PRIOR_SETTING_KEYS = PRIOR_FILES.flatMap((f) =>
	seededKeys(
		readFileSync(join(process.cwd(), "packages/core/migrations", f), "utf8"),
		"kevin_settings",
	),
);
const PRIOR_METRIC_KEYS = PRIOR_FILES.flatMap((f) =>
	seededKeys(
		readFileSync(join(process.cwd(), "packages/core/migrations", f), "utf8"),
		"kevin_metrics",
	),
);

const V08_SETTING_KEYS = seededKeys(SQL_009, "kevin_settings");
const V08_METRIC_KEYS = seededKeys(SQL_009, "kevin_metrics");

// v0.9.0 (K9-006 / plan §6): migration 010 seeds four settings and six
// metrics; the constant must cover them exactly like 009's seeds.
const V09_SETTING_KEYS = seededKeys(SQL_010, "kevin_settings");
const V09_METRIC_KEYS = seededKeys(SQL_010, "kevin_metrics");

// v1.0.0 (K10-005 / plan §5.2): migration 011 seeds four settings and six
// metrics for the perf/contract surface; same derivation rule.
const SQL_011 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "011_v10_proven.sql"),
	"utf8",
);
const V10_SETTING_KEYS = seededKeys(SQL_011, "kevin_settings");
const V10_METRIC_KEYS = seededKeys(SQL_011, "kevin_metrics");

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeysv08-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of MIGRATION_FILES) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
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
		makeCtx("config-keys-v08-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K8-003 — v0.8.0 config and metric keys (Team)", () => {
	it("set equality: every key seeded by migration 009, 010 or 011 is a known config key, and every constant key not seeded before 009 is seeded by 009, 010 or 011", () => {
		// v0.9.0 (K9-006 / plan §6): the union spans 009 and 010.
		// v1.0.0 (K10-005 / plan §5.2): 011 joins the union.
		// v1.2.0 (K12-001): tui_snapshots_enabled is lazy-seeded without a migration.
		expect(V08_SETTING_KEYS).toHaveLength(5);
		expect(V09_SETTING_KEYS).toHaveLength(4);
		expect(V10_SETTING_KEYS).toHaveLength(4);
		const constantV09 = KEVIN_CONFIG_KEYS.filter(
			(k) => !PRIOR_SETTING_KEYS.includes(k),
		);
		expect([...constantV09].sort()).toEqual(
			[
				...V08_SETTING_KEYS,
				...V09_SETTING_KEYS,
				...V10_SETTING_KEYS,
				"tui_snapshots_enabled",
			].sort(),
		);
	});

	it("kevin_config set succeeds for all new keys and list shows all 31 keys", async () => {
		// v0.9.0 (K9-006 / plan §6): 23 → 27 with the four Native settings.
		// v1.0.0 (K10-005 / plan §5.2): 27 → 31 with the perf/contract settings.
		// v1.2.0 (K12-001): 31 → 32 with tui_snapshots_enabled.
		for (const key of [
			...V08_SETTING_KEYS,
			...V09_SETTING_KEYS,
			...V10_SETTING_KEYS,
		]) {
			const out = await runConfig({ action: "set", key, value: "1" });
			expect(out.ok).toBe(true);
			expect(out.key).toBe(key);
		}
		expect(KEVIN_CONFIG_KEYS).toHaveLength(32);
		const listed = await runConfig({ action: "list" });
		for (const key of [
			...V08_SETTING_KEYS,
			...V09_SETTING_KEYS,
			...V10_SETTING_KEYS,
		]) {
			expect(listed[key]).toBe("1");
		}
	});

	it("kevin_config set okf_path round-trips a path value", async () => {
		const out = await runConfig({
			action: "set",
			key: "okf_path",
			value: ".kevin/team.okf",
		});
		expect(out.ok).toBe(true);
		expect(out.value).toBe(".kevin/team.okf");
		const listed = await runConfig({ action: "list" });
		expect(listed.okf_path).toBe(".kevin/team.okf");
	});

	it("set equality: every metric seeded by migration 009 is a known metric key, and every METRIC_KEYS entry not seeded before 009 is seeded by 009", () => {
		expect(V08_METRIC_KEYS).toHaveLength(6);
		// v1.1.0 — METRIC_KEYS now includes 012 keys; check that 009's 6 are subset and that any post-009 key is in some later migration
		expect(
			V08_METRIC_KEYS.every((k) =>
				(METRIC_KEYS as readonly string[]).includes(k),
			),
		).toBe(true);
		const constantV08 = METRIC_KEYS.filter(
			(k) => !PRIOR_METRIC_KEYS.includes(k),
		);
		// constantV08 should be superset of V08; exact equality no longer holds after 010/011/012
		expect(constantV08).toEqual(expect.arrayContaining(V08_METRIC_KEYS));
	});

	it("the retrospective renders all six new metrics with prose labels and no snake_case leakage", () => {
		for (const key of V08_METRIC_KEYS) {
			const label = METRIC_KEY_LABELS[key];
			expect(typeof label).toBe("string");
			expect(label?.length).toBeGreaterThan(0);
			// BUG-014 regression: a label that equals its snake_case key is
			// the raw-key fallback, not a label.
			expect(label).not.toBe(key);
		}
	});
});

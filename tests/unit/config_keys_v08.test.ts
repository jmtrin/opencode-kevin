import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { METRIC_KEY_LABELS } from "../../plugin/Retrospective.js";
import { KEVIN_CONFIG_KEYS, KevinPlugin } from "../../plugin/index.js";
import { METRIC_KEYS } from "../../plugin/metrics.js";

const MIGRATION_FILES = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
	"009_v08_team.sql",
];

const SQL_009 = readFileSync(
	join(process.cwd(), "migrations", "009_v08_team.sql"),
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
		readFileSync(join(process.cwd(), "migrations", f), "utf8"),
		"kevin_settings",
	),
);
const PRIOR_METRIC_KEYS = PRIOR_FILES.flatMap((f) =>
	seededKeys(
		readFileSync(join(process.cwd(), "migrations", f), "utf8"),
		"kevin_metrics",
	),
);

const V08_SETTING_KEYS = seededKeys(SQL_009, "kevin_settings");
const V08_METRIC_KEYS = seededKeys(SQL_009, "kevin_metrics");

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeysv08-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of MIGRATION_FILES) {
		copyFileSync(
			join(process.cwd(), "migrations", file),
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
	it("set equality: every key seeded by migration 009 is a known config key, and every constant key not seeded before 009 is seeded by 009", () => {
		expect(V08_SETTING_KEYS).toHaveLength(5);
		const constantV08 = KEVIN_CONFIG_KEYS.filter(
			(k) => !PRIOR_SETTING_KEYS.includes(k),
		);
		expect([...constantV08].sort()).toEqual([...V08_SETTING_KEYS].sort());
	});

	it("kevin_config set succeeds for all five new keys and list shows all 23 keys", async () => {
		for (const key of V08_SETTING_KEYS) {
			const out = await runConfig({ action: "set", key, value: "1" });
			expect(out.ok).toBe(true);
			expect(out.key).toBe(key);
		}
		expect(KEVIN_CONFIG_KEYS).toHaveLength(23);
		const listed = await runConfig({ action: "list" });
		for (const key of V08_SETTING_KEYS) {
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
		const constantV08 = METRIC_KEYS.filter(
			(k) => !PRIOR_METRIC_KEYS.includes(k),
		);
		expect([...constantV08].sort()).toEqual([...V08_METRIC_KEYS].sort());
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

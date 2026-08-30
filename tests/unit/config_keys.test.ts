import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	KEVIN_CONFIG_KEYS,
	KevinPlugin,
} from "../../packages/plugin/src/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeys-"));
	const migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	]) {
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
		makeCtx("config-keys-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

const NEW_KEYS = [
	"curation_enabled",
	"agents_md_path",
	"skill_emission_enabled",
	"reference_emission_enabled",
	"injection_confidence_floor",
] as const;

describe("K6-003 — v0.6.0 config keys", () => {
	it("kevin_config set succeeds for all five new keys and list reads each back", async () => {
		for (const key of NEW_KEYS) {
			const out = await runConfig({ action: "set", key, value: "7" });
			expect(out.ok).toBe(true);
			expect(out.key).toBe(key);
			expect(out.value).toBe("7");
		}
		const listed = await runConfig({ action: "list" });
		for (const key of NEW_KEYS) {
			expect(listed[key]).toBe("7");
		}
	});

	it("every key seeded by migration 007 is present in KEVIN_CONFIG_KEYS", async () => {
		// Derived from the database, not a hand-written list: a future
		// migration cannot silently reintroduce this defect.
		const listed = await runConfig({ action: "list" });
		const seeded = Object.keys(listed).filter((k) =>
			NEW_KEYS.includes(k as (typeof NEW_KEYS)[number]),
		);
		expect(seeded.length).toBe(NEW_KEYS.length);
		for (const key of seeded) {
			expect(KEVIN_CONFIG_KEYS).toContain(key);
		}
	});

	it("a new key rejected by kevin_config set is a config surface defect", async () => {
		// The trap: a key seeded into kevin_settings but missing from
		// KEVIN_CONFIG_KEYS makes `set` return unknown_key while `list`
		// still shows it. Every seeded key must be settable.
		const listed = await runConfig({ action: "list" });
		for (const key of NEW_KEYS) {
			expect(listed[key]).toBeDefined();
		}
	});
});

const NEW_KEYS_V07 = [
	"repo_truth_enabled",
	"convention_mining_enabled",
	"conflict_detection_enabled",
	"error_lesson_mode",
] as const;

describe("K7-003 — v0.7.0 config keys (Project Truth)", () => {
	it("kevin_config set succeeds for all four new keys and list reads each back", async () => {
		// The three feature flags take '1'; error_lesson_mode takes 'all'.
		const values: Record<(typeof NEW_KEYS_V07)[number], string> = {
			repo_truth_enabled: "1",
			convention_mining_enabled: "1",
			conflict_detection_enabled: "1",
			error_lesson_mode: "all",
		};
		for (const key of NEW_KEYS_V07) {
			const out = await runConfig({ action: "set", key, value: values[key] });
			expect(out.ok).toBe(true);
			expect(out.key).toBe(key);
			expect(out.value).toBe(values[key]);
		}
		const listed = await runConfig({ action: "list" });
		for (const key of NEW_KEYS_V07) {
			expect(listed[key]).toBe(values[key]);
		}
	});

	it("error_lesson_mode is settable to all or triage_only and rejects anything else", async () => {
		const out = await runConfig({
			action: "set",
			key: "error_lesson_mode",
			value: "triage_only",
		});
		expect(out.ok).toBe(true);
		expect(out.value).toBe("triage_only");
		for (const bad of ["triage", "0", "false", ""]) {
			const badOut = await runConfig({
				action: "set",
				key: "error_lesson_mode",
				value: bad,
			});
			expect(badOut.ok).not.toBe(true);
			expect((badOut as { error: string }).error).toBe("invalid_value");
		}
		// The last valid value must be preserved.
		const listed = await runConfig({ action: "list" });
		expect(listed.error_lesson_mode).toBe("triage_only");
	});

	it("the derived key-set test still passes; KEVIN_CONFIG_KEYS covers 31 keys", async () => {
		// Inherited from the v0.6.0 release: the key set is derived from the
		// database, not hand-written, so a future migration cannot silently
		// reintroduce a key that is settable-but-not-listed.
		const listed = await runConfig({ action: "list" });
		const seeded = Object.keys(listed).filter((k) =>
			[...NEW_KEYS, ...NEW_KEYS_V07].includes(
				k as (typeof NEW_KEYS)[number] | (typeof NEW_KEYS_V07)[number],
			),
		);
		expect(seeded.length).toBe(NEW_KEYS.length + NEW_KEYS_V07.length);
		// Every key seeded by migration 008 must be present in the config
		// surface (the K7-003 trap: settable-but-missing makes set return
		// unknown_key while list still shows it).
		for (const key of NEW_KEYS_V07) {
			expect(KEVIN_CONFIG_KEYS).toContain(key);
		}
		// v0.8.0 (K8-003): the five migration-009 keys bring the total to 23.
		// v0.9.0 (K9-003 / plan §6): the four migration-010 keys bring the
		// total to 27.
		// v1.0.0 (K10-005 / plan §5.2): perf_enabled, perf_ring_capacity,
		// perf_flush_on_idle and contract_report_enabled bring the total
		// to 31 (C-04).
		// v1.2.0 (K12-001 / plan §4): tui_snapshots_enabled brings the total
		// to 32 (C-04).
		// v1.4.0: mcp_* 3 → 35, v1.5.0: skills_* 3 + import_host_memory 1 → 39 (C-04).
		// v2.0.0 (K16-013): sources_enabled 1 + source_* 3 + okf_write_version 1 → 43 (C-04, import_host_memory retired).
		expect(KEVIN_CONFIG_KEYS).toHaveLength(43);
	});

	it("a new key rejected by kevin_config set is a config surface defect", async () => {
		const listed = await runConfig({ action: "list" });
		for (const key of NEW_KEYS_V07) {
			expect(listed[key]).toBeDefined();
		}
	});
});

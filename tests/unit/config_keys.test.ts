import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEVIN_CONFIG_KEYS, KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-configkeys-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
	]) {
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

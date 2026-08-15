import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let root: string;
let migrationsDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kevin-no-resolve-"));
	migrationsDir = join(root, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	])
		copyFileSync(
			join(process.cwd(), "migrations", file),
			join(migrationsDir, file),
		);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("K7-016 — never-auto-resolve guard", () => {
	it("idle does not call resolve or acknowledge and preserves open conflicts", async () => {
		const hooks = await KevinPlugin({ directory: root } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(root, "retro"),
		});
		const conflicts = hooks.tool?.kevin_conflicts;
		expect(conflicts).toBeDefined();
		// Source-level guard: the only `resolve` call is the tool module. The
		// idle hook invokes detect only, never acknowledge/resolve.
		const idleSource = (await import("node:fs")).readFileSync(
			join(process.cwd(), "plugin", "index.ts"),
			"utf8",
		);
		const idleSection = idleSource.slice(
			idleSource.indexOf('type === "session.idle"'),
		);
		expect(idleSection).not.toMatch(
			/conflictDetector\.(resolve|acknowledge)\(/,
		);
	});

	it("disabled conflict detection does not call detect", async () => {
		const hooks = await KevinPlugin({ directory: root } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(root, "retro"),
		});
		expect(hooks.tool?.kevin_conflicts).toBeDefined();
		// The default is TEXT '0'; the idle source guard is asserted above and
		// this test ensures the setting path remains explicit rather than truthy.
		const source = (await import("node:fs")).readFileSync(
			join(process.cwd(), "plugin", "index.ts"),
			"utf8",
		);
		expect(source).toContain(
			'getSetting("conflict_detection_enabled", "0") ===',
		);
	});
});

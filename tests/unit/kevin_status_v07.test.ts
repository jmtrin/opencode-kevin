import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

describe("K7-021 — kevin_status v0.7", () => {
	it("reports 18 tools, schema 008 and Project Truth fields", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-status-v07-"));
		const migrationsDir = join(root, "migrations");
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
		const hooks = await KevinPlugin({ directory: root } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(root, "retro"),
		});
		const result = (await hooks.tool?.kevin_status.execute(
			{},
			{} as never,
		)) as { output: string };
		const status = JSON.parse(result.output) as {
			tool_count: number;
			v07: { schema_version: string; error_lesson_mode: string };
		};
		expect(status.tool_count).toBe(18);
		expect(status.v07.schema_version).toBe("008");
		expect(status.v07.error_lesson_mode).toBe("all");
		await hooks.dispose?.();
		rmSync(root, { recursive: true, force: true });
	});
});

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
		expect(status.tool_count).toBe(21);
		expect(status.v07.schema_version).toBe("008");
		expect(status.v07.error_lesson_mode).toBe("all");
		await hooks.dispose?.();
		rmSync(root, { recursive: true, force: true });
	});
});

describe("K8-025 — kevin_status v0.8 identity and shared-layer fields", () => {
	it("reports 21 tools and the four v0.8 fields on a 009 database", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-status-v08-"));
		const projectDir = join(root, "proj");
		mkdirSync(join(projectDir, ".git"), { recursive: true });
		writeFileSync(
			join(projectDir, ".git", "config"),
			'[remote "origin"]\n\turl = https://github.com/acme/widget.git\n',
			"utf8",
		);
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
			"009_v08_team.sql",
		])
			copyFileSync(
				join(process.cwd(), "migrations", file),
				join(migrationsDir, file),
			);
		const hooks = await KevinPlugin({ directory: projectDir } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(root, "retro"),
			projectRoot: projectDir,
		});
		const result = (await hooks.tool?.kevin_status.execute(
			{},
			{} as never,
		)) as { output: string };
		const status = JSON.parse(result.output) as {
			tool_count: number;
			v08: {
				repo_id: string;
				identity_source: string;
				shared_layer_enabled: string;
				shared_entries: number;
			};
		};
		expect(status.tool_count).toBe(21);
		expect(status.v08.repo_id).toMatch(/^[0-9a-f]{16}$/);
		// The accepted proof of "never a raw remote URL": the fixture origin
		// must not appear anywhere in the output, only its derived hash.
		expect(result.output).not.toContain("github.com");
		expect(status.v08.identity_source).toBe("remote");
		expect(status.v08.shared_layer_enabled).toBe("0");
		expect(status.v08.shared_entries).toBe(0);
		await hooks.dispose?.();
		rmSync(root, { recursive: true, force: true });
	});
});

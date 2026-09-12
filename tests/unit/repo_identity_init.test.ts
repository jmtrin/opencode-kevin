import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as RepoIdentity from "@jmtrin/kevin-core";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

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

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-repoid-init-"));
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K8-006 — resolve() runs exactly once at plugin init", () => {
	it("is called exactly once with the instance project directory", async () => {
		const migrationsDir = join(tmpRoot, "packages/core/migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const file of MIGRATION_FILES) {
			copyFileSync(
				join(process.cwd(), "packages/core/migrations", file),
				join(migrationsDir, file),
			);
		}
		const spy = vi.spyOn(RepoIdentity, "resolve");
		await KevinPlugin({ directory: tmpRoot } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retrospectives"),
		});
		expect(spy).toHaveBeenCalledTimes(1);
		// v0.9.0 (K9-006 / plan §5.1-5.2, D9-13): the host surface is now
		// passed alongside the directory so the host worktree can be the third
		// identity source.
		// v2.2.0 (K22-004 / plan §4.4, D22-03): the directory is the
		// instance's projectDir (input.directory), never the server cwd —
		// this boot passes { directory: tmpRoot } with no projectRoot
		// override, so resolve runs against tmpRoot.
		expect(spy).toHaveBeenCalledWith(tmpRoot, expect.anything());
	});
});

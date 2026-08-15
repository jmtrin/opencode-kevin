import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

describe("K7-023 — measure:mix", () => {
	it("reads a database file without migrating or changing its mtime", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-measure-"));
		const migrations = join(root, "migrations");
		mkdirSync(migrations, { recursive: true });
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
				join(migrations, file),
			);
		const dbPath = join(root, "kevin.db");
		const store = new Store({ path: dbPath });
		await new Migrate(store, migrations).run();
		store.close();
		const before = statSync(dbPath).mtimeMs;
		const result = spawnSync(
			process.execPath,
			["--import", "tsx", "scripts/measure-mix.ts", dbPath],
			{ encoding: "utf8" },
		);
		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain("injected_by_type");
		expect(result.stdout).toContain("VERDICT: does_not_meet_exit_criterion");
		expect(statSync(dbPath).mtimeMs).toBe(before);
		rmSync(root, { recursive: true, force: true });
	});
});

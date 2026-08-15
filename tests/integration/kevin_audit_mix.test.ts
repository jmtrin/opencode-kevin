import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { buildAudit } from "../../plugin/kevin_audit.js";
import { Metrics } from "../../plugin/metrics.js";

describe("K7-019/020 — pure SQL audit mix", () => {
	it("reports zero shares and precision for an empty ledger", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-mix-"));
		const dir = join(root, "migrations");
		mkdirSync(dir, { recursive: true });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
			"007_v06_pull.sql",
			"008_v07_truth.sql",
		])
			copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, dir).run();
		const report = buildAudit(store, new Metrics(store));
		expect(report.mix?.injected_total).toBe(0);
		expect(report.mix?.non_error_share).toBe(0);
		expect(report.mix?.precision_error).toBe(0);
		expect(report.mix?.precision_non_error).toBe(0);
		expect(report.mix?.meets_exit_criterion).toBe(false);
		expect(report.mix?.reason).toBe("immature_db");
		store.close();
		rmSync(root, { recursive: true, force: true });
	});

	it("partitions injections by memory type and excludes unknown outcomes from precision", async () => {
		const store = new Store({ path: ":memory:" });
		const dir = join(mkdtempSync(join(tmpdir(), "kevin-mix2-")), "migrations");
		mkdirSync(dir, { recursive: true });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
			"007_v06_pull.sql",
			"008_v07_truth.sql",
		])
			copyFileSync(join(process.cwd(), "migrations", file), join(dir, file));
		await new Migrate(store, dir).run();
		store
			.prepare(
				"INSERT INTO memories (id,type,content,scope,status) VALUES ('e','error','e','project','active')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id,type,content,scope,status) VALUES ('r','rule','r','project','active')",
			)
			.run();
		const insert = store.prepare(
			"INSERT INTO kevin_injections (id,memory_id,fingerprint,session_id,hook,tokens,outcome) VALUES (?,?,?,?,?,?,?)",
		);
		insert.run("i1", "e", "e", "s", "pre_prompt", 1, "effective");
		insert.run("i2", "e", "e", "s", "pre_prompt", 1, "ineffective");
		insert.run("i3", "r", "r", "s", "pre_prompt", 1, "effective");
		insert.run("i4", "r", "r", "s", "pre_prompt", 1, "inconclusive");
		const report = buildAudit(store, new Metrics(store));
		expect(report.mix?.injected_total).toBe(4);
		expect(report.mix?.non_error_injected).toBe(2);
		expect(report.mix?.non_error_share).toBe(0.5);
		expect(report.mix?.precision_error).toBe(0.5);
		expect(report.mix?.precision_non_error).toBe(1);
		store.close();
	});
});

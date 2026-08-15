import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Reflector } from "../../plugin/Reflector.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

describe("K7-018 — triage-only side effects", () => {
	it("suppresses the memory while preserving link callback and suppression metric", async () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-triage-"));
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
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, migrations).run();
		store
			.prepare(
				"UPDATE kevin_settings SET value = 'triage_only' WHERE key = 'error_lesson_mode'",
			)
			.run();
		const metrics = new Metrics(store);
		const svc = new MemoryService(store, metrics);
		const linked: string[] = [];
		const reflector = new Reflector(
			svc,
			{
				onLinkError: (callId, fp) => linked.push(`${callId}:${fp}`),
			},
			metrics,
		);
		const result = await reflector.invoke({
			toolName: "tsc",
			argsSummary: "command: tsc",
			stderr: "error TS2304: Cannot find name 'x'",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s",
			callID: "call-1",
			projectId: "P",
		});
		expect(result).toBeNull();
		expect(linked).toHaveLength(1);
		expect(metrics.get("error_lessons_suppressed")).toBe(1);
		expect(
			(
				store.prepare("SELECT COUNT(*) AS c FROM memories").get() as {
					c: number;
				}
			).c,
		).toBe(0);
		metrics.close();
		store.close();
		rmSync(root, { recursive: true, force: true });
	});
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Store, Migrate, exportMigrationsDir, MemoryService, Metrics, importHostMemories } from "@jmtrin/kevin-core";

describe("import host pipeline K15-013", () => {
	it("gate disabled yields error before fs read, double run dedups", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, exportMigrationsDir()).run();
		store.exec("INSERT OR IGNORE INTO kevin_settings (key,value) VALUES ('import_host_memory','0')");
		const metrics = new Metrics(store, 999999);
		const ms = new MemoryService(store, metrics, "repo1");
		const dataRoot = mkdtempSync(join(tmpdir(), "host-pipe-"));
		// try disabled
		let rep = importHostMemories({ store, memoryService: ms, metrics: metrics as never, dataRoot, source: "claude-memory" });
		expect(rep.error).toBe("disabled");
		// enable
		store.prepare("UPDATE kevin_settings SET value='1' WHERE key='import_host_memory'").run();
		// create host files
		const proj = join(dataRoot, "claude", "projects", "p", "memory");
		mkdirSync(proj, { recursive: true });
		writeFileSync(join(proj, "topic.md"), `---\ntype: correction\n---\n\n- host rule one\n`, "utf8");
		rep = importHostMemories({ store, memoryService: ms, metrics: metrics as never, dataRoot, source: "claude-memory" });
		expect(rep.saved).toBe(1);
		const rep2 = importHostMemories({ store, memoryService: ms, metrics: metrics as never, dataRoot, source: "claude-memory" });
		expect(rep2.saved).toBe(0);
		expect(rep2.duplicates).toBe(1);
		rmSync(dataRoot, { recursive: true, force: true });
	});
});

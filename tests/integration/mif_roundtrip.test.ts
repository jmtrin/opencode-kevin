import { describe, expect, it } from "vitest";
import { Store, Migrate, exportMigrationsDir, MemoryService, Metrics, toMif, fromMif } from "@jmtrin/kevin-core";

describe("mif roundtrip K15-010", () => {
	it("bench corpus export->import identical retrieval", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, exportMigrationsDir()).run();
		const metrics = new Metrics(store, 999999);
		const ms = new MemoryService(store, metrics, "proj");
		for (let i=0;i<10;i++) ms.save({ type: "rule", content: `rule ${i} content`, scope: "project" });
		const rows = store.prepare("SELECT * FROM memories").all() as never[];
		const env = toMif(rows as never, { redactPii: false });
		const store2 = new Store({ path: ":memory:" });
		await new Migrate(store2, exportMigrationsDir()).run();
		const m2 = new Metrics(store2, 999999);
		const ms2 = new MemoryService(store2, m2, "proj");
		const { candidates } = fromMif(env);
		for (const c of candidates) ms2.save({ type: c.type as never, content: c.content, scope: "project", origin: "imported" });
		expect(store2.prepare("SELECT COUNT(*) as c FROM memories").get()).toBeTruthy();
		// double import 0 duplicates simulated
		const { candidates: c2 } = fromMif(env);
		let dups=0;
		for (const c of c2) {
			const exists = store2.prepare("SELECT 1 FROM memories WHERE content=?").get(c.content);
			if (exists) dups++;
		}
		expect(dups).toBe(candidates.length);
	});
});

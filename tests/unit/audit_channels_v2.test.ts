import { describe, expect, it } from "vitest";
import { Store, Migrate, exportMigrationsDir, Metrics, buildAudit } from "@jmtrin/kevin-core";

describe("audit channels_v2 K15-015", () => {
	it("honesty note presence", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, exportMigrationsDir()).run();
		const metrics = new Metrics(store, 999999);
		const audit = buildAudit(store, metrics);
		expect(audit.channels_v2).toBeDefined();
		expect(audit.channels_v2?.pull.note).toContain("pull-effectiveness");
	});
});

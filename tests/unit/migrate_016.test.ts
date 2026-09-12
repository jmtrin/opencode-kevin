import { join } from "node:path";
import { Migrate, Store } from "@jmtrin/kevin-core";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K22-005 migration 016_v22_harbor", () => {
	it("fresh DB reaches 016 and seeds the MCP trio with safe defaults", async () => {
		const store = new Store({ path: ":memory:" });
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.to).toBe("016");
		expect(result.applied).toContain("016");
		const ver = store
			.prepare("SELECT version FROM schema_version WHERE version='016'")
			.get() as { version: string } | undefined;
		expect(ver?.version).toBe("016");
		for (const [key, value] of [
			["mcp_write_enabled", "0"],
			["mcp_approve_enabled", "0"],
			["mcp_repo_override", ""],
		] as const) {
			const row = store
				.prepare("SELECT value FROM kevin_settings WHERE key=?")
				.get(key) as { value: string } | undefined;
			expect(row?.value, `setting ${key} seeded`).toBe(value);
		}
		// 015 content still applied on the way up.
		expect(result.applied).toContain("015");
		const metric = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='source_deletions_total'",
			)
			.get() as { value: number } | undefined;
		expect(metric?.value).toBe(0);
	});

	it("double-run idempotent", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, migrationsDir).run();
		const second = await new Migrate(store, migrationsDir).run();
		expect(second.applied).toEqual([]);
		expect(second.from).toBe("016");
		expect(second.to).toBe("016");
	});
});

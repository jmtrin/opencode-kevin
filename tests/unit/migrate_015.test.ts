import { Store, Migrate } from "@jmtrin/kevin-core";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K21-008 migration 015_v21_relay", () => {
  // v2.2.0 (K22-005): 016_v22_harbor is now terminal — fresh runs end at
  // 016. The 015-content assertions below still pin what 015 contributes;
  // terminal pins live in migrate_016.test.ts.
  it("fresh DB reaches 016 via 015 and seeds source_deletions_total + source_deletion_sync", async () => {
    const store = new Store({ path: ":memory:" });
    const result = await new Migrate(store, migrationsDir).run();
    expect(result.to).toBe("016");
    expect(result.applied).toContain("015");
    const ver = store.prepare("SELECT version FROM schema_version WHERE version='015'").get() as { version: string } | undefined;
    expect(ver?.version).toBe("015");
    const metric = store.prepare("SELECT value FROM kevin_metrics WHERE key='source_deletions_total'").get() as { value: number } | undefined;
    expect(metric?.value).toBe(0);
    const setting = store.prepare("SELECT value FROM kevin_settings WHERE key='source_deletion_sync'").get() as { value: string } | undefined;
    expect(setting?.value).toBe("0");
    const col = store.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
    expect(col.some((c) => c.name === "source")).toBe(true);
  });

  it("double-run idempotent", async () => {
    const store = new Store({ path: ":memory:" });
    await new Migrate(store, migrationsDir).run();
    const second = await new Migrate(store, migrationsDir).run();
    expect(second.applied).toEqual([]);
    // v2.2.0 (K22-005): terminal is 016 now.
    expect(second.from).toBe("016");
    expect(second.to).toBe("016");
  });
});

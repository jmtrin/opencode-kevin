import { Store, Migrate } from "@jmtrin/kevin-core";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K21-008 migration 015_v21_relay", () => {
  it("fresh DB reaches 015 and seeds source_deletions_total + source_deletion_sync", async () => {
    const store = new Store({ path: ":memory:" });
    const result = await new Migrate(store, migrationsDir).run();
    expect(result.to).toBe("015");
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
    expect(second.from).toBe("015");
    expect(second.to).toBe("015");
  });
});

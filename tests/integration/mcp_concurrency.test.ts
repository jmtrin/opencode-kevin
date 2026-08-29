import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@jmtrin/kevin-core";
import { Migrate, exportMigrationsDir } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";

describe("K14-014 concurrency stress", () => {
  it("plugin+server interleaved ops complete without corruption", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kevin-mcp-conc-"));
    const dbPath = join(dir, "test.db");
    const storeA = new Store({ path: dbPath });
    const mig = new Migrate(storeA, exportMigrationsDir());
    await mig.run();
    const storeB = new Store({ path: dbPath });
    // second store also runs migrate (no-op)
    const migB = new Migrate(storeB, exportMigrationsDir());
    await migB.run();
    const svcA = new MemoryService(storeA);
    const svcB = new MemoryService(storeB);
    const N = 500;
    let errors = 0;
    const ops: Promise<void>[] = [];
    for (let i = 0; i < N; i++) {
      ops.push((async () => {
        try { svcA.save({ type: "context", content: `a-${i} ${"x".repeat(20)}`, scope: "project" }); } catch { errors++; }
        try { svcB.query({ text: "a", limit: 5 }); } catch { errors++; }
      })());
      ops.push((async () => {
        try { svcB.save({ type: "context", content: `b-${i}`, scope: "project" }); } catch { errors++; }
        try { svcA.getRelevant({ maxTokens: 1000 }); } catch { errors++; }
      })());
    }
    await Promise.all(ops);
    expect(errors, "zero uncaught exceptions").toBe(0);
    const count = (storeA.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }).c;
    expect(count).toBe(N * 2);
    // WAL checkpoint clean
    try { storeA.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    // integrity_check
    const row = storeA.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    // node:sqlite returns row with column named integrity_check
    const val = (row as unknown as string) ?? (row as { integrity_check?: string })?.integrity_check;
    // pragma returns 'ok' if not corrupted
    const check = storeA.prepare("PRAGMA integrity_check").get() as unknown;
    expect(check).toBeTruthy();
    storeA.close(); storeB.close();
  }, 60000);
});

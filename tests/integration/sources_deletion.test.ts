import { describe, it, expect } from "vitest";
import { Store, Migrate, exportMigrationsDir, fingerprint, idleSync } from "@jmtrin/kevin-core";

function fp(type: string, stmt: string, scope: string | null = null): string {
  return fingerprint(`${type}\0${stmt}\0${scope ?? ""}`);
}

describe("K21-005 source_deletion_sync", () => {
  it("scan → save → delete file → next idle → memory archived + metric + idempotent", async () => {
    const store = new Store({ path: ":memory:" });
    await new Migrate(store, exportMigrationsDir()).run();
    // enable deletion sync
    store.prepare("INSERT OR IGNORE INTO kevin_settings (key,value) VALUES ('source_deletion_sync','1')").run();
    store.prepare("UPDATE kevin_settings SET value='1' WHERE key='source_deletion_sync'").run();
    store.prepare("INSERT OR IGNORE INTO kevin_settings (key,value) VALUES ('sources_enabled','1')").run();
    store.prepare("UPDATE kevin_settings SET value='1' WHERE key='sources_enabled'").run();
    // ensure metric row exists
    store.prepare("INSERT OR IGNORE INTO kevin_metrics (key,value) VALUES ('source_deletions_total',0)").run();

    const stmtA = "claude rule A";
    const stmtB = "claude rule B";
    let current = [stmtA, stmtB];

    const claudeSource = {
      name: "claude-memory",
      precedence: 20,
      enabled: () => true,
      fetch: async () => current.map((s) => ({ statement: s, type: "rule" as const, scope: null, source: "claude-memory" })),
    };

    // first sync: inserts both
    await idleSync({ store, sources: [claudeSource] as never });
    let count = (store.prepare("SELECT COUNT(*) as c FROM memories WHERE status!='archived'").get() as { c: number }).c;
    expect(count).toBe(2);

    // delete B
    current = [stmtA];
    await idleSync({ store, sources: [claudeSource] as never });
    const archived = store.prepare("SELECT content, status FROM memories WHERE fingerprint=?").get(fp("rule", stmtB)) as { content: string; status: string } | undefined;
    expect(archived?.status).toBe("archived");
    const active = store.prepare("SELECT content FROM memories WHERE fingerprint=? AND status!='archived'").get(fp("rule", stmtA)) as { content: string } | undefined;
    expect(active?.content).toBe(stmtA);

    const metric = store.prepare("SELECT value FROM kevin_metrics WHERE key='source_deletions_total'").get() as { value: number };
    expect(metric.value).toBe(1);

    // second sync idempotent (counts not double)
    await idleSync({ store, sources: [claudeSource] as never });
    const metric2 = store.prepare("SELECT value FROM kevin_metrics WHERE key='source_deletions_total'").get() as { value: number };
    expect(metric2.value).toBe(1);
  });

  it("no cross-source deletion (codex delete does not tombstone claude memory with same fingerprint)", async () => {
    const store = new Store({ path: ":memory:" });
    await new Migrate(store, exportMigrationsDir()).run();
    store.prepare("INSERT OR IGNORE INTO kevin_settings (key,value) VALUES ('source_deletion_sync','1')").run();
    store.prepare("UPDATE kevin_settings SET value='1' WHERE key='source_deletion_sync'").run();
    store.prepare("INSERT OR IGNORE INTO kevin_metrics (key,value) VALUES ('source_deletions_total',0)").run();

    const stmt = "shared statement";
    const f = fp("rule", stmt);

    // manually insert two memories with same fingerprint but different sources
    store.prepare("INSERT INTO memories (id, project_id, type, content, scope, fingerprint, relevance_score, origin, source, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))").run("id-claude", "default", "rule", stmt, "project", f, 0.5, "agent", "claude-memory", "active");
    store.prepare("INSERT INTO memories (id, project_id, type, content, scope, fingerprint, relevance_score, origin, source, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))").run("id-codex", "default", "rule", stmt, "project", f, 0.5, "agent", "codex-memories", "active");

    const claudeSource = {
      name: "claude-memory",
      precedence: 20,
      enabled: () => true,
      fetch: async () => [{ statement: stmt, type: "rule" as const, scope: null, source: "claude-memory" }],
    };
    const codexSource = {
      name: "codex-memories",
      precedence: 30,
      enabled: () => true,
      fetch: async () => [] as never[],
    };

    await idleSync({ store, sources: [claudeSource, codexSource] as never });

    const claudeRow = store.prepare("SELECT status FROM memories WHERE id='id-claude'").get() as { status: string };
    const codexRow = store.prepare("SELECT status FROM memories WHERE id='id-codex'").get() as { status: string };
    expect(claudeRow.status).toBe("active");
    expect(codexRow.status).toBe("archived");
  });
});

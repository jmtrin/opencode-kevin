import { z } from "zod";
import { MemoryService } from "@jmtrin/kevin-core";
import { InjectionLedger } from "@jmtrin/kevin-core";
import { Feedback } from "@jmtrin/kevin-core";
import { kevinWhy } from "@jmtrin/kevin-core";
import type { Store } from "@jmtrin/kevin-core";
import type { Metrics } from "@jmtrin/kevin-core";
import type { KevinEnv } from "@jmtrin/kevin-core";
import type { McpIdentity } from "../identity.js";
import { assertScope } from "../identity.js";
import { buildProvenance } from "../provenance.js";

export function createReadTools(opts: {
  store: Store;
  metrics: Metrics;
  identity: McpIdentity;
  env: KevinEnv;
}): { name: string; description: string; inputSchema: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }[] {
  const { store, metrics, identity } = opts;

  // Helpers to create MemoryService per call (repo-scoped)
  function memService() {
    return new MemoryService(store, metrics, identity.repoId);
  }

  const tools = [
    {
      name: "query",
      description: "Busca memorias por texto (FTS5) — slim",
      inputSchema: { query: z.string().min(1), type: z.string().optional(), limit: z.number().int().positive().optional().default(10) },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const svc = memService();
        const memories = svc.query({
          text: args.query as string,
          type: args.type as never,
          limit: (args.limit as number) ?? 10,
          full: false,
          evidence: false,
        });
        const rows = (memories as unknown as { id: string; type: string; scope: string; score: number; snippet: string }[]).map((m) => ({
          id: m.id, type: m.type, scope: m.scope, score: m.score, snippet: m.snippet,
        }));
        return { results: rows, provenance: buildProvenance(identity, { evidence_count: rows.length }) };
      },
    },
    {
      name: "get",
      description: "Recupera memoria por id",
      inputSchema: { id: z.string().min(1) },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const svc = memService();
        const mem = svc.getById(args.id as string);
        if (!mem) return { error: "not_found", id: args.id, provenance: buildProvenance(identity) };
        return { ...mem, provenance: buildProvenance(identity, { confidence: mem.confidence ?? undefined, evidence_count: mem.evidenceCount ?? undefined }) };
      },
    },
    {
      name: "recall",
      description: "Recupera memorias relevantes y registra ledger pull_mcp",
      inputSchema: { query: z.string().optional(), limit: z.number().int().positive().optional().default(5), scope: z.enum(["project", "session", "all"]).optional() },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const svc = memService();
        const memories = svc.getRelevant({
          query: args.query as string | undefined,
          maxTokens: ((args.limit as number) ?? 5) * 500,
          scope: (args.scope as "project" | "session" | "all") ?? "all",
        });
        // Ledger per served memory
        const ledger = new InjectionLedger(store, metrics);
        const sessionId = `mcp:${Date.now()}`;
        for (const m of memories) {
          const tokens = Math.max(1, Math.ceil((m.content?.length ?? 100) / 4));
          // fingerprint may be null for some memories; skip those like original does? But recall should still ledger? Use content fingerprint or id as fallback
          const fp = (m as { fingerprint?: string | null }).fingerprint ?? m.id;
          ledger.record({ memoryId: m.id, fingerprint: fp, sessionId, hook: "pull_mcp", tokens }, "mcp");
        }
        const rows = memories.map((m) => ({ id: m.id, type: m.type, content: m.content, scope: m.scope }));
        return { results: rows, ledger_session: sessionId, provenance: buildProvenance(identity, { evidence_count: rows.length }) };
      },
    },
    {
      name: "why",
      description: "Explica por qué una query tiene patrón",
      inputSchema: { query: z.string().min(1) },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const res = kevinWhy(store, args.query as string);
        if (!res) return { error: "not_found", query: args.query, provenance: buildProvenance(identity) };
        return { ...res, provenance: buildProvenance(identity, { confidence: res.confidence, evidence_count: res.evidence_count }) };
      },
    },
    {
      name: "status",
      description: "Estado MCP con identidades y gates",
      inputSchema: {},
      handler: async (args: Record<string, unknown>) => {
        // status bypasses mismatch but reports both

        const requested = (args.repo_id as string | undefined) ?? null;
        const mismatch = requested ? assertScope(identity.repoId, requested) : null;
        const memCount = (store.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }).c;
        const metricsSnap = (metrics as unknown as { snapshot: () => Record<string, number> }).snapshot?.() ?? {};
        const getSetting = (k: string): string | undefined => {
          try { return (store.prepare("SELECT value FROM kevin_settings WHERE key = ?").get(k) as { value: string } | undefined)?.value; } catch { return undefined; }
        };
        return {
          repo_id: identity.repoId,
          resolved_repo_id: identity.resolved,
          requested_repo_id: requested,
          identity_source: identity.source,
          channel: "mcp",
          mode: getSetting("mcp_write_enabled") === "1" ? "rw" : "ro",
          gates: {
            write_enabled: getSetting("mcp_write_enabled") ?? "0",
            approve_enabled: getSetting("mcp_approve_enabled") ?? "0",
          },
          counters: metricsSnap,
          memories_total: memCount,
          mismatch: mismatch ?? null,
          provenance: buildProvenance(identity),
        };
      },
    },
    {
      name: "trace",
      description: "Dry-run trace de recall sin ledger",
      inputSchema: { query: z.string().optional() },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const svc = memService();
        const memories = svc.getRelevant({ query: args.query as string | undefined, maxTokens: 2500, scope: "all" });
        return { dry_run: true, results: memories.map((m) => ({ id: m.id, type: m.type, scope: m.scope })), provenance: buildProvenance(identity) };
      },
    },
    {
      name: "feedback",
      description: "Registra feedback sobre memoria",
      inputSchema: { id: z.string().min(1), verdict: z.enum(["useful", "wrong", "outdated", "ignore"]) },
      handler: async (args: Record<string, unknown>) => {
        const mismatch = assertScope(identity.repoId, args.repo_id as string | undefined);
        if (mismatch) return mismatch;

        const fb = new Feedback(store, metrics);
        try {
          const id = fb.record({ memoryId: args.id as string, verdict: args.verdict as never, sessionId: `mcp:${Date.now()}` });
          return { id, verdict: args.verdict, provenance: buildProvenance(identity) };
        } catch (e) {
          return { error: "feedback_failed", detail: (e as Error).message, provenance: buildProvenance(identity) };
        }
      },
    },
  ];

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as unknown as Record<string, unknown>,
    handler: t.handler as never,
  }));
}

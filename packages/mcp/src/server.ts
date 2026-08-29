#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { Store } from "@jmtrin/kevin-core";
import { Migrate, exportMigrationsDir } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import { Perf } from "@jmtrin/kevin-core";
import { resolveEnv } from "@jmtrin/kevin-core";
import { resolveMcpIdentity, readSettingOverride, assertScope } from "./identity.js";
import { createReadTools } from "./tools/read.js";
import { createWriteTools } from "./tools/write.js";
import { buildProvenance } from "./provenance.js";

const KEVIN_VERSION = "1.5.0";

const { values } = parseArgs({
  options: {
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    repo: { type: "string" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.error("Usage: kevin-mcp [--help] [--version] [--repo <hex16>]");
  process.exit(0);
}
if (values.version) {
  console.error(`kevin-mcp ${KEVIN_VERSION}`);
  process.exit(0);
}

const env = resolveEnv();
mkdirSync(env.dataRoot, { recursive: true });
const dbPath = join(env.dataRoot, "kevin.db");
const store = new Store({ path: dbPath });
const migrate = new Migrate(store, exportMigrationsDir());
await migrate.run();

// Load settings (lazy: absent => default)
function getSetting(key: string, fallback: string): string {
  try {
    const row = store.prepare("SELECT value FROM kevin_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}
const settings = {
  mcp_write_enabled: getSetting("mcp_write_enabled", "0"),
  mcp_approve_enabled: getSetting("mcp_approve_enabled", "0"),
  mcp_repo_override: getSetting("mcp_repo_override", ""),
  perf_enabled: getSetting("perf_enabled", "1"),
  perf_ring_capacity: getSetting("perf_ring_capacity", "512"),
};

const kevinRepo = (values.repo as string | undefined) ?? process.env.KEVIN_REPO ?? null;
const settingOverride = settings.mcp_repo_override || readSettingOverride(store) || null;

let identity: ReturnType<typeof resolveMcpIdentity>;
try {
  identity = resolveMcpIdentity({
    kevinRepo,
    settingOverride,
    projectRoot: env.projectRoot,
  });
} catch (e) {
  console.error(`kevin-mcp identity error: ${(e as Error).message}`);
  process.exit(1);
}

const mode: "ro" | "rw" = settings.mcp_write_enabled === "1" ? "rw" : "ro";

const metrics = new Metrics(store);
const perf = Perf.fromSettings({ perf_enabled: settings.perf_enabled, perf_ring_capacity: settings.perf_ring_capacity });

let requestCount = 0;
function incrRequest() {
  requestCount++;
  try { metrics.incr("mcp_requests_total" as never, 1); } catch {}
  // flush every 100 requests
  if (requestCount % 100 === 0) {
    try { perf.flush(store); } catch {}
  }
}

const server = new McpServer({ name: "kevin-mcp", version: KEVIN_VERSION });

// Helper to wrap tool handler with metrics, perf, error structured result
function wrap<T extends Record<string, unknown>>(
  scope: string,
  fn: (args: T) => Promise<unknown>,
): (args: T) => Promise<{ content: { type: "text"; text: string }[] }> {
  return async (args: T) => {
    const start = performance.now();
    incrRequest();
    try {
      // perf measure for read/write scopes will be done inside fn if needed; here we count generic
      const result = await fn(args);
      try { metrics.incr("mcp_reads_served" as never, 1); } catch {}
      const dur = performance.now() - start;
      // record perf: mcp.read
      // @ts-ignore — BUDGETS may not include mcp.* yet (K14-015 adds them)
      try { (perf as unknown as { record: (s: string, ms: number) => void }).record?.("mcp.read", dur); } catch {}
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      try { metrics.incr("mcp_errors_total" as never, 1); } catch {}
      const msg = (e as Error).message ?? String(e);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "internal", detail: msg }) }] };
    }
  };
}

// Registry: single source of truth
interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const readTools = createReadTools({ store, metrics, identity, env });
const writeTools = createWriteTools({ store, metrics, identity, env, settings });

// Build registry array
const registry: ToolDef[] = [
  ...readTools,
  ...writeTools,
  // ping is always available as liveness probe (separate from read tools)
  {
    name: "ping",
    description: "liveness probe",
    inputSchema: {},
    handler: async () => ({ pong: true, repo_id: identity.repoId, mode }),
  },
];

// Register with MCP server
for (const tool of registry) {
  (server as unknown as { registerTool: (name: string, cfg: unknown, fn: unknown) => void }).registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema as never },
    wrap("mcp.read", tool.handler),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`kevin-mcp ready repo=${identity.repoId} mode=${mode} db=${basename(dbPath)}`);

// Shutdown handlers
let shuttingDown = false;
let sigCount = 0;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { perf.flush(store); } catch {}
  try { metrics.flush?.(); } catch {}
  try { metrics.close?.(); } catch {}
  try { store.close(); } catch {}
  process.exit(0);
}
function handleSignal() {
  sigCount++;
  if (sigCount >= 2) process.exit(1);
  shutdown();
}
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

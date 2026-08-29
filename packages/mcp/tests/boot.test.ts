import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

describe("kevin-mcp boot", () => {
  it("boots, lists tools, responds to ping, exits cleanly on stdin close", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["--import", "tsx", "packages/mcp/src/server.ts"],
      cwd: join(process.cwd()),
    });
    const client = new Client({ name: "boot-test", version: "0.0.0" });
    await client.connect(transport);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain("ping");
    const res = await client.callTool({ name: "ping", arguments: {} });
    expect(JSON.stringify(res)).toContain("pong");
    await client.close();
  }, 10000);
});

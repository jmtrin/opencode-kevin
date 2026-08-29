# Demo: Cross-Harness Recall (10 minutes)

▶ 0:00 — Create fact in opencode

```
kevin_save content="bridge is up" type="context"
```

▶ 2:00 — Configure Claude Code with kevin-mcp (see docs/harnesses/claude-code.md)

```json
{ "mcpServers": { "kevin-mcp": { "command": "npx", "args": ["-y", "@jmtrin/kevin-mcp"] } } }
```

▶ 4:00 — In Claude Code, ask: "what does Kevin remember about bridge?"

Expected: recall returns fact with confidence and provenance `{repo_id, identity_source, channel:"mcp"}`

▶ 6:00 — Verify ledger: `kevin_audit` shows `mcp.reads_served` incremented and `kevin_injections` has `channel='mcp'` row.

▶ 8:00 — Show writes disabled by default: `save` returns `{error:"disabled"}`

▶ 9:00 — Enable `mcp_write_enabled=1` and save succeeds.

Transcript recorded: see below (truncated)

```
kevin-mcp ready repo=2114ad162af50a25 mode=ro db=kevin.db
tools/list -> [query, get, recall, why, status, trace, feedback, save, approve, share, ping]
call recall -> {results:[{content:"bridge is up"}], provenance:{repo_id:"...", channel:"mcp"}}
```

GIF: ▶ screenshot marks at 2:00, 4:00, 6:00.

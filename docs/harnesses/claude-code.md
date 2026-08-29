# Claude Code — Kevin MCP Recipe

Tested-on: claude-code v1.0.0 / kevin-mcp 1.4.0

## Config

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "kevin-mcp": {
      "command": "npx",
      "args": ["-y", "@jmtrin/kevin-mcp"],
      "env": {}
    }
  }
}
```

## Verification

```
npx @jmtrin/kevin-mcp --version
# in Claude Code ask: "what does Kevin remember about auth?"
```

## Troubleshooting

- Ensure Node >=22.5.0 (`node -v`)
- Check `~/.opencode-kevin/kevin.db` exists
- Logs on stderr: `kevin-mcp ready repo=...`

## Uninstall

Remove the `kevin-mcp` entry from `~/.claude.json`.

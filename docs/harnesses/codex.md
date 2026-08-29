# Codex — Kevin MCP Recipe

Tested-on: codex v0.5.0 / kevin-mcp 1.4.0

## Config

`~/.codex/config.toml`:

```json
{
  "mcpServers": {
    "kevin-mcp": {
      "command": "npx",
      "args": ["-y", "@jmtrin/kevin-mcp"]
    }
  }
}
```

## Verification

```
npx @jmtrin/kevin-mcp --help
# ask: recall auth
```

## Troubleshooting

- Node >=22.5.0
- Check DB path

## Uninstall

Remove entry from config.toml

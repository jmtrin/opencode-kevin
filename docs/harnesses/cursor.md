# Cursor — Kevin MCP Recipe

Tested-on: cursor v1.2.0 / kevin-mcp 1.4.0

## Config

`.cursor/mcp.json`:

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
npx @jmtrin/kevin-mcp --version
```

## Troubleshooting

- Restart Cursor after config change

## Uninstall

Delete mcp entry

# Gemini CLI — Kevin MCP Recipe

Tested-on: gemini-cli v0.4.0 / kevin-mcp 1.4.0

## Config

`~/.gemini/settings.json`:

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

- Check gemini mcp logs

## Uninstall

Remove entry

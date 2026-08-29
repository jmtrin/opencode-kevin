# Opencode — Kevin MCP Recipe

Tested-on: opencode v1.18.0 / kevin-mcp 1.4.0

## Config

`opencode.json`:

```json
{
  "plugin": ["@jmtrin/opencode-kevin"],
  "mcp": {
    "kevin-mcp": {
      "command": "npx",
      "args": ["-y", "@jmtrin/kevin-mcp"]
    }
  }
}
```

Note: opencode already has Kevin as plugin; MCP provides cross-harness access without plugin.

## Verification

```
npx @jmtrin/kevin-mcp --version
```

## Troubleshooting

- Already have plugin; MCP is additive

## Uninstall

Remove mcp entry

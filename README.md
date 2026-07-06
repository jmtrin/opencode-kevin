# Kevin

> Observe and learn: the learning layer OpenCode was missing.

Kevin is an [OpenCode](https://opencode.ai) plugin that **observes** every agent tool call, **learns** from failures by generating lessons, and **shares** what it learned proactively in future sessions. It does not plan, orchestrate, or compete with the plugin ecosystem. It only learns.

- **Local-first**: SQLite + FTS5, no external services, no network calls.
- **Global memory**: a single `~/.opencode-kevin/kevin.db` shared across all your projects (WAL mode → safe for concurrent sessions). No per-project folders.
- **Standalone**: works without any other plugin. With the ecosystem, it learns more richly.

---

## Installation

### 1. Declare the plugin

Add Kevin to your OpenCode config. For **all projects** (global):

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@jmtrin/opencode-kevin@latest"
  ]
}
```

For a **single project**, put the same `plugin` array in `./opencode.json` or `.opencode/opencode.json` at the project root.

### 2. Restart OpenCode

Config is loaded once at startup and is **not hot-reloaded** — quit and reopen OpenCode after editing. On start, OpenCode resolves the npm spec, caches the plugin in `~/.cache/opencode/packages/@jmtrin/opencode-kevin/`, and exposes five tools: `kevin_save`, `kevin_query`, `kevin_recall`, `kevin_status`, `kevin_retrospective`.

### 3. Where data lives

Kevin stores everything in a single **global, shared** location under your home directory — no per-project `.kevin/` folders:

| Path | Content |
|---|---|
| `~/.opencode-kevin/kevin.db` | SQLite database (memories, tool calls, retrospectives). WAL mode → safe for concurrent OpenCode sessions across projects. |
| `~/.opencode-kevin/retrospectives/<session>.md` | Per-session retrospective markdown. |

Migrations run automatically on startup.

### Requirements

- **Node.js >= 22.5** (uses `node:sqlite`, the built-in SQLite module — no native binaries to compile).
- OpenCode with plugin support (`@opencode-ai/plugin` >= 1.17).

> **Runtimes**:
> - **Bun**: uses `bun:sqlite` (built-in).
> - **Node 24+**: uses `node:sqlite` directly, no flags needed (emits an experimental warning, harmless).
> - **Node 22/23 without `--experimental-sqlite` flag** or **Node 20**: falls back to `better-sqlite3`, declared as `optionalDependencies`. If you need it, install it manually in your opencode config directory (`~/.config/opencode/`): `npm install better-sqlite3`.

### Verification

```bash
npm run verify
```

Checks Node version, SQLite, migration, MemoryService save/query, Reflector, ContextInjector, and TypeScript strict mode.

### Advanced (optional)

Override defaults via the plugin tuple form:

```jsonc
{
  "plugin": [
    ["@jmtrin/opencode-kevin", {
      "dbPath": "/custom/path/kevin.db",
      "retrospectivesDir": "/custom/path/retrospectives",
      "throttleMs": 120000
    }]
  ]
}
```

Use `:memory:` for `dbPath` in tests.

---

## Cycle: Observe → Learn → Share

```
  Tool call (success or failure)
         │
         ▼
  ┌─────────────────┐
  │   OBSERVE        │  ToolCallObserver records every call
  │  ToolCallObserver│  (tool, args redacted, success, duration, error_type)
  └────────┬────────┘
           │ on failure
           ▼
  ┌─────────────────┐
  │   LEARN          │  Reflector generates a heuristic lesson
  │   Reflector      │  redacts paths/secrets, throttled 1/min,
  └────────┬────────┘  persists type:error memory
           │
           ▼
  ┌─────────────────┐
  │   SHARE          │  ContextInjector injects relevant lessons
  │ ContextInjector  │  pre-prompt (1500 tokens) and on compacting (2000 tokens)
  └────────┬────────┘
           │ session.idle
           ▼
  ┌─────────────────┐
  │  RETROSPECTIVE   │  Retrospective generates ~/.opencode-kevin/retrospectives/<session>.md
  └─────────────────┘  with summary of failures and lessons
```

---

## Tools

Kevin exposes 5 tools callable by the agent:

### `kevin_save`

Saves an explicit memory.

```
kevin_save({ type: "decision", content: "We use vitest for tests", scope: "project" })
// → { "id": "0195a3b2-..." }
```

`type`: `error` | `pattern` | `decision` | `context`. `scope`: `project` (persists) | `session` (TTL 24h).

### `kevin_query`

Searches memories by text (FTS5 + bm25).

```
kevin_query({ query: "typecheck", type: "error", limit: 5 })
// → [{ "id": "...", "type": "error", "content": "...", "scope": "project" }, ...]
```

### `kevin_recall`

Retrieves relevant memories (greedy fill by relevance). Without `query`, returns all memories in scope.

```
kevin_recall({ query: "auth", limit: 3 })
// → [{ "id": "...", "type": "decision", ... }, ...]
```

### `kevin_status`

Global counts.

```
kevin_status({})
// → { "memories": 42, "tool_calls": 318, "retrospectives": 7 }
```

### `kevin_retrospective`

Generates a retrospective for a session (uses current session if `session_id` is omitted).

```
kevin_retrospective({ session_id: "sess-abc" })
// → { "file_path": "~/.opencode-kevin/retrospectives/sess-abc.md" }
// or → { "message": "No failures in session sess-abc." }
```

---

## Hooks

Kevin subscribes to 6 OpenCode hooks:

| Hook | What Kevin does |
|---|---|
| `tool.execute.before` | Records tool call start (callID + redacted args) |
| `tool.execute.after` | Records result; on failure → Reflector.invoke async (throttled) |
| `experimental.chat.system.transform` | Injects relevant lessons in `<kevin-context>` (1500 tokens) |
| `experimental.session.compacting` | Re-injects lessons in `<kevin-memory>` after compacting (2000 tokens) |
| `event` (`session.created`) | Captures current `sessionID` |
| `event` (`session.idle`) | Generates retrospective.md for the session |

**Redaction**: absolute paths (`C:\Users\...`, `/home/...`) → `<path>` and secrets (`API_KEY=`, `Bearer`, `token`) → `<redacted>` before persisting anything.

**Throttle**: Reflector generates at most 1 lesson per minute (configurable via `throttleMs`).

**Truncation**: content > 4KB keeps the lesson searchable; only the additional context is truncated (`metadata.truncated = true`).

---

## Configuration

Kevin accepts options via the plugin's tuple form (see Installation → Advanced). Programmatic defaults:

```ts
import { KevinPlugin } from "@jmtrin/opencode-kevin";

// defaults
KevinPlugin(input, {
  dbPath: "~/.opencode-kevin/kevin.db",            // or ":memory:" for tests
  migrationsDir: "<package>/dist/migrations",       // resolved automatically
  retrospectivesDir: "~/.opencode-kevin/retrospectives",
  throttleMs: 60_000,
});
```

---

## Development

```bash
git clone https://github.com/jmtrin/opencode-kevin.git
cd opencode-kevin
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e)
npm run verify      # post-install verification
```

### Publishing (maintainer)

```bash
npm login              # as the jmtrin account that owns the @jmtrin scope
npm publish --access public
```

`prepublishOnly` runs `npm run build` (tsc + copy migrations) automatically. The `files` field ships only `dist/plugin`, `dist/migrations`, and `migrations`. `dist/` is gitignored and rebuilt on publish.

### Structure

```
plugin/
  index.ts              # Entry point: KevinPlugin
  Store.ts              # Wrapper SQLite (node:sqlite / bun:sqlite / better-sqlite3 fallback)
  Migrate.ts            # Idempotent migrations
  MemoryService.ts      # save/query/getRelevant (FTS5 + bm25)
  ToolCallObserver.ts   # onBefore/onAfter + redact + inferErrorType
  Reflector.ts          # Heuristic lessons + throttle + truncation
  ContextInjector.ts    # deriveQuery + pre-prompt/compacting injection
  Retrospective.ts      # Generates retrospective.md + table insert
migrations/
  001_initial.sql       # schema: memories, tool_calls, retrospectives
  002_indexes.sql       # FTS5 + indexes
tests/{unit,integration,e2e}/
scripts/
  copy-migrations.mjs   # build step: copies *.sql to dist/migrations
  verify-install.ts     # npm run verify
```

---
## License

MIT

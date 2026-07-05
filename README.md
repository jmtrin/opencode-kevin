# Kevin

> Observe and learn: the learning layer OpenCode was missing.

Kevin is an [OpenCode](https://opencode.ai) plugin that **observes** every agent tool call, **learns** from failures by generating lessons, and **shares** what it learned proactively in future sessions. It does not plan, orchestrate, or compete with the plugin ecosystem. It only learns.

- **Local-first**: memory in SQLite + FTS5, no external services.
- **No network**: everything lives in `.kevin/kevin.db` inside your project.
- **Standalone**: works without any other plugin. With the ecosystem, it learns more richly.

---

## Installation

```bash
npm install kevin
```

Enable Kevin in your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "kevin"
  ]
}
```

When OpenCode starts, Kevin creates `.kevin/kevin.db` and runs migrations automatically.

### Requirements

- Node.js >= 20
- OpenCode with plugin support (`@opencode-ai/plugin` >= 1.17)

### Verification

```bash
npm run verify
```

Checks Node version, SQLite, migration, MemoryService save/query, Reflector, ContextInjector, and TypeScript strict mode.

---

## Ecosystem (optional)

Kevin works standalone, but shines with the rest of the OpenCode ecosystem. None are required:

```jsonc
{
  "plugin": [
    "opencode-conductor",               // Workflow: Context → Spec → Plan → Implement
    "opencode-background-agents",       // Async delegation
    "opencode-scheduler",               // Cron jobs
    "opencode-dynamic-context-pruning", // Context pruning (DCP)
    "kevin"                             // Learning layer
  ]
}
```

| Plugin | Role | Synergy with Kevin |
|---|---|---|
| `opencode-conductor` | Orchestrates autonomous tracks | More tool calls → more failures to learn from |
| `opencode-background-agents` | Async delegation | Kevin observes background work |
| `opencode-scheduler` | Cron jobs | Kevin learns from recurring jobs |
| `opencode-dynamic-context-pruning` (DCP) | Prunes stale tool outputs | DCP frees space → Kevin fills it with useful lessons |

DCP and Kevin are complementary: DCP prunes stale content, Kevin injects learned lessons.

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
  │  RETROSPECTIVE   │  Retrospective generates .kevin/retrospectives/<session>.md
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
// → { "file_path": ".kevin/retrospectives/sess-abc.md" }
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

Kevin accepts options via the plugin's second argument (advanced):

```ts
import { KevinPlugin } from "kevin";

// defaults
KevinPlugin(input, {
  dbPath: ".kevin/kevin.db",     // or ":memory:" for tests
  migrationsDir: "./migrations",
  retrospectivesDir: ".kevin/retrospectives",
  throttleMs: 60_000,
});
```

---

## Development

```bash
git clone <repo> && cd kevin
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e)
npm run verify      # post-install verification
```

### Structure

```
plugin/
  index.ts              # Entry point: KevinPlugin
  Store.ts              # Wrapper better-sqlite3 (WAL, FK, transactions)
  Migrate.ts            # Idempotent migrations
  MemoryService.ts      # save/query/getRelevant (FTS5 + bm25)
  ToolCallObserver.ts   # onBefore/onAfter + redact + inferErrorType
  Reflector.ts          # Heuristic lessons + throttle + truncation
  ContextInjector.ts    # deriveQuery + pre-prompt/compacting injection
  Retrospective.ts      # Generates retrospective.md + table insert
migrations/
  001_initial.sql       # schema: memories, tool_calls, retrospectives
tests/{unit,integration,e2e}/
scripts/
  verify-install.ts     # npm run verify
```

---

## Roadmap

| Versión | Feature | Descripción |
|---|---|---|
| v0.1 | Heurístico + FTS5 | **Esta versión.** Reflector con templates por error_type |
| v0.2 | Embeddings + hybrid retrieval | sqlite-vec + BGE-M3 ONNX; BM25 + cosine + RRF |
| v0.2 | Pattern mining | PatternMiner: secuencias de tool calls recurrentes |
| v0.3 | Cross-project memory | Preferencias del usuario con consentimiento explícito |
| v0.3 | Prompt mutation HITL | Sugerencias de mutación de SKILL.md con human-in-the-loop |
| v0.4 | Skill quality index | Pass-rate, error types, drift detection por skill |
| v0.5 | Ecosystem deep integration | Conductor tracks, sentry events, background results |

---

## License

MIT

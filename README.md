# Kevin

> Observe and learn: the learning layer OpenCode was missing.

Kevin is an [OpenCode](https://opencode.ai) plugin that **observes** every agent tool call, **learns** from failures by generating lessons, and **shares** what it learned proactively in future sessions. It does not plan, orchestrate, or compete with the plugin ecosystem. It only learns.

- **Local-first**: SQLite + FTS5, no external services, no network calls.
- **Global memory**: a single `~/.opencode-kevin/kevin.db` shared across all your projects (WAL mode → safe for concurrent sessions). No per-project folders.
- **Knowledge + Causality (v0.3.0)**: causal failure→fix chains, `kevin_why` explanations, OKF export/import, a supersede model, and human-in-the-loop AGENTS.md suggestions.
- **Signal over Noise (v0.4.0)**: a quality gate that stores weak lessons without injecting them, an injection ledger with honest `precision_rate`, two-sided confidence, and a fixed compacting hook.
- **Audited**: the v0.4.0 bug catalog (`docs/Kevin_v0.4.0_Bugs.md`) is fully closed — 16/16 bugs fixed and regression-tested (evidence in `kevin_query`/`kevin_get`, OKF round-trip fidelity, causal refresh guard, redaction precision, cross-session isolation).
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

Config is loaded once at startup and is **not hot-reloaded** — quit and reopen OpenCode after editing. On start, OpenCode resolves the npm spec, caches the plugin in `~/.cache/opencode/packages/@jmtrin/opencode-kevin/`, and exposes ten tools: `kevin_save`, `kevin_query`, `kevin_get`, `kevin_recall`, `kevin_status`, `kevin_retrospective`, `kevin_why`, `kevin_export`, `kevin_import`, `kevin_config`.

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
  │  ToolCallObserver│  (tool, args redacted, success, duration, error_type,
  │                  │   id = callID) + stripPrivate + opt-in dedup (v0.2.0)
  └────────┬────────┘
           │ on failure             │ on success
           ▼                        ▼
  ┌─────────────────┐   ┌─────────────────────────┐
  │   LEARN          │   │  CAUSAL CHAIN (v0.3.0)  │
  │   Reflector      │   │  CausalChain.onSuccess   │
  │  heuristic lesson │   │  links the fix to the   │
  │  per-error-code  │   │  failure within 10 tool │
  │  rule table      │   │  calls (error_fingerprint)
  │  (v0.2.0 v2),    │   └───────────┬─────────────┘
  │  per-fingerprint │               │
  │  throttle BEFORE │               │ session.idle
  │  LLM enrich      │               ▼
  │  (opt-in v0.3.0),│   ┌─────────────────────────┐
  │  stamps          │   │  CausalChain.onSessionIdle│
  │  error_fingerprint│  │  promotes recurring errors│
  └────────┬────────┘   │  → causal patterns (idempotent,
           │             │   cumulative evidence)     │
           ▼             └───────────┬───────────────┘
  ┌─────────────────┐               │
  │   SHARE          │◄──────────────┘
  │ ContextInjector  │  injects relevant lessons pre-prompt
  │                  │  (1500 tokens) + on compacting (2000)
  │                  │  + <protect> + id: line (v0.2.0)
  │                  │  + origin-aware rank (v0.2.0)
  │                  │  + <kevin-suggestion> after negative
  │                  │    feedback half (HITL, v0.3.0)
  └────────┬────────┘
           │ session.idle
           ▼
  ┌─────────────────┐
  │  RETROSPECTIVE   │  generates ~/.opencode-kevin/retrospectives/<session>.md
  │                  │  with origin labels, FP recap, metrics snapshot (v0.2.0)
  │                  │  + boostPositiveReflectors (v0.2.0)
  │                  │  + penalizeRecurringReflectors (v0.3.0)
  │                  │  + PatternMiner.mine (opt-in, v0.2.0)
  └─────────────────┘
```

---

## Tools

Kevin exposes 10 tools callable by the agent:

### `kevin_save`

Saves an explicit memory.

```
kevin_save({ type: "decision", content: "We use vitest for tests", scope: "project" })
// → { "id": "0195a3b2-..." }
```

`type`: `error` | `pattern` | `decision` | `context` | `rule` | `solution` (v0.3.0). `scope`: `project` (persists) | `session` (TTL 24h).

Saving a `decision` or `rule` with the same `fingerprint` as an existing active row supersedes the old one (v0.3.0 — `status='superseded'`, hidden from default queries).

### `kevin_query`

Searches memories by text (FTS5 + bm25). Returns a **slim** payload by default (v0.2.0). Pass `full: true` for the v0.1.x full content body, or `evidence: true` (v0.3.0) to include `confidence`, `evidence_count`, `last_verified_at` in the slim payload.

```
kevin_query({ query: "typecheck", type: "error", limit: 5 })
// → [{ "id": "...", "type": "error", "scope": "project", "score": -0.87, "snippet": "When bash fails with typecheck:..." }, ...]

kevin_query({ query: "typecheck", type: "error", limit: 5, full: true })
// → [{ "id": "...", "type": "error", "content": "...", "scope": "project" }, ...]
```

### `kevin_get`

Fetches a **single full memory** by id (v0.2.0 — progressive disclosure). Use when `kevin_query` returns a slim snippet and you need the complete content.

```
kevin_get({ id: "0195a3b2-..." })
// → { "id": "...", "type": "error", "content": "...", "scope": "project",
//      "relevanceScore": 0.55, "origin": "reflector", "fingerprint": "cbf29ce484222325",
//      "projectId": null, "metadata": null,
//      "evidenceCount": 2, "recurrenceCount": 1, "lastVerifiedAt": "2026-08-01 10:00:00",
//      "status": "active", "confidence": 0.55, "fixArgs": "npm i -g rg" }
```

### `kevin_recall`

Retrieves relevant memories (greedy fill by relevance). Without `query`, returns all memories in scope. Pass `includeSuperseded: true` to include superseded rows (v0.3.0).

```
kevin_recall({ query: "auth", limit: 3 })
// → [{ "id": "...", "type": "decision", ... }, ...]
```

### `kevin_status`

Global counts and metrics. v0.2.0 adds `memories_reflector`, `memories_agent`, `memories_pattern` and a `metrics` object; v0.3.0 adds `memories_causal` and 3 more seeded counters (`patterns_causal`, `causal_links`, `memories_superseded`); v0.4.0 adds the precision block: `injections_total`, `injections_effective`, `injections_ineffective`, `precision_rate`, `patterns_promoted_new`, and per-origin `recurrence_by_origin`.

```
kevin_status({})
// → { "memories": 42, "memories_reflector": 12, "memories_agent": 30, "memories_pattern": 0,
//      "memories_causal": 1, "tool_calls": 318, "retrospectives": 7,
//      "metrics": { "tokens_injected_pre_prompt": 51, "tokens_injected_compacting": 0,
//                   "reflections_throttled": 3, "duplicate_suppressions": 2,
//                   "tool_calls_deduped": 0, "patterns_mined": 0,
//                   "patterns_causal": 1, "causal_links": 2, "memories_superseded": 0 },
//      "injections_total": 14, "injections_effective": 11, "injections_ineffective": 3,
//      "precision_rate": 0.79, "patterns_promoted_new": 2,
//      "recurrence_by_origin": { "reflector": 3, "causal": 1 } }
```

### `kevin_retrospective`

Generates a retrospective for a session (uses current session if `session_id` is omitted).

```
kevin_retrospective({ session_id: "sess-abc" })
// → { "file_path": "~/.opencode-kevin/retrospectives/sess-abc.md" }
// or → { "message": "No failures in session sess-abc." }
```

### `kevin_why` (v0.3.0)

Explains *why* a failure keeps happening: looks up causal patterns for the query and builds a failure → fix trace from memories + tool_calls, including related TypeScript error-code rules.

```
kevin_why({ query: "TS2304 cannot find name" })
// → { "summary": "TS2304 recurs because ... Confirmed by 2 fixes.",
//      "confidence": 0.7, "evidence_count": 2, "last_verified": "2026-08-01 10:00:00",
//      "trace": [ { "type": "error", "summary": "..." }, { "type": "fix", "tool": "bash" } ],
//      "related_rules": [ { "code": "TS2304", "suggestion": "import or typo" } ] }
```

### `kevin_export` (v0.3.0)

Exports knowledge for sharing: `decision`/`rule`/`pattern` memories (active only, no raw errors) as YAML-frontmatter blocks (`format: "okf"`) or markdown (`format: "markdown"`). Includes `id`, `type`, `confidence` (two-sided v0.4.0 formula), `evidence_count`, `recurrence_count`, `last_verified_at`, `fingerprint`. Timestamps are treated as UTC — a re-import reproduces the exact source values.

### `kevin_import` (v0.3.0)

Ingests an exported bundle. Each entry becomes a `context` memory with `origin='imported'`; a fingerprint collision with an existing `decision`/`rule` supersedes the old row. Returns `{ imported, superseded }`.

### `kevin_config` (v0.4.0)

Reads/writes `kevin_settings` without SQL. `action: "list"` returns every setting; `action: "set"` upserts a value (default `"1"` when omitted) and rejects unknown keys unless `strict: false`.

```
kevin_config({ action: "list" })
// → { "quality_gate_enabled": "1", "lesson_snippet_injection": "1", "llm_reflection_enabled": "0", ... }

kevin_config({ action: "set", key: "quality_gate_enabled", value: "0" })
// → { "ok": true }
```

Known keys: `quality_gate_enabled`, `lesson_snippet_injection`, `llm_reflection_enabled`, `cross_project_enabled`, `patternminer_enabled`, `tool_calls_dedup_enabled` (v0.4.0).

---

## Precision (v0.4.0)

Weak lessons — errors the reflector cannot dispatch to a deterministic rule — are **stored but never injected** while `quality_gate_enabled = '1'` (default). Injection now goes through a ledger: every pre-prompt/compacting injection is recorded and settled as effective or ineffective at session idle, so `kevin_status` reports the honest picture (`injections_total`, `injections_effective/ineffective`, `precision_rate`, `patterns_promoted_new`) instead of raw "lessons shared" counts. Recurrences demote lessons (`recurrence_count` → `stale`) and lower confidence. Debug mode: `kevin_config({ action: "set", key: "quality_gate_enabled", value: "0" })` re-injects weak lessons with a `(low confidence)` marker.

---

## Hooks

Kevin subscribes to 6 OpenCode hooks:

| Hook | What Kevin does |
|---|---|
| `tool.execute.before` | Records tool call start (callID + redacted args) |
| `tool.execute.after` | Records result (id = callID); on failure → Reflector.invoke async (throttled); on success → CausalChain.onSuccess links the fix (v0.3.0) |
| `experimental.chat.system.transform` | Injects relevant lessons in `<kevin-context>` (1500 tokens) + optional `<kevin-suggestion>` (v0.3.0) |
| `experimental.session.compacting` | Re-injects lessons in `<kevin-memory>` after compacting (2000 tokens) + optional `<kevin-suggestion>` |
| `event` (`session.created`) | Captures current `sessionID` |
| `event` (`session.idle`) | Generates retrospective.md; boosts positive lessons (v0.2.0); penalizes recurring failures (v0.3.0); promotes causal patterns + mines patterns (opt-in); flushes metrics |

**Redaction**: absolute paths (`C:\Users\...`, `/home/...`) → `<path>` and secrets (`API_KEY=`, `Bearer`, `token`) → `<redacted>` before persisting anything. v0.2.0 adds `<private>…</private>` block redaction: sweeps tool call args and output before persistence, replaces with `<private: redacted N chars>`.

**Throttle**: Reflector generates at most 1 lesson per minute per unique fingerprint (v0.2.0: per-fingerprint, not global). Configurable via `throttleMs`.

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
  Migrate.ts            # Idempotent migrations + post-apply hooks
  MemoryService.ts      # save/query/getRelevant (FTS5 + bm25 + origin-aware rank + supersede)
  ToolCallObserver.ts   # onBefore/onAfter + redact + inferErrorType + dedup (opt-in)
  Reflector.ts          # Heuristic lessons + per-fingerprint throttle + lesson v2 + LLM enrich
  CausalChain.ts        # v0.3.0 — links fixes to failures + promotes causal patterns
  ContextInjector.ts    # deriveQuery + pre-prompt/compacting injection + <kevin-suggestion>
  QualityGate.ts        # v0.4.0 — weak-lesson gate (stored, not injected by default)
  InjectionLedger.ts    # v0.4.0 — injection ledger + settle → precision_rate
  Retrospective.ts      # Generates retrospective.md + FP recap + metrics snapshot
  LessonFixer.ts        # v0.4.0 — deterministic fix_args capture + promotion enrichment
  confidence.ts         # v0.4.0 — two-sided computeConfidence (evidence + recurrence)
  fingerprint.ts        # FNV-1a 64-bit (in-house, no node:crypto)
  metrics.ts            # In-memory counters + debounced flush to kevin_metrics
  PatternMiner.ts       # Opt-in deterministic 2-gram/3-gram miner
  kevin_why.ts          # v0.3.0 — kevin_why tool: failure→fix traces + related rules
  okf-export.ts         # v0.3.0 — kevin_export: OKF/markdown export
  okf-import.ts         # v0.3.0 — kevin_import: bundle parser + import
  query-tokenizer.ts    # v0.4.0 — FTS5 tokenizer for query sanitization
  memory-format.ts      # escapeInjectedText, formatMemories, <protect> + id: line wrappers
  redact.ts             # redactPaths + stripPrivate
  uuid.ts               # UUIDv7
migrations/
  001_initial.sql       # schema: memories, tool_calls, retrospectives
  002_indexes.sql       # FTS5 + indexes
  003_v02_signal.sql    # v0.2.0 Signal Quality: fingerprint, origin, metrics, dedup indexes
  004_v03_knowledge.sql # v0.3.0 Knowledge + Causality: evidence/status/supersede, error_fingerprint
  005_v04_signal.sql    # v0.4.0 Signal over Noise: recurrence_count, fix_args, last_injected_at
tests/{unit,integration,e2e}/
scripts/
  copy-migrations.mjs   # build step: copies *.sql to dist/migrations
  verify-install.ts     # npm run verify
```

---
## License

MIT

# Kevin

> Observe and learn: the learning layer OpenCode was missing.

Kevin is an [OpenCode](https://opencode.ai) plugin that **observes** every agent tool call, **learns** from failures by generating lessons, and **shares** what it learned proactively in future sessions. It does not plan, orchestrate, or compete with the plugin ecosystem. It only learns.

- **Local-first**: SQLite + FTS5, no external services, no network calls.
- **Global memory**: a single `~/.opencode-kevin/kevin.db` shared across all your projects (WAL mode → safe for concurrent sessions). No per-project folders.
- **Knowledge + Causality**: causal failure→fix chains, `kevin_why` explanations, OKF export/import, a supersede model, and human-in-the-loop AGENTS.md suggestions.
- **Signal over Noise**: a quality gate that stores weak lessons without injecting them, an injection ledger with honest `precision_rate`, and two-sided confidence.
- **Glass Box**: honest measurement replaces estimates — three-way injection settlement (`effective` / `ineffective` / `inconclusive`), human feedback that actually moves confidence, a strict dry-run `kevin_trace`, a read-only `kevin_audit`, and a hermetic replay harness.
- **Pull**: knowledge earns its way into files the model actually reads — `kevin_propose` generates a reviewable diff, a human approves, and **only then** does Kevin write, inside a frozen marker block, preserving your file's CRLF/BOM/formatting byte-for-byte outside it. Plus three distribution channels (AGENTS.md, skills, references) and a push budget gated by a confidence floor.
- **Audited**: the v0.4.0 bug catalog (`docs/Kevin_v0.4.0_Bugs.md`) is fully closed — 16/16 bugs fixed and regression-tested.
- **Standalone**: works without any other plugin. With the ecosystem, it learns more richly.

---

## Contents

- [Installation](#installation)
- [How Kevin works](#how-kevin-works)
- [Tools](#tools)
- [How Kevin measures itself](#how-kevin-measures-itself)
- [Curation & Pull](#curation--pull)
- [Replay harness](#replay-harness)
- [Hooks](#hooks)
- [Configuration](#configuration)
- [Development](#development)
- [License](#license)

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

Config is loaded once at startup and is **not hot-reloaded** — quit and reopen OpenCode after editing. On start, OpenCode resolves the npm spec, caches the plugin in `~/.cache/opencode/packages/@jmtrin/opencode-kevin/`, and exposes sixteen tools: `kevin_save`, `kevin_query`, `kevin_get`, `kevin_recall`, `kevin_status`, `kevin_retrospective`, `kevin_why`, `kevin_export`, `kevin_import`, `kevin_config`, `kevin_feedback`, `kevin_trace`, `kevin_audit`, `kevin_propose`, `kevin_approve`, `kevin_publish`.

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

## How Kevin works

Every tool call is observed; every failure becomes a lesson; every lesson is either pushed into the next prompt, written into an artifact a human approved, or retired when it stops earning its place.

```
  Tool call (success or failure)
         │
         ▼
  ┌─────────────────────────┐  OBSERVE
  │    ToolCallObserver     │  records every call (tool, redacted args,
  └───────────┬─────────────┘  success, duration, error type, dedup)
              │
   failure    │              success
   ┌──────────▼───────────┐   ┌─────────────────────────┐
   │       Reflector      │   │       CausalChain       │
   │  heuristic lesson    │   │  links the fix to the   │
   │  per error code      │   │  failure within 10 calls│
   │  (throttled per      │   └────────────┬────────────┘
   │   fingerprint)       │                │
   └──────────┬───────────┘                │ session.idle
              │                            ▼
              ▼              ┌─────────────────────────┐
  ┌───────────────────────┐  │  promotes recurring     │
  │    ContextInjector    │◄─┤  errors → causal        │
  │  SHARE: injects       │  │  patterns (cumulative   │
  │  <kevin-context>      │  │  evidence)              │
  │  ≤400 tokens/prompt   │  └─────────────────────────┘
  └───────────┬───────────┘
              │ session.idle
              ▼
  ┌─────────────────────────┐  RETROSPECTIVE: <session>.md with
  │     Retrospective       │  lessons, metrics snapshot, causal
  └─────────────────────────┘  promotion, pattern mining (opt-in)
```

At `session.idle` Kevin also settles injection outcomes, retires stale memories, and — when curation is enabled — drafts pull proposals for your review (see [Curation & Pull](#curation--pull)).

---

## Tools

Kevin exposes 16 tools callable by the agent.

### `kevin_save`

Saves an explicit memory.

```
kevin_save({ type: "decision", content: "We use vitest for tests", scope: "project" })
// → { "id": "0195a3b2-..." }
```

`type`: `error` | `pattern` | `decision` | `context` | `rule` | `solution`. `scope`: `project` (persists) | `session` (TTL 24h).

Saving a `decision` or `rule` with the same `fingerprint` as an existing active row supersedes the old one (`status='superseded'`, hidden from default queries).

### `kevin_query`

Searches memories by text (FTS5 + bm25). Returns a **slim** payload by default; pass `full: true` for the complete content, or `evidence: true` to include `confidence`, `evidence_count` and `last_verified_at`.

```
kevin_query({ query: "typecheck", type: "error", limit: 5 })
// → [{ "id": "...", "type": "error", "scope": "project", "score": -0.87,
//      "snippet": "When bash fails with typecheck:..." }, ...]
```

### `kevin_get`

Fetches a **single full memory** by id (progressive disclosure) — use it when `kevin_query` returned a slim snippet and you need the complete content.

```
kevin_get({ id: "0195a3b2-..." })
// → { "id": "...", "type": "error", "content": "...", "scope": "project",
//      "relevanceScore": 0.55, "origin": "reflector", "fingerprint": "cbf29ce484222325",
//      "projectId": null, "metadata": null,
//      "evidenceCount": 2, "recurrenceCount": 1, "lastVerifiedAt": "2026-08-01 10:00:00",
//      "status": "active", "confidence": 0.55, "fixArgs": "npm i -g rg" }
```

### `kevin_recall`

Retrieves relevant memories (greedy fill by relevance). Without `query`, returns all memories in scope. Pass `includeSuperseded: true` to include superseded rows.

```
kevin_recall({ query: "auth", limit: 3 })
// → [{ "id": "...", "type": "decision", ... }, ...]
```

### `kevin_status`

Global counts and metrics: memory census, the precision block, the six blocked-gate counters, feedback totals, and the v0.6 block (`schema_version`, `curation_enabled`, emission states, `proposals_pending` — omitted on pre-007 databases).

```
kevin_status({})
// → { "memories": 42, "memories_reflector": 12, "memories_agent": 30,
//      "memories_pattern": 0, "memories_causal": 1, "tool_calls": 318,
//      "retrospectives": 7, "tool_count": 16,
//      "metrics": { "tokens_injected_pre_prompt": 51, "tokens_injected_compacting": 0,
//                   "reflections_throttled": 3, "duplicate_suppressions": 2,
//                   "tool_calls_deduped": 0, "patterns_mined": 0,
//                   "patterns_causal": 1, "causal_links": 2, "memories_superseded": 0,
//                   "injections_inconclusive": 9, ... },
//      "injections_total": 14, "injections_effective": 2, "injections_ineffective": 3,
//      "injections_inconclusive": 9, "precision_rate": 0.40, "coverage_rate": 0.36,
//      "blocked": { "seen": 1, "weak": 0, "recurrence": 2, "stale": 0,
//                   "ignored": 1, "confidence": 2 },
//      "memories_ignored": 1, "memories_archived": 4,
//      "feedback": { "positive": 2, "negative": 1 },
//      "patterns_promoted_new": 2, "recurrence_by_origin": { "reflector": 3, "causal": 1 },
//      "v06": { "schema_version": "007", "curation_enabled": "1",
//               "skill_emission": "off", "reference_emission": "off",
//               "proposals_pending": 2 } }
```

### `kevin_retrospective`

Generates a retrospective for a session (uses the current session if `session_id` is omitted).

```
kevin_retrospective({ session_id: "sess-abc" })
// → { "file_path": "~/.opencode-kevin/retrospectives/sess-abc.md" }
// or → { "message": "No failures in session sess-abc." }
```

### `kevin_why`

Explains *why* a failure keeps happening: looks up causal patterns for the query and builds a failure → fix trace from memories + tool_calls, including related TypeScript error-code rules.

```
kevin_why({ query: "TS2304 cannot find name" })
// → { "summary": "TS2304 recurs because ... Confirmed by 2 fixes.",
//      "confidence": 0.7, "evidence_count": 2, "last_verified": "2026-08-01 10:00:00",
//      "trace": [ { "type": "error", "summary": "..." }, { "type": "fix", "tool": "bash" } ],
//      "related_rules": [ { "code": "TS2304", "suggestion": "import or typo" } ] }
```

### `kevin_export`

Exports knowledge for sharing: `decision`/`rule`/`pattern` memories (active only, no raw errors) as YAML-frontmatter blocks (`format: "okf"`) or markdown (`format: "markdown"`). Includes `id`, `type`, `confidence`, `evidence_count`, `recurrence_count`, `last_verified_at`, `fingerprint`. Timestamps are treated as UTC — a re-import reproduces the exact source values.

### `kevin_import`

Ingests an exported bundle. Each entry becomes a `context` memory with `origin='imported'`; a fingerprint collision with an existing `decision`/`rule` supersedes the old row. Returns `{ imported, superseded }`.

### `kevin_config`

Reads/writes `kevin_settings` without SQL. `action: "list"` returns every setting; `action: "set"` upserts a value (default `"1"` when omitted) and rejects unknown keys unless `strict: false`.

```
kevin_config({ action: "list" })
// → { "quality_gate_enabled": "1", "lesson_snippet_injection": "1",
//      "llm_reflection_enabled": "0", "pre_prompt_budget_tokens": "400",
//      "injection_confidence_floor": "0.6", ... }

kevin_config({ action: "set", key: "quality_gate_enabled", value: "0" })
// → { "ok": true, "key": "quality_gate_enabled", "value": "0" }
```

All settings and their defaults are listed in [Configuration](#configuration).

### `kevin_feedback`

Rates an injected memory and makes the rating count. `verdict` is `useful` | `wrong` | `outdated` | `ignore`. The first three are stored in `memory_feedback` and move `kevin_why`'s confidence (`+0.05` / `-0.1` per count); **`ignore` is a hard action** — the memory is stamped `ignored = 1` and excluded from retrieval, queries and injection.

```
kevin_feedback({ memory_id: "0195a3b2-...", verdict: "wrong", note: "the fix was wrong" })
// → { "ok": true, "verdict": "wrong" }
```

### `kevin_trace`

Strict dry-run: predicts exactly which memories `onSystemTransform` WOULD inject for a query (optionally `session_id`, `tag` and `cap`), with **zero side effects** — no counters, no ledger rows, no seen-set writes, no relevance bumps. Rejected items carry their `GateReason` (`seen_this_session` | `weak` | `recurrence` | `stale` | `ignored` | `confidence`).

```
kevin_trace({ query: "tsc error" })
// → { "query": "tsc error", "tag": "context", "cap": 400, "would_inject": true,
//      "total_tokens": 82,
//      "admitted": [ { "id": "...", "type": "error", "decision": "admitted", "tokens": 62 } ],
//      "blocked": [ { "id": "...", "type": "error", "decision": "blocked",
//                     "reason": "confidence", "tokens": 20 } ] }
```

### `kevin_audit`

Read-only report of the whole system state: memories by `status`/`origin`/`type`, injection outcomes with `precision_rate`/`coverage_rate`, the six `blocked` counters, feedback by verdict, tokens injected, the push-vs-pull `channels` comparison and the `curation` scoreboard. `verbose: true` adds the settings block. No writes, no LLM; on pre-007 databases it omits the v0.6 blocks and reports `"partial": true`.

```
kevin_audit({})
// → { "memories": { "total": 42, "by_status": { "active": 37, "stale": 1, "archived": 4 },
//                   "by_origin": { "reflector": 12, "agent": 30 }, "by_type": { "error": 20, ... },
//                   "ignored": 1, "with_feedback": 3 },
//      "injections": { "total": 14, "effective": 2, "ineffective": 3, "inconclusive": 9,
//                      "unmeasured": 0, "precision_rate": 0.40, "coverage_rate": 0.36 },
//      "blocked": { "seen": 1, "weak": 0, "recurrence": 2, "stale": 0,
//                   "ignored": 1, "confidence": 2 },
//      "feedback": { "positive": 2, "negative": 1, "by_verdict": { "useful": 2, "wrong": 1 } },
//      "tokens": { "pre_prompt": 51, "compacting": 0 }, "partial": false,
//      "channels": { "push": { "tokens_pre_prompt": 51, "injections_total": 14,
//                              "precision_rate": 0.40, "coverage_rate": 0.36,
//                              "budget_tokens": 400 },
//                    "pull": { "proposals_created": 6, "proposals_approved": 1,
//                              "proposals_rejected": 2, "artifact_writes_total": 2,
//                              "artifact_writes_noop": 1, "references_registered": 0,
//                              "skills_registered": 0,
//                              "skill_emission": "off", "reference_emission": "off" } },
//      "curation": { "eligible": 5, "curated": 1, "inferable": 3, "non_inferable": 2,
//                    "unknown": 1, "proposals_by_status": { "pending": 2, "applied": 1, ... } } }
```

### `kevin_propose`

Creates curation proposals as `pending` rows with unified diffs — **a strict dry run**. Reads the eligible memories (`inferable != 1`), renders what would go into the artifact, and returns the minimal diff. No disk write, no `curated` marks, no side effects. Only `kevin_approve` may write.

```
kevin_propose({ kind: "agents_md" })   // kind: "agents_md" | "skill" | "reference"
// → { "proposals": [ { "id": "...", "kind": "agents_md", "targetPath": "AGENTS.md",
//                      "memoryIds": ["mem-1"], "status": "pending",
//                      "createdAt": "2026-08-14 10:00:00",
//                      "diff": "--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ ..." } ] }
```

### `kevin_approve`

The **only** code path that writes a file. `approve` applies the proposal's diff atomically (temp file + rename, CRLF/BOM preserved), records an `artifact_writes` audit row, marks the proposal `applied` and its memories `curated`. `reject` records the human decision and touches nothing. Refusals and noops are audited, never silent.

```
kevin_approve({ proposal_id: "...", decision: "approve" })   // or "reject"
// → { "proposalId": "...", "status": "applied", "outcome": "written", "curated": 1 }
//   ("outcome": "noop" when the artifact already matches, "refused" when the
//    marker block is malformed; a rejected proposal returns
//    { "proposalId": "...", "status": "rejected" })
```

### `kevin_publish`

Regenerates the pull-channel bundles under `~/.opencode-kevin/` — `skills/project-knowledge.md` and `refs/<topic>.md` — reporting per-bundle outcome and the emission state (`on` / `off` / `unavailable`). Registration with the host happens at plugin startup; this tool only materializes and reports.

---

## How Kevin measures itself

### Injection outcomes

Every injection is settled at `session.idle` into one of **four outcomes**:

| Outcome | Meaning | Counts toward precision? |
|---|---|---|
| `effective` | A linked fix was observed after the injection | yes (numerator) |
| `ineffective` | The same error recurred after the injection | yes (denominator) |
| `inconclusive` | Neither — the error did not recur, but no fix was seen either | no |
| `unmeasured` | Session went idle before settlement could run | no |

- **`precision_rate`** = `effective / (effective + ineffective)`. Measuring *effect*, not absence of recurrence: a lesson that was injected and never contradicted counts as `inconclusive`, not success. **Your precision rate will look lower than before v0.5.0. That is the honest number.**
- **`coverage_rate`** = `(effective + ineffective) / total` — the share of injections that were actually measured. Reported alongside precision so a low measurable fraction stays visible instead of hiding behind a large total.
- **`blocked`** counts every gate rejection by reason — `seen_this_session`, `weak`, `recurrence`, `stale`, `ignored`, `confidence` — a rejection you did not count did not happen.

### The quality gate

Weak lessons — errors the reflector cannot dispatch to a deterministic rule — are **stored but never injected** while `quality_gate_enabled = '1'` (default). Recurrences demote lessons (`recurrence_count` → `stale`) and lower confidence. Debug mode: `kevin_config({ action: "set", key: "quality_gate_enabled", value: "0" })` re-injects weak lessons with a `(low confidence)` marker.

### Seeing the whole picture

`kevin_trace` shows you the plan *before* it happens (dry run, zero side effects); `kevin_audit` reads the whole state after; `kevin_feedback` lets a human correct it — and the correction moves the confidence number `kevin_why` reports.

---

## Curation & Pull

### The marker contract

Kevin never edits your files directly. Every artifact write happens inside a frozen marker block, delimited verbatim by:

```
<!-- kevin:begin — curated by opencode-kevin, safe to edit -->
<!-- kevin:end -->
```

These exact strings are **frozen for the v0.x line** — README, tests and the v1.0.0 migration plan all depend on their byte sequences. What Kevin guarantees:

- **Only the block between the markers may change.** Bytes outside them are byte-identical after every write — including line endings (a CRLF file stays CRLF everywhere, even inside the generated block), a leading UTF-8 BOM, and the file's final newline.
- **Malformed markers are refused, never repaired.** If the file contains a `begin` without an `end` (or vice versa), Kevin refuses the write with an explicit reason and the file is untouched. Repairing would mean guessing at user intent; refusing means the state stays visible and auditable.
- **Idempotent**: applying an unchanged plan is a counted `noop` — no temp file, no write, no mtime churn.

### The propose → review → approve flow

```
   eligible memories (inferable != 1)
          │
          ▼
   kevin_propose({ kind })          ── creates pending rows + unified diffs.
          │                            NO disk write, NO curated marks.
          ▼
   HUMAN REVIEWS THE DIFF           ── this is the entire safety model:
          │                            a memory earns its way into a file
          ▼                            only after a human said yes.
   kevin_approve({ proposal_id, decision })
          │
          ├── "approve"  ── ArtifactWriter.apply() (the ONLY write path)
          │                 atomic temp+rename, audit row in artifact_writes,
          │                 memory marked curated, proposal marked applied
          └── "reject"   ── recorded, nothing touches disk
```

Rejection history is never deleted: it is the evidence base for the roadmap's kill criterion "proposals rejected more often than approved".

### Three distribution channels

| Channel | Artifact | Cost when unused |
|---|---|---|
| **Push** | per-prompt `<kevin-context>` injection | charges on every prompt — now capped at 400 tokens by default |
| **Pull — AGENTS.md** | marker block in the project's `AGENTS.md` | zero |
| **Pull — skills** | `~/.opencode-kevin/skills/project-knowledge.md` (`skill_emission_enabled`) | zero |
| **Pull — references** | `~/.opencode-kevin/refs/<topic>.md` (`reference_emission_enabled`) | zero |

`kevin_audit`'s `channels` block compares push vs pull on the same axes, and reports each emission channel as `"on"`, `"off"` (setting `'0'` on a capable host) or `"unavailable"` (host without the v2 domain).

### The confidence floor gate

`injection_confidence_floor` (default `'0.6'`) rejects memories whose computed confidence is below the floor, counted as `injections_blocked_confidence` — the sixth gate rejection reason, measured exactly like the first five. Single-observation memories (base confidence 0.5, no confirmed evidence) stop being pushed by default; `kevin_config({ action: "set", key: "injection_confidence_floor", value: "0" })` restores v0.5 behaviour exactly.

---

## Replay harness

`npm run replay` runs every transcript in `tests/replay/fixtures/` through the plugin against an in-memory database with a frozen clock and prints one table row per transcript (memories created, injection outcomes, `precision_rate`, `coverage_rate`, tokens). Record your own session as a JSON array of typed events (`session.created`, `chat.message`, `tool.before`, `tool.after`, `system.transform`, `compacting`, `session.idle`) with ISO-8601 `at` timestamps, drop it into `tests/replay/fixtures/`, and re-run. The `at` timestamps are the only source of time during replay.

---

## Hooks

Kevin subscribes to 6 OpenCode hooks:

| Hook | What Kevin does |
|---|---|
| `tool.execute.before` | Records tool call start (callID + redacted args) |
| `tool.execute.after` | Records result (id = callID); on failure → Reflector.invoke async (throttled); on success → CausalChain links the fix |
| `experimental.chat.system.transform` | Injects relevant lessons in `<kevin-context>` (400 tokens by default, configurable) + optional `<kevin-suggestion>` |
| `experimental.session.compacting` | Re-injects lessons in `<kevin-memory>` after compacting (2000 tokens) + optional `<kevin-suggestion>` |
| `event` (`session.created`) | Captures current `sessionID` (skill/reference emissions register at plugin startup, not per session) |
| `event` (`session.idle`) | Settles injection outcomes; generates the retrospective; boosts positive lessons; penalizes recurring failures; promotes causal patterns and mines patterns (opt-in); drafts curation proposals (`curation_enabled`); flushes metrics |

**Redaction**: absolute paths (`C:\Users\...`, `/home/...`) → `<path>` and secrets (`API_KEY=`, `Bearer`, `token`) → `<redacted>` before persisting anything. `<private>…</private>` blocks are swept from tool call args and output before persistence and replaced with `<private: redacted N chars>`.

**Throttle**: Reflector generates at most 1 lesson per minute per unique fingerprint (per-fingerprint, not global). Configurable via `throttleMs`.

**Truncation**: content > 4KB keeps the lesson searchable; only the additional context is truncated (`metadata.truncated = true`).

---

## Configuration

### Plugin options

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

### Settings

Read/write via `kevin_config({ action: "list" | "set", ... })`. All values are TEXT; booleans compare against `"1"`.

| Setting | Default | Effect |
|---|---|---|
| `quality_gate_enabled` | `"1"` | Weak lessons are stored but never injected while enabled |
| `lesson_snippet_injection` | `"1"` | Injects the rescued errorType snippet with each lesson |
| `llm_reflection_enabled` | `"0"` | Opt-in LLM enrichment of reflector lessons |
| `cross_project_enabled` | `"0"` | `kevin_query` includes imported cross-project memories |
| `patternminer_enabled` | `"0"` | Opt-in deterministic 2-gram/3-gram pattern miner at `session.idle` |
| `tool_calls_dedup_enabled` | `"0"` | Opt-in dedup of repeated tool calls |
| `deterministic_retrieval` | `"0"` | Freezes Kevin's internal clock (recency factor 1.0, no relevance bumps) — for hermetic tests and the replay harness |
| `pre_prompt_budget_tokens` | `"400"` | Pre-prompt injection cap, clamped to `[0, 4000]`; `0` turns push off |
| `archive_after_days` | `"30"` | Age at which stale non-pattern memories are retired to `archived` on `session.idle` |
| `curation_enabled` | `"1"` | Generates curation proposals at `session.idle` |
| `agents_md_path` | `"AGENTS.md"` | Where the AGENTS.md channel writes (project-relative) |
| `skill_emission_enabled` | `"0"` | Registers the curated skill with the host at startup (v2 hosts only) |
| `reference_emission_enabled` | `"0"` | Registers `@kevin/<topic>` references at startup (v2 hosts only) |
| `injection_confidence_floor` | `"0.6"` | Push gate: memories below this confidence are counted and rejected |

---

## Development

```bash
git clone https://github.com/jmtrin/opencode-kevin.git
cd opencode-kevin
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e + replay)
npm run verify      # post-install verification
npm run replay      # replay report over tests/replay/fixtures
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
  index.ts              # Entry point: KevinPlugin (wires hooks, tools, emissions)
  Store.ts              # SQLite wrapper (node:sqlite / bun:sqlite / better-sqlite3 fallback)
  sqlite-adapter.ts     # Runtime-agnostic SQLite adapter behind Store
  Migrate.ts            # Idempotent migrations + post-apply hooks
  MemoryService.ts      # save/query/getRelevant (FTS5 + bm25 + origin-aware rank + supersede)
  ToolCallObserver.ts   # onBefore/onAfter + redact + inferErrorType + dedup (opt-in)
  Reflector.ts          # Heuristic lessons + per-fingerprint throttle + LLM enrich (opt-in)
  ContextInjector.ts    # deriveQuery + pre-prompt/compacting injection + <kevin-suggestion>
  Retrospective.ts      # Generates retrospective.md + FP recap + metrics snapshot
  Feedback.ts           # kevin_feedback: verdicts, confidence terms, ignored stamp
  Archiver.ts           # Retires stale non-pattern memories past archive_after_days
  CausalChain.ts        # Links fixes to failures + promotes causal patterns
  QualityGate.ts        # Weak-lesson gate (stored, not injected by default)
  InjectionLedger.ts    # Injection ledger + settle → precision_rate
  LessonFixer.ts        # Deterministic fix_args capture + promotion enrichment
  PatternMiner.ts       # Opt-in deterministic 2-gram/3-gram miner
  Curator.ts            # Curation candidates + propose/approve lifecycle
  ArtifactWriter.ts     # The SINGLE write path (markers, atomic, noop, audit rows)
  Materializer.ts       # Pull-channel topic bundles (skills, refs)
  inferability.ts       # Deterministic inferable/non-inferable/unknown classifier
  capabilities.ts       # v2 domain probe (skills / references)
  diff.ts               # Minimal unified diff for proposal review
  replay.ts             # Hermetic replay driver over recorded transcripts
  replay-types.ts       # Transcript/result types for the replay harness
  kevin_propose.ts      # kevin_propose tool (strict dry run)
  kevin_approve.ts      # kevin_approve tool (only writer call site)
  kevin_publish.ts      # kevin_publish tool (bundle regeneration)
  kevin_audit.ts        # Read-only audit + channels/curation blocks
  kevin_why.ts          # kevin_why tool: failure→fix traces + related rules
  okf-export.ts         # kevin_export: OKF/markdown export
  okf-import.ts         # kevin_import: bundle parser + import
  confidence.ts         # Two-sided computeConfidence (evidence + recurrence + feedback)
  query-tokenizer.ts    # FTS5 tokenizer for query sanitization
  memory-format.ts      # escapeInjectedText, formatMemories, <protect> + id: line wrappers
  redact.ts             # redactPaths + stripPrivate
  fingerprint.ts        # FNV-1a 64-bit (in-house, no node:crypto)
  metrics.ts            # In-memory counters + debounced flush to kevin_metrics
  uuid.ts               # UUIDv7
migrations/
  001_initial.sql       # schema: memories, tool_calls, retrospectives
  002_indexes.sql       # FTS5 + indexes
  003_v02_signal.sql    # fingerprint, origin, metrics, dedup indexes
  004_v03_knowledge.sql # evidence/status/supersede, error_fingerprint
  005_v04_signal.sql    # recurrence_count, fix_args, last_injected_at
  006_v05_glassbox.sql  # ignored/archived/superseded_by, feedback, metrics
  007_v06_pull.sql      # curation_proposals, artifact_writes, curated/inferable
tests/
  unit/                 # component tests
  integration/          # tool-level tests through real components
  e2e/                  # closed-loop tests through the host hooks
  replay/               # transcript fixtures + replay harness tests
scripts/
  copy-migrations.mjs   # build step: copies *.sql to dist/migrations
  verify-install.ts     # npm run verify
```

---

## License

MIT
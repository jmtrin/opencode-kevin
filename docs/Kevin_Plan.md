# Opencode-kevin — Implementation Plan v0.1.0

**Version:** 0.1.0
**Date:** 2026-06-30
**Status:** Frozen (Phase 1 started — 2026-07-01)
**Paradigm:** Observe and Learn
**Type:** Design document + implementation plan

---

## 1. Executive Summary

Opencode-kevin is an OpenCode plugin that **observes** what the agent does, **learns** from its mistakes, and **shares** what it has learned proactively in future sessions. It does not compete with the OpenCode plugin ecosystem; it installs on top and provides the one layer nobody else offers: learning from errors.

| Dimension | Value |
|---|---|
| Paradigm | Observe and Learn |
| Version | 0.1.0 |
| Plugins | 1 (`opencode-kevin`) |
| Source files | ~10 |
| Tasks for v0.1.0 | 45 |
| Estimated duration | 5-6 weeks (~120h) |
| Storage | Local SQLite (`.kevin/kevin.db`) |
| External dependencies | better-sqlite3, @opencode-ai/plugin, zod |

**Exit criterion**: after a typecheck failure, Kevin automatically generates a persisted lesson; in the next session, that lesson is injected into the system prompt before the agent acts, without the user asking for it.

---

## 2. Philosophy — "Observe and Learn"

### 2.1 Thesis

> Kevin is the learning layer that OpenCode lacks. It observes every tool call, reflects on failures by generating lessons, and proactively injects them into future runs. It does not plan, does not orchestrate, does not compete with the ecosystem. It only learns.

### 2.2 The core cycle

```
    ┌──────────┐
    │ OBSERVES │ tool.execute.before/after → records in tool_calls
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │  LEARNS  │ if failure → Reflector generates type:error memory
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │  SHARES  │ system.transform → injects lesson before next prompt
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ OBSERVES │ (next session, cycle repeats with learned context)
    └──────────┘
```

### 2.3 Principles

| # | Principle | Implication |
|---|---|---|
| 1 | Observe, don't orchestrate | Kevin never invokes agent tools; it only observes |
| 2 | Learning is the differentiator | Every feature answers: "does this help learning?" |
| 3 | Local-first | Everything in local SQLite. No cloud, no external services |
| 4 | Proactive over reactive | Kevin injects lessons before the agent asks for them |
| 5 | Delegate to the ecosystem | Workflow, async, scheduling, observability → community plugins |
| 6 | Plan-as-graph compatible | Kevin doesn't plan; it learns from any planner |

### 2.4 What opencode-kevin 0.1.0 does NOT do

| Function | Reason | Alternative |
|---|---|---|
| Loop engine / workflow | Ecosystem does it better | `opencode-conductor` |
| Background / async | Ecosystem does it better | `opencode-background-agents` |
| Cron scheduling | Ecosystem does it better | `opencode-scheduler` |
| Skill discovery | Native OpenCode host | Agent Skills (`/docs/skills`) |
| Remote observability | Ecosystem does it better | `opencode-sentry-monitor` |
| Context pruning | Ecosystem does it better | `opencode-dynamic-context-pruning` |
| Embeddings / semantic search | ABI complexity; deferred to v0.2 | FTS5 with `remove_diacritics` |
| Pattern mining | Deferred to v0.2 | — |
| Prompt mutation | Deferred to v0.3 | — |
| Cross-project memory | Deferred to v0.3 | — |

---

## 3. Architecture

### 3.1 Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    USER / LLM                                 │
│              (OpenCode TUI / Desktop / IDE)                  │
├──────────────────────────────────────────────────────────────┤
│                   OPENCODE HOST                               │
│  Native Skills · Agents (build, plan, general, explore)      │
│  task tool · permissions · MCP · LSP · compaction            │
├──────────────────────────────────────────────────────────────┤
│              KEVIN 0.1.0 — Observe and Learn                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  plugin/index.ts (entry point)                       │   │
│  │  ├── Store.ts           SQLite connection            │   │
│  │  ├── Migrate.ts         Migration runner             │   │
│  │  ├── MemoryService.ts   CRUD + FTS5 search           │   │
│  │  ├── ToolCallObserver.ts  Records tool calls         │   │
│  │  ├── Reflector.ts         Heuristic + LLM reflection │   │
│  │  ├── ContextInjector.ts   Injects lessons pre-prompt │   │
│  │  └── Retrospective.ts     Session summary            │   │
│  └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│              LOCAL STORAGE                                    │
│  .kevin/                                                     │
│  ├── kevin.db (SQLite + FTS5)                                │
│  ├── retrospectives/ (markdown per session)                  │
│  └── version                                                  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 File structure

```
opencode-kevin/
├── package.json
├── tsconfig.json
├── opencode.json
├── AGENTS.md
├── README.md
├── plugin/
│   ├── index.ts              # Entry point: registers tools + hooks
│   ├── Store.ts              # SQLite connection + helpers
│   ├── Migrate.ts            # Migration runner
│   ├── uuid.ts               # UUID v7 generator
│   ├── MemoryService.ts      # CRUD memories + FTS5 search
│   ├── ToolCallObserver.ts   # Hook tool.execute.* → records tool_calls
│   ├── Reflector.ts          # Heuristic + optional LLM reflection
│   ├── ContextInjector.ts    # Hook system.transform + compacting
│   └── Retrospective.ts      # Hook session.idle → generates retrospective.md
├── migrations/
│   └── 001_initial.sql       # Schema: memories, memories_fts, tool_calls, retrospectives
├── scripts/
│   └── verify-install.ts     # Post-install verification
├── tests/
│   ├── unit/
│   │   ├── store.test.ts
│   │   ├── migrate.test.ts
│   │   ├── memory-service.test.ts
│   │   ├── tool-call-observer.test.ts
│   │   ├── reflector.test.ts
│   │   ├── context-injector.test.ts
│   │   └── retrospective.test.ts
│   ├── integration/
│   │   ├── reflection-hook.test.ts
│   │   ├── pre-prompt-injection.test.ts
│   │   └── compacting-injection.test.ts
│   └── e2e/
│       ├── memory-flow.test.ts
│       ├── reflection-loop.test.ts
│       ├── context-injection.test.ts
│       └── retrospective.test.ts
└── docs/
    ├── Kevin_Plan.md         # This document
    └── Kevin_Task.md         # Task list
```
Opencode-kevin 0.1.0 works **standalone** without any other plugin. With ecosystem plugins, opencode-kevin observes more context and learns richer, but does not depend on them.

---

## 4. SQLite Schema — `migrations/001_initial.sql`

```sql
-- ============================================================
-- Opencode-kevin 0.1.0 — Initial Schema
-- ============================================================

-- Migration versions table
CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- memories: learned lessons
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('error', 'pattern', 'decision', 'context')),
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project', 'session')),
  relevance_score REAL DEFAULT 0.5,
  source_tool TEXT,
  source_session TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

-- FTS5: full-text search with diacritic removal (best for Spanish)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  tokenize='unicode61 remove_diacritics 1'
);

-- Triggers to keep FTS5 synchronized
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

-- ============================================================
-- tool_calls: agent tool call observation
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,
  args_summary TEXT,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  duration_ms INTEGER,
  agent TEXT,
  error_type TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool);
CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(ts);
CREATE INDEX IF NOT EXISTS idx_tool_calls_success ON tool_calls(success);

-- ============================================================
-- retrospectives: session summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS retrospectives (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  failure_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  lessons_count INTEGER DEFAULT 0,
  file_path TEXT,
  metadata TEXT
);

-- ============================================================
-- Seed: initial version
-- ============================================================
INSERT OR IGNORE INTO schema_version (version) VALUES ('001');
```

---

## 5. Components — detailed specification

### 5.1 `Store.ts` — SQLite Connection

**Responsibility**: Opens better-sqlite3 connection, exposes prepared statements, manages transactions.

```typescript
import Database from 'better-sqlite3';

export class Store {
  private db: Database.Database;

  constructor(options: { path: string }) {
    this.db = new Database(options.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  prepare(sql: string): Database.Statement { return this.db.prepare(sql); }
  transaction(fn: () => void): void { this.db.transaction(fn)(); }
  close(): void { this.db.close(); }
  get raw(): Database.Database { return this.db; }
}
```

**Key methods**:
- `constructor({ path })` — opens DB, WAL mode, foreign keys ON
- `prepare(sql)` — prepared statement
- `transaction(fn)` — transactional wrapper
- `close()` — closes connection

### 5.2 `Migrate.ts` — Migration Runner

**Responsibility**: Reads `schema_version`, applies pending migrations from `migrations/`, updates version.

```typescript
export class Migrate {
  constructor(private store: Store, private migrationsDir: string) {}

  async run(): Promise<{ from: string; to: string; applied: string[] }> {
    // 1. Create schema_version if it doesn't exist
    // 2. Read current version
    // 3. List .sql migrations in migrationsDir sorted
    // 4. Apply pending ones in a transaction
    // 5. Return result
  }
}
```

**Behavior**:
- Idempotent: if all applied, does nothing
- Transactional: if a migration fails, full rollback
- Reads `.sql` files from the `migrations/` directory

### 5.3 `uuid.ts` — UUID v7 Generator

**Responsibility**: Generates temporally sortable IDs (UUID v7).

```typescript
export function uuidv7(): string {
  // Timestamp (48 bits) + random (12 bits version + 62 bits random)
  // Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
}
```

### 5.4 `MemoryService.ts` — CRUD + FTS5

**Responsibility**: Saves, searches, updates, and deletes memories. FTS5 search with `bm25` ranking.

```typescript
export class MemoryService {
  constructor(private store: Store) {}

  save(input: {
    type: 'error' | 'pattern' | 'decision' | 'context';
    content: string;
    scope?: 'project' | 'session';
    relevanceScore?: number;
    sourceTool?: string;
    sourceSession?: string;
    metadata?: Record<string, unknown>;
    expiresAt?: string;
  }): string;

  query(input: {
    text: string;
    type?: string;
    scope?: 'project' | 'session' | 'all';
    limit?: number;
  }): Memory[];

  getById(id: string): Memory | null;

  update(id: string, fields: Partial<Memory>): void;

  delete(id: string): void;

  getRelevant(input: {
    query?: string;
    maxTokens?: number;
    scope?: 'project' | 'session' | 'all';
  }): Memory[];
}
```

**`Memory` type**:
```typescript
interface Memory {
  id: string;
  type: 'error' | 'pattern' | 'decision' | 'context';
  content: string;
  scope: 'project' | 'session';
  relevanceScore: number;
  sourceTool?: string;
  sourceSession?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
```

**FTS5 Search**:
```sql
SELECT m.*, bm25(memories_fts) as score
FROM memories_fts
JOIN memories m ON m.id = memories_fts.rowid
WHERE memories_fts MATCH ?
  AND (m.scope = ? OR ? = 'all')
  AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
ORDER BY score
LIMIT ?;
```

**`getRelevant`**: greedy strategy with token budget. Filters expired, orders by `relevance_score` DESC + `created_at` DESC, fill respecting `maxTokens * 4` chars.

### 5.5 `ToolCallObserver.ts` — Observation

**Responsibility**: Hook `tool.execute.before/after`. Records each tool call in the `tool_calls` table.

```typescript
export class ToolCallObserver {
  constructor(private store: Store) {}

  onBefore(input: ToolExecuteInput, output: ToolExecuteOutput): void {
    // Record intention (initial ts)
  }

  onAfter(input: ToolExecuteInput, output: ToolExecuteOutput): void {
    // Record result: tool, args_summary (redacted), success, duration_ms, agent
    // Infer error_type if success=0
  }

  private redactSecrets(text: string): string {
    // Patterns: API_KEY=*, SECRET=*, PASSWORD=*, token *, bearer *
    // Replace with <redacted>
  }

  private summarizeArgs(args: Record<string, unknown>): string {
    // Readable summary: paths, commands, no secrets
  }

  private inferErrorType(stderr: string, stdout: string): string | null {
    // typecheck: "error TS" | "tsc" | "TypeScript"
    // lint: "lint" | "biome" | "eslint"
    // test: "test" | "vitest" | "jest" | "FAIL"
    // runtime: "Error:" | "TypeError" | "ReferenceError"
    // timeout: exitCode -1 && empty stderr
    // unknown: default
  }
}
```

**Record in `tool_calls`**:
```sql
INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata)
VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?);
```

### 5.6 `Reflector.ts` — Reflection on Failures

**Responsibility**: After a failed tool call, generates a `type: error` memory with the learned lesson.

```typescript
export class Reflector {
  constructor(private memoryService: MemoryService) {}

  async invoke(input: {
    toolName: string;
    argsSummary: string;
    stderr: string;
    stdout: string;
    exitCode: number;
    errorType: string;
    sessionId: string;
  }): Promise<string | null> {
    // 1. Redact paths and secrets from output
    // 2. Generate heuristic lesson
    // 3. If content > 4KB, truncate + metadata.not_searchable = true
    // 4. Persist as type: error memory
    // 5. Return memory_id or null if not applicable
  }

  private generateHeuristicLesson(input: ReflectionInput): string {
    // Template: "When {tool} fails with {errorType}: {firstErrorLine}\nSuggestion: {suggestion}"
    // Suggestions per errorType:
    //   typecheck → "Verify types and imports before running."
    //   lint → "Run linter and fix warnings before committing."
    //   test → "Run tests and fix failures before proceeding."
    //   runtime → "Check error message and stack trace for root cause."
    //   timeout → "Check for infinite loops or long-running operations."
    //   unknown → "Review the error output for details."
  }

  private redactPaths(text: string): string {
    // Replace absolute paths with <path>
    // Windows: C:\... → <path>
    // Unix: /home/... → <path>
  }

  private redactSecrets(text: string): string {
    // API_KEY=*, SECRET=*, PASSWORD=*, token*, bearer*
  }
}
```

**Throttle**: maximum 1 reflection per minute (configurable). If a reflection already happened in the last minute, skip.

**Fallback**: if no sub-agent is available, always generates a heuristic lesson. The heuristic lesson is functional without API costs.

### 5.7 `ContextInjector.ts` — Proactive Injection

**Responsibility**: Injects learned lessons into the system prompt before each user message, and during compaction.

```typescript
export class ContextInjector {
  constructor(private memoryService: MemoryService) {}

  onSystemTransform(input: SystemTransformInput, output: SystemTransformOutput): void {
    // 1. Derive query from last user message
    // 2. Search relevant memories (prioritize type: error and type: pattern)
    // 3. Budget: 1500 tokens (~6000 chars)
    // 4. Format as <kevin-context>Relevant Lessons:\n...</kevin-context>
    // 5. Add to output (system prompt)
  }

  onCompacting(input: CompactingInput, output: CompactingOutput): void {
    // 1. Derive query from session context
    // 2. Search relevant memories (all types)
    // 3. Budget: 2000 tokens (~8000 chars)
    // 4. Format as <kevin-memory>\n...</kevin-memory>
    // 5. Add to output.context
  }

  private deriveQuery(messages: Message[]): string {
    // Extract keywords from last user message
    // Basic stop words (English and Spanish)
  }

  private formatMemories(memories: Memory[], format: 'context' | 'memory'): string {
    // context: <kevin-context>Relevant Lessons:\n[type] content\n...</kevin-context>
    // memory: <kevin-memory>\n[type] content\n...</kevin-memory>
  }
}
```

**Key behavior**:
- If no relevant memories, adds nothing (don't contaminate the prompt)
- Prioritizes `type: error` and `type: pattern` over `decision` and `context`
- Respects the token budget
- Filters expired memories (session scope)

### 5.8 `Retrospective.ts` — Session Summary

**Responsibility**: After `session.idle`, if there were failures, generates a markdown file with the summary.

```typescript
export class Retrospective {
  constructor(private store: Store, private memoryService: MemoryService) {}

  async generate(sessionId: string): Promise<string | null> {
    // 1. Count tool_calls success/failure for the session
    // 2. If no failures, return null (don't generate retrospective)
    // 3. List tools that failed with error_type
    // 4. List generated lessons (memories type:error with source_session = sessionId)
    // 5. Generate markdown:
    //    # Retrospective — Session {sessionId}
    //    ## Summary
    //    - Tool calls: {total} ({success} ok, {failure} failed)
    //    ## Tools that failed
    //    - {tool} ({error_type}): {args_summary}
    //    ## Generated Lessons
    //    - {content}
    // 6. Save in .kevin/retrospectives/{sessionId}.md
    // 7. Insert into retrospectives table
    // 8. Return file_path
  }
}
```

---

## 6. Plugin Entry Point — `plugin/index.ts`

```typescript
import { type Plugin, tool } from '@opencode-ai/plugin';
import { Store } from './Store.js';
import { Migrate } from './Migrate.js';
import { MemoryService } from './MemoryService.js';
import { ToolCallObserver } from './ToolCallObserver.js';
import { Reflector } from './Reflector.js';
import { ContextInjector } from './ContextInjector.js';
import { Retrospective } from './Retrospective.js';

export const KevinPlugin: Plugin = async (ctx) => {
  // 1. Initialize Store
  const dbPath = `${ctx.directory}/.kevin/kevin.db`;
  const store = new Store({ path: dbPath });

  // 2. Migrate
  const migrate = new Migrate(store, `${ctx.directory}/migrations`);
  await migrate.run();

  // 3. Initialize components
  const memoryService = new MemoryService(store);
  const observer = new ToolCallObserver(store);
  const reflector = new Reflector(memoryService);
  const injector = new ContextInjector(memoryService);
  const retrospective = new Retrospective(store, memoryService);

  // 4. Session state
  let currentSessionId: string | null = null;
  let lastReflectionTs = 0;

  return {
    // === TOOLS ===
    tool: {
      kevin_save: tool({
        description: 'Save a memory (lesson learned, decision, pattern, context)',
        args: {
          type: tool.schema.enum(['error', 'pattern', 'decision', 'context']),
          content: tool.schema.string(),
          scope: tool.schema.enum(['project', 'session']).optional(),
        },
        async execute(args) {
          const id = memoryService.save(args);
          return `Memory saved: ${id}`;
        },
      }),

      kevin_query: tool({
        description: 'Search memories by text (FTS5)',
        args: {
          query: tool.schema.string(),
          type: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args) {
          const results = memoryService.query({
            text: args.query,
            type: args.type,
            limit: args.limit ?? 10,
          });
          return JSON.stringify(results, null, 2);
        },
      }),

      kevin_recall: tool({
        description: 'Recall memories relevant to the current task',
        args: {
          query: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
        },
        async execute(args) {
          const results = memoryService.getRelevant({
            query: args.query,
            maxTokens: 2000,
          });
          return JSON.stringify(results, null, 2);
        },
      }),

      kevin_status: tool({
        description: 'Show Kevin learning status (memories, tool calls, retrospectives)',
        args: {},
        async execute() {
          // Count memories, tool_calls, retrospectives
          // Return JSON summary
        },
      }),

      kevin_retrospective: tool({
        description: 'Generate or view session retrospective',
        args: {
          session_id: tool.schema.string().optional(),
        },
        async execute(args) {
          const result = await retrospective.generate(
            args.session_id ?? currentSessionId ?? 'unknown'
          );
          return result
            ? `Retrospective generated: ${result}`
            : 'No failures in session, no retrospective generated';
        },
      }),
    },

    // === HOOKS ===
    'tool.execute.before': async (input, output) => {
      observer.onBefore(input, output);
    },

    'tool.execute.after': async (input, output) => {
      observer.onAfter(input, output);

      // If failure, trigger async reflection (throttled)
      if (output.success === false) {
        const now = Date.now();
        if (now - lastReflectionTs > 60_000) { // throttle 1/min
          lastReflectionTs = now;
          // No await: async, doesn't block the hook
          reflector.invoke({
            toolName: input.tool,
            argsSummary: observer.summarizeArgs(input.args),
            stderr: output.stderr ?? '',
            stdout: output.stdout ?? '',
            exitCode: output.exitCode ?? 1,
            errorType: observer.inferErrorType(output.stderr ?? '', output.stdout ?? '') ?? 'unknown',
            sessionId: currentSessionId ?? 'unknown',
          }).catch(() => {}); // swallow errors
        }
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      injector.onSystemTransform(input, output);
    },

    'experimental.session.compacting': async (input, output) => {
      injector.onCompacting(input, output);
    },

    'session.idle': async (event) => {
      if (currentSessionId) {
        await retrospective.generate(currentSessionId).catch(() => {});
      }
    },

    'session.created': async (event) => {
      currentSessionId = event.properties?.sessionID ?? null;
    },
  };
};
```

---

## 7. Exposed Tools — Summary

| Tool | Description | Args |
|---|---|---|
| `kevin_save` | Saves a memory | `type`, `content`, `scope?` |
| `kevin_query` | Searches memories by text (FTS5) | `query`, `type?`, `limit?` |
| `kevin_recall` | Recalls relevant memories | `query?`, `limit?` |
| `kevin_status` | Learning status | — |
| `kevin_retrospective` | Generates/views retrospective | `session_id?` |

---

## 8. Subscribed Hooks — Summary

| Hook | Component | Behavior |
|---|---|---|
| `tool.execute.before` | `ToolCallObserver` | Records initial ts of tool call |
| `tool.execute.after` | `ToolCallObserver` + `Reflector` | Records result; if failure, triggers async reflection (throttled 1/min) |
| `experimental.chat.system.transform` | `ContextInjector` | Injects relevant lessons pre-prompt (1500 tokens budget) |
| `experimental.session.compacting` | `ContextInjector` | Injects relevant memories during compaction (2000 tokens budget) |
| `session.created` | Plugin | Captures current `sessionID` |
| `session.idle` | `Retrospective` | Generates retrospective.md if there were failures |

---

## 9. Configuration — Base Files

### 9.1 `package.json`

```json
{
  "name": "opencode-kevin",
  "version": "0.1.0",
  "description": "Kevin — Observe and Learn: learning layer for OpenCode",
  "type": "module",
  "scripts": {
    "build": "tsc --outDir dist",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "vitest run tests/e2e",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "verify": "node --import tsx scripts/verify-install.ts"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.17.6",
    "better-sqlite3": "^12.11.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "engines": { "node": ">=20.0.0" },
  "license": "MIT"
}
```

### 9.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"],
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["plugin/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]
}
```

### 9.3 `opencode.json` (development)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./plugin/index.ts"]
}
```

### 9.4 `AGENTS.md` (skeleton)

```markdown
# Kevin — AGENTS.md

## Commands
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — Biome check
- `npm test` — Vitest (all tests)
- `npm run verify` — Post-install verification

## Architecture
Kevin is 1 plugin with 7 components: Store, Migrate, MemoryService,
ToolCallObserver, Reflector, ContextInjector, Retrospective.

## Conventions
- TypeScript strict, ESM modules
- SQLite via better-sqlite3
- Tests with vitest (unit, integration, e2e)
- Lint with Biome
```

---

## 10. Testing Strategy

### 10.1 Levels

| Level | Coverage | Tool | When |
|---|---|---|---|
| Unit | ≥90% pure functions | vitest | Each phase |
| Integration | ≥80% component-component interactions | vitest + SQLite `:memory:` | Each phase |
| E2E | Complete flows | vitest + temporary SQLite | End of project |

### 10.2 Critical Tests

| Test | Description |
|---|---|
| `store.test.ts` | Store opens, prepares, transactions, closes |
| `migrate.test.ts` | Migration 001 applies without error, idempotent |
| `memory-service.test.ts` | CRUD + FTS5 search + session scope expiration |
| `tool-call-observer.test.ts` | Records tool calls, redacts secrets, infers error_type |
| `reflector.test.ts` | Heuristic lesson generation, redact paths/secrets, throttle |
| `context-injector.test.ts` | Injects lessons, respects budget, no contamination if empty |
| `retrospective.test.ts` | Generates markdown, doesn't generate if no failures |
| `reflection-loop.test.ts` (e2e) | Typecheck failure → error memory → recall returns it |
| `context-injection.test.ts` (e2e) | Error memory → next session injects lesson pre-prompt |
| `retrospective.test.ts` (e2e) | Session with failures → retrospective.md exists |

### 10.3 Continuous Verification

```bash
npm run typecheck && npm run lint && npm test
npm run verify
```

---

## 11. Decisions

| # | Decision | Resolution | Justification |
|---|---|---|---|
| D1 | 1 plugin or multiple | **1 plugin** | v0.1.0 simplicity; split in v0.2 if it grows |
| D2 | Memory: FTS5 or embeddings | **FTS5** with `remove_diacritics 1` | No ABI risk with sqlite-vec; embeddings in v0.2 |
| D3 | Reflection: LLM or heuristic | **Heuristic always**, LLM optional | Works without API costs; LLM enriches if available |
| D4 | Scope: project, session, or global | **project + session** | Global/cross-project in v0.3 |
| D5 | Storage location | `.kevin/kevin.db` (project-level) | Local-first; no global in v0.1.0 |
| D6 | Throttle reflection | 1/min maximum | Avoid costs if LLM is available |
| D7 | Token budget injection | 1500 tokens pre-prompt, 2000 compacting | Don't contaminate context |
| D8 | Retrospective trigger | `session.idle` only if there were failures | Don't generate noise if session OK |
| D9 | FTS5 tokenizer | `unicode61 remove_diacritics 1` | Better for Spanish than `unicode61` alone |
| D10 | Version target | **0.1.0** | Fresh start, honest semver |

---

## 12. Plan Phases

| Phase | Duration | Tasks | Description |
|---|---|---|---|
| F1 — Foundation | 1 week | K-001 to K-007 | Project setup, Store, Migrate, schema, uuid |
| F2 — Memory | 1 week | K-008 to K-014 | MemoryService CRUD + FTS5 + session scope |
| F3 — Observation | 1 week | K-015 to K-020 | ToolCallObserver + hooks + redaction |
| F4 — Reflection | 1 week | K-021 to K-028 | Heuristic Reflector + failure hook + throttle |
| F5 — Injection + Retrospective | 1 week | K-029 to K-036 | ContextInjector + Retrospective + hooks |
| F6 — Plugin + Release | 0.5-1 week | K-037 to K-045 | Entry point, tools, e2e, verify, tag v0.1.0 |

**Total: ~5-6 weeks, ~120h, 45 tasks**

**Critical path**:
```
K-001 → K-003 → K-005 → K-008 → K-010 → K-015 → K-017
    → K-021 → K-024 → K-029 → K-033 → K-037 → K-041 → K-045
```

---

## 13. Versioning

**Opencode-kevin v0.1.0** — first public release.

```markdown
## [0.1.0] - 2026-XX-XX

### Added
- `kevin` plugin with "Observe and Learn" paradigm
- Local-first SQLite + FTS5 memory (unicode61 remove_diacritics)
- ToolCallObserver: records tool calls via hooks
- Reflector: generates heuristic lessons after failures
- ContextInjector: injects lessons pre-prompt and during compaction
- Retrospective: generates session summary after session.idle
- Tools: kevin_save, kevin_query, kevin_recall, kevin_status, kevin_retrospective
- Hooks: tool.execute.before/after, system.transform, session.compacting, session.idle
- Recommended stack: conductor, background-agents, scheduler, DCP (optional)
```

---

## 14. Future Roadmap (post-v0.1.0)

| Version | Feature | Description |
|---|---|---|
| v0.2 | Embeddings + hybrid retrieval | sqlite-vec + BGE-M3 ONNX; BM25 + cosine + RRF |
| v0.2 | Pattern mining | PatternMiner: tool call sequences |
| v0.3 | Prompt mutation HITL | SKILL.md mutation suggestions with human-in-the-loop |
| v0.3 | Cross-project memory | User preferences with consent |
| v0.4 | Skill quality index | Pass-rate, error types, drift detection per skill |
| v0.4 | Enriched LLM reflection | Cheap sub-agent for richer reflection |
| v0.5 | Ecosystem deep integration | Conductor tracks, sentry events, background results |

---

## 15. References

- https://opencode.ai/docs — OpenCode docs (intro, install, usage)
- https://opencode.ai/docs/plugins — Plugin API, hooks, events
- https://opencode.ai/docs/skills — Native Agent Skills
- https://opencode.ai/docs/agents — Primary/subagents, task tool
- https://opencode.ai/docs/custom-tools — tool() helper, Zod schemas
- https://opencode.ai/docs/ecosystem — Community plugins
- https://github.com/WiseLibs/better-sqlite3 — SQLite for Node.js
- https://github.com/sqlite/sqlite/blob/master/ext/fts5/doc/fts5.md — FTS5 docs

**Next document**: `Kevin_Task.md` — exhaustive task list K-001..K-045.

**Post-release fix**: `docs/Kevin_Fix_v0.1.4.md` — Fix v0.1.4: detección de fallos auto-suficiente (K-046…K-050). Tras la validación K-045, F#1 seguía roto en producción: el bash tool entrega `metadata = {}` y la heurística de v0.1.3 no escaneaba `output.output` en la rama por defecto (`plugin/index.ts:291`). v0.1.4 siempre escanea stdout con `STRONG_ERROR_RE` cuando no hay señal definitiva.

---

# PART B — v0.2.0 (Signal Quality)

> **Complement, not replacement.** This Part B is additive: it keeps Part A (v0.1.0 + Fix v0.1.4) intact above and appends the v0.2.0 plan, decisions, schema delta, and architecture deltas. Sections are prefixed `§B*` to avoid clashing with Part A's `§1`..`§15`. Tasks are numbered `K2-001`..`K2-032` to avoid clashing with `K-001`..`K-050`.
>
> **Author:** GLM-5.2 ( Turn 2 of the v0.2.0 planning session, 2026-07-18 ).
> **Inputs:** `docs/Kevin_new_v0.2.0.md` (Grok 4.5 analysis) + direct review of `plugin/*.ts` and `migrations/001_initial.sql`.
> **Status:** Draft for implementation by a later model.
> **Version target:** `@jmtrin/opencode-kevin@0.2.0`.
> **Estimated effort:** 3–5 weeks (single implementer), 32 tasks.

---

## §B1. Executive summary

v0.1.x delivered *observation* (ToolCallObserver), *reflection* (Reflector with `STRONG_ERROR_RE`), and *injection* (ContextInjector with 1500/2000 token budgets). v0.2.0 delivers **signal quality** on top of that substrate: fewer duplicates, per-fingerprint throttling, stable IDs in every injected block, DCP-aware `<protect>`/`<private>` wrappers, deterministic lesson v2 from per-error-code rules, project-scoped dedup, a metrics surface in `kevin_status`, and an opt-in PatternMiner. The storage layer gets a **backward-compatible, idempotent migration 003** that adds nullable columns and runtime backfill — no DB rebuild required.

Two explicit non-goals carry over from the Grok 4.5 analysis: **embeddings stay in v0.2-later or v0.3** (we keep FTS5 + a deterministic hybrid rank), and **LLM reflection stays in v0.3+.** OKF core integration is rejected (only the *progressive disclosure* idea is borrowed, via the new `kevin_get` tool). claude-mem's Worker + Chroma + multi-IDE stack is also rejected — Kevin remains 1 plugin, SQLite-only, DCP-first.

| Dimension | Value |
|---|---|
| Release theme | Signal Quality |
| New files (plugin) | `fingerprint.ts`, `metrics.ts`, `PatternMiner.ts` |
| Changed files | `MemoryService.ts`, `Reflector.ts`, `ContextInjector.ts`, `ToolCallObserver.ts`, `redact.ts`, `memory-format.ts`, `Retrospective.ts`, `index.ts`, `Store.ts`, `Migrate.ts` |
| New migration | `migrations/003_v02_signal.sql` (idempotent, additive) |
| New tool | `kevin_get({ id })` |
| Changed tools | `kevin_query` (slim payload), `kevin_status` (metrics + reflector/agent split) |
| New memory columns | `memories.project_id`, `memories.fingerprint`, `memories.origin` |
| New tool_calls columns | `tool_calls.project_id`, `tool_calls.fingerprint` |
| New table | `kevin_metrics` (seeded counters) |
| Tasks | `K2-001`..`K2-032` (32) |
| Risk | 🟡 medium (DB migration + dedup semantics; guarded by idempotent DDL and opt-in flags) |
| Breaking | No (additive columns/migration; runtime backfill keeps old rows usable) |

**Exit criterion**: in a fresh clone, after `npm run typecheck` fails and the agent does NOT call `kevin_save`, `kevin_status` reports `memories ≥ 1` with `origin = reflector`, `kevin_query "typecheck"` returns a slim `{ id, type, scope, score, snippet }` row, `kevin_get <id>` returns the full lesson, and the next session's `system.transform` injects the lesson wrapped in `<protect>` with its `id` line visible — all without intervention.

---

## §B2. Deltas vs the Grok 4.5 recommendation

GLM-5.2 agrees with the Grok 4.5 analysis (`docs/Kevin_new_v0.2.0.md`) on the P0/P1 split, the rejection of OKF core and claude-mem cloning, and the "Signal Quality" theme. The following are explicit deltas from GLM-5.2, each with rationale:

| # | Delta | Rationale |
|---|---|---|
| D-a | **DB backward compatibility is a HARD requirement.** Migration 003 must be idempotent, all new columns nullable, old rows backfilled at runtime (not pre-populated). | The kevin DB at `~/.opencode-kevin/kevin.db` already exists in users' hands; a rebuild would erase K-045-style lessons and the K-045 anti-gaming audit trail. Grok 4.5 listed "DB compat" as a bullet but did not make it non-negotiable. |
| D-b | **Observation contract: `origin` column distinguishes `reflector` vs `agent`.** | K-045's anti-gaming audit depends on being able to tell which memories came from the agent calling `kevin_save` vs which came from the Reflector. We add `origin IN ('reflector','agent','pattern','retrospective')` so the retrospective and the ContextInjector ranking can treat them differently. |
| D-c | **PatternMiner is OPT-IN by default; threshold `N ≥ 5` occurrences before it emits a `pattern` memory.** | Grok 4.5 listed PatternMiner as P1 with no threshold. Noise from consecutive tool patterns is a real risk in an Observe-and-Learn plugin — we start noisy-off and let the user enable it. |
| D-d | **Lesson v2 is a per-error-code deterministic rule table, NOT an LLM call.** | We map `TS2304 → 'import or typo'`, `TS2322 → 'type mismatch'`, `TS2740 → 'missing or wrong property'`, `TS2552 → 'undefined identifier'`, `TS18047 → 'possibly null'`, plus generic `Error:`, `EADDRINUSE`, `ENOENT`, `EACCES`, `EPERM`, `Command failed` rules. Routing is dispatched off the captured error code; no external model. Grok 4.5 hinted at "heuristic lesson v2" without specifying the dispatch mechanism. |
| D-e | **Feedback loop positive half only in v0.2.** | We record "this lesson was injected and the session ended without a repeat of that fingerprint" as a positive signal that boosts `relevance_score` by a small ε. The negative half (down-weight on recurrence) is deferred to v0.3 with the LLM reflection hop. |
| D-f | **`project_id` becomes a first-class column participating in the dedup UNIQUE partial index.** | Grok 4.5 listed `project_id` as P0 but treated it as metadata. Making it a column lets us scope dedup per project (an ESLint rule fired in project A is NOT the same lesson as the same rule in project B) and lets future cross-project recall buy back the sharing semantics. |
| D-g | **Hybrid ranking without embeddings is kept deterministic (BM25 + field boosts + recency), no RRF.** | Grok 4.5 left hybrid ranking at P1 with a "no embeddings" caveat. We formalize it: no sqlite-vec in v0.2, so there is no vector leg to fuse — RRF is meaningless. Revisit at v0.3 when embeddings land. |
| D-h | **`kevin_query` returns a slim `{ id, type, scope, score, snippet }` default payload; `kevin_get({ id })` fetches full content.** | Adds a second hop but cuts tokens during pre-prompt injection (we only inject the snippets + ids; the agent calls `kevin_get` only when it actually needs the body). This is the "progressive disclosure" idea borrowed from OKF without importing the OKF format. |

All other P0 items (`K2-01` throttle per fingerprint, `K2-02` dedup, `K2-03` ids in injection, `K2-04` `<protect>`+DCP, `K2-05` `<private>`, `K2-08` metrics) are accepted as Grok 4.5 stated.

---

## §B3. Scope and non-goals

**In scope (P0):**

1. Per-fingerprint throttle (refactor `lastReflectionTs` from a single global ts to a `Map<fingerprintKey, ts>`).
2. Error-memory dedup via `(project_id, fingerprint)` UNIQUE partial index.
3. Stable `id` lines in every injected memory block.
4. `<protect>` wrapper around injected blocks + `<private>` redaction in observed tool calls.
5. Progressive disclosure tooling: `kevin_get({ id })` + slim `kevin_query`.
6. `project_id` first-class column on `memories` and `tool_calls`.
7. Metrics counters surfaced through `kevin_status`.
8. Lesson v2 deterministic rule table keyed by error code.

**In scope (P1, opt-in):**

9. PatternMiner (opt-in, threshold N ≥ 5).
10. tool_calls dedup (off by default, behind a flag).
11. Conditional budgets in ContextInjector (lower budget when the block is already `<protect>`-tagged).
12. Feedback loop positive half (inject → no recurrence → boost by ε).
13. Hybrid ranking (BM25 + field boosts + recency) — no embeddings.

**Out of scope (deferred):**

14. Embeddings / sqlite-vec / BGE-M3 / RRF → **v0.3** (the roadmap table in §14 is amended accordingly; see §B12).
15. LLM reflection loop → v0.3.
16. Worker / separate process / MCP server → unspecified future.
17. OKF format import/export → v0.3 cross-project bridge.
18. Session compaction via DCP → already handled by opencode core (`experimental.session.compacting`); we keep reading the event and re-inject.
19. Feedback loop negative half (down-weight on recurrence) → v0.3.
20. Multi-IDE integration, shared sync, Chroma → never (claude-mem cloning gated as reject).

---

## §B4. Architecture deltas

The 7-module static structure from Part A is preserved. Three new files and one new migration are introduced, and existing modules get additive changes:

```
plugin/
  index.ts               # +kevin_get tool; +slim kevin_query; +kevin_status metrics
  Store.ts               # +prepare 003 statements; +metrics table access
  sqlite-adapter.ts      # unchanged
  Migrate.ts             # +load 003_v02_signal.sql (idempotent)
  MemoryService.ts       # +fingerprint; +dedup on save; +project_id; +hybrid rank (BM25 + boosts + recency)
  ToolCallObserver.ts    # +<private> redaction; +tool_calls dedup (flag)
  Reflector.ts           # +per-key throttle Map; +fingerprint; +lesson v2 rule table; +origin='reflector'
  ContextInjector.ts     # +ids line; +<protect> wrapper; +conditional budget; +origin-aware ranking
  Retrospective.ts       # +false-positive recap; +[reflector]/[agent] labels; +metrics flush
  redact.ts              # +stripPrivate (sweep <private>…</private> blocks)
  memory-format.ts       # +protect wrapper; +id line per block
  uuid.ts                # unchanged
  fingerprint.ts        # NEW — FNV-1a 64-bit in-house hash (no node:crypto)
  metrics.ts             # NEW — in-memory Map + flush to kevin_metrics
  PatternMiner.ts        # NEW — opt-in; reads tool_calls; emits 'pattern' memories (origin='pattern')
migrations/
  001_initial.sql        # unchanged
  002_v01_*.sql          # unchanged (if any)
  003_v02_signal.sql     # NEW — additive, idempotent
```

No module is removed; no hook is removed; no tool is removed. The 6 hooks and 5+1 tools from Part A are all preserved (the 6th tool `kevin_get` is added).

### Hook surface (unchanged from Part A)

- `tool.execute.before` — unchanged.
- `tool.execute.after` — unchanged signature; Reflector now reads `fingerprint` to throttle per-key.
- `experimental.chat.system.transform` — ContextInjector now wraps each block in `<protect>` and prepends an `id` line.
- `experimental.session.compacting` — same change as above for the compacting payload.
- `session.created` — unchanged.
- `session.idle` — unchanged; Retrospective now flushes metrics.

### Tool surface

| Tool | Change |
|---|---|
| `kevin_save` | Adds `project_id` (auto-detected from CWD if absent) and sets `origin = 'agent'`. Dedup applies. |
| `kevin_query` | Returns slim `{ id, type, scope, score, snippet }` by default. Optional `{ full: true }` restores the v0.1.x payload. |
| `kevin_recall` | Unchanged signature; semantics identical (greedy fill by token budget); now applies origin-aware ranking. |
| `kevin_status` | Adds `memories_reflector`, `memories_agent`, `memories_pattern`, and a top-level `metrics` object with the seeded counters from `kevin_metrics`. |
| `kevin_retrospective` | Adds a "false-positive recap" section and tags each memory row with `[reflector]` / `[agent]` / `[pattern]`. |
| `kevin_get` (NEW) | `kevin_get({ id })` → returns a single full memory row by `id`. 404 if not found or scope mismatch. |

---

## §B5. Schema delta — `migrations/003_v02_signal.sql`

Idempotent, additive, all new columns nullable, partial UNIQUE index, no DROP. Runs inside the existing `Migrate.ts` executor that already wraps each statement in a `try/catch` and tolerates `ALTER TABLE ... ADD COLUMN` if column exists.

```sql
-- v0.2.0 Signal Quality — additive only, backward-compatible.

-- 1. New columns on memories (nullable, backfilled at runtime).
ALTER TABLE memories ADD COLUMN project_id  TEXT;
ALTER TABLE memories ADD COLUMN fingerprint TEXT;
ALTER TABLE memories ADD COLUMN origin       TEXT NOT NULL DEFAULT 'agent';

-- 2. New columns on tool_calls (nullable, backfilled at runtime).
ALTER TABLE tool_calls ADD COLUMN project_id  TEXT;
ALTER TABLE tool_calls ADD COLUMN fingerprint TEXT;

-- 3. Partial UNIQUE: one reflector-sourced error memory per (project_id, fingerprint).
--    NULL fingerprint is excluded (no dedup for non-error memories).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memories_error_fp
  ON memories (project_id, fingerprint)
  WHERE type = 'error' AND fingerprint IS NOT NULL AND origin = 'reflector';

-- 4. Metrics table (key/value/counters), seeded with zero defaults.
CREATE TABLE IF NOT EXISTS kevin_metrics (
  key       TEXT PRIMARY KEY,
  value     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('tokens_injected_pre_prompt', 0),
  ('tokens_injected_compacting', 0),
  ('reflections_throttled',       0),
  ('duplicate_suppressions',      0),
  ('tool_calls_deduped',           0),
  ('patterns_mined',               0);

-- 5. PatternMiner opt-in flag lives in a settings table we also add (idempotent).
CREATE TABLE IF NOT EXISTS kevin_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('patternminer_enabled', '0'),
  ('tool_calls_dedup_enabled', '0');
```

**Runtime backfill (in `Migrate.ts` after the DDL):**

```ts
// Backfill project_id for legacy rows using the DEFAULT_PROJECT constant.
// Backfill origin for legacy rows that came from kevin_save → 'agent'.
db.prepare(
  `UPDATE memories SET origin = 'agent' WHERE origin IS NULL OR origin = ''`,
).run();
```

`fingerprint` is left NULL for legacy rows; they continue to participate in FTS and ranking, but dedup only begins to apply to rows written after v0.2.0. The partial UNIQUE index excludes NULL fingerprints, so legacy rows do not collide.

---

## §B6. Component specifications (deltas)

### §B6.1 `fingerprint.ts` (NEW)

- Exports `fingerprint(content: string, project_id?: string): string` — an **FNV-1a 64-bit** in-house hash, hex string.
- Keeps the implementer off `node:crypto` (no surprising loader semantics in plugin context) and off any external dep.
- Normalizes input: lowercases, strips ANSI sequences, collapses whitespace, removes line numbers and paths before hashing (so `src/foo.ts:42` and `src/bar.ts:7` hash the same when the error text is otherwise identical).
- When `project_id` is provided, the hash includes it as a salt prefix — guaranteeing the same error text in two different projects produces two different fingerprints (D-f above).

### §B6.2 `metrics.ts` (NEW)

- In-memory `Map<string, number>` mirror of `kevin_metrics`.
- `incr(key: MetricsKey, by = 1): void` — updates the map and lazily flushes to the DB on a 1-second debounce and on `session.idle`.
- `snapshot(): Record<string, number>` — returns the current counts (used by `kevin_status`).
- Seeded keys: `tokens_injected_pre_prompt`, `tokens_injected_compacting`, `reflections_throttled`, `duplicate_suppressions`, `tool_calls_deduped`, `patterns_mined`.
- The `token_*` counters are estimates (cheap heuristic based on block length / 4).

### §B6.3 `MemoryService.ts`

- `save(input)` now requires (or auto-derives) `project_id` and `origin`, computes `fingerprint` for `type = 'error'`, and on a UNIQUE violation (caught by SQLite `SQLITE_CONSTRAINT_UNIQUE`) returns the existing row's `id` instead of inserting — a no-op save that still increments `duplicate_suppressions`.
- `query()` returns the slim payload; `recall()` keeps the v0.1 greedy fill but applies an **origin-aware rank**: exact FTS `BM25` rank + boost (`× 2` for `origin = 'reflector'`, `× 1.5` for `origin = 'pattern'`, `× 1` for `origin = 'agent'`) + recency decay (`× 0.95^(age_days)`). No embeddings, no RRF.
- New accessor `getById(id): Memory | null` for `kevin_get`.

### §B6.4 `Reflector.ts`

- Replaces the single `lastReflectionTs: number` with `lastReflectionByFp: Map<string, number>` keyed by `fingerprint` (D-a above). Throttle window unchanged at 60 s.
- On a failure event, computes `fingerprint(stdout)`, looks up the throttle map; if still hot → `incr('reflections_throttled')` and return.
- On a successful reflection, sets `origin = 'reflector'`, passes `fingerprint` to `MemoryService.save`.
- **Lesson v2 dispatch**: a new `RULES` table maps error codes to suggestion templates. Parsing order: (1) `TS\d{4,5}` (TypeScript), (2) `(ELIF|F\d{3,4})|flake8: \S+` (Python lint), (3) `Error: \w+` and `Command ".+" failed`, (4) syscall codes `EADDRINUSE|ENOENT|EACCES|EPERM`. Each rule yields a short suggestion string ("import or typo", "missing or wrong property", etc.) used as a deterministic lesion in the emitted memory's `content`. Missing codes fall back to the v0.1 unknown template.
- `MAX_CONTENT_CHARS = 4096` is preserved; `SUGGESTIONS` is retired in favor of `RULES`.

### §B6.5 `ContextInjector.ts`

- For every memory block emitted, prepend an `id:` line (e.g. `id: mem_01H8…\n`) so the agent can address it via `kevin_get`.
- Wrap each block in `<protect>` / `</protect>` markers (D-04) so DCP compression does not collapse injected lessons.
- **Conditional budget**: if the recalled memories aggregate already covers more than 80% of `SYSTEM_TRANSFORM_TOKENS = 1500` and none of the blocks are `<protect>`-tagged above the fold, lower the budget to `0.8 * 1500` to leave room for the agent's own reasoning. No change otherwise. Compact payload gets the same treatment against `COMPACTING_TOKENS = 2000`.
- **Origin-aware ranking**: apply the same multiplier as `MemoryService.recall` so reflector lessons outrank agent-saved notes at injection time.

### §B6.6 `ToolCallObserver.ts`

- Sweep observed `tool.execute.before` input and `tool.execute.after` stdout/stderr for `<private>…</private>` segments and `stripPrivate()` them before persisting to `tool_calls` (D-05 / K2-05). The redacted blocks are replaced with `<private: redacted N chars>`.
- tool_calls dedup (off by default, flag in `kevin_settings.tool_calls_dedup_enabled`): when ON, skip persisting a `tool_call` row whose `(project_id, fingerprint, minute_bucket)` tuple already exists. Increment `tool_calls_deduped` counter.

### §B6.7 `redact.ts`

- Adds `stripPrivate(text: string): string` — replaces `<private>…</private>` blocks (case-insensitive, multiline) with `<private: redacted N chars>`. Existing redaction of secrets/keys is preserved.

### §B6.8 `memory-format.ts`

- `formatMemories(rows)` now emits, per row: an `id:` line, the `<protect>` opening tag, the existing body, and `</protect>`. The wrapper is conditional on a per-row `protect = true` default; `kevin_recall` callers can opt out (used internally by `kevin_status` to avoid spamming the protect wrapper in human-readable status dumps).

### §B6.9 `Retrospective.ts`

- Adds a "False-positive recap" section listing reflector-sourced memories that were injected but whose fingerprint recurred in a later tool_call within the same project (a positive-of-positive signal). Each recap row shows `[reflector] <id> <snippet>`.
- Tags every memory row in the session summary with `[reflector]` / `[agent]` / `[pattern]` based on `origin`.
- Calls `metrics.snapshot()` and includes the 6 seeded counters in the markdown.

### §B6.10 `PatternMiner.ts` (NEW, opt-in)

- Reads `tool_calls` rows for the current `project_id`, groups by ordered 2-grams of `(tool_name)` and 3-grams where the second tool was a failure, and when a group reaches `N ≥ 5` distinct sessions emits a `type = 'pattern'`, `origin = 'pattern'` memory with a deterministic suggestion.
- Disabled unless `kevin_settings.patternminer_enabled = '1'`. Default off (D-c).
- Increment `patterns_mined` per emission. Idempotency: once emitted, the pattern's fingerprint is also persisted with `origin = 'pattern'`; the partial UNIQUE index does not apply (`origin != 'reflector'`), so pattern memories are dedup'd by a separate `INSERT OR IGNORE` keyed on `(project_id, fingerprint, type)`.

---

## §B7. Decisions (D2-01..D2-14)

| ID | Decision |
|---|---|
| D2-01 | Release name **"Signal Quality"** (adopt Grok 4.5). Theme over a feature list. |
| D2-02 | **DCP-first**: we read `experimental.session.compacting` and re-inject on DCP's schedule; we do not implement our own session compression. |
| D2-03 | **Reject claude-mem cloning** (Worker/Chroma/IA/multi-IDE). Keep 1 plugin, SQLite-only. |
| D2-04 | **Reject OKF core** for v0.2. Borrow only progressive disclosure (`kevin_get` + slim `kevin_query`). Defer OKF import/export to v0.3. |
| D2-05 | **DB backward compat is HARD**: migration 003 is idempotent, all new columns nullable, runtime backfill only. No destructive ALTER. No rebuild. |
| D2-06 | `origin` column on `memories` ∈ `'reflector' \| 'agent' \| 'pattern' \| 'retrospective'`. Used for anti-gaming (K-045 continuity) and origin-aware ranking. |
| D2-07 | Dedup UNIQUE partial index only fires on `type='error' AND fingerprint IS NOT NULL AND origin='reflector'`. Agent and pattern memories are not dedup'd this way (they have separate idempotency rules). |
| D2-08 | PatternMiner **opt-in**, threshold `N ≥ 5` sessions. Default off. |
| D2-09 | Lesson v2 is a **per-error-code deterministic rule table**, no LLM. Codes: `TS2304|TS2322|TS2740|TS2552|TS18047` (TS), `ELIF|F\d{3,4}|flake8` (Python), syscall `EADDRINUSE|ENOENT|EACCES|EPERM`, generic `Error:`, `Command failed`. |
| D2-10 | Feedback loop **positive half only** in v0.2 (inject → no recurrence within project → `relevance_score += ε`, `ε = 0.05`, cap 1.0). Negative half → v0.3. |
| D2-11 | `project_id` is a **first-class column** on `memories` and `tool_calls`, participates in the dedup partial UNIQUE index, and is auto-derived (hashed absolute CWD) when not provided. |
| D2-12 | `kevin_query` returns slim `{ id, type, scope, score, snippet }`; `kevin_get({ id })` fetches full content. This is the progressive disclosure "borrowed from OKF". |
| D2-13 | Hybrid ranking in v0.2 is **BM25 + field boosts + recency decay** — **no embeddings, no RRF**. RRF is meaningless with one leg. Revisit at v0.3 when embeddings land. |
| D2-14 | **FNV-1a 64-bit** in-house for `fingerprint` (no `node:crypto`). Deterministic, fast, zero-dep, easy to port to other plugin hosts. |

---

## §B8. Validation strategy

1. **Unit tests** (vitest, `tests/unit/`):
   - `fingerprint.test.ts` — stable across order-preserving and whitespace-only rewrites, salted by `project_id`.
   - `metrics.test.ts` — incr, debounce, snapshot, reseed.
   - `lessonv2.test.ts` — Reflector dispatches each of the 5 TS codes, Python lint codes, syscall codes, generic `Error:` / `Command failed`, and the unknown fallback correctly.
   - `dedup.test.ts` — second save of identical `(project_id, fingerprint, type='error', origin='reflector')` is a no-op that returns the existing `id` and bumps `duplicate_suppressions`.
   - `reflector.per-key-throttle.test.ts` — two different fingerprints within the same minute both reflect; the same fingerprint twice in a minute throttles the second.
   - `contextinjector.test.ts` — every emitted block has an `id:` line and a `<protect>` wrapper; conditional budget halves when aggregate tokens > 80% of the cap.
   - `stripPrivate.test.ts` — `<private>…</private>` blocks of arbitrary length collapse to `<private: redacted N chars>`.
   - `query.test.ts` — slim payload shape; `full: true` restores v0.1.x body.
   - `kevin_get.test.ts` — returns full row by id; 404 on missing/out-of-scope.
   - `retrospective.test.ts` — recap lists reflector-sourced lessons whose fingerprints recurred; labels `[reflector]`/`[agent]`/`[pattern]`.
   - `migrate_003.test.ts` — running migration 003 twice is a no-op; legacy rows keep working after backfill.
   - `patternminer.test.ts` — at `N < 5` no emission; at `N ≥ 5` (different sessions) emits exactly one pattern memory; second run does not duplicate.
2. **Integration tests** (`tests/integration/`): end-to-end Reflector → MemoryService → ContextInjector → system.transform chain on a mocked plugin host; assert `id` lines, `<protect>` wrappers, dedup, and metrics counters move.
3. **E2E test** (`tests/e2e/`): **validation protocol K2-032** — in a fresh clone, run `npm run typecheck` (deliberately broken TS to trigger `TS2304`), assert the agent does **NOT** call `kevin_save`, assert `kevin_status` reports `memories_reflector ≥ 1` and `metrics` shows `duplicate_suppressions` and `tokens_injected_pre_prompt > 0` after a session tick, and assert a follow-up session injects the lesson. Anti-gaming: ensure `origin = 'reflector'`, not `'agent'`.
4. **Backward compat**: open a v0.1.5 DB, run migration 003 in place, assert all legacy rows are queryable via `kevin_query` and recall'd by `kevin_recall` without degradation.

---

## §B9. Dependencies

No new production dependencies. `better-sqlite3` and the existing plugin SDK are sufficient. Dev deps already include `vitest`, `biome`, `typescript`.

---

## §B10. Compatibility & migration

- **Node**: same range as v0.1.x (per `package.json#engines`).
- **SQLite**: at least 3.38 (for `datetime('now')` default + partial UNIQUE index semantics). `better-sqlite3` already ships a compatible prebuilt.
- **DB file**: location unchanged (`~/.opencode-kevin/kevin.db`, global — this is a v0.1.x reality that diverges from the §architecture note in Part A; we grand-father it).
- **Migration order**: 001 → (002 if present) → 003 via `Migrate.ts`'s existing executor with idempotency guards.
- **Rollback**: drop the migration row `003_v02_signal` (new `schema_migrations` entry — to be added by `Migrate.ts` if not present, additive) and delete the new tables/index/columns. Old code remains runnable against the legacy schema because all new columns are nullable. This is the inverse of D2-05's "no destructive ALTER": rollback *does* destruct, but only on the new artifacts.

---

## §B11. Release checklist

- [ ] Bump `package.json` to `0.2.0`.
- [ ] Update `CHANGELOG.md` with the "Signal Quality" entry.
- [ ] Update `README.md`: extend storage section, document `kevin_get`, document the slim `kevin_query` payload, document the metrics object in `kevin_status`.
- [ ] Tag `v0.2.0`.
- [ ] `npm run verify` green; `npm run typecheck` green; `npm run lint` green; `npm test` green.
- [ ] Manual K2-032 walkthrough recorded.

---

## §B12. Amendment to the Part A roadmap (§14)

The roadmap table referenced in §14 lists v0.2 as "Embeddings + hybrid retrieval + Pattern mining". This Part B **amends** that row:

| Version | Item | Amended scope |
|---|---|---|
| v0.2 → **now** | Pattern mining + hybrid ranking **without** embeddings + dedup + ids + `<protect>`/`<private>` + metrics + lesson v2 + progressive disclosure | Signal Quality |
| v0.3 → **was v0.2 embeddings** | Embeddings + sqlite-vec + BGE-M3 ONNX + RRF; LLM reflection loop; OKF export/import; cross-project memory (consent); negative half of feedback loop | |
| v0.4 | Prompt mutation HITL + skill quality deep work + enriched LLM reflection | (unchanged) |
| v0.5 | Ecosystem deep integration | (unchanged) |

The v0.1.x roadmap row for v0.2 is left untouched in Part A — this Part B clarifies that the embeddings half of that original v0.2 row has been **deferred to v0.3** to make v0.2 the human-digestible "Signal Quality" release.

---

## §B13. Author

Analysis, deltas, schema, and decisions in this Part B: **GLM-5.2** (2026-07-18). Built on top of `docs/Kevin_new_v0.2.0.md` by Grok 4.5. The complete task list (`K2-001`..`K2-032`) lives in the matching Part B of `docs/Kevin_Task.md`.

**Next documents**: `docs/Kevin_Task.md` — Part B (K2-001..K2-032). `docs/Kevin_new_v0.2.0.md` remains the source analysis doc.

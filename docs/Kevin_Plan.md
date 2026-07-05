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

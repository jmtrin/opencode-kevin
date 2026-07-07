# Opencode-kevin — Task List v0.1.0

**Version:** 0.1.0
**Date:** 2026-06-30
**Status:** Frozen (Phase 1 started — 2026-07-01)
**Dependency:** `docs/Kevin_Plan.md`
**ID Convention:** `K-XXX` (Kevin 0.1.0); `K-04X` (Fix v0.1.4, continúa la numeración)
**Total tasks:** 45 (v0.1.0) + 5 (Fix v0.1.4) = 50
**Fix v0.1.4:** `docs/Kevin_Fix_v0.1.4.md` — detección de fallos auto-suficiente (K-046…K-050)

---

## Summary

| Phase | Tasks | Priority | Weeks |
|---|---|---|---|
| F1 — Foundation | K-001 to K-007 | P0 | 1 |
| F2 — Memory | K-008 to K-014 | P0 | 2 |
| F3 — Observation | K-015 to K-020 | P0 | 3 |
| F4 — Reflection | K-021 to K-028 | P0 | 4 |
| F5 — Injection + Retrospective | K-029 to K-036 | P0 | 5 |
| F6 — Plugin + Release | K-037 to K-045 | P0 | 6 |

---

## Conventions

- **Estimation:** S (≤4h), M (4-16h), L (16-40h).
- **Dependencies:** Task IDs that must be completed first.
- **Risk:** 🟢 low · 🟡 medium · 🔴 high.
- **Verification:** command or action confirming the task is done correctly.
- **Status:** `[ ]` pending · `[~]` in progress · `[X]` completed

---

# Phase 1 — Foundation (week 1, P0)

### K-001 — Create project structure and package.json

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `package.json`, `tsconfig.json`, `opencode.json`, `AGENTS.md`, `.gitignore`
- **Description:** Initialize Node 20+ project with TypeScript strict. `package.json` with `name: "kevin"`, `version: "0.1.0"`, `type: "module"`, scripts `build/test/typecheck/lint/format/verify`, deps `@opencode-ai/plugin`, `better-sqlite3`, `zod`, devDeps `@biomejs/biome`, `@types/better-sqlite3`, `@types/node`, `tsx`, `typescript`, `vitest`. `tsconfig.json` with `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `types: ["node"]`. `opencode.json` with `"plugin": ["./plugin/index.ts"]`. `AGENTS.md` with commands and architecture. `.gitignore` with `.kevin/`, `node_modules/`, `dist/`.
- **Acceptance criteria:**
  - `npm install` works without errors.
  - `npm run typecheck` passes (no code yet, only config).
  - Directory structure created: `plugin/`, `migrations/`, `scripts/`, `tests/unit/`, `tests/integration/`, `tests/e2e/`, `docs/`.
- **Verification:** `Test-Path package.json` and `npm install` exit 0.

### K-002 — Implement `uuid.ts` (UUID v7)

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-001
- **Risk:** 🟢
- **Files:** `plugin/uuid.ts`
- **Description:** Implement UUID v7 generator (timestamp + random). Format: `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`. First 48 bits are Unix timestamp in ms, next 12 bits include version (7), rest is random. Temporally sortable IDs.
- **Acceptance criteria:**
  - `uuidv7()` returns a 36-char string with `-` at positions 8, 13, 18, 23.
  - The character at position 14 is `7` (version).
  - Two consecutive calls: the second UUID is greater than the first (temporal order).
  - Unit tests pass.
- **Verification:** `npx vitest run tests/unit/uuid.test.ts`

### K-003 — Implement `Store.ts` (SQLite connection)

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-002
- **Risk:** 🟡
- **Files:** `plugin/Store.ts`
- **Description:** `Store` class that opens a better-sqlite3 connection. Constructor receives `{ path: string }`. Configures `journal_mode = WAL` and `foreign_keys = ON`. Exposes `prepare(sql)`, `transaction(fn)`, `close()`, `get raw()`.
- **Acceptance criteria:**
  - `new Store({ path: ':memory:' })` works without error.
  - `store.prepare('SELECT 1 as v').get()` returns `{ v: 1 }`.
  - `store.transaction(() => { ... })` executes in a transaction.
  - `store.close()` closes without error.
  - WAL mode enabled (verify with `PRAGMA journal_mode`).
  - Unit tests pass.
- **Verification:** `npx vitest run tests/unit/store.test.ts`

### K-004 — Implement `Migrate.ts` (migration runner)

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-003
- **Risk:** 🟡
- **Files:** `plugin/Migrate.ts`
- **Description:** `Migrate` class that receives `Store` and `migrationsDir`. Method `run()` reads `schema_version` table, lists `.sql` files in `migrationsDir` sorted alphabetically, applies pending ones in a transaction, inserts version in `schema_version`. Creates `schema_version` if it doesn't exist. Idempotent.
- **Acceptance criteria:**
  - `Migrate.run()` creates `schema_version` if it doesn't exist.
  - Applies pending migrations in order.
  - If all applied, returns `{ from: '001', to: '001', applied: [] }`.
  - If a migration fails, full rollback (transaction).
  - Unit tests with mock directory.
- **Verification:** `npx vitest run tests/unit/migrate.test.ts`

### K-005 — Create `migrations/001_initial.sql`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-004
- **Risk:** 🟢
- **Files:** `migrations/001_initial.sql`
- **Description:** Create initial migration with full schema (see `Kevin_Plan.md` §4): `schema_version`, `memories` (4 types, 2 scopes, relevance_score, expires_at, source_tool, source_session, metadata), `memories_fts` (FTS5 with `unicode61 remove_diacritics 1`, content='memories'), 3 FTS5 triggers (insert/delete/update), `tool_calls` (session_id, tool, args_summary, success, duration_ms, agent, error_type, metadata), `retrospectives` (session_id, failure_count, success_count, lessons_count, file_path). Indexes on type, scope, relevance, created, session_id, tool, ts, success. Seed `INSERT OR IGNORE INTO schema_version VALUES ('001')`.
- **Acceptance criteria:**
  - `Migrate.run()` applies 001 without error.
  - Tables `memories`, `memories_fts`, `tool_calls`, `retrospectives`, `schema_version` exist.
  - FTS5 functional: `INSERT INTO memories` → `SELECT * FROM memories_fts` returns row.
  - Triggers work: delete on memories → row removed from FTS5.
  - `tokenize='unicode61 remove_diacritics 1'` verified with `SELECT * FROM memories_fts WHERE memories_fts MATCH 'autenticacion'` (finds "autenticación").
- **Verification:** `npx vitest run tests/unit/migrate.test.ts`

### K-006 — Integrated unit tests for Store + Migrate

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-005
- **Risk:** 🟢
- **Files:** `tests/unit/store.test.ts`, `tests/unit/migrate.test.ts`
- **Description:** Comprehensive tests: Store opens/closes, prepared statements, transactions (commit + rollback), WAL mode. Migrate creates schema_version, applies 001, idempotent, rollback on failure.
- **Acceptance criteria:**
  - ≥90% coverage of Store.ts and Migrate.ts.
  - Tests pass with `:memory:` SQLite.
- **Verification:** `npx vitest run tests/unit/store.test.ts tests/unit/migrate.test.ts`

### K-007 — Phase 1 checkpoint commit

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-001 to K-006
- **Risk:** 🟢
- **Description:** Commit with all F1 changes. Tag `kevin-f1-done`.
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `git tag kevin-f1-done`.
- **Verification:** `git tag --list kevin-f1-done`.

---

# Phase 2 — Memory (week 2, P0)

### K-008 — Implement `MemoryService.ts` (base CRUD)

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K-007
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts`
- **Description:** `MemoryService` class with `Store`. Methods: `save(input)`: inserts into `memories`, returns id. `getById(id)`: SELECT by PK. `update(id, fields)`: dynamic UPDATE. `delete(id)`: DELETE. Input with Zod schema: `type` enum 4 values, `content` string, `scope` enum `project|session` default `project`, `relevanceScore` number default 0.5, `sourceTool` string optional, `sourceSession` string optional, `metadata` record optional, `expiresAt` string optional. Uses `uuidv7()` to generate IDs.
- **Acceptance criteria:**
  - `save({ type: 'error', content: 'test' })` persists and returns UUID v7.
  - `getById(id)` returns the memory with camelCase fields (`createdAt`, not `created_at`).
  - `update(id, { content: 'updated' })` updates `updated_at`.
  - `delete(id)` removes from `memories` and `memories_fts` (via trigger).
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/memory-service.test.ts`

### K-009 — Implement FTS5 search in `MemoryService`

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-008
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts`
- **Description:** Method `query(input)`: searches `memories_fts` with `MATCH ?`, join with `memories`, ordered by `bm25(memories_fts)` score, filtered by `type` and `scope` (if not 'all'), filters `expires_at`. Returns array of `Memory` with `score` in metadata. Default limit 10.
- **Acceptance criteria:**
  - `query({ text: 'auth' })` returns memories containing 'auth' in content.
  - `query({ text: 'autenticacion' })` finds memories with 'autenticación' (remove_diacritics).
  - `query({ text: 'test', type: 'error' })` filters by type.
  - `query({ text: 'test', scope: 'project' })` filters by scope.
  - `query({ text: 'test', scope: 'all' })` doesn't filter by scope.
  - Results ordered by bm25 score (most relevant first).
  - Memories with past `expires_at` don't appear.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/memory-service.test.ts`

### K-010 — Implement `scope: 'session'` with expiration

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-009
- **Risk:** 🟢
- **Files:** `plugin/MemoryService.ts`
- **Description:** `save` with `scope: 'session'` sets `expires_at` to 24h from now by default (configurable). `query` and `getRelevant` filter `expires_at IS NULL OR expires_at > datetime('now')`.
- **Acceptance criteria:**
  - `save({ type: 'context', content: 'tmp', scope: 'session' })` sets `expires_at`.
  - `save({ type: 'context', content: 'perm', scope: 'project' })` doesn't set `expires_at`.
  - Query doesn't return expired session memories.
  - Unit tests with date mock.
- **Verification:** `npx vitest run tests/unit/memory-service.test.ts`

### K-011 — Implement `getRelevant` with token budget

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-010
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts`
- **Description:** Method `getRelevant(input)`: if `query` present, does FTS5 to narrow candidates. If not, loads all (scope project). Sorts by `relevance_score` DESC + `created_at` DESC. Greedy fill respecting `maxTokens * 4` chars (approx 1 token = 4 chars). Default `maxTokens: 2000`. Filters expired.
- **Acceptance criteria:**
  - `getRelevant({ query: 'auth', maxTokens: 500 })` returns relevant memories without exceeding ~2000 chars total.
  - If no query, returns top memories by relevance_score.
  - Prioritizes `type: 'error'` and `type: 'pattern'` over `decision` and `context` (secondary sort).
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/memory-service.test.ts`

### K-012 — MemoryService + Store integration tests

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-011
- **Risk:** 🟢
- **Files:** `tests/integration/memory-integration.test.ts`
- **Description:** Test using real Store (`:memory:`) + Migrate + MemoryService. Flow: migrate → save 3 memories → query → update → delete → verify FTS5 synchronized.
- **Acceptance criteria:**
  - Full save/query/update/delete flow works.
  - FTS5 synchronized after each operation (triggers).
  - `npm test` passes.
- **Verification:** `npx vitest run tests/integration/memory-integration.test.ts`

### K-013 — E2E test: memory flow (save → query → recall)

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-012
- **Risk:** 🟢
- **Files:** `tests/e2e/memory-flow.test.ts`
- **Description:** E2E test of memory flow: (a) save type:error memory "typecheck no-unused-vars", (b) save type:decision memory "we use vitest", (c) query "typecheck" returns first, (d) query "vitest" returns second, (e) recall without query returns both within budget.
- **Acceptance criteria:**
  - Query by keyword returns correct memory.
  - Recall respects token budget.
  - FTS5 with diacritics: save "autenticación" → query "autenticacion" finds it.
- **Verification:** `npx vitest run tests/e2e/memory-flow.test.ts`

### K-014 — Phase 2 checkpoint commit

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-008 to K-013
- **Risk:** 🟢
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `git tag kevin-f2-done`.
- **Verification:** `git tag --list kevin-f2-done`.

---

# Phase 3 — Observation (week 3, P0)

### K-015 — Implement `ToolCallObserver.ts` (recording)

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K-014
- **Risk:** 🟡
- **Files:** `plugin/ToolCallObserver.ts`
- **Description:** `ToolCallObserver` class with `Store`. `onBefore(input, output)`: records initial timestamp in internal Map (session+tool → startTs). `onAfter(input, output)`: calculates duration_ms, inserts into `tool_calls` table with: id (uuidv7), session_id, tool, args_summary (redacted), success (output.success === true ? 1 : 0), duration_ms, agent (input.agent ?? null), error_type (inferred), metadata (JSON string with complete redacted args). Maintains timestamp state per session.
- **Acceptance criteria:**
  - After `onAfter`, row exists in `tool_calls`.
  - `duration_ms` is > 0 if there was delay between before and after.
  - `success` is 1 if output.success is true, 0 if false.
  - Unit tests with mock input/output.
- **Verification:** `npx vitest run tests/unit/tool-call-observer.test.ts`

### K-016 — Implement secret redaction in `ToolCallObserver`

- **Priority:** P0
- **Estimation:** M (3h)
- **Dependencies:** K-015
- **Risk:** 🟡
- **Files:** `plugin/ToolCallObserver.ts`
- **Description:** Method `redactSecrets(text)` replaces patterns with `<redacted>`. Patterns: `API_KEY=...`, `SECRET=...`, `PASSWORD=...`, `TOKEN=...`, `Bearer ...`, `token ...` (case-insensitive). Method `summarizeArgs(args)` extracts paths (filePath, path, cwd) and commands (command, cmd) without secrets. Rest truncated to 200 chars.
- **Acceptance criteria:**
  - `redactSecrets("API_KEY=abc123")` → `"API_KEY=<redacted>"`.
  - `redactSecrets("Bearer xyz")` → `"Bearer <redacted>"`.
  - `summarizeArgs({ filePath: "/foo/bar.ts", command: "npm test" })` → `"filePath: /foo/bar.ts, command: npm test"`.
  - `summarizeArgs({ apiKey: "secret" })` → `"apiKey: <redacted>"`.
  - `tool_calls.args_summary` contains no secrets.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/tool-call-observer.test.ts -t "redact"`

### K-017 — Implement `error_type` inference in `ToolCallObserver`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-016
- **Risk:** 🟢
- **Files:** `plugin/ToolCallObserver.ts`
- **Description:** Method `inferErrorType(stderr, stdout)`: returns string categorizing the error. Rules (case-insensitive, first match wins): stderr contains "error TS" or "tsc" → `typecheck`. stderr contains "lint" or "biome" or "eslint" → `lint`. stderr contains "FAIL" or "vitest" or "jest" or "test failed" → `test`. stderr contains "Error:" or "TypeError" or "ReferenceError" → `runtime`. exitCode -1 and empty stderr → `timeout`. Default → `unknown`.
- **Acceptance criteria:**
  - `inferErrorType("error TS2304: Cannot find name", "")` → `"typecheck"`.
  - `inferErrorType("FAIL src/test.ts", "")` → `"test"`.
  - `inferErrorType("TypeError: x is undefined", "")` → `"runtime"`.
  - `inferErrorType("", "")` with exitCode -1 → `"timeout"`.
  - `inferErrorType("random output", "")` → `"unknown"`.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/tool-call-observer.test.ts -t "error_type"`

### K-018 — Expose public methods of `ToolCallObserver` for the plugin

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K-017
- **Risk:** 🟢
- **Files:** `plugin/ToolCallObserver.ts`
- **Description:** Expose `summarizeArgs(args)` and `inferErrorType(stderr, stdout)` as public methods (so the plugin can use them when invoking Reflector). Ensure they are deterministic and have no side effects.
- **Acceptance criteria:**
  - Methods are public and typed.
  - `npm run typecheck` passes.
- **Verification:** `npm run typecheck`

### K-019 — Integration tests for ToolCallObserver with mocked hooks

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-018
- **Risk:** 🟢
- **Files:** `tests/integration/tool-call-observer.test.ts`
- **Description:** Test simulating sequence: `onBefore` → 10ms delay → `onAfter` with success=true, verify row in `tool_calls` with duration_ms > 0. Then `onAfter` with success=false and typecheck stderr, verify `error_type = 'typecheck'`. Verify secret redaction.
- **Acceptance criteria:**
  - Rows in `tool_calls` with correct data.
  - `duration_ms > 0`.
  - Correct `error_type`.
  - No secrets in `args_summary`.
- **Verification:** `npx vitest run tests/integration/tool-call-observer.test.ts`

### K-020 — Phase 3 checkpoint commit

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-015 to K-019
- **Risk:** 🟢
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `git tag kevin-f3-done`.
- **Verification:** `git tag --list kevin-f3-done`.

---

# Phase 4 — Reflection (week 4, P0)

### K-021 — Implement `Reflector.ts` (skeleton + heuristic)

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K-020
- **Risk:** 🟡
- **Files:** `plugin/Reflector.ts`
- **Description:** `Reflector` class with `MemoryService`. Method `invoke(input)`: async, returns `string | null` (memory_id). Flow: (1) redact paths and secrets from stderr/stdout, (2) extract first error line (first line containing "error" or "Error" or "FAIL"), (3) generate heuristic lesson with template, (4) if content > 4KB truncate and mark `metadata.not_searchable = true`, (5) persist as `type: 'error'` memory with `source_tool` and `source_session`, (6) return memory_id.
- **Acceptance criteria:**
  - `invoke(...)` with typecheck failure → returns memory_id (UUID v7).
  - Memory persisted with `type: 'error'`, `source_tool`, `source_session`.
  - Content contains the heuristic lesson.
  - `npm run typecheck` passes.
- **Verification:** `npx vitest run tests/unit/reflector.test.ts`

### K-022 — Implement heuristic lesson generation by error_type

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-021
- **Risk:** 🟡
- **Files:** `plugin/Reflector.ts`
- **Description:** Method `generateHeuristicLesson(input)`: generates string with template `"When {tool} fails with {errorType}: {firstErrorLine}\nSuggestion: {suggestion}"`. Suggestions per errorType: typecheck → "Verify types and imports before running.", lint → "Run linter and fix warnings before committing.", test → "Run tests and fix failures before proceeding.", runtime → "Check error message and stack trace for root cause.", timeout → "Check for infinite loops or long-running operations.", unknown → "Review the error output for details.". If firstErrorLine > 500 chars, truncate with "...".
- **Acceptance criteria:**
  - Lesson for typecheck contains "Verify types and imports".
  - Lesson for test contains "Run tests and fix failures".
  - Lesson for runtime contains "Check error message".
  - firstErrorLine truncated if > 500 chars.
  - Unit tests for each error_type.
- **Verification:** `npx vitest run tests/unit/reflector.test.ts -t "heuristic"`

### K-023 — Implement path and secret redaction in `Reflector`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-022
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`
- **Description:** Method `redactPaths(text)`: replaces absolute paths. Windows: `C:\Users\...` → `<path>`. Unix: `/home/...`, `/Users/...`, `/var/...` → `<path>`. Case-insensitive regex. Method `redactSecrets(text)`: same patterns as ToolCallObserver. Apply both to stderr/stdout before generating lesson.
- **Acceptance criteria:**
  - `redactPaths("Error at C:\\Users\\foo\\bar.ts:10")` → `"Error at <path>:10"`.
  - `redactPaths("Error at /home/foo/bar.ts:10")` → `"Error at <path>:10"`.
  - `error` memory contains no absolute paths or secrets.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/reflector.test.ts -t "redact"`

### K-024 — Implement throttle in `Reflector`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-023
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`
- **Description:** `Reflector` maintains internal `lastReflectionTs`. `invoke` checks `Date.now() - lastReflectionTs > 60_000` (1 min). If not enough time has passed, returns `null` (skip). Throttle is per Reflector instance (one per plugin). Configurable via constructor option `throttleMs`.
- **Acceptance criteria:**
  - First call to `invoke` → generates memory.
  - Second immediate call → returns `null` (throttled).
  - Third call after 61s → generates memory.
  - Unit tests with Date.now mock.
- **Verification:** `npx vitest run tests/unit/reflector.test.ts -t "throttle"`

### K-025 — Implement content truncation > 4KB

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K-024
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`
- **Description:** If content > 4096 chars, truncate to 4096 + "... [truncated]" and set `metadata: { not_searchable: true }`. Memories with `not_searchable: true` can be retrieved by ID but don't appear in FTS5 queries (filter in MemoryService.query with `metadata NOT LIKE '%not_searchable%'` or post-query check).
- **Acceptance criteria:**
  - Content > 4KB is truncated.
  - `metadata` contains `not_searchable: true`.
  - FTS5 query doesn't return `not_searchable` memories.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/reflector.test.ts -t "trunc"`

### K-026 — Reflector + MemoryService integration tests

- **Priority:** P0
- **Estimation:** M (3h)
- **Dependencies:** K-025
- **Risk:** 🟡
- **Files:** `tests/integration/reflector-integration.test.ts`
- **Description:** Test using real Store (`:memory:`) + MemoryService + Reflector. Flow: (a) invoke Reflector with typecheck failure, (b) verify memory persisted in `memories`, (c) `kevin_query("typecheck")` finds it, (d) verify content has no absolute paths.
- **Acceptance criteria:**
  - `type: error` memory persisted after invoke.
  - FTS5 query finds it by keyword.
  - Content redacted (no absolute paths).
  - `source_tool` and `source_session` set.
- **Verification:** `npx vitest run tests/integration/reflector-integration.test.ts`

### K-027 — E2E test: typecheck failure → error memory → recall returns it

- **Priority:** P0
- **Estimation:** M (3h)
- **Dependencies:** K-026
- **Risk:** 🟡
- **Files:** `tests/e2e/reflection-flow.test.ts`
- **Description:** E2E test: (a) simulate failed tool call with stderr "error TS2304: Cannot find name 'foo'", (b) invoke Reflector.invoke, (c) `memoryService.query({ text: 'typecheck' })` returns the memory, (d) `memoryService.getRelevant({ query: 'typecheck' })` includes it, (e) content contains "Verify types and imports".
- **Acceptance criteria:**
  - Memory generated and persisted.
  - Query finds it.
  - getRelevant includes it.
  - Content contains correct suggestion.
- **Verification:** `npx vitest run tests/e2e/reflection-flow.test.ts`

### K-028 — Phase 4 checkpoint commit

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-021 to K-027
- **Risk:** 🟢
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `git tag kevin-f4-done`.
- **Verification:** `git tag --list kevin-f4-done`.

---

# Phase 5 — Injection + Retrospective (week 5, P0)

### K-029 — Implement `ContextInjector.ts` (skeleton + deriveQuery)

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-028
- **Risk:** 🟡
- **Files:** `plugin/ContextInjector.ts`
- **Description:** `ContextInjector` class with `MemoryService`. Method `deriveQuery(messages)`: extracts keywords from last user message. Basic stop words (en/es: "the", "a", "el", "la", "de", "que", "for", "with", "how", "como"). Returns keyword string separated by spaces (for FTS5 MATCH).
- **Acceptance criteria:**
  - `deriveQuery([{ role: 'user', content: 'how do I handle authentication?' }])` → `"handle authentication"`.
  - `deriveQuery([{ role: 'user', content: 'implementa dark mode' }])` → `"implementa dark mode"`.
  - Stop words filtered.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/context-injector.test.ts`

### K-030 — Implement `ContextInjector.onSystemTransform` (pre-prompt)

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K-029
- **Risk:** 🟡
- **Files:** `plugin/ContextInjector.ts`
- **Description:** Method `onSystemTransform(input, output)`: (1) derives query from last user message, (2) `memoryService.getRelevant({ query, maxTokens: 1500 })`, (3) if there are memories, formats as `<kevin-context>Relevant Lessons:\n[type] content\n...</kevin-context>`, (4) adds to output (system prompt string or array). If no memories, adds nothing.
- **Acceptance criteria:**
  - With relevant memories: output includes `<kevin-context>`.
  - Without memories: output unchanged.
  - Budget of 1500 tokens (~6000 chars) respected.
  - Prioritizes type: error and type: pattern.
  - Unit tests with mock MemoryService.
- **Verification:** `npx vitest run tests/unit/context-injector.test.ts`

### K-031 — Implement `ContextInjector.onCompacting`

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-030
- **Risk:** 🟡
- **Files:** `plugin/ContextInjector.ts`
- **Description:** Method `onCompacting(input, output)`: (1) derives query from session context (recent messages), (2) `memoryService.getRelevant({ query, maxTokens: 2000 })`, (3) formats as `<kevin-memory>\n[type] content\n...</kevin-memory>`, (4) adds to `output.context` (array). If no memories, adds nothing.
- **Acceptance criteria:**
  - With memories: `output.context` includes `<kevin-memory>`.
  - Without memories: `output.context` unchanged.
  - Budget of 2000 tokens (~8000 chars) respected.
  - Unit tests.
- **Verification:** `npx vitest run tests/unit/context-injector.test.ts`

### K-032 — Implement `Retrospective.ts`

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-028
- **Risk:** 🟡
- **Files:** `plugin/Retrospective.ts`
- **Description:** `Retrospective` class with `Store` and `MemoryService`. Method `generate(sessionId)`: (1) count session tool_calls (success and failure), (2) if failure_count === 0, return `null`, (3) list tools that failed with error_type and args_summary, (4) list generated lessons (type:error memories with source_session = sessionId), (5) generate markdown, (6) save in `.kevin/retrospectives/{sessionId}.md`, (7) insert into `retrospectives` table, (8) return file_path.
- **Acceptance criteria:**
  - With failures: generates `.md` file and row in `retrospectives`.
  - Without failures: returns `null`, generates nothing.
  - Markdown contains: "# Retrospective", "## Summary", "## Tools that failed", "## Generated Lessons".
  - Unit tests with Store `:memory:`.
- **Verification:** `npx vitest run tests/unit/retrospective.test.ts`

### K-033 — ContextInjector integration tests with mocked hooks

- **Priority:** P0
- **Estimation:** M (3h)
- **Dependencies:** K-031
- **Risk:** 🟡
- **Files:** `tests/integration/injection.test.ts`
- **Description:** Test simulating: (a) save error memory "typecheck no-unused-vars", (b) simulate `onSystemTransform` with message "fix the typecheck error", (c) verify output includes `<kevin-context>` with the memory, (d) simulate `onCompacting`, (e) verify `output.context` includes `<kevin-memory>`.
- **Acceptance criteria:**
  - `onSystemTransform` injects relevant lesson.
  - `onCompacting` injects memories.
  - If no relevant memories, nothing is injected.
  - Token budget respected.
- **Verification:** `npx vitest run tests/integration/injection.test.ts`

### K-034 — E2E test: reflection → next session → context injection

- **Priority:** P0
- **Estimation:** L (6h)
- **Dependencies:** K-033, K-027
- **Risk:** 🟡
- **Files:** `tests/e2e/context-injection.test.ts`
- **Description:** E2E test of the complete cycle: (a) session 1: simulate typecheck failure → Reflector generates error memory, (b) session 2: simulate `onSystemTransform` with message "fix typecheck", (c) verify that session 1's lesson is injected into session 2's system prompt without the user asking for it.
- **Acceptance criteria:**
  - Error memory generated in session 1.
  - Session 2: system prompt includes `<kevin-context>` with the lesson.
  - The lesson appears before the agent acts (proactive).
- **Verification:** `npx vitest run tests/e2e/context-injection.test.ts`

### K-035 — E2E test: session with failures → retrospective.md

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-032
- **Risk:** 🟢
- **Files:** `tests/e2e/retrospective.test.ts`
- **Description:** E2E test: (a) register 5 tool calls (3 success, 2 failure), (b) invoke `Retrospective.generate(sessionId)`, (c) verify `.kevin/retrospectives/{sessionId}.md` file exists, (d) verify content has correct sections, (e) verify row in `retrospectives` table.
- **Acceptance criteria:**
  - Markdown file exists.
  - Contains "## Summary" with "5 (3 ok, 2 failed)".
  - Contains "## Tools that failed" with 2 entries.
  - Row in `retrospectives` with `file_path` set.
- **Verification:** `npx vitest run tests/e2e/retrospective.test.ts`

### K-036 — Phase 5 checkpoint commit

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-029 to K-035
- **Risk:** 🟢
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `git tag kevin-f5-done`.
- **Verification:** `git tag --list kevin-f5-done`.

---

# Phase 6 — Plugin + Release (week 6, P0)

### K-037 — Implement `plugin/index.ts` (entry point)

- **Priority:** P0
- **Estimation:** L (8h)
- **Dependencies:** K-036
- **Risk:** 🔴
- **Files:** `plugin/index.ts`
- **Description:** Implement `KevinPlugin` as `Plugin` from `@opencode-ai/plugin`. In constructor: (1) initialize Store with path `${ctx.directory}/.kevin/kevin.db`, (2) create `.kevin/` directory if it doesn't exist, (3) `Migrate.run()`, (4) initialize MemoryService, ToolCallObserver, Reflector, ContextInjector, Retrospective, (5) maintain `currentSessionId` and `lastReflectionTs` as state. Return object with `tool` (5 tools) and 6 hooks. See `Kevin_Plan.md` §6 for reference code.
- **Acceptance criteria:**
  - `npm run typecheck` passes.
  - Plugin exports `KevinPlugin` as `Plugin`.
  - Return structure matches OpenCode plugin API.
- **Verification:** `npm run typecheck`

### K-038 — Implement plugin tools (kevin_save, kevin_query, kevin_recall, kevin_status, kevin_retrospective)

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K-037
- **Risk:** 🟡
- **Files:** `plugin/index.ts`
- **Description:** Register 5 tools with `tool()` helper and Zod schemas. `kevin_save`: args type/content/scope, executes `memoryService.save`, returns id. `kevin_query`: args query/type/limit, executes `memoryService.query`, returns JSON. `kevin_recall`: args query/limit, executes `memoryService.getRelevant`, returns JSON. `kevin_status`: no args, counts memories/tool_calls/retrospectives, returns JSON. `kevin_retrospective`: args session_id optional, executes `retrospective.generate`, returns file_path or message.
- **Acceptance criteria:**
  - 5 tools registered with correct Zod schemas.
  - `kevin_save` with valid args persists memory.
  - `kevin_query` returns JSON results.
  - `kevin_status` returns counts.
  - `kevin_retrospective` returns file_path or "no failures".
  - Unit tests for each tool.
- **Verification:** `npx vitest run tests/unit/plugin-tools.test.ts`

### K-039 — Wire hooks in plugin (tool.execute, system.transform, compacting, session)

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K-038
- **Risk:** 🟡
- **Files:** `plugin/index.ts`
- **Description:** Wire 6 hooks: `tool.execute.before` → `observer.onBefore`. `tool.execute.after` → `observer.onAfter` + if `output.success === false` and throttle OK, invoke `reflector.invoke` asynchronously (no await, `.catch(() => {})`). `experimental.chat.system.transform` → `injector.onSystemTransform`. `experimental.session.compacting` → `injector.onCompacting`. `session.created` → capture `sessionID`. `session.idle` → `retrospective.generate(currentSessionId)`.
- **Acceptance criteria:**
  - 6 hooks wired.
  - Reflection is asynchronous (doesn't block hook).
  - Throttle applied (1 reflection/min).
  - `session.created` captures sessionID.
  - `session.idle` generates retrospective if there were failures.
  - Integration tests.
- **Verification:** `npx vitest run tests/integration/plugin-hooks.test.ts`

### K-040 — E2E tests of the complete plugin (all flows)

- **Priority:** P0
- **Estimation:** L (8h)
- **Dependencies:** K-039
- **Risk:** 🔴
- **Files:** `tests/e2e/plugin-complete.test.ts`
- **Description:** E2E test simulating the complete plugin cycle: (a) session.created → captures sessionID, (b) tool.execute.before/after with success=true → records tool_call, (c) tool.execute.after with success=false (typecheck error) → records + triggers reflection (throttle OK), (d) verify error memory persisted, (e) experimental.chat.system.transform with message "fix typecheck" → injects lesson, (f) session.idle → generates retrospective. Use Store `:memory:` and OpenCode context mocks.
- **Acceptance criteria:**
  - Complete cycle works end-to-end.
  - tool_calls recorded.
  - Error memory generated after failure.
  - Lesson injected into system prompt.
  - Retrospective generated.
  - `npm run typecheck && npm run lint && npm test` pass.
- **Verification:** `npx vitest run tests/e2e/plugin-complete.test.ts`

### K-041 — Implement `scripts/verify-install.ts`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-040
- **Risk:** 🟢
- **Files:** `scripts/verify-install.ts`
- **Description:** Script that verifies: (a) Node 20+, (b) SQLite works (`new Database(':memory:')`), (c) migration 001 applies without error, (d) `MemoryService.save` + `query` work, (e) `Reflector.invoke` generates memory, (f) `ContextInjector` injects lesson, (g) typecheck passes. Returns checkmark for each verification. Exit 0 if all OK, exit 1 if something fails.
- **Acceptance criteria:**
  - `npm run verify` returns checkmarks.
  - Exit 0 if everything passes.
  - Exit 1 if something fails with a clear message.
- **Verification:** `npm run verify`

### K-042 — Create `README.md` (end-user)

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K-041
- **Risk:** 🟢
- **Files:** `README.md`
- **Description:** README with: (a) what is Kevin ("Observe and Learn"), (b) installation (`npm install` + `opencode.json` config), (c) recommended ecosystem (conductor, background-agents, scheduler, DCP — optional), (d) available tools with examples, (e) hooks Kevin subscribes to, (f) how the Observe→Learn→Share cycle works, (g) future roadmap (v0.2 embeddings, v0.3 cross-project).
- **Acceptance criteria:**
  - README describes what Kevin is and how to install it.
  - Includes example `opencode.json`.
  - Includes recommended stack.
  - Usage examples for each tool.
- **Verification:** manual review.

### K-043 — Bump version 0.1.0 + CHANGELOG

- **Priority:** P0
- **Estimation:** S (30m)
- **Dependencies:** K-042
- **Risk:** 🟢
- **Files:** `package.json`, `CHANGELOG.md`
- **Description:** Confirm `package.json` version `0.1.0`. Create `CHANGELOG.md` with `[0.1.0]` entry (see `Kevin_Plan.md` §13).
- **Acceptance criteria:**
  - `package.json` version `0.1.0`.
  - `CHANGELOG.md` `[0.1.0]` entry complete.
- **Verification:** `node -e "console.log(require('./package.json').version)"` returns `0.1.0`.

### K-044 — Final commit + tag v0.1.0

- **Priority:** P0
- **Estimation:** S (15m)
- **Dependencies:** K-043
- **Risk:** 🟢
- **Acceptance criteria:**
  - `npm run typecheck && npm run lint && npm test` pass.
  - `npm run verify` passes.
  - `git tag v0.1.0`.
- **Verification:** `git tag --list v0.1.0`.

### K-045 — Manual validation in OpenCode Desktop

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K-044
- **Risk:** 🟡
- **Description:** Manual validation: (a) install plugin in OpenCode Desktop, (b) run `kevin_save type:"decision" content:"test decision"` → OK, (c) run `kevin_query query:"test"` → returns the memory, (d) run `kevin_status` → shows counts, (e) trigger a failure (e.g. bash with invalid command) → verify `kevin_recall query:"error"` returns generated lesson, (f) start new session → verify system prompt includes `<kevin-context>` if there are relevant lessons.
- **Acceptance criteria:**
  - Plugin loads in Desktop without error.
  - Tools accessible and functional.
  - Automatic reflection after failure.
  - Proactive injection in new session.
- **Verification:** manual inspection in OpenCode Desktop.

---

# Post-release — Fix v0.1.4

**Dependency:** `docs/Kevin_Fix_v0.1.4.md`
**Date:** 2026-07-07
**Razón:** la validación manual K-045 detectó que F#1 (detección de fallos → reflexión) sigue roto en producción: tras un `tsc` con `error TS2304`, `kevin_status` reporta `memories: 0`. El fix v0.1.3 solo escanea `output.output` cuando `metadata.success === true` (`plugin/index.ts:283`); el bash tool de opencode entrega `metadata = {}` (vacío) con el texto en `output.output`, por lo que la heurística cae al `else` (`plugin/index.ts:291`) y devuelve `success = true` sin escanear. Ver `docs/Kevin_Fix_v0.1.4.md` para el análisis exhaustivo, código propuesto y tests.

### K-046 — Añadir `STRONG_ERROR_RE` en `Reflector.ts`
- **Priority:** P0 · **Estimation:** S (30m) · **Dependencies:** — · **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`
- **Description:** Exportar `STRONG_ERROR_RE` (marcadores fuertes no ambiguos) junto a `ERROR_LINE_RE` (línea 30-31). Stdout se escanea con fuerte; stderr sigue con amplio. Sin tocar `extractFirstErrorLine`.
- **Acceptance:** `STRONG_ERROR_RE` exportada; `npm run typecheck` pasa; `tests/unit/reflector.test.ts` sin regresión.
- **Verification:** `npm run typecheck && npx vitest run tests/unit/reflector.test.ts`

### K-047 — Heurística robusta en `index.ts` + `pickExitCode`
- **Priority:** P0 · **Estimation:** M (2h) · **Dependencies:** K-046 · **Risk:** 🟡
- **Files:** `plugin/index.ts`
- **Description:** Reemplazar el cómputo de `success` en `tool.execute.after` (`index.ts:271-293`) por la nueva precedencia: `meta.success===false` → fail; `pickExitCode(meta)` numérico (`exitCode`/`exit_code`/`exit`) → fail si ≠0; `stderr` no vacío + `ERROR_LINE_RE` → fail; si no, escanear `stdout`/`output.output` con `STRONG_ERROR_RE` (cubre `metadata:{}` y `{success:true}`). Conservar `observer.onAfter` + `if(!success) reflector.invoke`. La red de seguridad del evento `session.next.tool.failed` se conserva intacta.
- **Acceptance:** `npm run typecheck && npm run lint && npm test` pasan; todos los tests existentes sin modificación.
- **Verification:** `npm run typecheck && npm run lint && npm test`

### K-048 — Tests de regresión en `plugin-tools.test.ts`
- **Priority:** P0 · **Estimation:** S (1h) · **Dependencies:** K-047 · **Risk:** 🟢
- **Files:** `tests/unit/plugin-tools.test.ts`
- **Description:** +4 tests en el `describe("tool.execute.after — …")` (línea 236): (1) `metadata:{}` + `error TS2304` en `output.output` → reflection sin evento (regresión K-045, núcleo del fix); (2) `metadata:{}` + `"0 errors"` → 0 memorias; (3) `metadata:{}` + prosa con `panic`/`error` → 0 memorias (guard F#28 en rama default); (4) `metadata:{exit_code:2}` → reflection (verifica `pickExitCode`).
- **Acceptance:** Los 4 tests pasan; los tests existentes (237-297) sin cambio.
- **Verification:** `npx vitest run tests/unit/plugin-tools.test.ts`

### K-049 — Test e2e: ciclo completo con metadata vacía (sin evento)
- **Priority:** P0 · **Estimation:** M (2h) · **Dependencies:** K-047 · **Risk:** 🟡
- **Files:** `tests/e2e/plugin-complete.test.ts`
- **Description:** +1 test e2e (espejo de `plugin-complete.test.ts:82-171`): `tool.execute.after` con `metadata:{}` y `output.output` con TS error → `waitForAsync` hasta lección persistida → `chat.message` + `system.transform` inyecta `<kevin-context>`, **sin** emitir `session.next.tool.failed` (auto-suficiencia de la heurística).
- **Acceptance:** Lección persistida e inyectada sin evento; el test existente `plugin-complete.test.ts:282` (que sí usa el evento) sigue pasando.
- **Verification:** `npx vitest run tests/e2e/plugin-complete.test.ts`

### K-050 — Bump 0.1.4 + CHANGELOG
- **Priority:** P0 · **Estimation:** S (30m) · **Dependencies:** K-048, K-049 · **Risk:** 🟢
- **Files:** `package.json`, `CHANGELOG.md`
- **Description:** (1) `package.json` version `0.1.3`→`0.1.4`; (2) entrada `## [0.1.4] — 2026-07-07` en `CHANGELOG.md` (draft en `Kevin_Fix_v0.1.4.md` §10); (3) corregir `README-K045.md`: DB path `~/.opencode-kevin/kevin.db`, plugin `@jmtrin/opencode-kevin@latest`, diagnóstico vía `kevin_status` (no `npx better-sqlite3`). Incluye refresco del caché stale de opencode (ver `Kevin_Fix_v0.1.4.md` §8).
- **Acceptance:** `node -e "console.log(require('./package.json').version)"` → `0.1.4`; CHANGELOG presente; README-K045 coherente.
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## Critical Dependencies

```
K-001 ──→ K-002 ──→ K-003 ──→ K-004 ──→ K-005 ──→ K-006 ──→ K-007
                                                              │
                                                              ▼
K-008 ──→ K-009 ──→ K-010 ──→ K-011 ──→ K-012 ──→ K-013 ──→ K-014
                                                              │
                                                              ▼
K-015 ──→ K-016 ──→ K-017 ──→ K-018 ──→ K-019 ──→ K-020
                                                    │
                                                    ▼
K-021 ──→ K-022 ──→ K-023 ──→ K-024 ──→ K-025 ──→ K-026 ──→ K-027 ──→ K-028
                                                                        │
                                                                        ▼
K-029 ──→ K-030 ──→ K-031     K-032                                    K-033
                              │                                        │
                              └───────────────→ K-034 ──→ K-035 ──→ K-036
                                                                        │
                                                                        ▼
K-037 ──→ K-038 ──→ K-039 ──→ K-040 ──→ K-041 ──→ K-042 ──→ K-043 ──→ K-044 ──→ K-045
```

**Critical path**:
```
K-001 → K-003 → K-005 → K-008 → K-010 → K-015 → K-017
    → K-021 → K-024 → K-029 → K-033 → K-037 → K-040 → K-041 → K-044 → K-045
```

**Critical path length**: ~16 tasks. Estimated duration: ~5-6 weeks (1 dev, ~120h).

---

## Implementation Status

Legend: `[ ]` pending · `[~]` in progress · `[X]` completed

Global summary:
- **v0.1.0:** 44 of 45 tasks completed (Phase 6 finished; K-045 manual validation pending user).
- **Fix v0.1.4:** 5 of 5 tasks completed (K-046…K-050 done — ver `docs/Kevin_Fix_v0.1.4.md`).

| Status | Task | Phase | Short description |
|---|---|---|---|
| `[X]` | K-001 | F1 | Create project structure and package.json |
| `[X]` | K-002 | F1 | Implement uuid.ts (UUID v7) |
| `[X]` | K-003 | F1 | Implement Store.ts (SQLite connection) |
| `[X]` | K-004 | F1 | Implement Migrate.ts (migration runner) |
| `[X]` | K-005 | F1 | Create migrations/001_initial.sql |
| `[X]` | K-006 | F1 | Unit tests for Store + Migrate |
| `[X]` | K-007 | F1 | Phase 1 checkpoint commit |
| `[X]` | K-008 | F2 | Implement MemoryService.ts (base CRUD) |
| `[X]` | K-009 | F2 | Implement FTS5 search in MemoryService |
| `[X]` | K-010 | F2 | Implement session scope with expiration |
| `[X]` | K-011 | F2 | Implement getRelevant with token budget |
| `[X]` | K-012 | F2 | MemoryService + Store integration tests |
| `[X]` | K-013 | F2 | E2E test: memory flow (save → query → recall) |
| `[X]` | K-014 | F2 | Phase 2 checkpoint commit |
| `[X]` | K-015 | F3 | Implement ToolCallObserver.ts (recording) |
| `[X]` | K-016 | F3 | Implement secret redaction |
| `[X]` | K-017 | F3 | Implement error_type inference |
| `[X]` | K-018 | F3 | Expose public methods of ToolCallObserver |
| `[X]` | K-019 | F3 | Integration tests ToolCallObserver with hooks |
| `[X]` | K-020 | F3 | Phase 3 checkpoint commit |
| `[X]` | K-021 | F4 | Implement Reflector.ts (skeleton + heuristic) |
| `[X]` | K-022 | F4 | Implement heuristic lesson by error_type |
| `[X]` | K-023 | F4 | Implement path and secret redaction |
| `[X]` | K-024 | F4 | Implement throttle in Reflector |
| `[X]` | K-025 | F4 | Implement content truncation > 4KB |
| `[X]` | K-026 | F4 | Reflector + MemoryService integration tests |
| `[X]` | K-027 | F4 | E2E test: failure → error memory → recall |
| `[X]` | K-028 | F4 | Phase 4 checkpoint commit |
| `[X]` | K-029 | F5 | Implement ContextInjector (skeleton + deriveQuery) |
| `[X]` | K-030 | F5 | Implement onSystemTransform (pre-prompt) |
| `[X]` | K-031 | F5 | Implement onCompacting |
| `[X]` | K-032 | F5 | Implement Retrospective.ts |
| `[X]` | K-033 | F5 | Integration tests ContextInjector with hooks |
| `[X]` | K-034 | F5 | E2E test: reflection → next session → injection |
| `[X]` | K-035 | F5 | E2E test: session with failures → retrospective |
| `[X]` | K-036 | F5 | Phase 5 checkpoint commit |
| `[X]` | K-037 | F6 | Implement plugin/index.ts (entry point) |
| `[X]` | K-038 | F6 | Implement plugin tools |
| `[X]` | K-039 | F6 | Wire hooks in plugin |
| `[X]` | K-040 | F6 | E2E tests of complete plugin |
| `[X]` | K-041 | F6 | Implement scripts/verify-install.ts |
| `[X]` | K-042 | F6 | Create README.md (end-user) |
| `[X]` | K-043 | F6 | Bump version 0.1.0 + CHANGELOG |
| `[X]` | K-044 | F6 | Final commit + tag v0.1.0 |
| `[X]` | K-045 | F6 | Manual validation in OpenCode Desktop (pending user) |
| `[X]` | K-046 | Fix v0.1.4 | Añadir `STRONG_ERROR_RE` en `Reflector.ts` |
| `[X]` | K-047 | Fix v0.1.4 | Heurística robusta en `index.ts` + `pickExitCode` |
| `[X]` | K-048 | Fix v0.1.4 | Tests de regresión en `plugin-tools.test.ts` |
| `[X]` | K-049 | Fix v0.1.4 | Test e2e: ciclo con metadata vacía (sin evento) |
| `[X]` | K-050 | Fix v0.1.4 | Bump 0.1.4 + CHANGELOG + README-K045 |

---

## Suggested Next Steps (critical path order)

1. **K-001..K-007** — Phase 1: Foundation (project setup, Store, Migrate, schema, uuid).
2. **K-008..K-014** — Phase 2: Memory (MemoryService CRUD + FTS5 + session scope).
3. **K-015..K-020** — Phase 3: Observation (ToolCallObserver + hooks + redaction).
4. **K-021..K-028** — Phase 4: Reflection (heuristic Reflector + failure hook + throttle).
5. **K-029..K-036** — Phase 5: Injection + Retrospective (ContextInjector + Retrospective + hooks).
6. **K-037..K-045** — Phase 6: Plugin + Release (entry point, tools, e2e, verify, tag v0.1.0).

---

## References

- `docs/Kevin_Plan.md` — Implementation plan (architecture, schema, components, decisions)
- `docs/Kevin_Fix_v0.1.4.md` — Fix v0.1.4: detección de fallos auto-suficiente (K-046…K-050)
- https://opencode.ai/docs — OpenCode docs (intro, install, usage)
- https://opencode.ai/docs/plugins — Plugin API, hooks, events
- https://opencode.ai/docs/skills — Native Agent Skills
- https://opencode.ai/docs/agents — Primary/subagents, task tool
- https://opencode.ai/docs/custom-tools — tool() helper, Zod schemas
- https://opencode.ai/docs/ecosystem — Community plugins
- https://github.com/WiseLibs/better-sqlite3 — SQLite for Node.js
- https://github.com/sqlite/sqlite/blob/master/ext/fts5/doc/fts5.md — FTS5 docs

# Changelog

All notable changes to Kevin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — 2026-07-07

### Fixed

- **F#1-fix — success=true override via ERROR_LINE_RE on bash output**: opencode's bash tool returns `metadata.success === true` even when the executed process exits non-zero (it reports success of the *tool call*, not the wrapped subprocess). The previous `tool.execute.after` handler short-circuited on `meta.success === true` before checking `exitCode` or `output.output`, so every failed `tsc` (which prints `error TS####` to stdout with exitCode 2, no stderr) silently passed as success and never reached the Reflector. Symptom: `kevin_status` reported `tool_calls >= 1` but `memories = 0` after a guaranteed `tsc` failure.
  - New precedence: `meta.success === false` → fail; `exitCode !== undefined` → use it; `meta.success === true` → run `ERROR_LINE_RE` against `stderr` then `stdout` then `output.output` to catch strong error markers (`TS\d{4,}`, `cannot find`, `command failed`, `non-zero exit`, `panic`, `traceback`, …); default `meta.success === undefined` with no signal → success.

### Tests

- `plugin-tools.test.ts` +3: success=true+no-error-line keeps `memories=0` (negative); success=true+`error TS2304` in `output.output` triggers Reflector and persists a searchable memory (case bash+tsc, the regression); `meta.exitCode=2` overrides `meta.success=true` and triggers reflection.

## [0.1.2] — 2026-07-06

### Fixed (Windows / Bun-installed plugins)

- **F#31 — `node:sqlite` por defecto en Node 22+**: el adapter SQLite ahora intenta primero `node:sqlite` (built-in, sin binarios nativos que descargar) y solo cae a `better-sqlite3` como fallback opcional. Resuelve el bug de carga del plugin en opencode sobre Windows: opencode instala plugins con Bun (que no ejecuta el script `install: prebuild-install` de `better-sqlite3`) y los ejecuta con un runtime Node embebido (ABI 146, Node 24.15), por lo que el binario `.node` nunca llegaba al cache y el plugin abortaba al registrar las herramientas `kevin_*`.
  - Síntomas previos: log `failed to load plugin path=@jmtrin/opencode-kevin@latest error="Could not locate the bindings file …"` en `~/.local/share/opencode/log/opencode.log`. Las 5 herramientas `kevin_save/query/recall/status/retrospective` no se registraban.
  - Compatibilidad: Bun sigue usando `bun:sqlite`; Node 24+ usa `node:sqlite` sin flag (warning experimental benigno); Node 22/23 sin flag `--experimental-sqlite` cae al fallback `better-sqlite3`; Node 20 (sin `node:sqlite`) requiere instalar `better-sqlite3` manualmente.
  - `transaction` reimplementada con `BEGIN`/`COMMIT`/`ROLLBACK` para `node:sqlite` (no expone `db.transaction()` como `better-sqlite3`).

### Changed

- `better-sqlite3` movido de `dependencies` a `optionalDependencies` (red de seguridad para Node <22.5).
- `engines.node` subido a `>=22.5.0` (donde `node:sqlite` está disponible).

## [0.1.1] — 2026-07-02

Post-release hardening: fixes the three critical issues that prevented Kevin from delivering real value (failure detection, context-aware injection, bm25 usage) plus 13 robustness and privacy improvements.

### Fixed

- **F#1 — Robust failure detection (hybrid)**: three complementary mechanisms: (1) `tool.execute.after` uses `metadata.success`/`exitCode` when present, plus `ERROR_LINE_RE` heuristic on `output.output`+`stderr` (fallback), (2) **NEW**: `event` hook listens to `session.next.tool.failed` (from SDK, with `error.message`) — when `tool.execute.after` missed the failure (free metadata with no populated success/exitCode), this event catches it definitively via `toolCache` lookup populated in `tool.execute.before`. (3) `session.next.tool.success` releases the cache. `toolCache` (Map<callID, {tool, argsSummary}>) with `TOOL_CACHE_MAX=500` and FIFO eviction. Internal Reflector throttle prevents duplicate lessons. Kevin is no longer deaf to failures.
- **F#2 — Context-aware injection**: new `chat.message` hook extracts the last user message text (`deriveQuery` revived in production) and passes it to `getRelevant` in `system.transform`/`compacting`. Injected lessons now match the current context, not a static bucket.
- **F#3 — bm25 respected**: `getRelevant` uses stable sort by `TYPE_PRIORITY` preserving the bm25 FTS5 order within each type (previously re-sorted by static `relevance_score`, ignoring the computed bm25 score).
- **F#4 — `relevance_score` alive**: +0.05 bump (cap 1.0) when injecting a memory. The column is no longer fiction.
- **F#5 — `redactPaths` expanded**: Unix whitelist expanded with `app|work|workspace|code|repo|project|src|build|dist|packages|services|api|web|client|server|lib|node_modules` (previously missing → privacy hole).
- **F#6 — Graceful `dispose`**: tracks pending promises (`Set<Promise>`); `dispose` does `await Promise.allSettled([...pending])` before `store.close()`. No more DB closed with writes in flight.
- **F#7 — Lesson always searchable**: content >4KB is NO longer marked `not_searchable`. The lesson (~150-650 chars) stays in `content`; only the additional context is truncated (`metadata.truncated = true`).
- **F#8 — Honest `inferErrorType`**: timeout detects `exitCode===124` and patterns `timed out|ETIMEDOUT|killed|SIGTERM|SIGKILL` before the fallback.
- **F#9 — Specific `extractFirstErrorLine`**: regex `\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|...)\b` (previously `/error|Error|FAIL/i` too broad).
- **F#12 — Complete `kevin_save`**: accepts optional `metadata`, `relevanceScore`, `sourceTool`, `sourceSession`.
- **F#13 — `save` without interpolation**: session scope TTL is now a bound parameter (`?`), no SQL interpolation.
- **F#15 — `STOP_WORDS` no duplicates**: removed duplicate "were".
- **F#16 — `uuidv7` with crypto**: uses `node:crypto.randomBytes` instead of `Math.random()`.
- **F#21 — Strict context-aware injection**: `system.transform`/`compacting` NO longer inject when there's no `lastUserQuery` (previously fell back to `loadAll` = static bucket). If `deriveQuery` returns `""` (only stop words), `lastUserQuery` resets to `null`. Behavior now consistent with `ContextInjector.onSystemTransform`.
- **F#23 — Idempotent `Retrospective.generate`**: if a retrospective already exists for the session, returns the existing `file_path` without regenerating or inserting duplicates (previously a duplicate `session.idle` would create 2 rows and overwrite the file).
- **F#25 — Defensive `Store.close()``: `closed` flag prevents double `db.close()` (which would throw "Database is closed" on abrupt shutdown); `prepare`/`transaction`/`exec` throw a clear error if called after `close()`.
- **F#26 — Recursive redaction**: `redactValue` in `ToolCallObserver` recurses into nested objects/arrays applying `redactPaths` and `redactSecrets`, including paths/keys with secrets inside `env`/`config` blocks. Centralized in `plugin/redact.ts`.
- **F#27 — `kevin_recall` scope**: exposes `scope?: 'project'|'session'|'all'` (default `'all'`). Session memories no longer inaccessible.
- **F#28 — Heuristic stderr-only**: `ERROR_LINE_RE` only evaluated against `stderr` (not `stdout`). Default success=true if stderr is empty. No more false positives from prose mentioning 'panic'/'exception'.
- **F#29 — Migration 002**: `CREATE UNIQUE INDEX` on `retrospectives(session_id)` + `INSERT OR IGNORE` in `Retrospective.generate`. Index on `memories(expires_at)`.
- **F#30 — Safe FTS5 with quotes**: `stripUnbalancedQuotes` in `sanitizeMatch` prevents FTS5 crash on lone `"`.

### Added

- `chat.message` hook (context-aware injection).
- `event` hook listens to `session.next.tool.failed`/`session.next.tool.success` (event-driven failure detection via `toolCache` Map).
- `toolCache` Map<callID, {tool, argsSummary}> with FIFO eviction (TOOL_CACHE_MAX=500), populated in `tool.execute.before`, consumed in `event session.next.tool.failed`.
- `plugin/redact.ts`: centralized `redactPaths` helper.
- `migrations/002_indexes.sql`: UNIQUE index on `retrospectives.session_id`, index on `memories.expires_at`.
- Context-aware tests (plugin-complete +3): `chat.message` → `system.transform` injects ONLY relevant; unrelated query does not inject; stop-words-only does not trigger bucket.
- Event-driven tests (plugin-complete +2): `session.next.tool.failed` triggers reflection via toolCache; `session.next.tool.success` clears cache.
- Idempotency test (retrospective +1): second call returns same path, 0 duplicates.
- `waitForAsync` replaces flaky `flush()` in e2e tests (polling 5ms up to 1000ms).
- `ERROR_LINE_RE` exported from `Reflector` for reuse in `index.ts`.
- Nested redaction tests (tool-call-observer +2): object args with paths/secrets, array args with paths.
- `kevin_recall` scope tests (plugin-tools +1): `scope=session` returns only session memories.
- Heuristic tests (plugin-complete +1): stdout mentions 'panic' but stderr empty → success=true.
- Sanitize quote tests (memory-integration +2): lone `"` doesn't crash FTS5; balanced quotes pass through.

## [0.1.0] — 2026-07-02

First public release. OpenCode plugin with the "Observe and learn" paradigm.

### Added

- **KevinPlugin**: entry point (`plugin/index.ts`) that initializes Store, applies migrations, and orchestrates all 5 components.
- **Store** (`plugin/Store.ts`): wrapper around better-sqlite3 with WAL, foreign keys ON, transactions, and `prepare`/`exec`/`close`/`raw`.
- **Migrate** (`plugin/Migrate.ts`): idempotent migrations applying pending `.sql` files in a transaction.
- **MemoryService** (`plugin/MemoryService.ts`): `save`/`getById`/`update`/`delete`/`query` (FTS5 with bm25) and `getRelevant` (greedy fill by token budget, FTS5 OR for relevance). `not_searchable` memory filtering in `query`/`getRelevant`.
- **ToolCallObserver** (`plugin/ToolCallObserver.ts`): `onBefore`/`onAfter` record tool calls in the `tool_calls` table; public `redactSecrets`, `summarizeArgs`, and `inferErrorType`. `callID` support as primary match key.
- **Reflector** (`plugin/Reflector.ts`): generates heuristic lessons after failures with `generateHeuristicLesson` (templates by error_type), `redactPaths` (Windows/Unix, preserves `:line`), `redactSecrets`, configurable throttle (60s default), truncation >4KB with `metadata.not_searchable`.
- **ContextInjector** (`plugin/ContextInjector.ts`): `deriveQuery` (extracts keywords from last user message, filters stop words in en/es), `onSystemTransform` (1500 tokens, `<kevin-context>`) and `onCompacting` (2000 tokens, `<kevin-memory>`).
- **Retrospective** (`plugin/Retrospective.ts`): `generate(sessionId)` produces `.kevin/retrospectives/<session>.md` with failure summary and lessons, inserts a row in the `retrospectives` table.
- **Initial schema** (`migrations/001_initial.sql`): tables `memories` + `memories_fts` (FTS5 unicode61 remove_diacritics), `tool_calls`, `retrospectives` with triggers and indexes.
- **5 Tools**: `kevin_save`, `kevin_query`, `kevin_recall`, `kevin_status`, `kevin_retrospective` (Zod schemas).
- **6 Hooks**: `tool.execute.before`, `tool.execute.after` (with async reflection), `experimental.chat.system.transform`, `experimental.session.compacting`, `event` (`session.created` captures id, `session.idle` generates retrospective).
- **Verification script** (`scripts/verify-install.ts`): 7 checks (Node 20+, SQLite, migration, save/query, Reflector, ContextInjector, strict typecheck).
- **Test suite**: 124 tests (unit + integration + e2e) covering all 5 components and the complete observe → learn → share cycle.
- **Documentation**: `README.md`, `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`, `docs/Kevin_Token_Impact.md`.

### Security

- Redaction of absolute paths and secrets before persisting any tool call or lesson.
- Content >4KB truncated and marked `not_searchable` to avoid bloating searches.

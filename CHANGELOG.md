# Changelog

Todos los cambios notables de Kevin se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [0.1.1] — 2026-07-02

Hardening post-release: corrige los tres fallos críticos que impedían que Kevin aportara valor real (detección de fallos, inyección context-aware, uso de bm25) más 13 mejoras de robustez y privacidad.

### Corregido

- **F#1 — Detección de fallos robusta**: `tool.execute.after` ya no depende solo de `metadata.success`/`exitCode` (que los tools estándar no pueblan). Ahora aplica heurística sobre `output.output` + `stderr` con `ERROR_LINE_RE` para detectar fallos cuando el tool no marca `success` explícitamente. Kevin deja de ser "sordo" a los fallos.
- **F#2 — Inyección context-aware**: nuevo hook `chat.message` extrae el texto del último mensaje del usuario (`deriveQuery` revive en producción) y lo pasa a `getRelevant` en `system.transform`/`compacting`. Las lecciones inyectadas ahora matchean el contexto actual, no un bucket estático.
- **F#3 — bm25 respetado**: `getRelevant` usa stable sort por `TYPE_PRIORITY` preservando el orden bm25 de FTS5 dentro de cada tipo (antes re-ordenaba por `relevance_score` estático, ignorando el score bm25 computado).
- **F#4 — `relevance_score` vivo**: bump de +0.05 (cap 1.0) al inyectar una memoria. La columna deja de ser ficción.
- **F#5 — `redactPaths` ampliado**: whitelist Unix ampliada con `app|work|workspace|code|repo|project|src|build|dist|packages|services|api|web|client|server|lib|node_modules` (antes missing → privacy hole).
- **F#6 — `dispose` graceful**: track de pending promises (`Set<Promise>`); `dispose` hace `await Promise.allSettled([...pending])` antes de `store.close()`. No más DB cerrada con writes en vuelo.
- **F#7 — Lección siempre searchable**: contenidos >4KB ya NO se marcan `not_searchable`. La lección (~150-650 chars) se mantiene en `content`; solo el contexto adicional se trunca (`metadata.truncated = true`).
- **F#8 — `inferErrorType` honesto**: timeout detecta `exitCode===124` y patrones `timed out|ETIMEDOUT|killed|SIGTERM|SIGKILL` antes del fallback.
- **F#9 — `extractFirstErrorLine` específico**: regex `\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|...)\b` (antes `/error|Error|FAIL/i` demasiado broad).
- **F#12 — `kevin_save` completo**: acepta `metadata`, `relevanceScore`, `sourceTool`, `sourceSession` opcionales.
- **F#13 — `save` sin interpolación**: TTL de session scope ahora es parámetro bound (`?`), no interpolación en SQL.
- **F#15 — `STOP_WORDS` sin duplicado**: quitado "were" duplicado.
- **F#16 — `uuidv7` con crypto**: usa `node:crypto.randomBytes` en vez de `Math.random()`.

### Añadido

- Hook `chat.message` (context-aware injection).
- Tests context-aware (plugin-complete +2): verifica que `chat.message` → `system.transform` inyecta SOLO lecciones relevantes y NO unrelated.
- `waitForAsync` reemplaza `flush()` flaky en tests e2e (polling 5ms hasta 1000ms).
- `ERROR_LINE_RE` exportado de `Reflector` para reutilización en `index.ts`.

## [0.1.0] — 2026-07-02

Primera versión pública. Plugin de OpenCode con paradigma "Observa y aprende".

### Añadido

- **Plugin Kevin**: entry point `KevinPlugin` (`plugin/index.ts`) que inicializa Store, aplica migraciones y orquesta los 5 componentes.
- **Store** (`plugin/Store.ts`): wrapper sobre better-sqlite3 con WAL, foreign keys ON, transacciones y `prepare`/`exec`/`close`/`raw`.
- **Migrate** (`plugin/Migrate.ts`): migraciones idempotentes que aplican `.sql` pendientes en una transacción.
- **MemoryService** (`plugin/MemoryService.ts`): `save`/`getById`/`update`/`delete`/`query` (FTS5 con bm25) y `getRelevant` (greedy fill por presupuesto de tokens, FTS5 OR para relevancia). Filtrado de memorias `not_searchable` en `query`/`getRelevant`.
- **ToolCallObserver** (`plugin/ToolCallObserver.ts`): `onBefore`/`onAfter` registran tool calls en la tabla `tool_calls`; `redactSecrets`, `summarizeArgs` e `inferErrorType` públicos. Soporte de `callID` como clave primaria de matching.
- **Reflector** (`plugin/Reflector.ts`): genera lecciones heurísticas tras fallos con `generateHeuristicLesson` (templates por error_type), `redactPaths` (Windows/Unix, preserva `:line`), `redactSecrets`, throttle configurable (60s default), truncado >4KB con `metadata.not_searchable`.
- **ContextInjector** (`plugin/ContextInjector.ts`): `deriveQuery` (extrae keywords del último mensaje del usuario, filtra stop words en/es), `onSystemTransform` (1500 tokens, `<kevin-context>`) y `onCompacting` (2000 tokens, `<kevin-memory>`).
- **Retrospective** (`plugin/Retrospective.ts`): `generate(sessionId)` produce `.kevin/retrospectives/<session>.md` con resumen de fallos y lecciones, e inserta un row en la tabla `retrospectives`.
- **Schema inicial** (`migrations/001_initial.sql`): tablas `memories` + `memories_fts` (FTS5 unicode61 remove_diacritics), `tool_calls`, `retrospectives` con triggers e índices.
- **5 Tools**: `kevin_save`, `kevin_query`, `kevin_recall`, `kevin_status`, `kevin_retrospective` (Zod schemas).
- **6 Hooks**: `tool.execute.before`, `tool.execute.after` (con reflection asíncrono), `experimental.chat.system.transform`, `experimental.session.compacting`, `event` (`session.created` captura id, `session.idle` genera retrospective).
- **Script de verificación** (`scripts/verify-install.ts`): 7 checks (Node 20+, SQLite, migración, save/query, Reflector, ContextInjector, typecheck strict).
- **Suite de tests**: 124 tests (unit + integration + e2e) cubriendo los 5 componentes y el ciclo completo observe → learn → share.
- **Documentación**: `README.md`, `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`, `docs/Kevin_Token_Impact.md`.

### Seguridad

- Redacción de paths absolutos y secrets antes de persistir cualquier tool call o lección.
- Contenidos >4KB truncados y marcados `not_searchable` para no inflar búsquedas.

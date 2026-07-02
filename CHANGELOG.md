# Changelog

Todos los cambios notables de Kevin se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

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

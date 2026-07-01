# Kevin — Lista de Tareas v0.1.0

**Versión:** 0.1.0
**Fecha:** 2026-06-30
**Estado:** Congelada (Fase 1 iniciada — 2026-07-01)
**Dependencia:** `docs/Kevin_Plan.md`
**Convención de IDs:** `K-XXX` (Kevin 0.1.0)
**Total de tareas:** 45

---

## Resumen

| Fase | Tareas | Prioridad | Semanas |
|---|---|---|---|
| F1 — Foundation | K-001 a K-007 | P0 | 1 |
| F2 — Memory | K-008 a K-014 | P0 | 2 |
| F3 — Observation | K-015 a K-020 | P0 | 3 |
| F4 — Reflection | K-021 a K-028 | P0 | 4 |
| F5 — Injection + Retrospective | K-029 to K-036 | P0 | 5 |
| F6 — Plugin + Release | K-037 to K-045 | P0 | 6 |

---

## Convenciones

- **Estimación:** S (≤4h), M (4-16h), L (16-40h).
- **Dependencias:** IDs de tareas que deben estar completas antes.
- **Riesgo:** 🟢 bajo · 🟡 medio · 🔴 alto.
- **Verificación:** comando o acción que confirma que la tarea está bien hecha.
- **Estado:** `[ ]` pendiente · `[~]` en progreso · `[X]` completada

---

# Fase 1 — Foundation (semana 1, P0)

### K-001 — Crear estructura de proyecto y package.json

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** —
- **Riesgo:** 🟢
- **Archivos:** `package.json`, `tsconfig.json`, `opencode.json`, `AGENTS.md`, `.gitignore`
- **Descripción:** Inicializar proyecto Node 20+ con TypeScript strict. `package.json` con `name: "kevin"`, `version: "0.1.0"`, `type: "module"`, scripts `build/test/typecheck/lint/format/verify`, deps `@opencode-ai/plugin`, `better-sqlite3`, `zod`, devDeps `@biomejs/biome`, `@types/better-sqlite3`, `@types/node`, `tsx`, `typescript`, `vitest`. `tsconfig.json` con `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `types: ["node"]`. `opencode.json` con `"plugin": ["./plugin/index.ts"]`. `AGENTS.md` con comandos y arquitectura. `.gitignore` con `.kevin/`, `node_modules/`, `dist/`.
- **Criterios de aceptación:**
  - `npm install` funciona sin errores.
  - `npm run typecheck` pasa (sin código aún, solo config).
  - Estructura de directorios creada: `plugin/`, `migrations/`, `scripts/`, `tests/unit/`, `tests/integration/`, `tests/e2e/`, `docs/`.
- **Verificación:** `Test-Path package.json` y `npm install` exit 0.

### K-002 — Implementar `uuid.ts` (UUID v7)

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-001
- **Riesgo:** 🟢
- **Archivos:** `plugin/uuid.ts`
- **Descripción:** Implementar generador UUID v7 (timestamp + random). Formato: `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`. Los primeros 48 bits son timestamp Unix en ms, los siguientes 12 bits incluyen version (7), el resto es random. IDs ordenables temporalmente.
- **Criterios de aceptación:**
  - `uuidv7()` retorna string de 36 chars con `-` en posiciones 8, 13, 18, 23.
  - El char en posición 14 es `7` (version).
  - Dos llamadas consecutivas: el segundo UUID es mayor que el primero (orden temporal).
  - Tests unitarios pasan.
- **Verificación:** `npx vitest run tests/unit/uuid.test.ts`

### K-003 — Implementar `Store.ts` (conexión SQLite)

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-002
- **Riesgo:** 🟡
- **Archivos:** `plugin/Store.ts`
- **Descripción:** Clase `Store` que abre conexión better-sqlite3. Constructor recibe `{ path: string }`. Configura `journal_mode = WAL` y `foreign_keys = ON`. Expone `prepare(sql)`, `transaction(fn)`, `close()`, `get raw()`.
- **Criterios de aceptación:**
  - `new Store({ path: ':memory:' })` funciona sin error.
  - `store.prepare('SELECT 1 as v').get()` retorna `{ v: 1 }`.
  - `store.transaction(() => { ... })` ejecuta en transacción.
  - `store.close()` cierra sin error.
  - WAL mode activado (verificar con `PRAGMA journal_mode`).
  - Tests unitarios pasan.
- **Verificación:** `npx vitest run tests/unit/store.test.ts`

### K-004 — Implementar `Migrate.ts` (runner de migraciones)

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-003
- **Riesgo:** 🟡
- **Archivos:** `plugin/Migrate.ts`
- **Descripción:** Clase `Migrate` que recibe `Store` y `migrationsDir`. Método `run()` lee `schema_version` table, lista archivos `.sql` en `migrationsDir` ordenados alfabéticamente, aplica pendientes en transacción, inserta versión en `schema_version`. Si `schema_version` no existe, la crea. Idempotente.
- **Criterios de aceptación:**
  - `Migrate.run()` crea `schema_version` si no existe.
  - Aplica migraciones pendientes en orden.
  - Si todas aplicadas, retorna `{ from: '001', to: '001', applied: [] }`.
  - Si una migración falla, rollback completo (transacción).
  - Tests unitarios con mock de directorio.
- **Verificación:** `npx vitest run tests/unit/migrate.test.ts`

### K-005 — Crear `migrations/001_initial.sql`

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-004
- **Riesgo:** 🟢
- **Archivos:** `migrations/001_initial.sql`
- **Descripción:** Crear migración inicial con schema completo (ver `Kevin_Plan.md` §4): `schema_version`, `memories` (4 tipos, 2 scopes, relevance_score, expires_at, source_tool, source_session, metadata), `memories_fts` (FTS5 con `unicode61 remove_diacritics 1`, content='memories'), 3 triggers FTS5 (insert/delete/update), `tool_calls` (session_id, tool, args_summary, success, duration_ms, agent, error_type, metadata), `retrospectives` (session_id, failure_count, success_count, lessons_count, file_path). Índices en type, scope, relevance, created, session_id, tool, ts, success. Seed `INSERT OR IGNORE INTO schema_version VALUES ('001')`.
- **Criterios de aceptación:**
  - `Migrate.run()` aplica 001 sin error.
  - Tablas `memories`, `memories_fts`, `tool_calls`, `retrospectives`, `schema_version` existen.
  - FTS5 funcional: `INSERT INTO memories` → `SELECT * FROM memories_fts` retorna row.
  - Triggers funcionan: delete en memories → row removido de FTS5.
  - `tokenize='unicode61 remove_diacritics 1'` verificado con `SELECT * FROM memories_fts WHERE memories_fts MATCH 'autenticacion'` (encuentra "autenticación").
- **Verificación:** `npx vitest run tests/unit/migrate.test.ts`

### K-006 — Tests unitarios de Store + Migrate integrados

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-005
- **Riesgo:** 🟢
- **Archivos:** `tests/unit/store.test.ts`, `tests/unit/migrate.test.ts`
- **Descripción:** Tests completos: Store abre/cierra, prepared statements, transacciones (commit + rollback), WAL mode. Migrate crea schema_version, aplica 001, idempotente, rollback en fallo.
- **Criterios de aceptación:**
  - ≥90% coverage de Store.ts y Migrate.ts.
  - Tests pasan con `:memory:` SQLite.
- **Verificación:** `npx vitest run tests/unit/store.test.ts tests/unit/migrate.test.ts`

### K-007 — Commit checkpoint Fase 1

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-001 a K-006
- **Riesgo:** 🟢
- **Descripción:** Commit con todos los cambios de F1. Tag `kevin-f1-done`.
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `git tag kevin-f1-done`.
- **Verificación:** `git tag --list kevin-f1-done`.

---

# Fase 2 — Memory (semana 2, P0)

### K-008 — Implementar `MemoryService.ts` (CRUD base)

- **Prioridad:** P0
- **Estimación:** M (6h)
- **Dependencias:** K-007
- **Riesgo:** 🟡
- **Archivos:** `plugin/MemoryService.ts`
- **Descripción:** Clase `MemoryService` con `Store`. Métodos: `save(input)`: inserta en `memories`, retorna id. `getById(id)`: SELECT por PK. `update(id, fields)`: UPDATE dinámico. `delete(id)`: DELETE. Input con Zod schema: `type` enum 4 valores, `content` string, `scope` enum `project|session` default `project`, `relevanceScore` number default 0.5, `sourceTool` string optional, `sourceSession` string optional, `metadata` record optional, `expiresAt` string optional. Usa `uuidv7()` para generar IDs.
- **Criterios de aceptación:**
  - `save({ type: 'error', content: 'test' })` persiste y retorna UUID v7.
  - `getById(id)` retorna la memoria con campos camelCase (`createdAt`, no `created_at`).
  - `update(id, { content: 'updated' })` actualiza `updated_at`.
  - `delete(id)` remueve de `memories` y `memories_fts` (vía trigger).
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/memory-service.test.ts`

### K-009 — Implementar búsqueda FTS5 en `MemoryService`

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-008
- **Riesgo:** 🟡
- **Archivos:** `plugin/MemoryService.ts`
- **Descripción:** Método `query(input)`: busca en `memories_fts` con `MATCH ?`, join con `memories`, ordena por `bm25(memories_fts)` score, filtra por `type` y `scope` (si no es 'all'), filtra `expires_at`. Retorna array de `Memory` con `score` en metadata. Limit default 10.
- **Criterios de aceptación:**
  - `query({ text: 'auth' })` retorna memorias que contienen 'auth' en content.
  - `query({ text: 'autenticacion' })` encuentra memorias con 'autenticación' (remove_diacritics).
  - `query({ text: 'test', type: 'error' })` filtra por type.
  - `query({ text: 'test', scope: 'project' })` filtra por scope.
  - `query({ text: 'test', scope: 'all' })` no filtra por scope.
  - Resultados ordenados por bm25 score (más relevantes primero).
  - Memorias con `expires_at` pasado no aparecen.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/memory-service.test.ts`

### K-010 — Implementar `scope: 'session'` con expiración

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-009
- **Riesgo:** 🟢
- **Archivos:** `plugin/MemoryService.ts`
- **Descripción:** `save` con `scope: 'session'` setea `expires_at` a 24h desde ahora por defecto (configurable). `query` y `getRelevant` filtran `expires_at IS NULL OR expires_at > datetime('now')`.
- **Criterios de aceptación:**
  - `save({ type: 'context', content: 'tmp', scope: 'session' })` setea `expires_at`.
  - `save({ type: 'context', content: 'perm', scope: 'project' })` no setea `expires_at`.
  - Query no retorna memorias session expiradas.
  - Tests unitarios con mock de fecha.
- **Verificación:** `npx vitest run tests/unit/memory-service.test.ts`

### K-011 — Implementar `getRelevant` con token budget

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-010
- **Riesgo:** 🟡
- **Archivos:** `plugin/MemoryService.ts`
- **Descripción:** Método `getRelevant(input)`: si hay `query`, hace FTS5 para narrow candidatos. Si no, carga todas (scope project). Ordena por `relevance_score` DESC + `created_at` DESC. Fill greedy respetando `maxTokens * 4` chars (aprox 1 token = 4 chars). Default `maxTokens: 2000`. Filtra expiradas.
- **Criterios de aceptación:**
  - `getRelevant({ query: 'auth', maxTokens: 500 })` retorna memorias relevantes sin exceder ~2000 chars total.
  - Si no hay query, retorna top memorias por relevance_score.
  - Prioriza `type: 'error'` y `type: 'pattern'` sobre `decision` y `context` (sort secondary).
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/memory-service.test.ts`

### K-012 — Tests integración MemoryService + Store

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-011
- **Riesgo:** 🟢
- **Archivos:** `tests/integration/memory-integration.test.ts`
- **Descripción:** Test que usa Store real (`:memory:`) + Migrate + MemoryService. Flujo: migrar → save 3 memorias → query → update → delete → verificar FTS5 sincronizado.
- **Criterios de aceptación:**
  - Flujo completo save/query/update/delete funciona.
  - FTS5 sincronizado tras cada operación (triggers).
  - `npm test` pasa.
- **Verificación:** `npx vitest run tests/integration/memory-integration.test.ts`

### K-013 — Test e2e: memory flow (save → query → recall)

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-012
- **Riesgo:** 🟢
- **Archivos:** `tests/e2e/memory-flow.test.ts`
- **Descripción:** Test e2e del flujo de memoria: (a) save memoria type:error "typecheck no-unused-vars", (b) save memoria type:decision "usamos vitest", (c) query "typecheck" retorna la primera, (d) query "vitest" retorna la segunda, (e) recall sin query retorna ambas dentro de budget.
- **Criterios de aceptación:**
  - Query por keyword retorna memoria correcta.
  - Recall respeta token budget.
  - FTS5 con diacríticos: save "autenticación" → query "autenticacion" la encuentra.
- **Verificación:** `npx vitest run tests/e2e/memory-flow.test.ts`

### K-014 — Commit checkpoint Fase 2

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-008 a K-013
- **Riesgo:** 🟢
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `git tag kevin-f2-done`.
- **Verificación:** `git tag --list kevin-f2-done`.

---

# Fase 3 — Observation (semana 3, P0)

### K-015 — Implementar `ToolCallObserver.ts` (registro)

- **Prioridad:** P0
- **Estimación:** M (6h)
- **Dependencias:** K-014
- **Riesgo:** 🟡
- **Archivos:** `plugin/ToolCallObserver.ts`
- **Descripción:** Clase `ToolCallObserver` con `Store`. `onBefore(input, output)`: registra timestamp inicial en Map interno (session+tool → startTs). `onAfter(input, output)`: calcula duration_ms, inserta en `tool_calls` table con: id (uuidv7), session_id, tool, args_summary (redacted), success (output.success === true ? 1 : 0), duration_ms, agent (input.agent ?? null), error_type (inferido), metadata (JSON string con args completos redacted). Mantiene estado de timestamps por sesión.
- **Criterios de aceptación:**
  - Tras `onAfter`, fila existe en `tool_calls`.
  - `duration_ms` es > 0 si hubo delay entre before y after.
  - `success` es 1 si output.success true, 0 si false.
  - Tests unitarios con mock de input/output.
- **Verificación:** `npx vitest run tests/unit/tool-call-observer.test.ts`

### K-016 — Implementar redacción de secrets en `ToolCallObserver`

- **Prioridad:** P0
- **Estimación:** M (3h)
- **Dependencias:** K-015
- **Riesgo:** 🟡
- **Archivos:** `plugin/ToolCallObserver.ts`
- **Descripción:** Método `redactSecrets(text)`: reemplaza patrones por `<redacted>`. Patrones: `API_KEY=...`, `SECRET=...`, `PASSWORD=...`, `TOKEN=...`, `Bearer ...`, `token ...` (case-insensitive). Método `summarizeArgs(args)`: extrae paths (filePath, path, cwd) y comandos (command, cmd) sin secrets. Resto truncado a 200 chars.
- **Criterios de aceptación:**
  - `redactSecrets("API_KEY=abc123")` → `"API_KEY=<redacted>"`.
  - `redactSecrets("Bearer xyz")` → `"Bearer <redacted>"`.
  - `summarizeArgs({ filePath: "/foo/bar.ts", command: "npm test" })` → `"filePath: /foo/bar.ts, command: npm test"`.
  - `summarizeArgs({ apiKey: "secret" })` → `"apiKey: <redacted>"`.
  - `tool_calls.args_summary` no contiene secrets.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/tool-call-observer.test.ts -t "redact"`

### K-017 — Implementar inferencia de `error_type` en `ToolCallObserver`

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-016
- **Riesgo:** 🟢
- **Archivos:** `plugin/ToolCallObserver.ts`
- **Descripción:** Método `inferErrorType(stderr, stdout)`: retorna string categorizando el error. Reglas (case-insensitive, primera match gana): stderr contiene "error TS" o "tsc" → `typecheck`. stderr contiene "lint" o "biome" o "eslint" → `lint`. stderr contiene "FAIL" o "vitest" o "jest" o "test failed" → `test`. stderr contiene "Error:" o "TypeError" o "ReferenceError" → `runtime`. exitCode -1 y stderr vacío → `timeout`. Default → `unknown`.
- **Criterios de aceptación:**
  - `inferErrorType("error TS2304: Cannot find name", "")` → `"typecheck"`.
  - `inferErrorType("FAIL src/test.ts", "")` → `"test"`.
  - `inferErrorType("TypeError: x is undefined", "")` → `"runtime"`.
  - `inferErrorType("", "")` con exitCode -1 → `"timeout"`.
  - `inferErrorType("random output", "")` → `"unknown"`.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/tool-call-observer.test.ts -t "error_type"`

### K-018 — Exponer métodos públicos de `ToolCallObserver` para el plugin

- **Prioridad:** P0
- **Estimación:** S (1h)
- **Dependencias:** K-017
- **Riesgo:** 🟢
- **Archivos:** `plugin/ToolCallObserver.ts`
- **Descripción:** Exponer `summarizeArgs(args)` y `inferErrorType(stderr, stdout)` como métodos públicos (para que el plugin los use al invocar Reflector). Asegurar que son deterministas y no tienen side effects.
- **Criterios de aceptación:**
  - Métodos son públicos y tipados.
  - `npm run typecheck` pasa.
- **Verificación:** `npm run typecheck`

### K-019 — Tests integración ToolCallObserver con hooks simulados

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-018
- **Riesgo:** 🟢
- **Archivos:** `tests/integration/tool-call-observer.test.ts`
- **Descripción:** Test que simula secuencia: `onBefore` → delay 10ms → `onAfter` con success=true, verifica fila en `tool_calls` con duration_ms > 0. Luego `onAfter` con success=false y stderr de typecheck, verifica `error_type = 'typecheck'`. Verifica redaction de secrets.
- **Criterios de aceptación:**
  - Filas en `tool_calls` con datos correctos.
  - `duration_ms > 0`.
  - `error_type` correcto.
  - No hay secrets en `args_summary`.
- **Verificación:** `npx vitest run tests/integration/tool-call-observer.test.ts`

### K-020 — Commit checkpoint Fase 3

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-015 a K-019
- **Riesgo:** 🟢
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `git tag kevin-f3-done`.
- **Verificación:** `git tag --list kevin-f3-done`.

---

# Fase 4 — Reflection (semana 4, P0)

### K-021 — Implementar `Reflector.ts` (esqueleto + heuristic)

- **Prioridad:** P0
- **Estimación:** M (6h)
- **Dependencias:** K-020
- **Riesgo:** 🟡
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** Clase `Reflector` con `MemoryService`. Método `invoke(input)`: async, retorna `string | null` (memory_id). Flujo: (1) redact paths y secrets de stderr/stdout, (2) extraer first error line (primera línea que contiene "error" o "Error" o "FAIL"), (3) generar lección heurística con template, (4) si content > 4KB truncar y marcar `metadata.not_searchable = true`, (5) persistir como memoria `type: 'error'` con `source_tool` y `source_session`, (6) retornar memory_id.
- **Criterios de aceptación:**
  - `invoke(...)` con fallo typecheck → retorna memory_id (UUID v7).
  - Memoria persistida con `type: 'error'`, `source_tool`, `source_session`.
  - Content contiene la lección heurística.
  - `npm run typecheck` pasa.
- **Verificación:** `npx vitest run tests/unit/reflector.test.ts`

### K-022 — Implementar generación de lección heurística por error_type

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-021
- **Riesgo:** 🟡
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** Método `generateHeuristicLesson(input)`: genera string con template `"When {tool} fails with {errorType}: {firstErrorLine}\nSuggestion: {suggestion}"`. Suggestions por errorType: typecheck → "Verify types and imports before running.", lint → "Run linter and fix warnings before committing.", test → "Run tests and fix failures before proceeding.", runtime → "Check error message and stack trace for root cause.", timeout → "Check for infinite loops or long-running operations.", unknown → "Review the error output for details.". Si firstErrorLine > 500 chars, truncar con "...".
- **Criterios de aceptación:**
  - Lesson para typecheck contiene "Verify types and imports".
  - Lesson para test contiene "Run tests and fix failures".
  - Lesson para runtime contiene "Check error message".
  - firstErrorLine truncada si > 500 chars.
  - Tests unitarios para cada error_type.
- **Verificación:** `npx vitest run tests/unit/reflector.test.ts -t "heuristic"`

### K-023 — Implementar redacción de paths y secrets en `Reflector`

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-022
- **Riesgo:** 🟢
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** Método `redactPaths(text)`: reemplaza paths absolutos. Windows: `C:\Users\...` → `<path>`. Unix: `/home/...`, `/Users/...`, `/var/...` → `<path>`. Regex case-insensitive. Método `redactSecrets(text)`: igual patrones que ToolCallObserver. Aplicar ambos al stderr/stdout antes de generar lección.
- **Criterios de aceptación:**
  - `redactPaths("Error at C:\\Users\\foo\\bar.ts:10")` → `"Error at <path>:10"`.
  - `redactPaths("Error at /home/foo/bar.ts:10")` → `"Error at <path>:10"`.
  - Memoria `error` no contiene paths absolutos ni secrets.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/reflector.test.ts -t "redact"`

### K-024 — Implementar throttle en `Reflector`

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-023
- **Riesgo:** 🟢
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** `Reflector` mantiene `lastReflectionTs` interno. `invoke` verifica `Date.now() - lastReflectionTs > 60_000` (1 min). Si no ha pasado suficiente tiempo, retorna `null` (skip). Throttle es por instancia de Reflector (una por plugin). Configurable vía constructor option `throttleMs`.
- **Criterios de aceptación:**
  - Primera llamada a `invoke` → genera memoria.
  - Segunda llamada inmediata → retorna `null` (throttled).
  - Tercera llamada tras 61s → genera memoria.
  - Tests unitarios con mock de Date.now.
- **Verificación:** `npx vitest run tests/unit/reflector.test.ts -t "throttle"`

### K-025 — Implementar truncado de content > 4KB

- **Prioridad:** P0
- **Estimación:** S (1h)
- **Dependencias:** K-024
- **Riesgo:** 🟢
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** Si content > 4096 chars, truncar a 4096 + "... [truncated]" y setear `metadata: { not_searchable: true }`. Memorias con `not_searchable: true` se pueden recuperar por ID pero no aparecen en FTS5 queries (filtrar en MemoryService.query con `metadata NOT LIKE '%not_searchable%'` o check post-query).
- **Criterios de aceptación:**
  - Content > 4KB se trunca.
  - `metadata` contiene `not_searchable: true`.
  - Query FTS5 no retorna memorias `not_searchable`.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/reflector.test.ts -t "trunc"`

### K-026 — Tests integración Reflector + MemoryService

- **Prioridad:** P0
- **Estimación:** M (3h)
- **Dependencias:** K-025
- **Riesgo:** 🟡
- **Archivos:** `tests/integration/reflector-integration.test.ts`
- **Descripción:** Test que usa Store real (`:memory:`) + MemoryService + Reflector. Flujo: (a) invoke Reflector con fallo typecheck, (b) verificar memoria persistida en `memories`, (c) `kevin_query("typecheck")` la encuentra, (d) verificar content no tiene paths absolutos.
- **Criterios de aceptación:**
  - Memoria `type: error` persistida tras invoke.
  - Query FTS5 la encuentra por keyword.
  - Content redacted (sin paths absolutos).
  - `source_tool` y `source_session` seteados.
- **Verificación:** `npx vitest run tests/integration/reflector-integration.test.ts`

### K-027 — Test e2e: fallo typecheck → memoria error → recall la retorna

- **Prioridad:** P0
- **Estimación:** M (3h)
- **Dependencias:** K-026
- **Riesgo:** 🟡
- **Archivos:** `tests/e2e/reflection-flow.test.ts`
- **Descripción:** Test e2e: (a) simular tool call fallido con stderr "error TS2304: Cannot find name 'foo'", (b) invocar Reflector.invoke, (c) `memoryService.query({ text: 'typecheck' })` retorna la memoria, (d) `memoryService.getRelevant({ query: 'typecheck' })` la incluye, (e) content contiene "Verify types and imports".
- **Criterios de aceptación:**
  - Memoria generada y persistida.
  - Query la encuentra.
  - getRelevant la incluye.
  - Content contiene suggestion correcta.
- **Verificación:** `npx vitest run tests/e2e/reflection-flow.test.ts`

### K-028 — Commit checkpoint Fase 4

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-021 a K-027
- **Riesgo:** 🟢
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `git tag kevin-f4-done`.
- **Verificación:** `git tag --list kevin-f4-done`.

---

# Fase 5 — Injection + Retrospective (semana 5, P0)

### K-029 — Implementar `ContextInjector.ts` (esqueleto + deriveQuery)

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-028
- **Riesgo:** 🟡
- **Archivos:** `plugin/ContextInjector.ts`
- **Descripción:** Clase `ContextInjector` con `MemoryService`. Método `deriveQuery(messages)`: extrae keywords del último mensaje del usuario. Stop words básicas (en/es: "the", "a", "el", "la", "de", "que", "for", "with", "how", "como"). Retorna string con keywords separadas por espacio (para FTS5 MATCH).
- **Criterios de aceptación:**
  - `deriveQuery([{ role: 'user', content: 'how do I handle authentication?' }])` → `"handle authentication"`.
  - `deriveQuery([{ role: 'user', content: 'implementa dark mode' }])` → `"implementa dark mode"`.
  - Stop words filtradas.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/context-injector.test.ts`

### K-030 — Implementar `ContextInjector.onSystemTransform` (pre-prompt)

- **Prioridad:** P0
- **Estimación:** M (6h)
- **Dependencias:** K-029
- **Riesgo:** 🟡
- **Archivos:** `plugin/ContextInjector.ts`
- **Descripción:** Método `onSystemTransform(input, output)`: (1) deriva query del último mensaje del usuario, (2) `memoryService.getRelevant({ query, maxTokens: 1500 })`, (3) si hay memorias, formatea como `<kevin-context>Lecciones relevantes:\n[type] content\n...</kevin-context>`, (4) añade a output (system prompt string o array). Si no hay memorias, no añade nada.
- **Criterios de aceptación:**
  - Con memorias relevantes: output incluye `<kevin-context>`.
  - Sin memorias: output sin cambios.
  - Presupuesto 1500 tokens (~6000 chars) respetado.
  - Prioriza type: error y type: pattern.
  - Tests unitarios con mock de MemoryService.
- **Verificación:** `npx vitest run tests/unit/context-injector.test.ts`

### K-031 — Implementar `ContextInjector.onCompacting`

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-030
- **Riesgo:** 🟡
- **Archivos:** `plugin/ContextInjector.ts`
- **Descripción:** Método `onCompacting(input, output)`: (1) deriva query del contexto de la sesión (últimos mensajes), (2) `memoryService.getRelevant({ query, maxTokens: 2000 })`, (3) formatea como `<kevin-memory>\n[type] content\n...</kevin-memory>`, (4) añade a `output.context` (array). Si no hay memorias, no añade nada.
- **Criterios de aceptación:**
  - Con memorias: `output.context` incluye `<kevin-memory>`.
  - Sin memorias: `output.context` sin cambios.
  - Presupuesto 2000 tokens (~8000 chars) respetado.
  - Tests unitarios.
- **Verificación:** `npx vitest run tests/unit/context-injector.test.ts`

### K-032 — Implementar `Retrospective.ts`

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-028
- **Riesgo:** 🟡
- **Archivos:** `plugin/Retrospective.ts`
- **Descripción:** Clase `Retrospective` con `Store` y `MemoryService`. Método `generate(sessionId)`: (1) contar tool_calls de la sesión (success y failure), (2) si failure_count === 0, retornar `null`, (3) listar tools que fallaron con error_type y args_summary, (4) listar lecciones generadas (memories type:error con source_session = sessionId), (5) generar markdown, (6) guardar en `.kevin/retrospectives/{sessionId}.md`, (7) insertar en `retrospectives` table, (8) retornar file_path.
- **Criterios de aceptación:**
  - Con fallos: genera archivo `.md` y fila en `retrospectives`.
  - Sin fallos: retorna `null`, no genera nada.
  - Markdown contiene: "# Retrospective", "## Resumen", "## Tools que fallaron", "## Lecciones generadas".
  - Tests unitarios con Store `:memory:`.
- **Verificación:** `npx vitest run tests/unit/retrospective.test.ts`

### K-033 — Tests integración ContextInjector con hooks simulados

- **Prioridad:** P0
- **Estimación:** M (3h)
- **Dependencias:** K-031
- **Riesgo:** 🟡
- **Archivos:** `tests/integration/injection.test.ts`
- **Descripción:** Test que simula: (a) guardar memoria error "typecheck no-unused-vars", (b) simular `onSystemTransform` con mensaje "fix the typecheck error", (c) verificar output incluye `<kevin-context>` con la memoria, (d) simular `onCompacting`, (e) verificar `output.context` incluye `<kevin-memory>`.
- **Criterios de aceptación:**
  - `onSystemTransform` inyecta lección relevante.
  - `onCompacting` inyecta memorias.
  - Si no hay memorias relevantes, no se inyecta nada.
  - Token budget respetado.
- **Verificación:** `npx vitest run tests/integration/injection.test.ts`

### K-034 — Test e2e: reflection → next session → context injection

- **Prioridad:** P0
- **Estimación:** L (6h)
- **Dependencias:** K-033, K-027
- **Riesgo:** 🟡
- **Archivos:** `tests/e2e/context-injection.test.ts`
- **Descripción:** Test e2e del ciclo completo: (a) sesión 1: simular fallo typecheck → Reflector genera memoria error, (b) sesión 2: simular `onSystemTransform` con mensaje "fix typecheck", (c) verificar que la lección de sesión 1 se inyecta en system prompt de sesión 2 sin que el usuario la pida.
- **Criterios de aceptación:**
  - Memoria error generada en sesión 1.
  - Sesión 2: system prompt incluye `<kevin-context>` con la lección.
  - La lección aparece antes de que el agente actúe (proactivo).
- **Verificación:** `npx vitest run tests/e2e/context-injection.test.ts`

### K-035 — Test e2e: session with failures → retrospective.md

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-032
- **Riesgo:** 🟢
- **Archivos:** `tests/e2e/retrospective.test.ts`
- **Descripción:** Test e2e: (a) registrar 5 tool calls (3 success, 2 failure), (b) invocar `Retrospective.generate(sessionId)`, (c) verificar archivo `.kevin/retrospectives/{sessionId}.md` existe, (d) verificar contenido tiene secciones correctas, (e) verificar fila en `retrospectives` table.
- **Criterios de aceptación:**
  - Archivo markdown existe.
  - Contiene "## Resumen" con "5 (3 ok, 2 failed)".
  - Contiene "## Tools que fallaron" con 2 entries.
  - Fila en `retrospectives` con `file_path` seteado.
- **Verificación:** `npx vitest run tests/e2e/retrospective.test.ts`

### K-036 — Commit checkpoint Fase 5

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-029 a K-035
- **Riesgo:** 🟢
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `git tag kevin-f5-done`.
- **Verificación:** `git tag --list kevin-f5-done`.

---

# Fase 6 — Plugin + Release (semana 6, P0)

### K-037 — Implementar `plugin/index.ts` (entry point)

- **Prioridad:** P0
- **Estimación:** L (8h)
- **Dependencias:** K-036
- **Riesgo:** 🔴
- **Archivos:** `plugin/index.ts`
- **Descripción:** Implementar `KevinPlugin` como `Plugin` de `@opencode-ai/plugin`. En constructor: (1) inicializar Store con path `${ctx.directory}/.kevin/kevin.db`, (2) crear directorio `.kevin/` si no existe, (3) `Migrate.run()`, (4) inicializar MemoryService, ToolCallObserver, Reflector, ContextInjector, Retrospective, (5) mantener `currentSessionId` y `lastReflectionTs` como estado. Retornar objeto con `tool` (5 tools) y 6 hooks. Ver `Kevin_Plan.md` §6 para código de referencia.
- **Criterios de aceptación:**
  - `npm run typecheck` pasa.
  - Plugin exporta `KevinPlugin` como `Plugin`.
  - Estructura de retorno coincide con OpenCode plugin API.
- **Verificación:** `npm run typecheck`

### K-038 — Implementar tools en plugin (kevin_save, kevin_query, kevin_recall, kevin_status, kevin_retrospective)

- **Prioridad:** P0
- **Estimación:** M (6h)
- **Dependencias:** K-037
- **Riesgo:** 🟡
- **Archivos:** `plugin/index.ts`
- **Descripción:** Registrar 5 tools con `tool()` helper y Zod schemas. `kevin_save`: args type/content/scope, ejecuta `memoryService.save`, retorna id. `kevin_query`: args query/type/limit, ejecuta `memoryService.query`, retorna JSON. `kevin_recall`: args query/limit, ejecuta `memoryService.getRelevant`, retorna JSON. `kevin_status`: sin args, cuenta memories/tool_calls/retrospectives, retorna JSON. `kevin_retrospective`: args session_id optional, ejecuta `retrospective.generate`, retorna file_path o mensaje.
- **Criterios de aceptación:**
  - 5 tools registradas con schemas Zod correctos.
  - `kevin_save` con args válidos persiste memoria.
  - `kevin_query` retorna resultados JSON.
  - `kevin_status` retorna counts.
  - `kevin_retrospective` retorna file_path o "no failures".
  - Tests unitarios de cada tool.
- **Verificación:** `npx vitest run tests/unit/plugin-tools.test.ts`

### K-039 — Cablear hooks en plugin (tool.execute, system.transform, compacting, session)

- **Prioridad:** P0
- **Estimación:** M (4h)
- **Dependencias:** K-038
- **Riesgo:** 🟡
- **Archivos:** `plugin/index.ts`
- **Descripción:** Cablear 6 hooks: `tool.execute.before` → `observer.onBefore`. `tool.execute.after` → `observer.onAfter` + si `output.success === false` y throttle OK, invocar `reflector.invoke` asíncrono (no await, `.catch(() => {})`). `experimental.chat.system.transform` → `injector.onSystemTransform`. `experimental.session.compacting` → `injector.onCompacting`. `session.created` → capturar `sessionID`. `session.idle` → `retrospective.generate(currentSessionId)`.
- **Criterios de aceptación:**
  - 6 hooks cableados.
  - Reflection es asíncrona (no bloquea hook).
  - Throttle aplicado (1 reflection/min).
  - `session.created` captura sessionID.
  - `session.idle` genera retrospective si hubo fallos.
  - Tests integración.
- **Verificación:** `npx vitest run tests/integration/plugin-hooks.test.ts`

### K-040 — Tests e2e del plugin completo (todos los flujos)

- **Prioridad:** P0
- **Estimación:** L (8h)
- **Dependencias:** K-039
- **Riesgo:** 🔴
- **Archivos:** `tests/e2e/plugin-complete.test.ts`
- **Descripción:** Test e2e que simula el ciclo completo del plugin: (a) session.created → captura sessionID, (b) tool.execute.before/after con success=true → registra tool_call, (c) tool.execute.after con success=false (typecheck error) → registra + dispara reflection (throttle OK), (d) verificar memoria error persistida, (e) experimental.chat.system.transform con mensaje "fix typecheck" → inyecta lección, (f) session.idle → genera retrospective. Usar Store `:memory:` y mocks de OpenCode context.
- **Criterios de aceptación:**
  - Ciclo completo funciona end-to-end.
  - tool_calls registrados.
  - Memoria error generada tras fallo.
  - Lección inyectada en system prompt.
  - Retrospective generada.
  - `npm run typecheck && npm run lint && npm test` pasan.
- **Verificación:** `npx vitest run tests/e2e/plugin-complete.test.ts`

### K-041 — Implementar `scripts/verify-install.ts`

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-040
- **Riesgo:** 🟢
- **Archivos:** `scripts/verify-install.ts`
- **Descripción:** Script que verifica: (a) Node 20+, (b) SQLite funciona (`new Database(':memory:')`), (c) migración 001 aplica sin error, (d) `MemoryService.save` + `query` funcionan, (e) `Reflector.invoke` genera memoria, (f) `ContextInjector` inyecta lección, (g) typecheck pasa. Retorna checkmark por cada verificación. Exit 0 si todo OK, exit 1 si algo falla.
- **Criterios de aceptación:**
  - `npm run verify` retorna checkmarks.
  - Exit 0 si todo pasa.
  - Exit 1 si algo falla con mensaje claro.
- **Verificación:** `npm run verify`

### K-042 — Crear `README.md` (usuario final)

- **Prioridad:** P0
- **Estimación:** S (2h)
- **Dependencias:** K-041
- **Riesgo:** 🟢
- **Archivos:** `README.md`
- **Descripción:** README con: (a) qué es Kevin ("Observa y aprende"), (b) instalación (`npm install` + `opencode.json` config), (c) ecosistema recomendado (conductor, background-agents, scheduler, DCP — opcionales), (d) tools disponibles con ejemplos, (e) hooks que Kevin suscribe, (f) cómo funciona el ciclo Observe→Learn→Share, (g) roadmap futuro (v0.2 embeddings, v0.3 cross-project).
- **Criterios de aceptación:**
  - README describe qué es Kevin y cómo instalarlo.
  - Incluye `opencode.json` de ejemplo.
  - Incluye stack recomendado.
  - Ejemplos de uso de cada tool.
- **Verificación:** revisión manual.

### K-043 — Bump versión 0.1.0 + CHANGELOG

- **Prioridad:** P0
- **Estimación:** S (30m)
- **Dependencias:** K-042
- **Riesgo:** 🟢
- **Archivos:** `package.json`, `CHANGELOG.md`
- **Descripción:** Confirmar `package.json` version `0.1.0`. Crear `CHANGELOG.md` con entrada `[0.1.0]` (ver `Kevin_Plan.md` §13).
- **Criterios de aceptación:**
  - `package.json` version `0.1.0`.
  - `CHANGELOG.md` entrada `[0.1.0]` completa.
- **Verificación:** `node -e "console.log(require('./package.json').version)"` retorna `0.1.0`.

### K-044 — Commit final + tag v0.1.0

- **Prioridad:** P0
- **Estimación:** S (15m)
- **Dependencias:** K-043
- **Riesgo:** 🟢
- **Criterios de aceptación:**
  - `npm run typecheck && npm run lint && npm test` pasan.
  - `npm run verify` pasa.
  - `git tag v0.1.0`.
- **Verificación:** `git tag --list v0.1.0`.

### K-045 — Validación manual en OpenCode Desktop

- **Prioridad:** P0
- **Estimación:** S (1h)
- **Dependencias:** K-044
- **Riesgo:** 🟡
- **Descripción:** Validación manual: (a) instalar plugin en OpenCode Desktop, (b) ejecutar `kevin_save type:"decision" content:"test decision"` → OK, (c) ejecutar `kevin_query query:"test"` → retorna la memoria, (d) ejecutar `kevin_status` → muestra counts, (e) provocar un fallo (e.g. bash con comando inválido) → verificar que `kevin_recall query:"error"` retorna lección generada, (f) iniciar nueva sesión → verificar que system prompt incluye `<kevin-context>` si hay lecciones relevantes.
- **Criterios de aceptación:**
  - Plugin carga en Desktop sin error.
  - Tools accesibles y funcionales.
  - Reflection automática tras fallo.
  - Inyección proactiva en nueva sesión.
- **Verificación:** inspección manual en OpenCode Desktop.

---

## Dependencias críticas

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

**Ruta crítica**:
```
K-001 → K-003 → K-005 → K-008 → K-010 → K-015 → K-017
    → K-021 → K-024 → K-029 → K-033 → K-037 → K-040 → K-041 → K-044 → K-045
```

**Longitud ruta crítica**: ~16 tareas. Duración estimada: ~5-6 semanas (1 dev, ~120h).

---

## Estado de implementación

Leyenda: `[ ]` pendiente · `[~]` en progreso · `[X]` completada

Resumen global: **20 de 45 tareas completadas** (Fase 3 finalizada).

| Estado | Tarea | Fase | Descripción corta |
|---|---|---|---|
| `[X]` | K-001 | F1 | Crear estructura de proyecto y package.json |
| `[X]` | K-002 | F1 | Implementar uuid.ts (UUID v7) |
| `[X]` | K-003 | F1 | Implementar Store.ts (conexión SQLite) |
| `[X]` | K-004 | F1 | Implementar Migrate.ts (runner de migraciones) |
| `[X]` | K-005 | F1 | Crear migrations/001_initial.sql |
| `[X]` | K-006 | F1 | Tests unitarios de Store + Migrate |
| `[X]` | K-007 | F1 | Commit checkpoint Fase 1 |
| `[X]` | K-008 | F2 | Implementar MemoryService.ts (CRUD base) |
| `[X]` | K-009 | F2 | Implementar búsqueda FTS5 en MemoryService |
| `[X]` | K-010 | F2 | Implementar scope session con expiración |
| `[X]` | K-011 | F2 | Implementar getRelevant con token budget |
| `[X]` | K-012 | F2 | Tests integración MemoryService + Store |
| `[X]` | K-013 | F2 | Test e2e: memory flow (save → query → recall) |
| `[X]` | K-014 | F2 | Commit checkpoint Fase 2 |
| `[X]` | K-015 | F3 | Implementar ToolCallObserver.ts (registro) |
| `[X]` | K-016 | F3 | Implementar redacción de secrets |
| `[X]` | K-017 | F3 | Implementar inferencia de error_type |
| `[X]` | K-018 | F3 | Exponer métodos públicos de ToolCallObserver |
| `[X]` | K-019 | F3 | Tests integración ToolCallObserver con hooks |
| `[X]` | K-020 | F3 | Commit checkpoint Fase 3 |
| `[ ]` | K-021 | F4 | Implementar Reflector.ts (esqueleto + heuristic) |
| `[ ]` | K-022 | F4 | Implementar lección heurística por error_type |
| `[ ]` | K-023 | F4 | Implementar redacción de paths y secrets |
| `[ ]` | K-024 | F4 | Implementar throttle en Reflector |
| `[ ]` | K-025 | F4 | Implementar truncado de content > 4KB |
| `[ ]` | K-026 | F4 | Tests integración Reflector + MemoryService |
| `[ ]` | K-027 | F4 | Test e2e: fallo → memoria error → recall |
| `[ ]` | K-028 | F4 | Commit checkpoint Fase 4 |
| `[ ]` | K-029 | F5 | Implementar ContextInjector (esqueleto + deriveQuery) |
| `[ ]` | K-030 | F5 | Implementar onSystemTransform (pre-prompt) |
| `[ ]` | K-031 | F5 | Implementar onCompacting |
| `[ ]` | K-032 | F5 | Implementar Retrospective.ts |
| `[ ]` | K-033 | F5 | Tests integración ContextInjector con hooks |
| `[ ]` | K-034 | F5 | Test e2e: reflection → next session → injection |
| `[ ]` | K-035 | F5 | Test e2e: session con fallos → retrospective |
| `[ ]` | K-036 | F5 | Commit checkpoint Fase 5 |
| `[ ]` | K-037 | F6 | Implementar plugin/index.ts (entry point) |
| `[ ]` | K-038 | F6 | Implementar tools en plugin |
| `[ ]` | K-039 | F6 | Cablear hooks en plugin |
| `[ ]` | K-040 | F6 | Tests e2e del plugin completo |
| `[ ]` | K-041 | F6 | Implementar scripts/verify-install.ts |
| `[ ]` | K-042 | F6 | Crear README.md (usuario final) |
| `[ ]` | K-043 | F6 | Bump versión 0.1.0 + CHANGELOG |
| `[ ]` | K-044 | F6 | Commit final + tag v0.1.0 |
| `[ ]` | K-045 | F6 | Validación manual en OpenCode Desktop |

---

## Próximos pasos sugeridos (orden de la ruta crítica)

1. **K-001..K-007** — Fase 1: Foundation (project setup, Store, Migrate, schema, uuid).
2. **K-008..K-014** — Fase 2: Memory (MemoryService CRUD + FTS5 + session scope).
3. **K-015..K-020** — Fase 3: Observation (ToolCallObserver + hooks + redaction).
4. **K-021..K-028** — Fase 4: Reflection (Reflector heurístico + hook fallos + throttle).
5. **K-029..K-036** — Fase 5: Injection + Retrospective (ContextInjector + Retrospective + hooks).
6. **K-037..K-045** — Fase 6: Plugin + Release (entry point, tools, e2e, verify, tag v0.1.0).

---

## Referencias

- `docs/Kevin_Plan.md` — Plan de implementación (arquitectura, schema, componentes, decisiones)
- https://opencode.ai/docs — OpenCode docs (intro, install, usage)
- https://opencode.ai/docs/plugins — Plugin API, hooks, events
- https://opencode.ai/docs/skills — Agent Skills nativo
- https://opencode.ai/docs/agents — Primary/subagents, task tool
- https://opencode.ai/docs/custom-tools — tool() helper, Zod schemas
- https://opencode.ai/docs/ecosystem — Plugins comunitarios
- https://github.com/WiseLibs/better-sqlite3 — SQLite para Node.js
- https://github.com/sqlite/sqlite/blob/master/ext/fts5/doc/fts5.md — FTS5 docs

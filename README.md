# Kevin

> Observa y aprende: la capa de aprendizaje que OpenCode no tiene.

Kevin es un plugin de [OpenCode](https://opencode.ai) que **observa** cada tool call del agente, **aprende** de sus fallos generando lecciones, y **comparte** proactivamente lo aprendido en futuras sesiones. No planifica, no orquesta, no compite con el ecosistema de plugins. Solo aprende.

- **Local-first**: memoria en SQLite + FTS5, sin servicios externos.
- **Sin red**: todo vive en `.kevin/kevin.db` dentro de tu proyecto.
- **Standalone**: funciona sin ningún otro plugin. Con el ecosistema, aprende más rico.

---

## Instalación

```bash
npm install kevin
```

Habilita Kevin en tu config de OpenCode:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "kevin"
  ]
}
```

Al iniciar OpenCode, Kevin crea `.kevin/kevin.db` y aplica las migraciones automáticamente.

### Requisitos

- Node.js >= 20
- OpenCode con soporte de plugins (`@opencode-ai/plugin` >= 1.17)

### Verificación

```bash
npm run verify
```

Comprueba Node, SQLite, migración, save/query del MemoryService, Reflector, ContextInjector y typecheck.

---

## Ecosistema (opcional)

Kevin funciona standalone, pero brilla con el resto del ecosistema de OpenCode. Ninguno es obligatorio:

```jsonc
{
  "plugin": [
    "opencode-conductor",               // Workflow: Context → Spec → Plan → Implement
    "opencode-background-agents",       // Async delegation
    "opencode-scheduler",               // Cron jobs
    "opencode-dynamic-context-pruning", // Context pruning (DCP)
    "kevin"                             // Capa de aprendizaje
  ]
}
```

| Plugin | Rol | Sinergia con Kevin |
|---|---|---|
| `opencode-conductor` | Orquesta Tracks autónomos | Más tool calls → más fallos de los que aprender |
| `opencode-background-agents` | Delegación async | Kevin observa work en background |
| `opencode-scheduler` | Cron jobs | Kevin aprende de jobs recurrentes |
| `opencode-dynamic-context-pruning` (DCP) | Poda tool outputs stale | DCP libera espacio → Kevin lo ocupa con lecciones útiles |

DCP y Kevin son complementarios: DCP poda lo stale, Kevin inyecta lo aprendido.

---

## Ciclo: Observa → Aprende → Comparte

```
  Tool call (éxito o fallo)
         │
         ▼
  ┌─────────────────┐
  │   OBSERVA        │  ToolCallObserver registra cada llamada
  │  ToolCallObserver│  (tool, args redacted, success, duration, error_type)
  └────────┬────────┘
           │ si fallo
           ▼
  ┌─────────────────┐
  │   APRENDE        │  Reflector genera una lección heurística
  │   Reflector      │  redacta paths/secrets, throttled 1/min,
  └────────┬────────┘  persiste memoria type:error
           │
           ▼
  ┌─────────────────┐
  │   COMPARTE       │  ContextInjector inyecta lecciones relevantes
  │ ContextInjector  │  pre-prompt (1500 tokens) y al compactar (2000 tokens)
  └────────┬────────┘
           │ session.idle
           ▼
  ┌─────────────────┐
  │  RETROSPECTIVE   │  Retrospective genera .kevin/retrospectives/<session>.md
  └─────────────────┘  con resumen de fallos y lecciones de la sesión
```

---

## Tools

Kevin expone 5 tools invocables por el agente:

### `kevin_save`

Guarda una memoria explícita.

```
kevin_save({ type: "decision", content: "Usamos vitest para tests", scope: "project" })
// → { "id": "0195a3b2-..." }
```

`type`: `error` | `pattern` | `decision` | `context`. `scope`: `project` (persiste) | `session` (TTL 24h).

### `kevin_query`

Busca memorias por texto (FTS5 + bm25).

```
kevin_query({ query: "typecheck", type: "error", limit: 5 })
// → [{ "id": "...", "type": "error", "content": "...", "scope": "project" }, ...]
```

### `kevin_recall`

Recupera memorias relevantes (greedy fill por relevancia). Sin `query`, retorna todas del scope.

```
kevin_recall({ query: "auth", limit: 3 })
// → [{ "id": "...", "type": "decision", ... }, ...]
```

### `kevin_status`

Conteos globales.

```
kevin_status({})
// → { "memories": 42, "tool_calls": 318, "retrospectives": 7 }
```

### `kevin_retrospective`

Genera una retrospectiva de la sesión (usa la sesión actual si se omite `session_id`).

```
kevin_retrospective({ session_id: "sess-abc" })
// → { "file_path": ".kevin/retrospectives/sess-abc.md" }
// o → { "message": "No hubo fallos en la sesión sess-abc." }
```

---

## Hooks

Kevin se suscribe a 6 hooks de OpenCode:

| Hook | Qué hace Kevin |
|---|---|
| `tool.execute.before` | Registra el inicio del tool call (callID + args redacted) |
| `tool.execute.after` | Registra resultado; si fallo → Reflector.invoke asíncrono (throttled) |
| `experimental.chat.system.transform` | Inyecta lecciones relevantes en `<kevin-context>` (1500 tokens) |
| `experimental.session.compacting` | Reinyecta lecciones en `<kevin-memory>` tras compactar (2000 tokens) |
| `event` (`session.created`) | Captura el `sessionID` actual |
| `event` (`session.idle`) | Genera retrospective.md de la sesión |

**Redacción**: paths absolutos (`C:\Users\...`, `/home/...`) → `<path>` y secrets (`API_KEY=`, `Bearer`, `token`) → `<redacted>` antes de persistir nada.

**Throttle**: Reflector genera máximo 1 lección por minuto (configurable vía `throttleMs`).

**Truncado**: contenidos > 4KB se truncan y marcan `not_searchable` (no aparecen en queries, pero sí por `getById`).

---

## Configuración

Kevin acepta opciones vía el segundo argumento del plugin (avanzado):

```ts
import { KevinPlugin } from "kevin";

// defaults
KevinPlugin(input, {
  dbPath: ".kevin/kevin.db",     // o ":memory:" para tests
  migrationsDir: "./migrations",
  retrospectivesDir: ".kevin/retrospectives",
  throttleMs: 60_000,
});
```

---

## Desarrollo

```bash
git clone <repo> && cd kevin
npm install
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e)
npm run verify      # verificación post-install
```

### Estructura

```
plugin/
  index.ts              # Entry point: KevinPlugin
  Store.ts              # Wrapper better-sqlite3 (WAL, FK, transactions)
  Migrate.ts            # Migraciones idempotentes
  MemoryService.ts      # save/query/getRelevant (FTS5 + bm25)
  ToolCallObserver.ts   # onBefore/onAfter + redact + inferErrorType
  Reflector.ts          # Lecciones heurísticas + throttle + truncado
  ContextInjector.ts    # deriveQuery + inyección pre-prompt/compacting
  Retrospective.ts      # Genera retrospective.md + insert en tabla
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

## Licencia

MIT

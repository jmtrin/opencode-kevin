# Kevin — Plan de Implementación v0.1.0

**Versión:** 0.1.0
**Fecha:** 2026-06-30
**Estado:** Congelado (Fase 1 iniciada — 2026-07-01)
**Paradigma:** Observa y aprende
**Tipo:** Documento de diseño + plan de implementación

---

## 1. Resumen ejecutivo

Kevin es un plugin de OpenCode que **observa** lo que el agente hace, **aprende** de sus errores, y **comparte** proactivamente lo aprendido en futuras sesiones. No compite con el ecosistema de plugins de OpenCode; se instala encima y aporta la única capa que nadie más da: aprendizaje de errores.

| Dimensión | Valor |
|---|---|
| Paradigma | Observa y aprende |
| Versión | 0.1.0 |
| Plugins | 1 (`kevin`) |
| Archivos fuente | ~10 |
| Tareas para v0.1.0 | 45 |
| Duración estimada | 5-6 semanas (~120h) |
| Almacenamiento | SQLite local (`.kevin/kevin.db`) |
 Dependencias externas | better-sqlite3, @opencode-ai/plugin, zod |

**Criterio de salida**: tras un fallo de typecheck, Kevin genera automáticamente una lección persistida; en la siguiente sesión, esa lección se inyecta en el system prompt antes de que el agente actúe, sin que el usuario la pida.

---

## 2. Filosofía — "Observa y aprende"

### 2.1 Tesis

> Kevin es la capa de aprendizaje que OpenCode no tiene. Observa cada tool call, reflexiona sobre los fallos generando lecciones, y las inyecta proactivamente en futuras ejecuciones. No planifica, no orquesta, no compite con el ecosistema. Solo aprende.

### 2.2 El ciclo core

```
    ┌──────────┐
    │ OBSERVA  │ tool.execute.before/after → registra en tool_calls
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ APRENDE  │ si fallo → Reflector genera memoria type:error
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ COMPARTE │ system.transform → inyecta lección antes del próximo prompt
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ OBSERVA  │ (próxima sesión, ciclo se repite con contexto aprendido)
    └──────────┘
```

### 2.3 Principios

| # | Principio | Implicación |
|---|---|---|
| 1 | Observar, no orquestar | Kevin nunca invoca tools del agente; solo observa |
| 2 | Aprender es el diferenciador | Toda funcionalidad responde a: "¿esto ayuda a aprender?" |
| 3 | Local-first | Todo en SQLite local. Sin cloud, sin servicios externos |
| 4 | Proactivo sobre reactivo | Kevin inyecta lecciones antes de que el agente las pida |
| 5 | Delegar al ecosistema | Workflow, async, scheduling, observabilidad → plugins comunitarios |
| 6 | Plan-as-graph compatible | Kevin no planifica; aprende de cualquier planificador |

### 2.4 Lo que Kevin 0.1.0 NO hace

| Función | Razón | Alternativa |
|---|---|---|
| Loop engine / workflow | Ecosistema lo hace mejor | `opencode-conductor` |
| Background / async | Ecosistema lo hace mejor | `opencode-background-agents` |
| Cron scheduling | Ecosistema lo hace mejor | `opencode-scheduler` |
| Skill discovery | OpenCode host nativo | Agent Skills (`/docs/skills`) |
| Observabilidad remota | Ecosistema lo hace mejor | `opencode-sentry-monitor` |
| Context pruning | Ecosistema lo hace mejor | `opencode-dynamic-context-pruning` |
| Embeddings / búsqueda semántica | Complejidad ABI; deferred a v0.2 | FTS5 con `remove_diacritics` |
| Pattern mining | Deferred a v0.2 | — |
| Prompt mutation | Deferred a v0.3 | — |
| Cross-project memory | Deferred a v0.3 | — |

---

## 3. Arquitectura

### 3.1 Visión general

```
┌──────────────────────────────────────────────────────────────┐
│                    USUARIO / LLM                              │
│              (OpenCode TUI / Desktop / IDE)                  │
├──────────────────────────────────────────────────────────────┤
│                   OPENCODE HOST                               │
│  Skills nativas · Agents (build, plan, general, explore)     │
│  task tool · permissions · MCP · LSP · compaction            │
├──────────────────────────────────────────────────────────────┤
│              KEVIN 0.1.0 — Observa y aprende                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  plugin/index.ts (entry point)                       │   │
│  │  ├── Store.ts           SQLite connection            │   │
│  │  ├── Migrate.ts         Migration runner             │   │
│  │  ├── MemoryService.ts   CRUD + FTS5 search           │   │
│  │  ├── ToolCallObserver.ts  Registra tool calls        │   │
│  │  ├── Reflector.ts         Heuristic + LLM reflection │   │
│  │  ├── ContextInjector.ts   Inyecta lecciones pre-prompt│   │
│  │  └── Retrospective.ts     Resumen de sesión          │   │
│  └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│              ALMACENAMIENTO LOCAL                             │
│  .kevin/                                                     │
│  ├── kevin.db (SQLite + FTS5)                                │
│  ├── retrospectives/ (markdown por sesión)                   │
│  └── version                                                  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Estructura de archivos

```
kevin/
├── package.json
├── tsconfig.json
├── opencode.json
├── AGENTS.md
├── README.md
├── plugin/
│   ├── index.ts              # Entry point: registra tools + hooks
│   ├── Store.ts              # Conexión SQLite + helpers
│   ├── Migrate.ts            # Runner de migraciones
│   ├── uuid.ts               # UUID v7 generator
│   ├── MemoryService.ts      # CRUD memories + FTS5 search
│   ├── ToolCallObserver.ts   # Hook tool.execute.* → registra tool_calls
│   ├── Reflector.ts          # Heuristic + optional LLM reflection
│   ├── ContextInjector.ts    # Hook system.transform + compacting
│   └── Retrospective.ts      # Hook session.idle → genera retrospective.md
├── migrations/
│   └── 001_initial.sql       # Schema: memories, memories_fts, tool_calls, retrospectives
├── scripts/
│   └── verify-install.ts     # Verificación post-install
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
    ├── Kevin_Plan.md         # Este documento
    └── Kevin_Task.md         # Lista de tareas
```

### 3.3 Ecosistema recomendado (opcional, Kevin funciona sin ellos)

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-conductor",              // Workflow: Context → Spec → Plan → Implement
    "opencode-background-agents",      // Async delegation
    "opencode-scheduler",              // Cron jobs
    "opencode-dynamic-context-pruning",// Context pruning
    "kevin"                            // Capa de aprendizaje
  ]
}
```

Kevin 0.1.0 funciona **standalone** sin ningún otro plugin. Con los plugins del ecosistema, Kevin observa más contexto y aprende más rico, pero no depende de ellos.

---

## 4. Schema SQLite — `migrations/001_initial.sql`

```sql
-- ============================================================
-- Kevin 0.1.0 — Schema inicial
-- ============================================================

-- Tabla de versiones para migraciones
CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- memories: lecciones aprendidas
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

-- FTS5: búsqueda full-text con remoción de diacríticos (mejor para español)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  tokenize='unicode61 remove_diacritics 1'
);

-- Triggers para mantener FTS5 sincronizado
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
-- tool_calls: observación de tool calls del agente
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
-- retrospectives: resúmenes de sesión
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
-- Seed: versión inicial
-- ============================================================
INSERT OR IGNORE INTO schema_version (version) VALUES ('001');
```

---

## 5. Componentes — especificación detallada

### 5.1 `Store.ts` — Conexión SQLite

**Responsabilidad**: Abre conexión better-sqlite3, expone prepared statements, maneja transacciones.

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

**Métodos clave**:
- `constructor({ path })` — abre DB, WAL mode, foreign keys ON
- `prepare(sql)` — prepared statement
- `transaction(fn)` — wrapper transaccional
- `close()` — cierra conexión

### 5.2 `Migrate.ts` — Runner de migraciones

**Responsabilidad**: Lee `schema_version`, aplica migraciones pendientes desde `migrations/`, actualiza versión.

```typescript
export class Migrate {
  constructor(private store: Store, private migrationsDir: string) {}

  async run(): Promise<{ from: string; to: string; applied: string[] }> {
    // 1. Crear schema_version si no existe
    // 2. Leer versión actual
    // 3. Listar migraciones .sql en migrationsDir ordenadas
    // 4. Aplicar pendientes en transacción
    // 5. Retornar resultado
  }
}
```

**Comportamiento**:
- Idempotente: si todas aplicadas, no hace nada
- Transaccional: si una migración falla, rollback completo
- Lee archivos `.sql` del directorio `migrations/`

### 5.3 `uuid.ts` — Generador UUID v7

**Responsabilidad**: Genera IDs ordenables temporalmente (UUID v7).

```typescript
export function uuidv7(): string {
  // Timestamp (48 bits) + random (12 bits version + 62 bits random)
  // Formato: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
}
```

### 5.4 `MemoryService.ts` — CRUD + FTS5

**Responsabilidad**: Guarda, busca, actualiza y elimina memorias. Búsqueda FTS5 con `bm25` ranking.

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

**Tipo `Memory`**:
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

**Búsqueda FTS5**:
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

**`getRelevant`**: estrategia greedy con token budget. Filtra expiradas, ordena por `relevance_score` DESC + `created_at` DESC, fill respetando `maxTokens * 4` chars.

### 5.5 `ToolCallObserver.ts` — Observación

**Responsabilidad**: Hook `tool.execute.before/after`. Registra cada tool call en `tool_calls` table.

```typescript
export class ToolCallObserver {
  constructor(private store: Store) {}

  onBefore(input: ToolExecuteInput, output: ToolExecuteOutput): void {
    // Registrar intención (ts inicial)
  }

  onAfter(input: ToolExecuteInput, output: ToolExecuteOutput): void {
    // Registrar resultado: tool, args_summary (redacted), success, duration_ms, agent
    // Inferir error_type si success=0
  }

  private redactSecrets(text: string): string {
    // Patrones: API_KEY=*, SECRET=*, PASSWORD=*, token *, bearer *
    // Reemplazar por <redacted>
  }

  private summarizeArgs(args: Record<string, unknown>): string {
    // Resumen legible: paths, comandos, sin secrets
  }

  private inferErrorType(stderr: string, stdout: string): string | null {
    // typecheck: "error TS" | "tsc" | "TypeScript"
    // lint: "lint" | "biome" | "eslint"
    // test: "test" | "vitest" | "jest" | "FAIL"
    // runtime: "Error:" | "TypeError" | "ReferenceError"
    // timeout: exitCode -1 && stderr vacío
    // unknown: default
  }
}
```

**Registro en `tool_calls`**:
```sql
INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata)
VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?);
```

### 5.6 `Reflector.ts` — Reflexión sobre fallos

**Responsabilidad**: Tras un tool call fallido, genera una memoria `type: error` con la lección aprendida.

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
    // 1. Redact paths y secrets del output
    // 2. Generar lección heurística
    // 3. Si content > 4KB, truncar + metadata.not_searchable = true
    // 4. Persistir como memoria type: error
    // 5. Retornar memory_id o null si no aplica
  }

  private generateHeuristicLesson(input: ReflectionInput): string {
    // Template: "When {tool} fails with {errorType}: {firstErrorLine}\nSuggestion: {suggestion}"
    // Suggestions por errorType:
    //   typecheck → "Verify types and imports before running."
    //   lint → "Run linter and fix warnings before committing."
    //   test → "Run tests and fix failures before proceeding."
    //   runtime → "Check error message and stack trace for root cause."
    //   timeout → "Check for infinite loops or long-running operations."
    //   unknown → "Review the error output for details."
  }

  private redactPaths(text: string): string {
    // Reemplazar paths absolutos por <path>
    // Windows: C:\... → <path>
    // Unix: /home/... → <path>
  }

  private redactSecrets(text: string): string {
    // API_KEY=*, SECRET=*, PASSWORD=*, token*, bearer*
  }
}
```

**Throttle**: máximo 1 reflection por minuto (configurable). Si ya se reflexionó en el último minuto, skip.

**Fallback**: si no hay sub-agent disponible, siempre genera lección heurística. La lección heurística es funcional sin API costs.

### 5.7 `ContextInjector.ts` — Inyección proactiva

**Responsabilidad**: Inyecta lecciones aprendidas en el system prompt antes de cada mensaje del usuario, y al compactar.

```typescript
export class ContextInjector {
  constructor(private memoryService: MemoryService) {}

  onSystemTransform(input: SystemTransformInput, output: SystemTransformOutput): void {
    // 1. Derivar query del último mensaje del usuario
    // 2. Buscar memorias relevantes (priorizar type: error y type: pattern)
    // 3. Presupuesto: 1500 tokens (~6000 chars)
    // 4. Formatear como <kevin-context>Lecciones relevantes:\n...</kevin-context>
    // 5. Añadir a output (system prompt)
  }

  onCompacting(input: CompactingInput, output: CompactingOutput): void {
    // 1. Derivar query del contexto de la sesión
    // 2. Buscar memorias relevantes (todos los tipos)
    // 3. Presupuesto: 2000 tokens (~8000 chars)
    // 4. Formatear como <kevin-memory>\n...</kevin-memory>
    // 5. Añadir a output.context
  }

  private deriveQuery(messages: Message[]): string {
    // Extraer keywords del último mensaje del usuario
    // Stop words básicas (en inglés y español)
  }

  private formatMemories(memories: Memory[], format: 'context' | 'memory'): string {
    // context: <kevin-context>Lecciones relevantes:\n[type] content\n...</kevin-context>
    // memory: <kevin-memory>\n[type] content\n...</kevin-memory>
  }
}
```

**Comportamiento clave**:
- Si no hay memorias relevantes, no añade nada (no contaminar el prompt)
- Prioriza `type: error` y `type: pattern` sobre `decision` y `context`
- Respeta el presupuesto de tokens
- Filtra memorias expiradas (scope session)

### 5.8 `Retrospective.ts` — Resumen de sesión

**Responsabilidad**: Tras `session.idle`, si hubo fallos, genera un archivo markdown con el resumen.

```typescript
export class Retrospective {
  constructor(private store: Store, private memoryService: MemoryService) {}

  async generate(sessionId: string): Promise<string | null> {
    // 1. Contar tool_calls success/failure de la sesión
    // 2. Si no hubo fallos, retornar null (no generar retrospective)
    // 3. Listar tools que fallaron con error_type
    // 4. Listar lecciones generadas (memories type:error con source_session = sessionId)
    // 5. Generar markdown:
    //    # Retrospective — Session {sessionId}
    //    ## Resumen
    //    - Tool calls: {total} ({success} ok, {failure} failed)
    //    ## Tools que fallaron
    //    - {tool} ({error_type}): {args_summary}
    //    ## Lecciones generadas
    //    - {content}
    // 6. Guardar en .kevin/retrospectives/{sessionId}.md
    // 7. Insertar en retrospectives table
    // 8. Retornar file_path
  }
}
```

---

## 6. Plugin entry point — `plugin/index.ts`

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
  // 1. Inicializar Store
  const dbPath = `${ctx.directory}/.kevin/kevin.db`;
  const store = new Store({ path: dbPath });

  // 2. Migrar
  const migrate = new Migrate(store, `${ctx.directory}/migrations`);
  await migrate.run();

  // 3. Inicializar componentes
  const memoryService = new MemoryService(store);
  const observer = new ToolCallObserver(store);
  const reflector = new Reflector(memoryService);
  const injector = new ContextInjector(memoryService);
  const retrospective = new Retrospective(store, memoryService);

  // 4. Estado de sesión
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
          // Contar memories, tool_calls, retrospectives
          // Retornar resumen JSON
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

      // Si fallo, disparar reflection asíncrono (throttled)
      if (output.success === false) {
        const now = Date.now();
        if (now - lastReflectionTs > 60_000) { // throttle 1/min
          lastReflectionTs = now;
          // No await: asíncrono, no bloquea el hook
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

## 7. Tools expuestas — resumen

| Tool | Descripción | Args |
|---|---|---|
| `kevin_save` | Guarda una memoria | `type`, `content`, `scope?` |
| `kevin_query` | Busca memorias por texto (FTS5) | `query`, `type?`, `limit?` |
| `kevin_recall` | Recupera memorias relevantes | `query?`, `limit?` |
| `kevin_status` | Estado de aprendizaje | — |
| `kevin_retrospective` | Genera/ve retrospectiva | `session_id?` |

---

## 8. Hooks suscritos — resumen

| Hook | Componente | Comportamiento |
|---|---|---|
| `tool.execute.before` | `ToolCallObserver` | Registra ts inicial de tool call |
| `tool.execute.after` | `ToolCallObserver` + `Reflector` | Registra resultado; si fallo, dispara reflection asíncrono (throttled 1/min) |
| `experimental.chat.system.transform` | `ContextInjector` | Inyecta lecciones relevantes pre-prompt (1500 tokens budget) |
| `experimental.session.compacting` | `ContextInjector` | Inyecta memorias relevantes al compactar (2000 tokens budget) |
| `session.created` | Plugin | Captura `sessionID` actual |
| `session.idle` | `Retrospective` | Genera retrospective.md si hubo fallos |

---

## 9. Configuración — archivos base

### 9.1 `package.json`

```json
{
  "name": "kevin",
  "version": "0.1.0",
  "description": "Kevin — Observa y aprende: capa de aprendizaje para OpenCode",
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

### 9.3 `opencode.json` (desarrollo)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./plugin/index.ts"]
}
```

### 9.4 `AGENTS.md` (esqueleto)

```markdown
# Kevin — AGENTS.md

## Comandos
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — Biome check
- `npm test` — Vitest (all tests)
- `npm run verify` — Post-install verification

## Arquitectura
Kevin es 1 plugin con 7 componentes: Store, Migrate, MemoryService,
ToolCallObserver, Reflector, ContextInjector, Retrospective.

## Convenciones
- TypeScript strict, ESM modules
- SQLite via better-sqlite3
- Tests con vitest (unit, integration, e2e)
- Lint con Biome
```

---

## 10. Testing strategy

### 10.1 Niveles

| Nivel | Cobertura | Tool | Cuándo |
|---|---|---|---|
| Unit | ≥90% funciones puras | vitest | Cada fase |
| Integration | ≥80% interacciones componente-componente | vitest + SQLite `:memory:` | Cada fase |
| E2E | Flujos completos | vitest + SQLite temporal | Fin de proyecto |

### 10.2 Tests críticos

| Test | Descripción |
|---|---|
| `store.test.ts` | Store abre, prepara, transacciona, cierra |
| `migrate.test.ts` | Migración 001 aplica sin error, idempotente |
| `memory-service.test.ts` | CRUD + FTS5 search + expiración session scope |
| `tool-call-observer.test.ts` | Registra tool calls, redact secrets, infiere error_type |
| `reflector.test.ts` | Heuristic lesson generation, redact paths/secrets, throttle |
| `context-injector.test.ts` | Inyecta lecciones, respeta budget, no contamina si vacío |
| `retrospective.test.ts` | Genera markdown, no genera si no fallos |
| `reflection-loop.test.ts` (e2e) | Fallo typecheck → memoria error → recall la retorna |
| `context-injection.test.ts` (e2e) | Memoria error → próxima sesión inyecta lección pre-prompt |
| `retrospective.test.ts` (e2e) | Sesión con fallos → retrospective.md existe |

### 10.3 Verificación continua

```bash
npm run typecheck && npm run lint && npm test
npm run verify
```

---

## 11. Decisiones

| # | Decisión | Resolución | Justificación |
|---|---|---|---|
| D1 | 1 plugin o múltiples | **1 plugin** | v0.1.0 simplicidad; split en v0.2 si crece |
| D2 | Memoria: FTS5 o embeddings | **FTS5** con `remove_diacritics 1` | Sin riesgo ABI sqlite-vec; embeddings en v0.2 |
| D3 | Reflection: LLM o heurístico | **Heurístico siempre**, LLM opcional | Funciona sin API costs; LLM enriquece si disponible |
| D4 | Scope: project, session, o global | **project + session** | Global/cross-project en v0.3 |
| D5 | Storage location | `.kevin/kevin.db` (project-level) | Local-first; sin global en v0.1.0 |
| D6 | Throttle reflection | 1/min máximo | Evitar costos si LLM disponible |
| D7 | Token budget injection | 1500 tokens pre-prompt, 2000 compacting | No contaminar contexto |
| D8 | Retrospective trigger | `session.idle` solo si hubo fallos | No generar ruido si sesión OK |
| D9 | FTS5 tokenizer | `unicode61 remove_diacritics 1` | Mejor para español que `unicode61` solo |
| D10 | Version target | **0.1.0** | Fresh start, semver honesto |

---

## 12. Fases del plan

| Fase | Duración | Tasks | Descripción |
|---|---|---|---|
| F1 — Foundation | 1 sem | K-001 a K-007 | Project setup, Store, Migrate, schema, uuid |
| F2 — Memory | 1 sem | K-008 a K-014 | MemoryService CRUD + FTS5 + session scope |
| F3 — Observation | 1 sem | K-015 a K-020 | ToolCallObserver + hooks + redaction |
| F4 — Reflection | 1 sem | K-021 a K-028 | Reflector heurístico + hook fallos + throttle |
| F5 — Injection + Retrospective | 1 sem | K-029 to K-036 | ContextInjector + Retrospective + hooks |
| F6 — Plugin + Release | 0.5-1 sem | K-037 to K-045 | Entry point, tools, e2e, verify, tag v0.1.0 |

**Total: ~5-6 semanas, ~120h, 45 tareas**

**Ruta crítica**:
```
K-001 → K-003 → K-005 → K-008 → K-010 → K-015 → K-017
    → K-021 → K-024 → K-029 → K-033 → K-037 → K-041 → K-045
```

---

## 13. Versioning

**Kevin v0.1.0** — primer release público.

```markdown
## [0.1.0] - 2026-XX-XX

### Added
- Plugin `kevin` con paradigma "Observa y aprende"
- Memoria local-first SQLite + FTS5 (unicode61 remove_diacritics)
- ToolCallObserver: registra tool calls via hooks
- Reflector: genera lecciones heurísticas tras fallos
- ContextInjector: inyecta lecciones pre-prompt y al compactar
- Retrospective: genera resumen de sesión tras session.idle
- Tools: kevin_save, kevin_query, kevin_recall, kevin_status, kevin_retrospective
- Hooks: tool.execute.before/after, system.transform, session.compacting, session.idle
- Stack recomendado: conductor, background-agents, scheduler, DCP (opcionales)
```

---

## 14. Roadmap futuro (post-v0.1.0)

| Versión | Feature | Descripción |
|---|---|---|
| v0.2 | Embeddings + hybrid retrieval | sqlite-vec + BGE-M3 ONNX; BM25 + cosine + RRF |
| v0.2 | Pattern mining | PatternMiner: secuencias de tool calls |
| v0.3 | Prompt mutation HITL | Sugerencias de mutación de SKILL.md con human-in-the-loop |
| v0.3 | Cross-project memory | Preferencias del usuario con consentimiento |
| v0.4 | Skill quality index | Pass-rate, error types, drift detection por skill |
| v0.4 | LLM reflection enriquecida | Sub-agent barato para reflection más rica |
| v0.5 | Ecosystem deep integration | Conductor tracks, sentry events, background results |

---

## 15. Referencias

- https://opencode.ai/docs — OpenCode docs (intro, install, usage)
- https://opencode.ai/docs/plugins — Plugin API, hooks, events
- https://opencode.ai/docs/skills — Agent Skills nativo
- https://opencode.ai/docs/agents — Primary/subagents, task tool
- https://opencode.ai/docs/custom-tools — tool() helper, Zod schemas
- https://opencode.ai/docs/ecosystem — Plugins comunitarios
- https://github.com/WiseLibs/better-sqlite3 — SQLite para Node.js
- https://github.com/sqlite/sqlite/blob/master/ext/fts5/doc/fts5.md — FTS5 docs

**Documento siguiente**: `Kevin_Task.md` — lista exhaustiva de tareas K-001..K-045.

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
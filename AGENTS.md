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
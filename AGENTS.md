# Kevin — AGENTS.md

## Commands
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — Biome check
- `npm test` — Vitest (all tests)
- `npm run verify` — Post-install verification
- `npm run replay` — Replay report over tests/replay/fixtures (v0.5.0)

## Architecture
Kevin is 1 plugin with 9 components: Store, Migrate, MemoryService,
ToolCallObserver, Reflector, ContextInjector, Retrospective, Feedback,
Archiver.

## Conventions
- TypeScript strict, ESM modules
- SQLite via better-sqlite3
- Tests with vitest (unit, integration, e2e)
- Lint with Biome
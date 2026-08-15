# Kevin — AGENTS.md

## Commands
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — Biome check
- `npm test` — Vitest (all tests)
- `npm run verify` — Post-install verification
- `npm run replay` — Replay report over tests/replay/fixtures (v0.5.0)

## Architecture
Kevin is 1 plugin with 38 modules (`plugin/*.ts`), built around 9 core
components — Store, Migrate, MemoryService, ToolCallObserver, Reflector,
ContextInjector, Retrospective, Feedback, Archiver — plus the v0.3–v0.6
components: CausalChain, QualityGate, InjectionLedger, LessonFixer,
PatternMiner, Curator, ArtifactWriter, Materializer, kevin_why,
kevin_propose/kevin_approve/kevin_audit/kevin_publish, and the pure helpers
(confidence, diff, fingerprint, inferability, query-tokenizer, memory-format,
redact, uuid, replay, sqlite-adapter, capabilities).

## Conventions
- TypeScript strict, ESM modules
- SQLite via better-sqlite3
- Tests with vitest (unit, integration, e2e)
- Lint with Biome
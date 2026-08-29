# Kevin — AGENTS.md

## Commands
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — Biome check
- `npm test` — Vitest (all tests)
- `npm run verify` — Post-install verification
- `npm run replay` — Replay report over tests/replay/fixtures (v0.5.0)

## Architecture
Kevin is a monorepo with 3 packages (`packages/core` @jmtrin/kevin-core ~60
modules, zero deps; `packages/plugin` @jmtrin/opencode-kevin 4 modules —
`index`, `host`, `native`, `capabilities` — adapter thin; `packages/tui`
@jmtrin/opencode-kevin-tui isolated), built around 9 core components — Store,
Migrate, MemoryService, ToolCallObserver, Reflector, ContextInjector,
Retrospective, Feedback, Archiver — plus the v0.3–v0.6 components: CausalChain,
QualityGate, InjectionLedger, LessonFixer, PatternMiner, ConventionMiner,
ConflictDetector, Curator, ArtifactWriter, Materializer, kevin_why,
kevin_propose/kevin_approve/kevin_audit/kevin_publish, the v0.8 team components
— RepoIdentity (repo_id: declared → remote → path), SharedLayer (OKF v2
plan/apply/tombstone/import), okf (parse/serialize/merge, entry_id),
kevin_project/kevin_share/kevin_sync/kevin_forget — plus the v1.3.0 Bedrock
additions: `KevinEnv`/`resolveEnv` (`packages/core/src/env.ts`, sole
`process.cwd`/`homedir` site), `exportMigrationsDir` (`Migrate.ts`),
`idle-pipeline` (`composeIdlePipeline` / `IDLE_STEP_ORDER`, single source consumed
by adapter idle + replay), `replay` (now core-native, parity harness
`packages/plugin/tests/parity.test.ts`), and the pure helpers (confidence, diff,
fingerprint, inferability, query-tokenizer, memory-format, redact, uuid, replay,
sqlite-adapter, capabilities, columns, time-ms, bench-compare). C-10 preview is the
explicit export list at `packages/core/src/index.ts` (keep minimal).

## Conventions
- TypeScript strict, ESM modules
- SQLite via `node:sqlite` (Node 22.5+; `bun:sqlite` on Bun; `better-sqlite3`
  is an optional fallback for older runtimes)
- Tests with vitest (unit, integration, e2e)
- Lint with Biome
- Hot path (tool.execute.*, chat.message, system.transform, compacting):
  no LLM, no network, no filesystem scans
- `kevin_settings.value` is TEXT — compare with `=== "1"`, never truthiness
- Shared layer: every read/write of shared_entries/okf_imports filters on
  repo_id; exactly one `.apply(` site (ArtifactWriter, D8-08/D6-01); the
  OKF file is written only through the write funnel, never committed by Kevin
- Session identity (BUG-001/002/003): identity resolves ONCE at init;
  `kevin_project rekey` (confirmed) is the only mover — it rebuilds the
  SharedLayer bridge, MemoryService and Curator on the live id and heals the
  OKF `#repo` header (SharedLayer.healHeader). Tools report `sessionIdentity`,
  never a fresh per-call resolve; `kevin_project show/init` are the exception
  (file introspection is per-call on purpose).

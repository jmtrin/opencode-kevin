# Changelog — @jmtrin/kevin-core

All notable changes to the hostless core are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + SemVer.

## [1.5.0] - 2026-08-29

> Diaspora — canonical skills + mirrors + MIF codec + host import; 39 settings, 64 metrics, schema 014, `KEVIN_VERSION 1.5.0`.

## [1.3.0] - 2026-08-29

> Initial published core. Extracted from `@jmtrin/opencode-kevin` via `git mv` (Bedrock, K13-001…K13-018) — **REORGANIZATION-ONLY**. Zero dependencies, no behavior diff vs 1.2.0 (26/32/56, migrations 012, empty diffs in K13-016).

### Added

- **~60 domain modules** (`packages/core/src/*`) — Store, Migrate, MemoryService, ToolCallObserver, Reflector, ContextInjector, Retrospective, Feedback, Archiver, CausalChain, QualityGate, InjectionLedger, LessonFixer, PatternMiner, ConventionMiner, ConflictDetector, Curator, ArtifactWriter, Materializer, kevin_*, okf*, RepoIdentity, RepoTruth, SharedLayer, HookLiveness, Perf, Metrics, confidence/diff/fingerprint/inferability/query-tokenizer/memory-format/redact/uuid/replay/sqlite-adapter/columns/time-ms/bench-compare, plus helpers.
- **`KevinEnv {projectRoot,dataRoot}` + `resolveEnv(partial?)`** (`src/env.ts`, D13-03) — sole `process.cwd()`/`homedir()` site; injected by hosts/tests.
- **`exportMigrationsDir(): string`** (`src/Migrate.ts`, D13-04) — locates `dist/migrations` or `../migrations`.
- **`idle-pipeline` single source** (`src/idle-pipeline.ts`): `IDLE_STEP_ORDER` + `composeIdlePipeline(deps)`.
- **`replay` core-native** (`src/replay.ts`): `replay(transcript,{dbPath,env})` + alias `runReplaySession`.
- **`contract.ts` scanRoots plumbing** (`scanRoots?` + `resolveScanRoots(env?)`, D13-05) — values unchanged.
- **Purity scans** (`tests/core_purity_scan.test.ts`, `tests/no_host_dep.test.ts`).

### Changed

- Migrations live at `packages/core/migrations` and ship as `dist/migrations` (built via `scripts/copy-migrations.mjs`).

### Fixed

- Purity: `contract.ts:resolveScanRoots` → `resolveEnv(env).projectRoot`.
- Publishing: `package.json` `name @jmtrin/kevin-core`, `version 1.3.0`, `main dist/index.js`, `types dist/index.d.ts`, `exports["."]` types-first, `files ["dist"]`, `engines node >=22.5.0`, deps NONE.

### Verification

- `npm run typecheck -w @jmtrin/kevin-core` + `npm run verify:pack` core checks C1–C9 green + absence-run green.
- C-10 preview at `packages/core/src/index.ts`.

---

_Derived from `@jmtrin/opencode-kevin` 1.2.0 → 1.3.0 (see root `CHANGELOG.md`). Core 1.3.0 pins are exact by D13-06; plugin installs it as `dependencies: {"@jmtrin/kevin-core":"1.3.0"}`._

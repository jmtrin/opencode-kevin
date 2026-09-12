# Changelog — @jmtrin/kevin-core

All notable changes to the hostless core are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + SemVer.

## [2.2.1] - 2026-09-12

> Docs sync — README badges/sections refreshed; no behavior change (code identical to 2.2.0 except `KEVIN_VERSION`).

## [2.2.0] - 2026-09-11

> Harbor — MCP trio seeds + single-source config keys.

- Migration `016_v22_harbor.sql`: seeds `mcp_write_enabled` (`'0'`), `mcp_approve_enabled` (`'0'`), `mcp_repo_override` (`''`) via `INSERT OR IGNORE`; fresh `kevin_config list` = 44 keys. No columns, no metrics.
- `KEVIN_CONFIG_KEYS` + `ERROR_LESSON_MODE_VALUES` single-sourced here; the plugin `./config` subpath re-exports them.
- Contract C-07 `015→016` (golden single-hunk regen).

## [2.1.0] - 2026-08-30

> Relay — deletion sync + native probe + gate re-evaluated.

- Source deletion sync: `collectDeletions` + `IdleSync` fingerprint diff per source, gated `source_deletion_sync='0'` opt-in; archive + OKF tombstone + `source_deletions_total` (since 2.1.0), cross-source safe, idempotent.
- Opencode-native probe: single const `NATIVE_CANDIDATE_PATHS`, absent-safe (`health:absent`, never throws).
- Migration `015_v21_relay.sql`: `memories.source TEXT` + `idx_memories_source`, seeds `source_deletions_total` + `source_deletion_sync`, schema `014→015`.
- Adoption gate FAIL (ratio 0.287 < 0.50) — zero `cc-adapter` code, C-14 stays 4 sources.

## [2.0.0] - 2026-08-30

> Commonwealth — contract v2, OKF v3 sharding, MemorySources.

- Contract v2 (C-10..C-14); `contract_version` 1 → 2 with verbatim succession.
- OKF v3 sharded writer/reader (`okf_write_version`, default `'3'`, `'2'` rollback byte-exact).
- MemorySources framework (precedence, fingerprint dedup, `source_pair` conflicts, `kevin_sources` show-only) + `kevin_trace`/`kevin_audit` provenance.
- Migration `014_v2_commonwealth.sql`: `memory_sources` table + `memories.source` + backfill + 3 metric seeds; `import_host_memory` retired with one-shot translation to sources.

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

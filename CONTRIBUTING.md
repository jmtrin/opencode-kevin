# Contributing — Kevin (Bedrock monorepo)

## Layout

```
opencode-kevin-monorepo/          private root, workspaces: ["packages/*"]
├─ packages/core                  @jmtrin/kevin-core — zero deps, ~60 modules, migrations/ 001→012
│  ├─ src/                        all domain modules (Store, Migrate, MemoryService, Reflector, … replay, idle-pipeline, env)
│  ├─ migrations/                 SQL source (also shipped as dist/migrations)
│  └─ dist/                       built core + dist/migrations (copy-migrations.mjs)
├─ packages/plugin                @jmtrin/opencode-kevin — 4 modules only (index, host, native, capabilities)
│  └─ dist/plugin/                built adapter (tui lives in its own package)
├─ packages/tui                   @jmtrin/opencode-kevin-tui — isolated TUI panel, own package.json/exports
├─ scripts/                       bench, gen-corpus, verify-pack (dual), verify-install
├─ tests/                         unit · integration · e2e · replay fixtures (run at root)
├─ bench/                         committed corpus + committed results
└─ docs/                          CONTRACT.md, per-release plans/tasks, roadmap v2
```

Name `packages/plugin` is frozen by C-06; `exports["./tui"]` keeps the specifier stable (points to `@jmtrin/opencode-kevin-tui/dist/index.js`).

## Commands (run at root unless noted)

```bash
npm install                        # hoists workspaces, links packages/*

# Build / typecheck
npm run build                      # core → tui → plugin (core also copies dist/migrations)
npm run typecheck                  # delegates: -w core -w tui -w plugin + root
npm run typecheck -w @jmtrin/kevin-core   # single package

# Lint / format
npm run lint
npm run format

# Tests
npm test                           # all — vitest at root
npm run test:unit
npm run test:integration
npm run test:e2e
npm test -w @jmtrin/kevin-core     # core suite only
npx vitest run packages/core/tests/core_purity_scan.test.ts
npx vitest run packages/core/tests/no_host_dep.test.ts
npx vitest run tests/unit/tui_isolation.test.ts
npx vitest run packages/plugin/tests/parity.test.ts   # Bedrock parity harness (K13-011)

# Replays / benchmarks
npm run replay
npm run bench
npm run bench:check

# Packaging proofs
npm run verify                     # verify-install + verify:pack (dual + consumer smoke)
npm run verify:pack                # packs core+plugin(+tui sidecar) and runs consumer offline install
```

## Workspace rules

- **Import rule** — adapter `packages/plugin/src/*.ts` imports domain symbols ONLY from `@jmtrin/kevin-core` (the public entry). No deep imports into `packages/core/src/*`. Extend `packages/core/src/index.ts` explicitly when a new symbol is needed — that list IS the future C-10 surface, keep it minimal and deliberate.
- **Move mechanics** — use `git mv` so history follows files. After each phase run `npm run typecheck && npm test`. Commit per task, never bundle phases.
- **Core isolation** — `packages/core` has ZERO dependencies (not even `@opencode-ai/plugin` types). Scans enforce it: `core_purity_scan` (no `process.cwd`/`homedir`/`node:os` outside `env.ts`) and `no_host_dep` (no `@opencode-ai/plugin` import + absence-run with renamed `node_modules/@opencode-ai`).
- **Migrations** — live in `packages/core/migrations` and ship as `dist/migrations` via `packages/core/scripts/copy-migrations.mjs`. Use `exportMigrationsDir()` (from core) or `resolveMigrationsDir()` (adapter) — never hard-code a relative `migrations/` path.
- **Idle pipeline** — single source `composeIdlePipeline` / `IDLE_STEP_ORDER` in `packages/core/src/idle-pipeline.ts`; adapter and replay both consume it. Do not hand-duplicate wiring.
- **Settings** — TEXT values, compare with `=== "1"`, never truthiness.

## What changed in 1.3.0 (Bedrock)

- `KevinEnv {projectRoot,dataRoot}` + `resolveEnv()` — injected by adapter/tests; `packages/core/src/env.ts` is the only `process.cwd`/`homedir` site.
- `exportMigrationsDir()` — core owns the SQL, adapter locates it via walk-up `require.resolve("@jmtrin/kevin-core/package.json")` + fallback.
- `describeContract({scanRoots})` — accepts explicit roots; golden values unchanged.
- C-10 preview: see `packages/core/src/index.ts`.

## Provenance

Roadmap v2 §5.3 + ADR-001, plan docs `docs/Kevin_v1.3.0_Plan.md` / `docs/Kevin_v1.3.0_Task.md` (18 tasks K13-001..K13-018), decisions D13-01..D13-08, principles 45–47.

# Opencode-kevin — Implementation Plan v1.3.0

**Version:** 1.3.0
**Date:** 2026-08-25
**Status:** Done — shipped 2026-08-29 (K13-001..018 18/18, verification battery green)
**Paradigm:** … → Show → **Split**
**Codename:** "Bedrock"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.3 + ADR-001 — hostless-core decision.
- Extraction audit: of 56 modules / 17,572 lines, only `plugin/index.ts` (wiring),
  `native.ts`, `host.ts`, `capabilities.ts` are host-coupled (two typed imports at
  index.ts:5-6); everything else is pure over injected deps. *(pre-split snapshot 2026-08-25; post-Bedrock: ~66+4+3, 12 migrations)*
- `plugin/replay.ts` → `packages/core/src/replay.ts` — existing proof the pipeline runs hostless against `:memory:`.
- `plugin/host.ts` → `packages/plugin/src/host.ts` / `packages/core/src/host.ts` node_modules walk-up resolver — reused to locate kevin-core's
  migrations from the adapter.
- Platform constraint carried from v1.2.0: modules are target-exclusive; this release
  additionally separates packages so server/tui/mcp artifacts never share a build graph.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Bedrock" |
| Paradigm shift | The border between Kevin's brain and its hosts becomes a published fact |
| New layout | Root becomes a private npm-workspaces manager; `packages/core` (`@jmtrin/kevin-core`), `packages/plugin` (`@jmtrin/opencode-kevin`, name frozen by C-06), `packages/tui`, `packages/docs? no` |
| Behavior diff | **EMPTY** — the deliverable is parity |
| Dependency change | plugin gains runtime dep `@jmtrin/kevin-core@1.3.0`; core has ZERO deps |
| Tools / settings / metrics | 26 / 32 / 56 — unchanged |
| Migration | **None** (schema untouched) |
| Tasks | 18 (`K13-001` … `K13-018`) |

**Exit criterion.** Four statements:

1. **Core runs orphaned.** In a checkout where `packages/core/node_modules` contains no
   `@opencode-ai/plugin`, the full core test suite passes (isolation asserted
   mechanically, not by convention).
2. **Adapter is thin.** A source scan proves `packages/plugin/src` imports zero symbols
   from core internals other than the package's public entry (`@jmtrin/kevin-core`) and
   contains none of the moved domain files.
3. **Behavior parity is byte-level on fixtures.** The replay harness mounted through the
   adapter produces IDENTICAL outputs to the same pipeline mounted directly on core,
   across every committed replay fixture.
4. **Artifacts verify.** Both tarballs pass extended verify-pack; a clean consumer
   installing ONLY the plugin tarball resolves and runs (core arrives as its dependency).

---

## 2. Philosophy — "Bedrock"

Everything user-visible stays identical: same tools, same defaults, same DB, same paths.
The release ships a REORGANIZATION plus exactly one new public type family (`KevinEnv`)
and one new exported function (`exportMigrationsDir`). Any behavior diff found during
development is treated as a defect in the split, not an opportunity.

---

## 3. Principles (45–47)

| # | Principle |
|---|---|
| **45** | **A border that isn't enforced doesn't exist.** Isolation is asserted by scans in CI, not by folder names. |
| **46** | **The deliverable is an empty diff.** Parity failures are defects of the migration, never pretexts for improvement. |
| **47** | **Verify artifacts, not trees.** Packaging checks run against packed tarballs and clean consumer installs. |

---

## 4. Target layout

```
/                        private root ("opencode-kevin-monorepo"), workspaces:
├─ packages/core         @jmtrin/kevin-core        deps: NONE
│   ├─ src/…             all domain modules (list §5.1)
│   ├─ migrations/       001..012 (.sql move here)
│   └─ dist/             built core + dist/migrations
├─ packages/plugin       @jmtrin/opencode-kevin    deps: @jmtrin/kevin-core 1.3.0 exact (D13-06),
│   ├─ src/index.ts         native.ts, host.ts, capabilities.ts (adapter only)
│   └─ dist/plugin          (4 files; tui lives in @jmtrin/opencode-kevin-tui)
├─ packages/tui          @jmtrin/opencode-kevin-tui (thin re-export wrapper so the
│                        target-exclusive module owns its own package.json/exports;
│                        main plugin's exports["./tui"] now points here)
└─ scripts/, tests/      stay at ROOT (dev-only), running via workspaces
```

`tui.ts` moves to its own package because its dependency direction (host TUI types,
fs only) must not share the server build graph; plugin keeps `exports["./tui"]`
redirecting to `@jmtrin/opencode-kevin-tui/dist/index.js` — external consumers see NO
change (C-06/C-03 preserved).

### 4.1 `KevinEnv`

```ts
// packages/core/src/env.ts
export interface KevinEnv { projectRoot: string; dataRoot: string }
export const resolveEnv(partial?: Partial<KevinEnv>): KevinEnv
// defaults: projectRoot = process.cwd(), dataRoot = ~/.opencode-kevin
```

Every core constructor/signature that previously called `process.cwd()` or `homedir()`
gains an env parameter with these injected defaults supplied BY THE ADAPTER (or tests).
Enumerated touchpoints: RepoTruth(projectRoot), Retrospective(dir), Materializer(root),
Curator(projectId uses identity already), SharedLayer okfPath resolution (caller-side),
kevin_doctor report paths suppressed anyway, replay fixtures. Grep acceptance enumerates
zero remaining direct calls inside core src.

### 4.2 Migrations relocation

Migrate stays in core; SQL files live in `packages/core/migrations`. Core exports:

```ts
export function exportMigrationsDir(): string // dirname(fileURLToPath(import.meta.url))/../migrations
```

Adapter's `resolveMigrationsDir()` becomes: explicit option → `exportMigrationsDir()`
(via the host.ts walk-up resolver to find the core package). Packed layouts verified by
verify-pack for BOTH tarballs.

### 4.3 Contract source parsing

`describeContract()` parses source text today. After the split it accepts
`opts.scanRoots?: string[]` defaulting to `[packages/plugin/src, packages/core/src]`
resolved from the monorepo OR from installed locations when running packed-mode checks.
Golden VALUES are unchanged — clause contents do not move (D13-05).

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D13-01** | npm workspaces; root goes private; three packages (core/plugin/tui) | Standard layout; publishing unaffected per-package; enables hoisted dev tooling |
| **D13-02** | Core depends on NOTHING (not even @opencode-ai/plugin types) | ADR-001's whole point; enforced by scan |
| **D13-03** | `KevinEnv` injected by adapters; core defaults exist only as convenience | Keeps core runnable standalone while making hosts explicit |
| **D13-04** | Migrations ship inside core; adapter locates them via `exportMigrationsDir()` + existing walk-up resolver | Single owner of schema; C-07 chain untouched |
| **D13-05** | Contract golden values unchanged; only scan-root plumbing changes | Frozen surface means frozen values |
| **D13-06** | Coordinated versions: both packages 1.3.0; plugin pins core EXACTLY `"1.3.0"` until contract v2 revisits policy | Two-versioned matrix is untestable; exact pin is honest |
| **D13-07** | Replay moves INTO core; adapter parity test mounts both wirings over shared fixtures | Kills the hand-synced duplicate wiring noted in the audit |
| **D13-08** | No new settings/tools/metrics/migrations in this release | Parity release by definition |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Circular imports appear post-move (contract↔index parse targets) | Dependency-cruiser-style lightweight scan test added; contract scan roots parameterized (§4.3) |
| Consumer breakage from exports path change | Plugin package name/main/types UNCHANGED; ./tui redirect keeps specifier stable; consumer install test gates release |
| Windows path separators in scans | Scan tests normalize with path.sep-insensitive matching |
| Split tempts behavior tweaks | Principle 46 + empty-diff assertion in K13-016 |

---

## 7. Out of scope

Any feature work; MCP (next); OKF v3; touching golden values; renaming any tool/setting/
metric; changing default budgets.

---

## 8. Task breakdown

See `docs/Kevin_v1.3.0_Task.md` — 18 tasks, phases F0 Restructure → F1 Env → F2
Migrations → F3 Replay parity → F4 Contract → F5 Packaging → F6 Docs → F7 Release.

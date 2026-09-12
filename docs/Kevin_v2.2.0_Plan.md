# Opencode-kevin — Implementation Plan v2.2.0

**Version:** 2.2.0
**Date:** 2026-09-11
**Status:** Draft — gates on v2.1.0 "Relay" shipped
**Codename:** "Harbor"
**Type:** Implementation plan
**Author:** Muse Spark

**Inputs:**
- Triage report for v2.1.0 (7 bugs: BUG-01…BUG-07, since superseded and removed; this plan is its English successor — no Spanish-language working file remains in `docs/`)
- `packages/plugin/src/index.ts` (entrypoint exports, factory, `kevin_status` literal, runtime seeds)
- `packages/plugin/src/host.ts` (`probeHost` cache, `readProject`, `resolvePluginRoot` walk-up)
- `packages/core/src/RepoIdentity.ts` (`resolve(cwd, host?)`, `projectId` derivation)
- `packages/core/src/index.ts` (`KEVIN_CONFIG_KEYS`, `KEVIN_VERSION`)
- `packages/core/migrations/013_v14_bridge.sql`, `015_v21_relay.sql`
- `docs/CONTRACT.md` (C-03…C-07), `packages/core/src/contract.ts`, `tests/fixtures/contract/v2.json`
- `scripts/verify-pack.ts`, `scripts/verify-install.ts`
- `docs/Kevin_v2.1.0_Plan.md` §4–§5 + D21-01…D21-05, `docs/Kevin_v2.0.0_Plan.md` (naming/phasing conventions)

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Harbor" |
| Paradigm | Load anywhere, belong somewhere |
| New files | `packages/plugin/src/config.ts` (public metadata subpath), `packages/core/migrations/016_v22_harbor.sql`, `tests/unit/plugin-loader-contract.test.ts`, `docs/MIGRATION_2.2.0.md` |
| Modified files | `packages/plugin/src/index.ts` (entrypoint + factory identity + derived count + seeds), `packages/plugin/src/host.ts` (per-directory probe scope, cwd-free walk-up), `packages/core/src/RepoIdentity.ts` (project-dir-aware `projectId`, only if needed — see §4.4), `packages/plugin/package.json` (additive `./config` subpath), `scripts/verify-pack.ts` (property 8 + version parameterization), `docs/CONTRACT.md` (C-03 prose only), 6 fossilized asserts, config-key import sites (~40 suites, mechanical) |
| Tools | **27 stays 27** (no tool added or removed; `kevin_sources` remains tool #27) |
| Settings keys | **44 stays 44** (no key added or removed; 3 MCP keys gain their missing seeds) |
| Metric keys | 68 stays 68 (no metric added; `source_deletions_total` since 2.1.0 unchanged) |
| Migration | `016_v22_harbor.sql` ONLY (MCP trio seeds; additive `INSERT OR IGNORE`; no columns) |
| Tasks | 11 (K22-001…K22-011; none conditional) |

**Why 2.2.0 (minor), not 2.1.1 (patch):** the release adds a public export subpath (`./config`), a migration (`016`), and observably changes resolved identity under OpenCode Desktop (project-scoped instead of server-scoped). That is additive + behavior-fixing surface, not a byte-only patch. No removal, no rename, no default flip — see D22-01.

**What does NOT break:** C-07 forever (any 2.2.x opens any 1.x/2.0/2.1 DB); C-06 package name, `main`, specifier `./tui`, and `exports` order (the `./config` subpath is strictly additive); AGENTS.md markers (C-01); OKF wire format (C-02); C-09 zero-network/zero-spawn on the hot path; the single write path through `ArtifactWriter.apply()`; `kevin_settings.value` TEXT semantics (`=== "1"`, never truthiness); the `declared > remote > host > path` precedence (C-08/D8-03 — only *which directory* is passed in changes, never the order).

**Exit criterion (falsifiable, must all hold):**

1. **The published entrypoint loads.** A fresh `npm pack` tarball's `dist/plugin/index.js` has exactly the loader-valid exports (`KevinPlugin` + `default`, same reference) and `npm run verify:pack` (with new property 8) is green; reintroducing any non-function export turns it red.
2. **Desktop instances belong to their projects.** Two factories constructed in one process with different `input.directory` values resolve different `projectId`s equal to `fingerprint(dir)`, resolve `.kevin/` under each dir, and a `kevin_export` from one never includes the other's memories.
3. **Fresh databases tell the truth.** A fresh `001→016` database reports `kevin_config list` = 44 keys = `KEVIN_CONFIG_KEYS.length`, and `kevin_status.tool_count` equals the live tool-map size (27 today) by derivation, not by literal.
4. **Succession is still append-only.** Live contract diff vs golden `v2.json` is empty except the carried-clause C-03 prose fix and the C-07 `015→016` bump; the golden's tool list (27, incl. `kevin_sources` since 2.0.0) is untouched; succession + frozen suites stay green.
5. **Old databases thrive.** The migration matrix (`fresh`, `1.5-soaked`, `2.0-soaked`, `2.1-soaked`) opens, operates, and upgrades to `016` with zero manual steps across Node 22.5/24.

---

## 2. Philosophy — "Harbor"

v2.0.0 "Commonwealth" united the feeds into one brain. v2.1.0 "Relay" reached that brain toward a second pair of hands. v2.2.0 "Harbor" does the unglamorous harbor work: **let the ship dock** (the plugin must actually load in the host) **and give every crew its own bunk** (every Desktop instance must resolve to its own project, not the server's home directory). No new tools, no new settings, no new metrics, no new sources — just a loadable entrypoint, truthful seeds and counts, and an identity that belongs somewhere. A harbor adds no ships; it makes arrivals safe.

---

## 3. Principles (64–69, continuing 55–63)

| # | Principle |
|---|---|
| **64** | **The entrypoint is a door, not a warehouse.** The plugin's `main` module exports the factory and nothing else. Metadata lives behind a named subpath; convenience re-exports that break the host contract are not convenience. |
| **65** | **Identity follows the instance, never the server.** In a multi-instance host, `cwd` is the server's address, not the project's. Every per-project value derives from the instance's directory (`input.directory ?? input.worktree`), with `process.cwd()` as terminal fallback only. |
| **66** | **A count is computed, never written.** Any number that names the size of a live collection (`tool_count`, key tallies) derives from that collection at runtime. Literals desynchronize; derivations cannot. |
| **67** | **Seeds are proven by listing, not by accepting.** A setting exists only if a fresh database *lists* it. `set`-acceptance without `list`-presence is a missing seed, and the equality test covers migrations ↔ constant ↔ fresh-`list` all three ways. |
| **68** | **Caches are keyed by what varies.** A process-global cache of per-instance data (host probe, identity) is a cross-project leak. Cache by the varying key (project directory) or do not cache across instances. |
| **69** | **User-visible strings speak one language.** Every user-facing string in code and docs is English. A second language in one error message or one status title is a localization bug and a snapshot hazard. |

---

## 4. Component design

### 4.1 Entrypoint split (BUG-01/02/03)

**Problem.** `packages/plugin/src/index.ts` exports `KEVIN_CONFIG_KEYS` (array), `REMOVED_SETTINGS` (object), `ERROR_LESSON_MODE_VALUES` (array), `KEVIN_VERSION` (string), and `performRekey` (a *different* function from the factory). The legacy OpenCode loader passes **every** entrypoint export through `getServerPlugin` and throws `TypeError: Plugin export is not a function` on the first non-function — so the plugin never registers any of its 27 tools.

**Design (D22-02):**
- `packages/plugin/src/index.ts` exports **exactly two values**: `export const KevinPlugin` and `export default KevinPlugin` (same reference, so the loader's `seen` set registers one plugin).
- New module `packages/plugin/src/config.ts` owns the public metadata: `KEVIN_CONFIG_KEYS`, `REMOVED_SETTINGS`, `ERROR_LESSON_MODE_VALUES`, `KEVIN_VERSION` (imported from `@jmtrin/kevin-core`, not re-declared), plus `performRekey` with its types `RekeyCounts`/`RekeyResult` and any small pure helpers the entrypoint currently exports for tests. The factory in `index.ts` *imports* what it needs internally (including `performRekey` for the `kevin_project` handler) but **re-exports nothing**.
- `packages/plugin/package.json` gains one strictly additive subpath (C-06 safe):
  ```json
  "./config": { "types": "./dist/plugin/config.d.ts", "import": "./dist/plugin/config.js" }
  ```
  `main`, `exports["."]`, `exports["./tui"]`, and condition order are untouched.
- Mechanical import migration: every internal/test import of the moved symbols switches from the entrypoint to `@jmtrin/opencode-kevin/config` (source-relative `../packages/plugin/src/config.js` inside the repo). Known sites include `tests/unit/docs_settings_coverage.test.ts`, `tests/unit/plugin-config-keys.test.ts`, the ~40 suites importing `KevinPlugin` (those keep pointing at the entrypoint — only the *metadata* imports move), and `tests/integration/rekey*.test.ts` (`performRekey`). No test is deleted; K8-009's "exactly 2 occurrences of `performRekey(`" source-scan acceptance is updated to the new home (export in `config.ts` + single internal call site wired through `index.ts`).
- **No compatibility re-export** from `index.ts` ("just for old imports"): that reintroduces BUG-01 by construction. The migration is documented instead (`CHANGELOG.md` + `packages/plugin/README.md`, one line each).

### 4.2 Loader contract guard (BUG-04)

**Problem.** `verify-pack` measures the package, not the host contract — 2.1.0 passed every gate yet was unloadable.

**Design:**
- New unit test `tests/unit/plugin-loader-contract.test.ts` imports the **compiled** entrypoint (`dist/plugin/index.js` after build, with a documented source fallback for pre-build runs) and asserts, replicating the loader's `getServerPlugin`, that every export satisfies `typeof v === "function" || (v && typeof v === "object" && typeof v.server === "function")`, plus the exact-two-exports / same-reference assertion (`Object.keys(mod)` deep-equals `["KevinPlugin","default"]` modulo key order, and `mod.default === mod.KevinPlugin`).
- `scripts/verify-pack.ts` gains **property 8**: dynamic-import the tarball-extracted `dist/plugin/index.js` and run the same predicate; a single non-function export fails the run hard. The property lives next to P1…P7, follows the same `fail()`/`pass()` reporting, and is covered by a negative probe (temporarily adding `export const X = [...]` turns property 8 red — recorded once in task notes, then reverted).
- While touching `verify-pack.ts`: parameterize the hardcoded `"2.1.0"` pins and the `"015"` schema expectation to read the workspace `package.json` versions and the `packages/core/migrations` directory listing (BUG-12c). The pins stay exact; only their *source* changes from literal to derived, so the next release cannot fail its own gates on stale literals.

### 4.3 `KEVIN_VERSION` discipline (BUG-03 detail)

The canonical value lives in `@jmtrin/kevin-core`. The plugin imports it for internal use (status blocks, SharedLayer bridge version) and re-exposes it **only** via `./config`. `export { KEVIN_VERSION }` in `index.ts` becomes a plain `import`. A drift guard asserts `config.KEVIN_VERSION === core.KEVIN_VERSION === plugin/package.json version` (extends BUG-12b work; one test, three sources).

### 4.4 Desktop identity — `projectDir` (BUG-07 + BUG-08 + BUG-09)

**Problem (3 facets, one fix site).**
1. The factory calls `RepoIdentity.resolve(process.cwd(), host)` and defaults `projectRoot` to `process.cwd()`. Under OpenCode Desktop (one server process, N instances), `process.cwd()` is the *server's* directory, so `projectId`, `.kevin/` resolution, `kevin_export` slicing, `kevin_project show/init/rekey` targets, and `RepoTruth` scans all point at the server home. Every `WHERE project_id = ?` then mixes all projects.
2. `RepoIdentity.resolve` computes `projectId = fingerprint(cwd)` from its `cwd` argument only — even when the winning `repoId` source is `host`. Fixing the `repoId` input without fixing the `projectId` input leaves half the bug alive.
3. `probeHost()` caches its result **process-globally** (`cachedSurface`). In a multi-instance process the second instance reuses the first instance's project fields, and `resolvePluginRoot`'s third strategy walks up from `process.cwd()` (the server dir) — the same server-confusion in a second trench coat.

**Design (D22-03, D22-04):**
- Derive once in the factory, before anything else consumes a path:
  ```ts
  const projectDir = input.directory ?? input.worktree ?? process.cwd();
  ```
  reusing the parsing `host.ts:readProject` already performs (top-level `directory`/`worktree` fallback included). `opts.projectRoot` remains the test override and wins over everything when present: `projectRoot = opts.projectRoot ?? projectDir`.
- Pass `projectDir` (not `process.cwd()`) to `RepoIdentity.resolve(projectDir, host)` and use it for `projectRoot`, the `host.ts` walk-up base, and every `.kevin/` / OKF join that today uses the server cwd. `kevinEnv.projectRoot` follows automatically.
- `projectId` must equal `fingerprint(projectDir)`. Implement inside `resolve` (preferred — single site, all callers fixed: return `projectId: fingerprint(cwd)` where `cwd` is now the passed project dir) rather than patching each consumer; the factory change above is what makes `cwd` correct. No precedence change: `declared > remote > host > path` is untouched (C-08/D8-03); only the directory under test changes.
- Scope the host-probe cache by project directory (key `projectDir`, or drop cross-instance reuse and keep the frozen-per-instance result on the factory closure). Either implementation must satisfy: two factories, one process, different `input.directory` → different `project` fields, no shared mutable surface. `resolvePluginRoot`'s walk-up starts from `projectDir`, never bare `process.cwd()`.
- `repo_id`-via-`host` behavior is preserved; `declared`/`remote` now actually apply under Desktop because they read files under the project dir.
- Suites that construct the factory without `projectRoot` but with `{ directory: tmpRoot }` become *more* correct after the fix; any assert coupled to the old server-cwd behavior is updated with a citation, never silently.

### 4.5 Missing MCP seeds (BUG-05)

**Problem.** `KEVIN_CONFIG_KEYS.length` is 44 but a fresh `001→015` database lists 41: `mcp_write_enabled`, `mcp_approve_enabled`, `mcp_repo_override` are accepted by `set` yet absent from `list`. Migration `013` seeds the five `mcp_*` *metrics* but no `kevin_settings`; runtime seeds cover only `tui_snapshots_enabled` + the three `skills_*`. The write gate stays safe by default (`getSetting(..., "0")`), but `list` lies by omission.

**Design (D22-06):**
- New migration `016_v22_harbor.sql`, additive only:
  ```sql
  INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_write_enabled', '0');
  INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_approve_enabled', '0');
  INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_repo_override', '');
  INSERT OR IGNORE INTO schema_version (version) VALUES ('016');
  ```
- Belt-and-suspenders runtime seeds in the factory next to the existing `tui_*`/`skills_*` seeds (covers pre-016 databases that already sit at `015`, same convention as K12-001/K15-001).
- The key-equality test is extended to the three-way form (Principle 67): `migrations/*.sql` seeds ∪ runtime seeds == `KEVIN_CONFIG_KEYS` == fresh-DB `list`. Fresh-DB `list` must be exactly 44.

### 4.6 Derived `tool_count` (BUG-06)

**Problem.** `kevin_status` reports the literal `tool_count: 26` with a ladder comment ending at v1.1.0, while the factory registers 27 tools (`+kevin_sources` since 2.0.0). Six asserts fossilize the stale value; `docs/CONTRACT.md` C-03 prose says "the 26 registered tool names" and omits `kevin_sources` from the enumeration (the golden `v2.json` and `contract.ts` already list 27 correctly — they are NOT touched).

**Design (D22-05):**
- Replace the literal with a derivation from the live tool map (`Object.keys(tool).length` at the point the status payload is built), extend the ladder comment (`v2.0.0 (K16-019) — +kevin_sources = 27`), and update the 6 asserts (`kevin_status_v06` ×3, `kevin_status_v07` ×2, `kevin_publish` ×1; plus the `v08_regression_guard` allowlist entry for this plan-mandated change).
- New assertion: `tool_count === <live tool-map size>` (and `=== 27` today). Fix `CONTRACT.md` C-03 prose ("27", add `kevin_sources` to the enumeration). Golden file untouched.

### 4.7 Hygiene — newly found bugs fixed in the same release (BUG-10/11/12)

These were found during triage while verifying BUG-01…BUG-07. Each is small, each is load-bearing for the "no new bugs" bar, and each rides a file the release already touches — fixing them separately later would cost a second migration window and a second contract touch.

- **BUG-10 — Non-English user-visible strings.** `performRekey`'s pre-009 refusal is Spanish (`"la migracion 009 no se ha aplicado…"`, `index.ts:271`), and the `kevin_status` title is Spanish (`"Estado de Kevin"`, `index.ts:1183`). Both become English with identical semantics; a language lint guard (`tests/unit/english_strings.test.ts` or equivalent) scans the touched surfaces for known non-English markers so the removed `docs/Kevin_v2.1.0_Bugs.md` (Spanish, deleted by this release) never recurs in code. All docs produced here are English-only by task acceptance.
- **BUG-11 — `KEVIN_CONFIG_KEYS` lives in two places.** Core (`packages/core/src/index.ts`) and the adapter (`packages/plugin/src/index.ts`) each declare the full array with a comment claiming the other is canonical. Any future key edits one and forgets the other. After §4.1, `packages/plugin/src/config.ts` re-exports the core array (single source) instead of re-declaring it; a drift test asserts deep-equality between `config.KEVIN_CONFIG_KEYS`, core's, and the three-way seed equality of §4.5. (Whether `REMOVED_SETTINGS`/`ERROR_LESSON_MODE_VALUES` also single-source into core is left to the implementer — at minimum they are asserted equal if duplicated.)
- **BUG-12 — Hardcoded release literals.** `packages/core/src/index.ts` hardcodes `KEVIN_VERSION = "2.1.0"`; `verify-pack.ts` hardcodes `"2.1.0"` pins and `"015"` schema expectations; the consumer smoke asserts `version !== "015"`-style literals. All become derived (package.json versions, migrations-directory listing) with exactness preserved — the gates stay strict, they just stop rotting. Version bump `2.1.0 → 2.2.0` touches `packages/*/package.json`, `KEVIN_VERSION`, contract `C-07`'s schema note (`015→016`), and the golden's version fields via the existing generator (no hand edits to golden values).

### 4.8 Contract & golden (D22-07)

- `tests/fixtures/contract/v2.json`: regenerated, not hand-edited. Expected delta vs 2.1.0: **C-03 prose/count fix only in `CONTRACT.md`** (golden already correct at 27), **C-07 `015→016`**, nothing else. Any other diff fails the task.
- Succession suite stays green; the red-probe ritual (temporarily mutate one carried clause, watch the suite turn red naming it, revert) is re-run and recorded.
- `kevin_config`'s unknown-key rejection still derives from `KEVIN_CONFIG_KEYS` (C-04 — only the module of residence changes).

### 4.9 Packaging & migration doc

- `verify-pack` checks `×4` tarballs (core, plugin, tui, mcp — no cc-adapter; gate not taken in 2.1.0, unchanged here) plus consumer smoke; property 8 included.
- New `docs/MIGRATION_2.2.0.md`: upgrade paths (fresh / 2.0 / 2.1 DBs), the `./config` import migration (one-line codemod table: old specifier → new), Desktop identity behavior change (what moves and why it is safe), rollback notes. JSON-step blocks executable per D16-12 heritage where DB behavior is concerned.

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D22-01** | Ship as **2.2.0 minor**, not 2.1.1 patch | New public subpath + new migration + observable identity change = additive surface, not a byte-only patch. No removal/rename/default-flip rides along. |
| **D22-02** | `./config` subpath is additive; **no compat re-export** from the entrypoint | C-06 stays frozen (name/`main`/order untouched); any re-export reintroduces BUG-01 by construction. Migration is documented, not shimmed. |
| **D22-03** | `projectDir = input.directory ?? input.worktree ?? process.cwd()`; `opts.projectRoot` still overrides | Reuses the host's own documented fields (`readProject` already parses them); tests keep their override; production stops using the server cwd. Precedence `declared > remote > host > path` unchanged. |
| **D22-04** | Host-probe cache is keyed by project directory (or per-instance, never process-global) | A global cache is a cross-project leak under Desktop's one-process/N-instances model. Correctness first; the probe is already cheap and frozen-per-instance. |
| **D22-05** | `tool_count` derives from the live tool map | Literals desynchronize (this happened twice: 23→ and 26→). Derivation makes the class impossible. |
| **D22-06** | MCP trio fixed by **migration 016 + runtime seeds** (both) | Migration heals fresh DBs; runtime seeds heal existing 015 DBs — the K12-001/K15-001 convention. `INSERT OR IGNORE` keeps both idempotent. |
| **D22-07** | Golden `v2.json` is regenerated; expected delta is C-07 `015→016` only (C-03 golden already correct) | Hand-edited goldens drift; generator + empty-unexpected-diff is the proof. Carried-clause drift still means revert-or-new-major. |
| **D22-08** | All user-visible strings and all new docs are **English-only**; Spanish triage file deleted, not translated | The bug report served its purpose; keeping a second language in-tree (or in code strings) splits snapshots and searches. A lint guard prevents recurrence. |

---

## 6. No-new-bugs guardrails (implementer contract)

1. **Frozen clauses table:** C-01 markers, C-02 wire bytes, C-06 name/`main`/`exports` order, C-08 locations, C-09 invariants — none change. C-03 prose fix and C-07 `016` bump are the only contract edits.
2. **Hot path stays clean:** no LLM, no network, no filesystem scans on `tool.execute.*` / `chat.message` / `system.transform` / `compacting`. Identity resolves once at init; `rekey` (confirmed) remains the only mover.
3. **Single write path:** OKF writes only through `ArtifactWriter.apply()`; the new `config.ts` module performs no I/O at import time.
4. **TEXT semantics:** every `kevin_settings` comparison uses `=== "1"` / explicit defaults; `mcp_repo_override` empty-string default preserved.
5. **Idempotence:** migration 016 re-runnable; seeds `INSERT OR IGNORE`; deletion-sync and rekey behavior untouched.
6. **Import-time safety:** `config.ts` has no side effects (pure constants + `performRekey`, which takes its `Store` as a parameter). Importing it never opens a database.
7. **K8-009 survivor:** after the move, exactly one internal `performRekey(` call site remains (from the `kevin_project` handler); the source-scan acceptance is updated to the new file, not weakened.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Moving exports breaks ~40 test imports | Mechanical codemod (`index.js` → `config.js` for metadata only); `KevinPlugin` imports untouched; full suite green is the task gate |
| `projectDir` change alters existing single-project behavior | In CLI single-project mode `input.directory == cwd`, so resolution is byte-identical; Desktop is the only behavior change, and it is the fix. Matrix + two-instance test prove both |
| Probe cache rework regresses startup perf | Probe is a handful of guarded reads; per-directory memo still O(1) per instance. Perf suite + `bench:regress` must stay green |
| Migration 016 on exotic old DBs (pre-003 without `kevin_settings`) | Same try/catch seed discipline as K12-001/K15-001; migration uses `INSERT OR IGNORE`; matrix covers `fresh/1.5/2.0/2.1-soaked` |
| Translating the two Spanish strings breaks a snapshot | Snapshots asserting the old strings are updated with citations in the same commit; language guard pins the new strings |
| Golden regeneration smuggles drift | Expected-delta assertion (only C-07 `016`); red-probe ritual re-run |

---

## 8. Out of scope

CC adapter revival (gate stays not-taken), OKF v4, embeddings/vector search, cloud sync, auto-conflict-resolution, HTTP transports, telemetry, new tools/settings/metrics/sources, default flips (`source_deletion_sync` stays opt-in per D21-03), transcripts, web UI. Reopening any requires a roadmap amendment, not a task edit.

---

## 9. Task breakdown

See `docs/Kevin_v2.2.0_Task.md` — 11 tasks (K22-001…K22-011), phases F0 Triage → F1 Loader → F2 Identity & Truth → F3 Guards & Contract → F4 Docs & Release.

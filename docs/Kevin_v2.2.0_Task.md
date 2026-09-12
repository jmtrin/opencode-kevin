# Opencode-kevin — Task Breakdown v2.2.0 "Harbor"

**Version:** 2.2.0
**Date:** 2026-09-11
**Status:** Draft — gates on v2.1.0 "Relay" shipped
**Dependency:** v2.1.0 shipped (K21-001…K21-011 all `[X]`); triage report superseded by `docs/Kevin_v2.2.0_Plan.md` (Spanish working file removed, not translated)
**ID Convention:** `K22-XXX` ("Harbor") · Decisions as `D22-NN` (plan §5)
**Total tasks:** 11 (none conditional)
**Author:** Muse Spark

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused deliberately |
| `[!]` | Blocked — reason in Status notes |
| `[X]` | Done — acceptance met, verification passes |

Update §1 after each session.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K22-001 | F0 | Evidence baseline: reproduce all 7 + 3 new bugs, log only | P0 | S | `[X]` |
| K22-002 | F1 | Entrypoint split: `config.ts` subpath, move metadata + `performRekey` | P0 | M | `[X]` |
| K22-003 | F1 | Loader contract test + `verify-pack` property 8 (+ de-hardcode versions) | P0 | S | `[X]` |
| K22-004 | F2 | Desktop identity: `projectDir`, per-directory probe cache, cwd-free walk-up | P0 | M | `[X]` |
| K22-005 | F2 | MCP trio seeds: migration 016 + runtime seeds + 3-way equality test | P1 | S | `[X]` |
| K22-006 | F2 | Derived `tool_count` + ladder comment + 6 asserts + C-03 prose | P1 | S | `[X]` |
| K22-007 | F3 | Hygiene: English-only strings + single-source guards + language lint | P1 | S | `[X]` |
| K22-008 | F3 | Contract/golden regen (C-07 `016` only) + succession red-probe | P0 | S | `[X]` |
| K22-009 | F4 | Docs: `MIGRATION_2.2.0`, CHANGELOG, READMEs, roadmap close-out | P0 | M | `[X]` |
| K22-010 | F4 | Version bump `2.2.0` + engines/packaging sweep + consumer smoke | P0 | S | `[X]` |
| K22-011 | F4 | Final battery + Desktop live verification + tag readiness | P0 | L | `[X]` |

**Phase totals:** F0 1 · F1 2 · F2 3 · F3 2 · F4 3 — **11 total**

**Critical path:**
```
K22-001 → K22-002 → K22-003 → K22-004 → K22-005 → K22-006 → K22-007 → K22-008 → K22-009 → K22-010 → K22-011
```
(K22-005 and K22-006 may run in parallel after K22-004 lands; both touch `index.ts` — coordinate to avoid merge skew.)

---

## 2. Conventions

Base rules from `Kevin_v2.1.0_Task.md` §2 / `Kevin_v2.0.0_Task.md` §2 apply (exact paths, no new dependencies, hot path stays clean, TEXT `=== "1"` comparisons, single write path, `INSERT OR IGNORE` idempotence).

**Less-capable-AI guardrails (MUST read before coding any task):**

1. **Every task starts with DISCOVERY** — paste the current constant/array/header into Status notes before editing. Never guess shape.
2. **The entrypoint is a door, not a warehouse (Principle 64).** After K22-002, `packages/plugin/src/index.ts` exports exactly `KevinPlugin` + `default`. If your change adds any other export there, stop — you are reintroducing BUG-01.
3. **Precedence is frozen (C-08/D8-03).** K22-004 changes *which directory* is passed to `RepoIdentity.resolve`, never the `declared > remote > host > path` order.
4. **Counts derive; versions derive (Principles 66, BUG-12).** No new numeric/string literal that names a live collection size or the release version. Read it from the collection / `package.json` / migrations directory.
5. **English only (Principle 69).** Every user-visible string you add or touch is English. Tests assert it (K22-007).
6. **Conditional tasks:** none in this release. Every row must close with evidence, never with "gate not taken".

---

# Phase F0 — Triage

### K22-001 — Evidence baseline: reproduce all 7 + 3 new bugs, log only

**Status:** `[X]` Done 2026-09-11 — all 10 evidence rows reproduced against the clean
v2.1.0 tree (`d7d9e62`) after `npm install` (workspace links were missing) + `npm run build`
green. Zero source files modified (`git status` clean apart from the two v2.2.0 docs).
Probes live in temp (`k22-ev1…ev5`, `k22-dbg-migrate` removed); repo untouched.

- **Status notes (evidence table, actual outputs):**
  1. BUG-01/02/03 (`k22-ev1`): `EXPORT_KEYS =
     ["ERROR_LESSON_MODE_VALUES","KEVIN_CONFIG_KEYS","KEVIN_VERSION","KevinPlugin",
     "REMOVED_SETTINGS","default","performRekey"]`; loader verdicts: 4× FAIL
     (array/array/string/object), `KevinPlugin` OK, `default` OK, `performRekey`
     OK-but-phantom (would be invoked as a second plugin factory);
     `default===KevinPlugin: true`; `KEVIN_CONFIG_KEYS.length: 44`.
  2. BUG-04: `npm run verify:pack` fully green on the unloadable tree (C1–C9, P1–P7,
     CS1–CS2 all `✓`) — the gap: no loader-contract property.
  3. BUG-05 (`k22-ev2`): raw `Migrate 001→015` on `:memory:` → 37 `kevin_settings`
     rows; `KEVIN_CONFIG_KEYS.length` 44; `MISSING_FROM_DB =
     ["tui_snapshots_enabled","mcp_write_enabled","mcp_approve_enabled",
     "mcp_repo_override","skills_canonical_dir","skills_mirror_claude",
     "skills_mirror_cursor"]` (4 runtime-seeded + 3 never seeded; factory boot
     shows 41 vs 44).
  4. BUG-06: 27 `kevin_*: tool({` registrations in `index.ts` (incl. `kevin_sources`
     at :1749) vs literal `tool_count: 26` (:1194) with ladder ending v1.1.0.
  5. BUG-07 (`k22-ev3`): two factories, one process, `directory=dirA/dirB` (own
     `.git/config` remotes, no `projectRoot` override) → BOTH report
     `repo_id=2114ad162af50a25 source=remote` (the **server's** remote) and
     `project_id=e329ff68c276596d` (= `fingerprint(process.cwd())`), ignoring
     their own remotes (`fp(dirA)=6539e96c7132112e`, `fp(dirB)=6539e86c71320f7b`).
  6. BUG-08 (`k22-ev5`): `probeHost({directory A})` then `probeHost({directory B})`
     → second returns `directory/worktree = C:/proj/A`, `SAME_OBJECT: true`.
  7. BUG-09 (`k22-ev4`): `resolve(dirA, hostDir=dirB)` →
     `{repoId: 7ae8826afe5ba24c, source: host, projectId: 171bad8d66db8e8f =
     fingerprint(dirA)}` — repo follows host, project stays on the cwd arg.
  8. BUG-10: Spanish user-visible strings in `packages/plugin/src/index.ts`:
     `:272` pre-009 refusal, `:360` rekey-collision message, `:822/:944/:974`
     query/status descriptions, `:1183` title `"Estado de Kevin"`, `:1239`
     `kevin_project` description, `:1379` title `"Identidad de repositorio"`,
     `:1401` `kevin_audit` description, `:1492/:1633/:1673/:1704/:1707-1708/
     :1912/:1919/:1928/:1960/:1997/:2021/:2059/:2166` further tool descriptions;
     plus `packages/core/src/Retrospective.ts` labels (`:52-96`, `:312`, `:324`)
     asserted in Spanish by `tests/e2e/retrospective.test.ts` (Spanish
     metrics section header, injection labels, recurrence line). **Scope
     question for K22-007 recorded:**
     minimal (2 code strings per plan) vs full (all descriptions + labels + e2e)
     — to be asked before K22-007, blocks nothing earlier.
  9. BUG-11: `CORE_KEYS: 44 PLUGIN_KEYS: 44 IDENTICAL: true` — hazard is
     structural (two declarations), not a current value drift.
  10. BUG-12: `verify-pack.ts` hardcodes `"2.1.0"` (:129–130, :261–262, :305–311)
      and `"015"` (:378); `KEVIN_VERSION = "2.1.0"` literal in
      `packages/core/src/index.ts:194`.

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** none · **Risk:** 🟢 (read-only)
- **Files:** none committed (scratch under `C:\Users\JOSE_M~1\AppData\Local\Temp\opencode` or equivalent temp dir; delete after). Task notes record the evidence table.
- **Description (execute in order, NO fixes yet):**
  1. DISCOVERY: paste `packages/plugin/src/index.ts` export lines (`KEVIN_CONFIG_KEYS`, `REMOVED_SETTINGS`, `ERROR_LESSON_MODE_VALUES`, `export { KEVIN_VERSION }`, `performRekey`, `KevinPlugin`, `export default`), `package.json` `exports` map, and the factory's `resolve(process.cwd(), host)` + `projectRoot` lines into notes.
  2. BUG-01/02/03: build (`npm run build -w @jmtrin/opencode-kevin` or root build), dynamic-import `dist/plugin/index.js`, list every export with `typeof` and the `getServerPlugin` predicate. Record the FAIL table (expect: 4 non-function values + `performRekey` as phantom second plugin).
  3. BUG-04: run `npm run verify:pack` on the unmodified tree — record green (the gap: package gates pass on an unloadable tarball).
  4. BUG-05: fresh `:memory:` DB, `Migrate.run()` `001→015`, `SELECT COUNT(*) FROM kevin_settings` (expect 41) vs `KEVIN_CONFIG_KEYS.length` (expect 44); `grep` the 3 MCP keys across `packages/core/migrations/*.sql` (expect 0 hits).
  5. BUG-06: count `kevin_*: tool(` registrations in `index.ts` (expect 27) vs `tool_count: 26` literal; list the 6 fossil asserts.
  6. BUG-07: two factories in one process, `{ directory: dirA }` vs `{ directory: dirB }` (no `projectRoot` override) — record identical `projectId`s (both = server-cwd fingerprint) and `projectRoot` pointing at the server dir.
  7. BUG-08 (new): same harness — record `probeHost` returning instance A's project for instance B (global `cachedSurface`), and `resolvePluginRoot` walk-up base = `process.cwd()`.
  8. BUG-09 (new): call `RepoIdentity.resolve(dirA, { project: { directory: dirB, … } })` — record `repoId` from dirB but `projectId` = `fingerprint(dirA)` (host fixes repo, not project).
  9. BUG-10 (new): record the Spanish strings — `index.ts` pre-009 refusal (`"la migracion 009…"`) and `kevin_status` title (`"Estado de Kevin"`).
  10. BUG-11/12 (new): diff core vs plugin `KEVIN_CONFIG_KEYS` (expect identical today — the hazard is structural, note the duplication); record hardcoded `"2.1.0"` pins in `verify-pack.ts` + smoke and `"015"` expectations, and `KEVIN_VERSION = "2.1.0"` literal in `packages/core/src/index.ts`.
- **Acceptance criteria:** notes contain the 10-point evidence table with actual outputs (counts, FAIL rows, identical-id pairs); zero source files modified (`git status` clean apart from notes).
- **Status notes:** evidence table (paste outputs, not summaries).
- **Verification:** reviewer replays any 3 rows against the tree; `git status --porcelain` shows no source edits.

---

# Phase F1 — Loader

### K22-002 — Entrypoint split: `config.ts` subpath, move metadata + `performRekey`

### K22-002 — Entrypoint split: `config.ts` subpath, move metadata + `performRekey`

**Status:** `[X]` Done 2026-09-11 — entrypoint exports exactly `KevinPlugin` + `default`
(same ref, loader-OK); `./config` subpath live with 44 keys, version, rekey;
`tests/unit` + `tests/integration` 210 files / 1396 tests green; plugin build +
typecheck green.

- **Status notes:**
  - DISCOVERY: pre-split exports were `ERROR_LESSON_MODE_VALUES, KEVIN_CONFIG_KEYS,
    KEVIN_VERSION, KevinPlugin, REMOVED_SETTINGS, default, performRekey`
    (K22-001 ev1); `package.json` `exports` held only `"."` + `"./tui"`.
  - New `packages/plugin/src/config.ts`: `KEVIN_CONFIG_KEYS` +
    `ERROR_LESSON_MODE_VALUES` re-exported from core (single source — this
    absorbs K22-007's single-source step early so no duplicate is created only
    to be deleted; deviation recorded here and in K22-007), `REMOVED_SETTINGS`
    defined (only home), `KEVIN_VERSION` re-exported, `performRekey` +
    `RekeyCounts`/`RekeyResult`/`REKEY_TABLES` moved byte-verbatim (rekey
    dry-run/confirmed/collision/transaction paths proven by 5/5
    `rekey.test.ts` green).
  - `index.ts` now imports the four values + `performRekey` from `./config.js`
    and keeps `KEVIN_VERSION` from core; value exports are `KevinPlugin` +
    `default` only (`export interface KevinPluginOptions` is a type, erased at
    runtime — compiled export keys verified `["KevinPlugin","default"]`).
  - `package.json` gained additive `"./config"` (`types` first); `name`/`main`/
    `exports["."]`/`exports["./tui"]`/order untouched (C-06).
  - Codemod (metadata imports → `../config.js`, `KevinPlugin` imports untouched):
    `config_metric_keys`, `config_keys_v08`, `config_keys`,
    `docs_settings_coverage`, `repo_hygiene` (`KEVIN_VERSION`),
    `plugin-config-keys`; `rekey.test.ts` source-scan updated to
    `{config.ts: 1, index.ts: 1}` (a K22-002 comment containing
    `performRekey(` tripped the scan once — reworded, guard works as designed).
  - No-compat-reexport rule held: nothing re-exported from the entrypoint.
  - Docs: one-line migration note added as `packages/plugin/README.md`
    "What's new in 2.2.0 — Harbor" stub. CHANGELOG stub REVERTED the same
    session: `repo_hygiene` pins the newest `## [...]` heading to
    `KEVIN_VERSION` (still 2.1.0 until K22-010), so the full 2.2.0 entry lands
    atomically in K22-009/K22-010 — recorded instead of weakening the guard.
  - `docs/Kevin_Roadmap.md` link list extended with the two v2.2.0 docs
    (required by `roadmap_links`; `Kevin_Roadmap_v2.md` status line deferred to
    K22-009 close-out).
- **Verification:** `npm run build -w @jmtrin/opencode-kevin` +
  `typecheck` green, `dist/plugin/config.js` + `config.d.ts` emitted,
  compiled-export probe `ENTRYPOINT_OK`-equivalent (2 keys, same ref),
  `npx vitest run tests/unit tests/integration` → 210/1396 green.

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K22-001 · **Risk:** 🔴 (touches every metadata importer)
- **Files:** `packages/plugin/src/config.ts` (new), `packages/plugin/src/index.ts` (modify), `packages/plugin/package.json` (additive `./config`), all metadata import sites (modify — mechanical), `packages/plugin/README.md` + `CHANGELOG.md` (one migration line each; full entries land in K22-009)
- **Description:**
  1. DISCOVERY: paste the full current export list of `index.ts` and the `package.json` `exports` map into notes.
  2. Create `packages/plugin/src/config.ts`: move verbatim (no behavior change) `KEVIN_CONFIG_KEYS`, `REMOVED_SETTINGS`, `ERROR_LESSON_MODE_VALUES`; `KEVIN_VERSION` as `import { KEVIN_VERSION } …` + re-export from here only; `performRekey` + `RekeyCounts`/`RekeyResult` + `REKEY_TABLES` verbatim. Module has **no I/O at import time** (pure constants + parameterized function). Single-source note: `KEVIN_CONFIG_KEYS` here re-exports core's array (see K22-007 — coordinate; if K22-007 lands first, this task consumes it).
  3. Strip `index.ts` to exactly two exports (`export const KevinPlugin`, `export default KevinPlugin`, same reference). Convert `export { KEVIN_VERSION }` to a plain import; convert `export function performRekey` + its interfaces to imports from `./config.js`; keep the single internal call site in the `kevin_project` handler (update K8-009 source-scan acceptance to the new file: export in `config.ts` + one call in `index.ts`).
  4. `package.json`: add `"./config"` subpath (`types` first, then `import`, mirroring `"."`). Do NOT touch `name`, `main`, `types`, `exports["."]`, `exports["./tui"]`, or condition order (C-06).
  5. Codemod imports: every metadata import from the entrypoint → `./config.js` (in-repo relative) or `@jmtrin/opencode-kevin/config` (docs). Known sites: `tests/unit/docs_settings_coverage.test.ts`, `tests/unit/plugin-config-keys.test.ts`, `tests/integration/rekey*.test.ts`, plus any other suite importing the moved symbols (find via grep for `KEVIN_CONFIG_KEYS|REMOVED_SETTINGS|ERROR_LESSON_MODE_VALUES|performRekey` from the entrypoint path). `KevinPlugin` imports stay on the entrypoint. Delete no test.
  6. Add the one-line migration note in `packages/plugin/README.md` + root `CHANGELOG.md` stub: "public metadata now imports from `@jmtrin/opencode-kevin/config`".
- **Acceptance criteria:** `grep -n "^export" packages/plugin/src/index.ts` shows only the two factory exports; `tsc` build emits `dist/plugin/config.js` + `config.d.ts`; `node -e "import('./dist/plugin/index.js').then(m=>console.log(Object.keys(m)))"` prints exactly `KevinPlugin,default`; full `npm test` green (no deleted tests).
- **Status notes:** before/after export lists; codemod file list with counts.
- **Verification:** `npm run build && npm test && node --input-type=module -e "const m=await import('./packages/plugin/dist/plugin/index.js'); if(!(m.default===m.KevinPlugin))throw new Error('not same ref'); for(const[k,v]of Object.entries(m)){const ok=typeof v==='function'||(v&&typeof v==='object'&&typeof v.server==='function'); if(!ok)throw new Error('non-function export: '+k)} console.log('ENTRYPOINT_OK')"`

### K22-003 — Loader contract test + `verify-pack` property 8 (+ de-hardcode versions)

**Status:** `[X]` Done 2026-09-11 — contract test 2/2 green; `verify:pack` fully green
with P8a/P8/CS3; negative probe turned both guards red naming the violator, then
reverted; no hardcoded versions left in `verify-pack.ts`.

- **Status notes:**
  - DISCOVERY: P1…P7 block headers pasted in working notes (C-06 pins, exports
    order, exact `2.1.0` pins, no-sql, no-maps, no-tests, consumer smoke).
  - New `tests/unit/plugin-loader-contract.test.ts`: dynamic-imports the COMPILED
    `dist/plugin/index.js` (fail-loud "run npm run build first", never skips),
    replicates `getServerPlugin`, asserts zero violators + exact-two-exports +
    `default === KevinPlugin`.
  - `verify-pack.ts` P8: P8a pins tarball `dist/plugin/index.js` byte-identical
    to the tested repo build (the extracted copy cannot be imported directly —
    its deps are not installed in the extract dir by design; byte-identity is
    the sound bridge, rationale in code comment), P8b runs the predicate +
    exact-two/same-ref assertions over the build. CS3 runs the same predicate
    over the actually-installed packed plugin in the consumer smoke
    (`LOADER_OK` marker).
  - De-hardcode (BUG-12c): `workspaceVersion()` reads the three workspace
    `package.json`s (C1/P1/P4 stay strict-equality, now against live versions);
    `latestSchema` derives from the `packages/core/migrations` listing (smoke
    schema assertion). `grep "2\.1\.0"|"015"` on `verify-pack.ts` → 0 hits.
  - Negative probe transcript: appended `export const __P8_PROBE__ = ["probe"]`
    → unit test red (`__P8_PROBE__ (typeof object)`, keys
    `[KevinPlugin, __P8_PROBE__, default]`) AND `verify:pack` red
    (`✗ Property P8 FAILED: entrypoint exports rejected by the host loader:
    __P8_PROBE__ (typeof object)`, P8a still green) → reverted, rebuilt, all
    green. Probe absent from the tree (`grep __P8_PROBE__` → 0).
  - Lint finding (recorded, not introduced): `npm run lint` is red on the
    PRISTINE v2.1.0 tree too (16 biome diagnostics on `index.ts` +
    `verify-pack.ts`: `useLiteralKeys`/`useConst`/format-drift/
    `organizeImports` — verified via detached worktree + repo biome 1.9.4).
    Harbor adds zero new violations: the two new files are biome-clean
    (`config.ts` formatted once after creation). Pre-existing drift left
    untouched (reformatting it would balloon the diff; out of scope, noted
    for K22-011).
  - Side effect (kept, legitimate): `npm install` (required — workspace links
    were missing) synced the stale-since-1.3.0 `package-lock.json` to the
    2.1.0 tree (root/plugin/tui versions + tui `opencode` engine).
    K22-010 re-syncs to 2.2.0.
- **Verification:** `npx vitest run tests/unit/plugin-loader-contract.test.ts`
  (2/2) + `npm run verify:pack` (C1–C9, P1–P8, CS1–CS3 all `✓`).

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** K22-002 · **Risk:** 🟡
- **Files:** `tests/unit/plugin-loader-contract.test.ts` (new), `scripts/verify-pack.ts` (modify: property 8 + version/schema parameterization)
- **Description:**
  1. DISCOVERY: paste P1…P7 block headers of `verify-pack.ts` into notes.
  2. New test `tests/unit/plugin-loader-contract.test.ts`: imports the **compiled** entrypoint (`packages/plugin/dist/plugin/index.js`; skip-with-loud-message if unbuilt is forbidden — instead fail with "run npm run build first"), replicates `getServerPlugin` predicate over every export, asserts exact-two-exports + `default === KevinPlugin`. Runs in `npm test` (skips nowhere silently).
  3. `verify-pack.ts` property 8: after P1…P7, dynamic-import the **tarball-extracted** `package/dist/plugin/index.js`, run the same predicate, `fail("P8", …)` on the first violator naming the key and its runtime type. Negative probe: temporarily add `export const __P8_PROBE__ = ["x"]` to `config.ts`… no — to `index.ts` (must trip P8), run property 8 (expect red naming `__P8_PROBE__`), revert, re-run (green). Record both outputs in notes.
  4. De-hardcode (BUG-12c): replace `"2.1.0"` pins (C1/P1/P4) with reads from workspace `packages/{core,plugin,tui}/package.json` (exactness preserved: consumer still requires exact equality, just against the live version); replace `"015"` schema expectations (C9/smoke) with the sorted `packages/core/migrations/*.sql` listing + `ORDER BY version DESC LIMIT 1` check (strict, derived). No gate becomes looser — only its constant source changes.
- **Acceptance criteria:** `npx vitest run tests/unit/plugin-loader-contract.test.ts` green; `npm run verify:pack` green with a visible `✓ Property P8` line; negative-probe transcript in notes (red→revert→green).
- **Status notes:** P8 output lines; negative-probe transcript.
- **Verification:** `npm run build && npx vitest run tests/unit/plugin-loader-contract.test.ts && npm run verify:pack`

---

# Phase F2 — Identity & Truth

### K22-004 — Desktop identity: `projectDir`, per-directory probe cache, cwd-free walk-up

### K22-004 — Desktop identity: `projectDir`, per-directory probe cache, cwd-free walk-up

**Status:** `[X]` Done 2026-09-11 — factory derives `projectDir`, probe cache is
per-directory, walk-up tries project dir then server cwd; new 4-test
two-instance suite green (and red 3/4 on old code); full `tests/unit` +
`tests/integration` 212 files / 1402 tests green; root `tsc` clean; touched
files biome-clean.

- **Status notes:**
  - DISCOVERY: factory called `probeHost(input)` then
    `RepoIdentity.resolve(process.cwd(), host)` with `projectRoot =
    opts.projectRoot ?? process.cwd()`; `host.ts` held a process-global
    `cachedSurface`; `resolvePluginRoot` walked up from bare `process.cwd()`.
  - `host.ts`: new exported `projectDirFromInput()` (`directory ?? worktree ?? null`,
    reusing `readProject` parsing); cache is now `Map<string, HostSurface>`
    keyed by `options.projectDir ?? projectDirFromInput(input) ??
    process.cwd()` (keyless inputs share the cwd key — the `host_probe`
    same-frozen-object test still passes 11/11 unchanged); new `probeHost`
    option `projectDir`; `probeV2`/`readPluginVersion` take `baseDir`;
    `resolvePluginRoot(notes, baseDir)` walks the project chain first, then
    the server-cwd chain (deduped when equal) — the host package is the
    server's dependency, so the cwd chain is retained as fallback and CLI
    mode is byte-identical. Precedence inside `RepoIdentity.resolve`
    untouched (C-08/D8-03); `resolve()` itself needed no change
    (`projectId = fingerprint(cwd)` is fixed by passing the right `cwd`).
  - `index.ts` factory: `projectDir = opts.projectRoot ??
    projectDirFromInput(input) ?? process.cwd()` once; `probeHost(input,
    { projectDir })`; `resolve(projectDir, host)`; `projectRoot =
    opts.projectRoot ?? projectDir` (keeps the override; `kevin_project`
    show/init/rekey + RepoTruth + OKF joins fixed transitively).
  - New `tests/integration/desktop_two_instances.test.ts` (4 tests):
    per-`input.directory` projectId/repoId + `kevin_export` isolation on a
    shared DB; per-directory probe regression; host-source session identity
    (`kevin_status` v08 `identity_source: host`, repo `computeRepoId(dir)`)
    with no remotes; CLI-equivalence (`directory === cwd` matches direct
    `resolve(process.cwd())`). Counter-proof: 3/4 red on stashed (old) src,
    CLI-equivalence green both ways, stash popped cleanly.
  - cwd-coupled fallout fixed with `// v2.2.0 (K22-004)` citations (all were
    seeding/asserting the server-cwd identity while booting with
    `directory: tmpProj`):
    `kevin_share` (sessionIds helper = probeHost+resolve; `seedMemory` takes
    projectRoot; 11 call sites), `kevin_sync` (`sessionRepoId` helper; OKF
    headers + repo-scoped assertions), `rekey_session` (seeds via
    `resolve(projectRoot)` — exact under the remote fixture — plus a
    path-scoped foreign row so the dry run still reports a move-plan and the
    confirmed rekey still moves), `repo_identity_init` (spy now expects
    `(tmpRoot, anything)`).
  - Incidental find fixed in passing: the new test file had 3 root-`tsc`
    type errors (vitest doesn't typecheck) which broke
    `verify_install_enumeration` (it shells `npx tsc --noEmit`) — fixed with
    the repo's cast pattern; that file is green again with no changes to it.
- **Verification:** `npx vitest run
  tests/integration/desktop_two_instances.test.ts
  tests/unit/repo_identity_host.test.ts
  tests/unit/repo_identity_init.test.ts` green (inside the full 212/1402
  sweep); `npx tsc --noEmit --project tsconfig.json` clean.
- **Post-release audit fix (2026-09-12):** `projectDirFromInput` returned `""`
  for empty-string directories instead of falling through (v2.1.0 ignored
  empties via `length > 0` guards; `??` does not skip `""`), which would
  scope a session on `fingerprint("")` with relative `.kevin/` joins.
  Fixed with per-field `length > 0` checks (directory, then worktree);
  pinned by 2 unit tests + 1 factory end-to-end test (`directory: ""` →
  `project_id == fingerprint(cwd)`). Touched files biome-clean; full sweep
  215/1416 green after the fix.

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K22-003 · **Risk:** 🔴 (behavior change under Desktop; must be no-op in CLI)
- **Files:** `packages/plugin/src/index.ts` (factory: `projectDir`, `resolve` call, `projectRoot`, `kevinEnv`), `packages/plugin/src/host.ts` (`readProject` reuse/export if needed, per-directory cache, walk-up base), `packages/core/src/RepoIdentity.ts` (only if `projectId` derivation needs it — prefer factory-side fix), tests: new `tests/integration/desktop_two_instances.test.ts` (or equivalent), updates to cwd-coupled asserts (cited, never silent)
- **Description:**
  1. DISCOVERY: paste factory lines for `probeHost`, `RepoIdentity.resolve`, `projectRoot`, `kevinEnv`, plus `host.ts` `cachedSurface` + `resolvePluginRoot` walk-up into notes.
  2. Factory: derive `const projectDir = input.directory ?? input.worktree ?? process.cwd()` once (reuse `readProject`-equivalent parsing so top-level and `project.*` fields agree), then `RepoIdentity.resolve(projectDir, host)`, `projectRoot = opts.projectRoot ?? projectDir`, walk-up base = `projectRoot`, `kevinEnv = { projectRoot, dataRoot: materializerRoot }`. `opts.projectRoot` keeps winning (test override). Precedence inside `resolve` untouched.
  3. `projectId` = `fingerprint(projectDir)`: implement by passing the right `cwd` (preferred — `resolve` already returns `fingerprint(cwd)`), not by patching consumers. Verify `RepoIdentity.resolve` needs no signature change; if it does, keep it backward-compatible (`cwd` stays first param).
  4. `host.ts`: key the probe cache by project directory (or move the frozen surface onto the factory closure so instances never share). `resolvePluginRoot(dir)` takes the project dir; strategy 3 walks up from it, never bare `process.cwd()`. `probeHost` never throws (existing contract); cache-key collisions impossible (exact string key, no normalization beyond what `readProject` yields — document the choice).
  5. Tests: two factories, one process, `dirA ≠ dirB` → `projectId_A === fingerprint(dirA)`, `projectId_B === fingerprint(dirB)`, `.kevin/` + OKF joins under each dir, and `kevin_export`-equivalent row selection (`selectExportRows`-level) from A excludes B's memories. CLI-equivalence case: `input.directory === process.cwd()` → byte-identical identity to v2.1.0 (cite the pre-edit fixture where one exists).
  6. Update cwd-coupled asserts with `// v2.2.0 (K22-004)` citations; extend the `v08_regression_guard` allowlist for exactly these plan-mandated lines.
- **Acceptance criteria:** two-instance test green; CLI-equivalence case green; `RepoIdentity` precedence tests untouched and green; full suite green.
- **Status notes:** paste `projectDir` derivation block + cache design (key shape); list of updated asserts with citations.
- **Verification:** `npx vitest run tests/integration/desktop_two_instances.test.ts tests/unit/repo_identity_host.test.ts tests/unit/repo_identity_init.test.ts`

### K22-005 — MCP trio seeds: migration 016 + runtime seeds + 3-way equality test

### K22-005 — MCP trio seeds: migration 016 + runtime seeds + 3-way equality test

**Status:** `[X]` Done 2026-09-11 — `016_v22_harbor.sql` + runtime seeds live;
fresh boot lists 44/44; 3-way test green (and red on old code); terminal pins
rolled 015→016 per repo convention; touched files biome-clean-or-baseline.

- **Status notes:**
  - DISCOVERY: runtime seed block (`tui_*` + `skills_*` INSERT OR IGNORE,
    pre-003 try/catch) pasted; equality test was one-way (seeded ⊆ KEYS).
  - New `packages/core/migrations/016_v22_harbor.sql` (additive only, 3×
    INSERT OR IGNORE with safe defaults + `016` marker) + factory runtime
    seeds next to `skills_*` (heals existing 015 DBs; D22-06). Core build
    copies it to `dist/migrations` via `copy-migrations.mjs`.
  - `plugin-config-keys.test.ts` extended to three-way (Principle 67): boots
    the factory on `:memory:` with the FULL migration chain and asserts
    `kevin_config list` keys === `KEVIN_CONFIG_KEYS` (44, incl. the trio).
    Counter-proof: with old `index.ts` + 016 moved away, the test goes red
    missing `mcp_write_enabled`; restored → green.
  - New `tests/unit/migrate_016.test.ts` (terminal `016`, trio defaults,
    015-content intact, double-run idempotent).
  - Pin rollover (repo convention — K21-008 did the same for 015):
    `migrate_015` terminal pins → 016 (015-content asserts kept),
    `migrate_012` terminal pins → 016 (+ fallback list + describe text),
    `migration_matrix` describe/it/pins → 016 + new trio-defaults block on
    every upgraded fixture, `verify_install_enumeration` 15→16 (count +
    3× "migraciones copiadas"), `tool_calls_ts_ms` ≤011 exclusion + 016.
    Contract C-07/golden pins deferred to K22-008 (deliberate).
  - Lint: new/modified files biome-clean except `migrate_015` and
    `tool_calls_ts_ms`, whose format/organize diagnostics are byte-identical
    at HEAD (verified file-by-file) — left untouched.
- **Verification:** `npx vitest run tests/unit/config_keys.test.ts
  tests/unit/migrate_016.test.ts tests/integration/migration_matrix.test.ts`
  — plus the six-file targeted run (migrate_012/015/016, plugin-config-keys,
  verify_install_enumeration, tool_calls_ts_ms) 20/20 green.

- **Priority:** P1 · **Estimation:** S (3h) · **Dependencies:** K22-004 · **Risk:** 🟢
- **Files:** `packages/core/migrations/016_v22_harbor.sql` (new), `packages/plugin/src/index.ts` (runtime seeds next to `tui_*`/`skills_*`), key-equality test (extend: `tests/unit/config_keys.test.ts` or successor), `packages/core/src/contract.ts` C-07 note + `docs/CONTRACT.md` C-07 (`015→016`)
- **Description:**
  1. DISCOVERY: paste `015` file content + current runtime seed block + equality-test body into notes.
  2. Migration `016_v22_harbor.sql` (forward-only, additive): 3× `INSERT OR IGNORE INTO kevin_settings` (`mcp_write_enabled='0'`, `mcp_approve_enabled='0'`, `mcp_repo_override=''`) + `INSERT OR IGNORE INTO schema_version (version) VALUES ('016')`. Header comment cites K22-005/D22-06. No columns, no metrics, no backfill.
  3. Runtime seeds: same three rows via `INSERT OR IGNORE` in the factory seed block (covers 015-sitting DBs; try/catch discipline identical to neighbors for pre-003 DBs).
  4. Equality test → 3-way (Principle 67): seeds found in `migrations/*.sql` ∪ runtime seed statements == `KEVIN_CONFIG_KEYS` == fresh-DB (`Migrate.run()` on `:memory:`) `kevin_config list`. Fresh count asserted `=== 44`. The old two-way comparison (which passed while `list` lied) must fail if the `list` leg is removed — structure the test so all three legs are independently asserted.
- **Acceptance criteria:** fresh `001→016` DB lists 44 keys including the MCP trio; double `Migrate.run()` idempotent; `migrate_016`-level + matrix tests green.
- **Status notes:** paste `016` content + fresh-`list` count line.
- **Verification:** `npx vitest run tests/unit/config_keys.test.ts tests/unit/migrate_016.test.ts tests/integration/migration_matrix.test.ts`

### K22-006 — Derived `tool_count` + ladder comment + 6 asserts + C-03 prose

### K22-006 — Derived `tool_count` + ladder comment + 6 asserts + C-03 prose

**Status:** `[X]` Done 2026-09-11 — `tool_count` derives from the live map (27
verified live); 6 asserts at 27; no-literal scan guard; C-03 prose fixed;
golden untouched; touched files green + biome-clean-or-baseline.

- **Status notes:**
  - DISCOVERY: the 27 `kevin_*: tool({` registrations pasted; the map was
    inline in `return liveness.wrap({ tool: { … } })` with the status handler
    inside it — no handle to count from.
  - Refactor (2 surgical edits): `return liveness.wrap({ tool: {` →
    `const tools: NonNullable<Hooks["tool"]> = {` (NonNullable required:
    `Hooks["tool"]` includes `| undefined`, which broke `Object.keys` on the
    first attempt — TS2769; the annotation keeps the exact contextual check
    the inline literal had), and the map close `},` → `};` + `return
    liveness.wrap({ tool: tools, …`. Payload: `tool_count:
    Object.keys(tools).length` + ladder extended (`v2.0.0 K16-019
    +kevin_sources = 27`). Live probe: `TOOL_COUNT: 27`.
  - 6 asserts → 27 with citations (`kevin_status_v06` ×3 incl. fixing the
    stale "tool_count 23" title, `kevin_status_v07` ×2 incl. both "23 tools"
    titles → 27, `kevin_publish` incl. fixing the stale "reports 16 tools"
    title); `v08_regression_guard` needed NO change (all touched files
    already allowlisted; assertion is a superset).
  - New guard in `kevin_status_v07.test.ts`: source scan fails any
    `tool_count: <digits>` literal + pins the derivation expression. (First
    placed in v06 — its shared `afterEach` double-disposes when a test boots
    nothing; moved to v07 which has no shared hooks. A mis-edit during the
    move doubled a `});` — caught by root `tsc`, fixed, green.)
  - `docs/CONTRACT.md` C-03: "26" → "27", `kevin_sources` added with
    `since 2.0.0` (golden `v2.json` already correct — byte-untouched).
  - Lint: `kevin_publish` organizeImports diagnostic is byte-identical at
    HEAD (left); all other touched files biome-clean.
- **Verification:** `npx vitest run tests/unit/kevin_status_v06.test.ts
  tests/unit/kevin_status_v07.test.ts tests/integration/kevin_publish.test.ts
  tests/unit/v08_regression_guard.test.ts` 12/12 green; plugin build +
  typecheck green; live `TOOL_COUNT: 27` probe.

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K22-004 (same file region — coordinate) · **Risk:** 🟢
- **Files:** `packages/plugin/src/index.ts` (`kevin_status` payload), `tests/unit/kevin_status_v06.test.ts` (3), `tests/unit/kevin_status_v07.test.ts` (2), `tests/integration/kevin_publish.test.ts` (1), `tests/unit/v08_regression_guard.test.ts` (allowlist), `docs/CONTRACT.md` C-03 prose
- **Description:**
  1. DISCOVERY: paste the `tool_count: 26` block with its ladder comment into notes.
  2. Replace the literal with `Object.keys(tool).length` (or the in-scope tool-map equivalent — DISCOVERY first, no guessing) at payload-build time; extend the ladder comment (`v2.0.0 (K16-019) — +kevin_sources = 27`); fix the stale v06 test name mentioning "tool_count 23".
  3. Update the 6 asserts to 27 + add the derivation assertion (`tool_count === live tool-map size`; today also `=== 27`). `CONTRACT.md` C-03: "26" → "27", add `kevin_sources` to the enumeration. Golden `v2.json` NOT touched (already 27 — assert this in notes via grep).
- **Acceptance criteria:** status reports 27 on the current tool map; removing/adding a tool (probe, reverted) moves the count without code edits to the status block; C-03 prose names all 27.
- **Status notes:** before/after payload lines; grep proving golden already lists `kevin_sources`.
- **Verification:** `npx vitest run tests/unit/kevin_status_v06.test.ts tests/unit/kevin_status_v07.test.ts tests/integration/kevin_publish.test.ts tests/unit/v08_regression_guard.test.ts`

---

# Phase F3 — Guards & Contract

### K22-007 — Hygiene: English-only strings + single-source guards + language lint

**Status:** `[X]` Done 2026-09-11 — minimal scope per user decision (3 rekey
messages + status title translated; tool descriptions + Retrospective labels
deferred); single-source drift test + language lint green; touched files
biome-clean; plugin rebuilt.

- **Status notes:**
  - Scope decision (asked, user chose Minimal): triage found ~25 Spanish
    user-visible strings, but tool descriptions are unasserted host-visible
    behavior (risky to reword mid-release) and Retrospective labels are
    pinned by `tests/e2e/retrospective.test.ts`. Deferred surfaces recorded
    in the `english_strings.test.ts` header so a later release owns them.
  - Translations (semantics identical): pre-009 refusal → "migration 009 has
    not been applied: no repo_id column exists (nor
    shared_entries/okf_imports) to re-key against"; collision → "monorepo
    collision: the target repo_id already holds memories from a different
    project_id set; pass force: true only if you want to merge them";
    catch → "rekey failed and was fully rolled back: …"; `kevin_status`
    title → "Kevin status". One pin updated with citation
    (`rekey.test.ts` "revirtio" → "rolled back"; "monorepo" pin survives,
    status title unasserted anywhere).
  - New `tests/unit/english_strings.test.ts`: 5 exact removed markers absent
    from `index.ts` + `config.ts`, English replacements present. (My own
    "(was Estado de Kevin)" comment tripped the scan once — reworded; guards
    work as designed.)
  - New `tests/unit/metadata_single_source.test.ts`: KEYS and
    ERROR_LESSON_MODE_VALUES deep-equal core↔config, VERSION triple-equal
    (core↔config↔plugin package.json — literal-free, passes before and after
    the K22-010 bump), REMOVED_SETTINGS ownership pinned. (K22-002 already
    made config.ts re-export core's arrays; this is the guard half.)
- **Verification:** `npx vitest run tests/unit/english_strings.test.ts
  tests/unit/metadata_single_source.test.ts tests/integration/rekey.test.ts`
  12/12 green; root `tsc` clean.

- **Priority:** P1 · **Estimation:** S (3h) · **Dependencies:** K22-002, K22-006 · **Risk:** 🟢
- **Files:** `packages/plugin/src/index.ts` (2 strings), `packages/plugin/src/config.ts` (single-source re-export), `packages/core/src/index.ts` (`KEVIN_VERSION` bump site — value change lands in K22-010; here only the guard), new `tests/unit/english_strings.test.ts` (or equivalent name), drift test for `KEVIN_CONFIG_KEYS`/`KEVIN_VERSION`
- **Description:**
  1. DISCOVERY: paste the Spanish refusal line, the `"Estado de Kevin"` title line, and both `KEVIN_CONFIG_KEYS` declarations into notes.
  2. English strings (semantics identical, keys/values untouched): pre-009 refusal → `"migration 009 has not been applied: no repo_id column (nor shared_entries/okf_imports) to re-key"`; status title → `"Kevin status"`. Update any snapshot asserting the old bytes with `// v2.2.0 (K22-007)` citations.
  3. Single-source: `config.ts` re-exports core's `KEVIN_CONFIG_KEYS` (delete the adapter's duplicate array); drift test asserts deep-equality `core == config` and the §4.5 three-way equality; version guard asserts `core KEVIN_VERSION === config KEVIN_VERSION === plugin package.json version` (values bumped in K22-010; the guard is written here and must pass before and after).
  4. Language lint: new test scans user-visible surfaces (`packages/plugin/src/index.ts`, `config.ts`, plus the error/title strings) for a pinned marker list (at minimum the two removed Spanish strings and a small stop-list); all new docs asserted English by review checklist in K22-009 (no Spanish file may be added — the deleted triage file stays deleted).
- **Acceptance criteria:** no Spanish bytes remain in the touched surfaces (`grep -ri` for the two removed strings returns only the test's own fixtures/notes + task history); drift + language tests green.
- **Status notes:** before/after strings; grep outputs proving removal.
- **Verification:** `npx vitest run tests/unit/english_strings.test.ts tests/unit/plugin-config-keys.test.ts tests/unit/docs_settings_coverage.test.ts`

### K22-008 — Contract/golden regen (C-07 `016` only) + succession red-probe

### K22-008 — Contract/golden regen (C-07 `016` only) + succession red-probe

**Status:** `[X]` Done 2026-09-11 — golden regen via generator, single-hunk
C-07 diff; succession + frozen + parity + tool suites 19/19 green; red probe
turned succession red naming the carried clause, then reverted.

- **Status notes:**
  - DISCOVERY: `CONTRACT_VERSION = 2` (`contract.ts:45`), C-07 value
    `schema_version: "015"` (`:447`), generator
    `scripts/gen-contract-v2.mjs` (live `describeContract()` → `v2.json`,
    idempotent).
  - `contract.ts` C-07 → `"016"`; `docs/CONTRACT.md` C-07 prose → `016` +
    `016_v22_harbor` seed note; regenerated with
    `node --import tsx scripts/gen-contract-v2.mjs` — diff is exactly one
    hunk (`- "015"` / `+ "016"`), no other clause touched (C-03 golden was
    already 27-strong; only its `CONTRACT.md` prose was fixed in K22-006).
  - Suite finding (recorded): `contract_frozen` consumes core DIST, so it
    went red after the `contract.ts` edit until `npm run build -w
    @jmtrin/kevin-core` — expected ordering, not a bug; K22-011 battery
    builds before testing.
  - Red-probe transcript: renaming `kevin_sources` (v2-only) stayed green
    (correct — succession checks v1⊆v2, noted as a probe-design correction);
    renaming carried `kevin_save` → 2 failures naming `C-03.kevin_save`
    `removed` + `kevin_save_RENAMED` `added_bare` with the revert-or-2.0.0
    remedy → golden restored from backup (byte-verified: 1-hunk diff),
    backup deleted, 11/11 green.
- **Verification:** `npx vitest run tests/unit/contract_succession.test.ts
  tests/unit/contract_frozen.test.ts tests/unit/contract_parity.test.ts
  tests/unit/kevin_contract_tool.test.ts` 19/19 green.

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K22-005, K22-006, K22-007 · **Risk:** 🟡
- **Files:** `packages/core/src/contract.ts` (C-07 note only), `tests/fixtures/contract/v2.json` (regenerated via generator script, never hand-edited), `docs/CONTRACT.md` (C-07 `015→016`; C-03 landed in K22-006)
- **Description:**
  1. DISCOVERY: paste `CONTRACT_*` C-07 lines + `contract_version` value into notes.
  2. Bump C-07 schema note `015→016` (migration filename + seeds). Regenerate `v2.json` with the repo's generator; diff the result — expected delta is **only** the `016` trace. Any other hunk → stop, diagnose, do not hand-patch the golden.
  3. Red-probe ritual: temporarily mutate one carried clause in the golden copy, run `contract_succession` (expect red naming the clause), revert, re-run (green). Record the probe transcript in notes. Run frozen + succession suites.
- **Acceptance criteria:** `live-vs-v2` diff empty; succession + frozen suites green; probe transcript in notes; golden diff limited to `016` trace.
- **Status notes:** golden diff (full, short); probe transcript.
- **Verification:** `npx vitest run tests/unit/contract_succession.test.ts tests/unit/contract_frozen.test.ts`

---

# Phase F4 — Docs & Release

### K22-009 — Docs: `MIGRATION_2.2.0`, CHANGELOG, READMEs, roadmap close-out

### K22-009 — Docs: `MIGRATION_2.2.0`, CHANGELOG, READMEs, roadmap close-out

**Status:** `[X]` Done 2026-09-11 — migration runbook, both README "Harbor"
sections, roadmap close-out line; snippets parsed + migration block executed
live; doc tests green. CHANGELOG entry intentionally deferred to K22-010
(see deviation).

- **Status notes:**
  - New `docs/MIGRATION_2.2.0.md` (8 sections mirroring 2.1.0's runbook):
    pre-check, backup, 016 application + content, `./config` import table
    (5 rows old→new), Desktop behavior change + per-project verify,
    tool-count/strings notes, verify battery, rollback (with the honest
    warning that 2.1.0 rollback reinstates BUG-01 — prefer forward),
    exit ramps. Correction during verification: raw-table count after 016
    is 40 (37+3), 44 only after boot seeds — doc states both (proven by
    live execution: `APPLIED_TAIL: 015,016 TO: 016 SETTINGS_COUNT: 40`).
  - Root `README.md`: TOC entry + full "What's new in 2.2.0 — Harbor"
    section (4 bullets + upgrade line); plugin `README.md`: K22-002 stub
    expanded to 3 bullets. `Kevin_Roadmap_v2.md`: 2026-09-11 Harbor status
    line (27 tools derived, 44 settings seeded, 68 metrics, 016).
  - DEVIATION (justified, recorded here + K22-010): the CHANGELOG 2.2.0
    entry lands atomically WITH the version bump in K22-010, because
    `repo_hygiene` requires the newest `## [...]` heading to contain
    `KEVIN_VERSION` (still 2.1.0 until the bump) — same rationale as the
    K22-002 stub revert.
  - Cross-ref spot-audit: (`./config` table ↔ `config.ts` exports +
    `package.json` `./config` ↔ loader-contract + rekey-scan tests);
    (44-list claim ↔ `016` SQL + factory seeds ↔ 3-way + `migrate_016`
    tests); (per-instance scoping ↔ `projectDir` derivation ↔
    `desktop_two_instances` tests).
- **Verification:** `node --check` on the JS snippet (`SNIPPET_PARSE_OK`);
  migration `node --import tsx -e` block executed against a temp DB;
  `npx vitest run tests/unit/roadmap_links.test.ts
  tests/unit/docs_settings_coverage.test.ts tests/unit/repo_hygiene.test.ts`
  8/8 green; English-only (reviewed).

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K22-008 · **Risk:** 🟢
- **Files:** `docs/MIGRATION_2.2.0.md` (new), `CHANGELOG.md` (2.2.0 entry), `packages/plugin/README.md` (config-subpath + Desktop identity notes), root `README.md` (Upgrade to 2.2 section if convention exists), `docs/Kevin_Roadmap_v2.md` (close-out footer), `docs/CONTRACT.md` (already touched by K22-006/008 — verify consistency here, no new edits)
- **Description:**
  1. `MIGRATION_2.2.0.md`: upgrade paths (fresh / 2.0 / 2.1 DBs → auto-migrate to 016, zero manual steps), `./config` import-migration table (old specifier → new, per symbol), Desktop identity behavior change (what moves, why CLI is unaffected, `opts.projectRoot` override retained), rollback notes (pin `2.1.0`; 016 seeds are `INSERT OR IGNORE` inert rows). DB steps as executable JSON-step blocks per D16-12 heritage where applicable; Windows-safe paths.
  2. `CHANGELOG.md` 2.2.0 entry: exhaustive delta bullets mirroring the code diff (one bullet per task-visible change: entrypoint, probe, seeds, count, strings, contract, migration). Cross-ref spot-audit table (3 rows: doc claim ↔ code line ↔ test) pasted in notes.
  3. READMEs: plugin README documents `./config` (import snippet that parses as JSON/JS) + Desktop identity paragraph; root README upgrade section links the migration doc.
  4. Roadmap close-out footer: v2.2.0 date + outcome pointer. Doc-lint: no broken links, snippets parse, **English only** (review checklist signed in notes).
- **Acceptance criteria:** migration steps replay green where executable; cross-ref table in notes; doc-lint green; zero non-English docs added.
- **Status notes:** cross-ref table; doc-lint output.
- **Verification:** doc-lint + `node --check` on every JS snippet / `JSON.parse` on every JSON snippet (record commands + outputs)

### K22-010 — Version bump `2.2.0` + engines/packaging sweep + consumer smoke

### K22-010 — Version bump `2.2.0` + engines/packaging sweep + consumer smoke

**Status:** `[X]` Done 2026-09-11 — all versions + pins at 2.2.0, CHANGELOG
entry landed atomically, `verify:pack` green with zero script changes
(de-hardcoding payoff), engines sweep conforms to D16-11.

- **Status notes:**
  - DISCOVERY: root `package.json` IS bumped every release (2.0.0 at the
    v2.0.0 tag) — so 5 version files, not 4.
  - Bumped: root/private, core, plugin (+ core/tui pins), tui, mcp (+ core
    pin), `KEVIN_VERSION`, lockfile via `npm install --package-lock-only`
    (no dep changes); full `CHANGELOG.md [2.2.0]` entry (8 bullets,
    one per workstream) landed in the same edit as the bump — required by
    `repo_hygiene` (newest `## [...]` must contain `KEVIN_VERSION`),
    closing the K22-002/K22-009 deferrals.
  - Engines sweep (D16-11): core 2.2.0 node-only zero-deps; plugin 2.2.0
    node+opencode; tui 2.2.0 node+opencode; mcp 2.2.0 node-only. Cross-pins
    exact 2.2.0 (plugin→core/tui, mcp→core).
  - One version-coupled pin found by grep and updated with citation:
    `bench_persist` `package_version` "2.1.0"→"2.2.0" (bench stamps live
    `KEVIN_VERSION`). Historical `2.1.0` (migration filenames,
    `since`-fields, comments, README history) untouched by design.
  - `verify:pack` green with C1/P1/P4 reporting 2.2.0 and P8a/P8/CS3 intact
    — no script edit needed for the bump (K22-003 de-hardcoding verified
    in practice, not just in review).
- **Verification:** `npm run verify:pack` (C1–C9, P1–P8, CS1–CS3 all `✓`);
  `npx vitest run tests/unit/repo_hygiene.test.ts
  tests/unit/metadata_single_source.test.ts` 7/7 green (version guard +
  hygiene agree on 2.2.0).

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** K22-009 · **Risk:** 🟡
- **Files:** `packages/{core,plugin,tui,mcp}/package.json` (version), `packages/core/src/index.ts` (`KEVIN_VERSION`), lockfile if present (via `npm install --package-lock-only`, no dependency changes), `scripts/verify-pack.ts` (no further edits — consumes K22-003 parameterization)
- **Description:**
  1. Bump all four package versions `2.1.0 → 2.2.0` (keep exact cross-pins `@jmtrin/*: 2.2.0`); `KEVIN_VERSION = "2.2.0"`; plugin dep pins exact.
  2. Engines sweep: `engines.node >=22.5` everywhere; `engines.opencode` ONLY on plugin + tui (D16-11 heritage). Assert via existing sweep test or `verify-pack` + manual table in notes.
  3. Run `npm run verify:pack` (now with P8 + derived versions) ×4 tarballs + consumer smoke (plugin import exposes `KevinPlugin`/`default`; `Migrate` on packed migrations ends at `016`; in-memory round-trip). Record the grid (Node 22.5/24 × {fresh, 1.5-soaked, 2.0-soaked, 2.1-soaked}).
- **Acceptance criteria:** version guard from K22-007 green (three sources agree on `2.2.0`); `verify:pack` fully green; sweep table in notes.
- **Status notes:** version grep table; sweep grid.
- **Verification:** `npm run verify:pack && npx vitest run tests/integration/upgrade_matrix.test.ts` (or matrix successor)

### K22-011 — Final battery + Desktop live verification + tag readiness

**Status:** `[X]` Done 2026-09-11 — clean-checkout battery green except
pre-existing lint debt (honestly recorded, Harbor adds zero); full suite
242/1538 green; all 5 exit criteria demonstrated; tree is exactly the release
diff; tag/commit/push intentionally NOT executed (awaiting explicit release
instruction).

- **Status notes (battery tails):**
  - `npm ci` green (205 packages; lockfile reproduces).
  - `npm run typecheck` exit 0 (core + tui + plugin + root project).
  - `npm run lint`: 382 errors / 367 files vs PRISTINE-HEAD baseline 387 /
    359 (detached worktree + repo biome 1.9.4) — red before and after;
    every file Harbor touches verified individually clean-or-baseline
    (new files clean; `migrate_015`/`tool_calls_ts_ms`/`kevin_publish`
    diagnostics byte-identical at HEAD). No reformatting of pre-existing
    drift (out of scope).
  - `npm run build` green (core + tui + plugin + mcp via workspaces chain).
  - `npm test`: **242 files / 1538 tests, all green** (unit + integration
    + e2e). One REAL regression caught and fixed in-battery:
    `tests/e2e/v08_closed_loop.test.ts` failed (2nd run isolated; passes
    on pristine tree) — same cwd-coupled seed class as K22-004
    (`PLUGIN_REPO_ID/PROJECT_ID` from `resolve(process.cwd())`); fixed by
    seeding/constructing under per-dir `resolve(dir)` (remote fixtures make
    it exact) with citations; biome-clean; 2/2 green.
  - `npm run verify:pack`: C1–C9, P1–P8 (incl. P8a/P8), CS1–CS3 all `✓`.
  - `npm run replay`: parity table emitted (basic-typescript-loop 4
    memories, precision 0.000 / coverage 0.750 — harness baseline
    unchanged). No bun on this machine (not run, noted).
- **Exit-criterion walkthrough (plan §1):**
  1. Packed entrypoint loads: `EXPORT_KEYS: ["KevinPlugin","default"]`,
     same ref, P8 + CS3 green.
  2. Desktop instances belong: live probe — A/B distinct `project_id ==
     fingerprint(dir)`, distinct remote `repo_id`s, server cwd untouched;
     export isolation in-suite.
  3. Fresh DB tells truth: `kevin_config list` 44/44 (3-way test),
     `TOOL_COUNT: 27` live probe.
  4. Succession append-only: golden diff = single C-07 hunk; succession +
     frozen + parity + tool suites green; red-probe ritual recorded.
  5. Old DBs thrive: matrix 001..011 → 016 green (rows intact, trio seeded,
     second run no-op).
- **Ladders final:** tools 27, settings 44, metrics 68, migrations 16
  (001..016), principles 64–69 cited in plan §3, D22-01…D22-08 in plan §5
  and task notes.
- **Tree/tag:** 39 modified + 10 new files, zero scratch (temp probes
  deleted, worktrees removed, no tarballs); Spanish triage file absent;
  new docs English-only (accent scan clean; remaining Spanish bytes in-tree
  are pre-existing history). No commit/tag/push performed — release
  (`core → tui → plugin → mcp` per DISTRIBUTION + `v2.2.0` tag) awaits
  explicit instruction.
- **Verification:** battery commands above with outputs pasted.

- **Priority:** P0 · **Estimation:** L (6h) · **Dependencies:** everything · **Risk:** 🔴
- **Files:** none (transcripts archived locally, not committed)
- **Description:**
  1. Clean-checkout battery: `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pack` (plus `bench` + `bench:regress` + `replay` + `bun test` where available) — all green. If `npm run verify` exists as the wrapper, run it first; on any red, stop and fix before proceeding (no partial releases).
  2. Exit-criterion walkthrough (plan §1, all five): (a) packed-entrypoint import check on the tarball build; (b) two-instance Desktop harness incl. export-isolation; (c) fresh-DB `list`=44 + derived `tool_count`=27; (d) succession/golden walkthrough; (e) old-DB matrix. Paste tails (last ~20 lines) of each into notes.
  3. Ladders final: tools 27, settings 44, metrics 68, migrations ≤016, principles 64–69 cited, D22-01…D22-08 referenced (grep table in notes).
  4. Publish readiness per `DISTRIBUTION.md` order (core → tui → plugin → mcp); tag `v2.2.0` prepared but pushed only per distribution process. Confirm the Spanish triage file is absent from the tree and no temp probe files remain (`git status --porcelain` clean except the release diff).
- **Acceptance criteria:** battery log pasted; all five exit statements demonstrated with logs; tag `v2.2.0` ready; tree contains `Kevin_v2.2.0_Plan.md` + `Kevin_v2.2.0_Task.md`, no Spanish docs, no scratch files.
- **Status notes:** full outputs (battery tail + `git tag` readiness + `git status`).
- **Verification:** battery.

---

## Done definition

11/11 `[X]` with evidence in notes; 5 exit-criterion statements demonstrated; `npm run verify:pack` green with property 8; succession + frozen + matrix + loader-contract + two-instance suites green on the release commit; tag `v2.2.0`; releases publishable in pin order; `MIGRATION_2.2.0.md` executable steps green; English-only tree.

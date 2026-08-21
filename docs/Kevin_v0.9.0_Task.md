# Opencode-kevin — Task Breakdown v0.9.0

**Version:** 0.9.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** v0.8.0 "Team" complete (`K8-001` … `K8-027`)
**ID Convention:** `K9-XXX` ("Native") · Decisions referenced as `D9-NN`
**Total tasks:** 24
**Author:** Opus-5 (xHigh)

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused — started, parked for a stated reason |
| `[!]` | Blocked — cannot proceed until the blocker clears |
| `[X]` | Done — acceptance criteria met and verification command green |

```markdown
### K9-001 — Draft migration 010

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
...
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K9-001 | F0 | Migration `010` + post-apply hook `"010"` | P0 | M (5h) | `[X]` |
| K9-002 | F0 | Host-contract assertion suite | P0 | M (6h) | `[X]` |
| K9-003 | F0 | `KEVIN_CONFIG_KEYS` + `METRIC_KEY_LABELS` 39→45 | P0 | S (2h) | `[X]` |
| K9-004 | F0 | `plugin/host.ts` — `probeHost()` / `summarize()` | P0 | M (6h) | `[X]` |
| K9-005 | F1 | Remove `zod` from dependencies | P0 | S (2h) | `[X]` |
| K9-006 | F1 | Host identity source in `RepoIdentity.resolve()` | P1 | M (5h) | `[X]` |
| K9-007 | F1 | Raise the pin to `^1.18.16` on byte-level proof | P0 | S (3h) | `[X]` |
| K9-008 | F1 | `host_probes` persistence + `kevin_status` summary | P2 | S (3h) | `[X]` |
| K9-009 | F2 | `HookLiveness.wrap()` | P0 | M (6h) | `[X]` |
| K9-010 | F2 | `expect()`, threshold, and the `dead` verdict | P0 | M (7h) | `[X]` |
| K9-011 | F2 | Error path + `injections_suppressed_dead_hook` | P0 | M (5h) | `[X]` |
| K9-012 | F2 | `verdict` reducer (`healthy`/`degraded`/`unknown`) | P0 | S (3h) | `[X]` |
| K9-013 | F3 | `plugin/native.ts` + dynamic-import containment | P1 | M (5h) | `[X]` |
| K9-014 | F3 | `skill.transform` registration + read-back verify | P1 | M (6h) | `[X]` |
| K9-015 | F3 | `reference.transform` registration | P2 | M (5h) | `[X]` |
| K9-016 | F3 | Mutual exclusion with `Materializer` emission | P1 | M (5h) | `[X]` |
| K9-017 | F3 | `native_registrations` persistence + metrics | P2 | S (3h) | `[X]` |
| K9-018 | F4 | `kevin_doctor` | P0 | M (6h) | `[X]` |
| K9-019 | F4 | `kevin_native` | P2 | S (3h) | `[X]` |
| K9-020 | F4 | `kevin_audit` host block | P2 | S (3h) | `[X]` |
| K9-021 | F4 | `verify-install.ts` enumerates `migrations/` | P1 | S (3h) | `[X]` |
| K9-022 | F5 | End-to-end degradation drill | P0 | M (6h) | `[X]` |
| K9-023 | F5 | Docs + `Kevin_Roadmap.md` correction | P1 | M (5h) | `[X]` |
| K9-024 | F5 | Final verification | P0 | S (3h) | `[X]` |

**Phase totals:** F0 4 · F1 4 · F2 4 · F3 5 · F4 4 · F5 3 — **24 total**

**Done:** 23 · **In progress:** 0 · **Blocked:** 0

**Critical path:** K9-001 → K9-004 → K9-009 → K9-010 → K9-012 → K9-018 → K9-022 → K9-024.

The path runs through the instrument, not through the v2 attachment. F3 can slip to a later
release without invalidating F0–F2. F2 cannot slip: without it, v1.0.0 would freeze a public
contract over a host dependency nobody is watching.

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h. Estimates assume familiarity with the v0.8.0 module
set and with plan §3, which every task in F0 and F1 depends on having been read.

**Dependencies.** A task may start when every listed dependency is `[X]`. Dependencies are hard;
a task with an unmet dependency is `[!]`, not `[~]`.

**Risk.** 🟢 low · 🟡 medium · 🔴 high (affects ranking, retrieval or memory lifecycle). This
release adds a fourth sensitivity: anything that can make the plugin fail to construct is 🔴
regardless of how small the diff is, because a plugin that does not load is worse than any feature
it might have carried.

**Verification.** Every task ends with a command that either passes or does not. "Verified by
inspection" is not a verification.

**Files.** All paths are relative to the repository root `C:\Misc\opencode-kevin`.

**Style.**
- Strict TypeScript, no `any`. Where the host's types are genuinely unknown at compile time —
  the v2 draft objects on a host that may not have them — use `unknown` and narrow, never `any`.
- ESM with `.js` extensions on relative imports.
- `npm run format` before every commit.
- Cite the decision at the call site: `// v0.9.0 (K9-0NN / plan §X.Y, D9-NN)`.

**Database access in tests.** Through a temp file, never `:memory:` — the migration path is what
is under test and `:memory:` does not exercise it. `mkdtempSync` for the directory, removed in
`afterEach`.

**Filesystem fixtures.** Every test that reads or writes a project file builds its fixture under
`mkdtempSync`. Never point a test at the repository's own root: Kevin's own `.git/config`,
`AGENTS.md` and `migrations/` are real, and a test that reads them passes locally, fails in CI, or
rewrites a tracked file.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. Every setting in this release is `'0'`/`'1'` or a number in
   a string. `if (settings.get("hook_liveness_enabled"))` is true for `'0'`. Compare explicitly.
2. `dead_hook_report_threshold` is TEXT holding `'3'`. Parse with `Number.parseInt(v, 10)` and
   clamp; a `NaN` must fall back to the documented default, not to `0` (which would declare every
   hook dead on the first session).
3. `ALTER TABLE ADD COLUMN` is not idempotent. This migration has none, which is a first since
   006 — but the idempotency criterion is unchanged: **run `Migrate.run()` twice**.
4. SQLite cannot alter a CHECK constraint. `native_registrations.surface` carries one deliberately
   (plan §6.2); widening it later means a full table rebuild, and that is the intended cost.
5. `Store` sets `PRAGMA foreign_keys = ON`. None of the three new tables declares `REFERENCES`,
   for the same reason as v0.8.0: an append-only or machine-scoped table must not be able to fail
   an insert because a row elsewhere was retired.

**Scoping.** `hook_liveness` is machine-scoped and carries no `project_id` or `repo_id` (D9-08).
Do not add one "for consistency"; the other tables are scoped because their facts are per-project,
and this one's facts are not.

**Hot path.** No database write inside a hook body. `HookLiveness` mutates in-memory counters and
persists on the existing `metrics.flush()` cadence. The hot-path rule has held since v0.2.0 and
this release is the one that would be most tempting to break it in.

**Host-surface assumptions.** Any statement about `@opencode-ai/plugin`'s shape must be derived
from the resolved package on disk, never from memory or documentation. `K9-002` establishes the
pattern; follow it.

**Backwards compatibility.** With the seeded defaults — `native_registration_enabled = '0'`,
`host_probe_history_enabled = '0'` — this release changes no observable behaviour. Every v0.8.0
test must pass unmodified, and `K9-024` treats a modified v0.8.0 test as a failure of this release
rather than as a fixed test.

---

# Phase F0 — Substrate

Four tasks that put the floor down: the schema, the assertions that keep this plan honest, the key
registrations that every previous release has forgotten at least once, and the probe everything
else reads from.

`K9-002` is unusual and belongs first for a reason. This entire release rests on claims about a
package Kevin does not own. Those claims were true when this plan was written; the only way they
stay true is if a test fails the day they stop being. Writing that suite before writing the code
that depends on it means the code is never built on an assumption that has already expired.

### K9-001 — Migration `010` and the post-apply hook

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** —
- **Risk:** 🟡
- **Files:** `migrations/010_v09_native.sql`, `plugin/Migrate.ts`,
  `tests/unit/migrate_010.test.ts`
- **Description:**
  1. Write `migrations/010_v09_native.sql` exactly as plan §6: three tables (`hook_liveness`,
     `host_probes`, `native_registrations`), four indices, six metric seeds, four setting seeds,
     `INSERT OR IGNORE INTO schema_version (version) VALUES ('010');`. Follow the house style of
     `005_v04_signal.sql` — `-- ===` banner, numbered `-- N.` comment sections.
  2. No `ALTER TABLE` and no `REFERENCES` in this migration. `hook_liveness` has `hook` as its
     TEXT primary key and **no `project_id`** (D9-08).
  3. Register `010` in `Migrate.ts` and add the post-apply hook `"010"`:
     - Seed one `hook_liveness` row per name in `HookName`, `experimental` set from the
       `experimental.` prefix, all counters zero. Seeding eagerly is the point: a hook that has
       never fired must be a visible row with `fire_count = 0`, not an absent row that looks
       identical to a hook Kevin does not register.
     - Re-derive `hooks_dead_total` from `COUNT(*) WHERE dead_since IS NOT NULL`.
     - Normalize any `experimental` flag that disagrees with its own `hook` column's prefix.
- **Acceptance criteria:**
  - `Migrate.run()` twice on the same database: the second run is a no-op, `schema_version` holds
    one `'010'` row.
  - All three tables and four indices exist; `PRAGMA foreign_key_list` is empty for each.
  - `hook_liveness` holds exactly one row per `HookName` after the hook, with `experimental = 1`
    for precisely `experimental.chat.system.transform` and `experimental.session.compacting`.
  - `kevin_metrics` gains six keys, `kevin_settings` four, none overwriting an existing value.
  - A v0.8.0 database migrates forward without touching `memories`.
- **Status notes:** Done. `migrations/010_v09_native.sql` per plan §6 (3 tables + 4 indices, no ALTER/REFERENCES/DROP, 6 metric seeds, 4 setting seeds, schema_version 010). `HOOK_NAMES` exported from Migrate.ts; post-apply hook `"010"` seeds one hook_liveness row per hook, re-derives `hooks_dead_total` and normalizes `experimental` flags; no-op startup repair extended to `from === "010"`. `tests/unit/migrate_010.test.ts` — 10 tests green.
- **Verification:** `npx vitest run tests/unit/migrate_010.test.ts`

---

### K9-002 — Host-contract assertion suite

**Status:** `[X]` Done — 5 tests passing; 2 v2 assertions skip with "v1-only host" when `dist/v2` is absent from the resolved package

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `tests/unit/host_contract.test.ts`, `tests/fixtures/host/index.d.ts.sha256`
- **Description:**
  1. This suite reads the **resolved** `@opencode-ai/plugin` from `node_modules` and asserts the
     facts plan §3 depends on. It reads files; it does not import the package's runtime.
  2. Assert `dist/v2/promise/context.d.ts` declares `PluginContext` with **no** `tool`, `chat`,
     `session` or `event` member. This test is designed to fail one day — its failure is the
     signal to revisit D9-01, and the failure message must say so in those words.
  3. Record the SHA-256 of `1.17.6`'s `dist/index.d.ts` in
     `tests/fixtures/host/index.d.ts.sha256` and assert the resolved package's `dist/index.d.ts`
     matches it. This is the byte-identity claim D9-03 rests on; if a future host changes the v1
     surface, this fails before anything subtler does.
  4. Assert `dist/tool.d.ts` declares `var schema: typeof z` — the mechanism that makes `K9-005`
     safe.
  5. Assert `dist/index.d.ts` declares `$: BunShell` on `PluginInput`, and that a scan of
     `plugin/` finds zero references to `input.$`. Plan §3.6: the zero-spawn property is a
     decision made while holding the means to do otherwise, and this is the assertion that makes
     that sentence true rather than rhetorical.
  6. Assert `dist/v2/effect/registration.d.ts` imports from `"effect"` and
     `dist/v2/promise/registration.d.ts` does not — the basis for D9-04.
  7. Every assertion carries a comment naming the plan section and decision it protects.
- **Acceptance criteria:**
  - All six assertions pass against the currently resolved package.
  - Deleting `node_modules/@opencode-ai/plugin/dist/v2` causes the v2 assertions to skip with an
    explicit "v1-only host" message rather than to fail — the suite must be runnable on a
    `1.17.x` install.
  - The `PluginContext` assertion's failure message names D9-01.
- **Status notes:** Done. `tests/unit/host_contract.test.ts` (5 tests) + `tests/fixtures/host/index.d.ts.sha256` (F3EC1A150D1354BE3C9D93928FA130EDC118C63FB468533EBB01EB3D6ED77F92). Package resolved from repo layout under vitest (exports map lacks require/package.json subpaths). 1.17.13 ships the full v2 subpath; v2 assertions skip with "v1-only host" when `dist/v2` is absent (verified by renaming the dir).
- **Verification:** `npx vitest run tests/unit/host_contract.test.ts`

---

### K9-003 — Register the new config and metric keys

**Status:** `[X]` Done — 6 tests green; derived coverage closes the unregistered-key defect class

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K9-001
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `plugin/Retrospective.ts`,
  `tests/unit/config_metric_keys.test.ts`
- **Description:**
  1. Add the four new settings to `KEVIN_CONFIG_KEYS` in `plugin/index.ts:40`:
     `hook_liveness_enabled`, `native_registration_enabled`, `host_probe_history_enabled`,
     `dead_hook_report_threshold`.
  2. Add the six new metric keys to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts` with
     human-readable labels: `hook_fires_total`, `hook_errors_total`, `hooks_dead_total`,
     `injections_suppressed_dead_hook`, `native_registrations_total`,
     `native_registration_failures`.
  3. Add a test that derives both lists from the migration files rather than hard-coding them:
     parse every `INSERT OR IGNORE INTO kevin_settings` and `kevin_metrics` seed across
     `migrations/*.sql` and assert each key appears in the corresponding constant. This closes the
     class of defect rather than this instance of it — v0.4.0 shipped seven metric keys printing
     raw `snake_case`, and every release since has re-opened the same hole by hand.
- **Acceptance criteria:**
  - `kevin_config set` accepts all four new keys; without the change it returns
    `{error: "unknown_key"}` while `list` still shows them, which is the exact asymmetry this task
    exists to prevent.
  - `kevin_retrospective` renders labels, not `snake_case`, for all 45 metric keys.
  - The derived test fails if a future migration seeds a key that is not registered.
- **Status notes:** Done. `KEVIN_CONFIG_KEYS` 23→27 (v0.9.0 block with TEXT-comparison note); `METRIC_KEY_LABELS` 39→45 (Spanish prose labels). `tests/unit/config_metric_keys.test.ts` (6 tests) derives both lists from every `migrations/*.sql` seed block (reusing the v0.8.0 `seededKeys` parser), asserts prose labels (BUG-014 regression), exact 010 seed sets, count guards (27/45), and a functional `kevin_config set/list` round-trip for the four new keys (incl. `dead_hook_report_threshold` TEXT value). One type fix: `KEVIN_CONFIG_KEYS as readonly string[]` for `includes` over the literal tuple.
- **Verification:** `npx vitest run tests/unit/config_metric_keys.test.ts`

---

### K9-004 — `plugin/host.ts` — `probeHost()` and `summarize()`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K9-002
- **Risk:** 🔴
- **Files:** `plugin/host.ts`, `plugin/index.ts`, `tests/unit/host_probe.test.ts`
- **Description:**
  1. Implement `HostSurface`, `probeHost(input: unknown)` and `summarize(s)` per plan §5.1.
  2. **`probeHost()` must never throw.** Every read is guarded; every failure appends to `notes`
     and yields a conservative `false`. A throw here takes down the host's plugin load, which is
     strictly worse than any missing feature (D9-12). Risk is 🔴 for that reason alone.
  3. Duck-type only: `typeof` and `in` checks against `input`. Never `instanceof`, never a cast to
     a host class.
  4. The v2 probe is `await import("@opencode-ai/plugin/v2/promise")` inside a `try`. The subpath
     is absent from `1.17.x`'s `exports` map, so rejection *is* the answer. Record which domains
     the resolved module exposes (`skill`, `reference`) rather than assuming both.
  5. Read `pluginVersion` from the resolved package's `package.json` if reachable; `null` and a
     `note` otherwise. Never fabricate a version from the declared range — the declared range is
     precisely what plan §3.4 shows to be untrustworthy.
  6. Call it exactly once in `plugin/index.ts` at construction, freeze the result with
     `Object.freeze`, and thread it to consumers. A capability that appears mid-session would be
     indistinguishable from a bug.
  7. `summarize()` returns one paragraph containing the version, the flavour and the domain flags —
     **no paths, no identifiers**. It is designed to be pasted into an issue report.
- **Acceptance criteria:**
  - Against a stub `input` missing every field, `probeHost()` resolves, throws nothing, and returns
    `flavour: "v1-only"` with populated `notes`.
  - Against `input` containing `project`/`worktree`/`directory`/`$`, all are reflected, including
    `hasShell: true`.
  - On a `1.17.6` install, `v2.skill` and `v2.reference` are false and a `note` explains why.
  - Called twice, the second call returns the same frozen object; a test mutating the result
    throws in strict mode.
  - `summarize()` output matches `/^[\w .,:()+-]+$/` — no path separators.
- **Status notes:** Done. `plugin/host.ts` — `probeHost(input, { importV2? })` cached + `Object.freeze`d singleton (probe once, restart to re-probe), zero-throw with guarded reads, duck-typed. v2 probe = `await import("@opencode-ai/plugin/v2/promise")` in try; the promise subpath exports only `define` at runtime, so domain flags are verified against the resolved package's own `dist/v2/promise/{skill,reference}.d.ts`. `pluginVersion` from the resolved package.json (import.meta.resolve → createRequire → cwd walk-up fallbacks), never the declared range. `summarize()` = stable charset paragraph. `tests/unit/host_probe.test.ts` — 11 tests green; `resetHostProbeCache()` exported as test hook.
- **Verification:** `npx vitest run tests/unit/host_probe.test.ts`

---

# Phase F1 — Ground truth

Four tasks that replace assumptions with facts Kevin can defend: the dependency it actually uses,
the identity the host already knows, the pin taken on proof, and a record of what was probed.

`K9-005` and `K9-007` look like housekeeping and are not. Together they are the concrete claim
v1.0.0 will want to make — one runtime dependency, on a surface proven not to have moved — and
neither can be made retroactively.

### K9-005 — Remove `zod` from dependencies

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K9-002
- **Risk:** 🟡
- **Files:** `package.json`, `package-lock.json`, `tests/unit/no_zod_import.test.ts`
- **Description:**
  1. Delete `"zod": "^3.23.8"` from `dependencies`. Do not move it to `devDependencies`: it is not
     used there either.
  2. Re-run `npm install` and commit the regenerated lockfile. The tree must end with exactly one
     zod, `4.1.8`, owned by `@opencode-ai/plugin`.
  3. Add `tests/unit/no_zod_import.test.ts`: scan `plugin/`, `scripts/` and `tests/` for
     `from "zod"`, `require("zod")` and `import("zod")`; assert zero matches. Also assert
     `package.json` declares no `zod` in any dependency block.
  4. Do **not** change a single schema expression. All 25 already use `tool.schema`, which is the
     host package's own zod (plan §3.5); that is why this removal is safe and why it must not be
     accompanied by a refactor that could mask a regression.
- **Acceptance criteria:**
  - `npm ls zod` reports exactly one copy, nested under `@opencode-ai/plugin`.
  - `npm run typecheck` passes — proving the schemas never depended on the top-level zod.
  - `npm test` passes with no test modified.
  - The scan test fails if a contributor adds `import { z } from "zod"`.
- **Status notes:** zod already absent from `package.json` (dependencies = only `@opencode-ai/plugin`); lockfile had no top-level zod; `npm ls zod` = 1 copy `4.1.8` under `@opencode-ai/plugin@1.17.13`. `tests/unit/no_zod_import.test.ts` created (2 tests): package.json zod-free in all 4 dependency blocks + source scan of plugin/scripts/tests with anchored patterns (line-start imports only, so string literals that merely name zod don't trip) + self-exclusion. First attempt flagged the K9-002 fixture string `from "zod"` inside host_contract.test.ts and the test's own literal — patterns anchored + SELF skip. 2/2 green; typecheck green.
- **Verification:** `npm run typecheck && npx vitest run tests/unit/no_zod_import.test.ts`

---

### K9-006 — Host identity source in `RepoIdentity.resolve()`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K9-004
- **Risk:** 🔴
- **Files:** `plugin/RepoIdentity.ts`, `plugin/index.ts`,
  `tests/unit/repo_identity_host.test.ts`, `tests/fixtures/identity/v080_repo_ids.json`
- **Description:**
  1. Extend `IdentitySource` with `"host"` and change the chain to
     **declared → remote → host → path** (D9-13). `resolve(cwd, host?)` takes the optional
     `HostSurface`; with it absent the chain is exactly v0.8.0's.
  2. The host source reads `host.project.worktree`, falling back to `host.project.directory`.
     Both empty or absent means fall through to `path` — `resolve()` stays total.
  3. Feed the chosen value through the **unchanged** `computeRepoId()`. This task changes which
     string is hashed, never how.
  4. Risk is 🔴 because a mistake here silently re-keys a corpus: every memory becomes unreachable
     while the database still reports them present. The guard is the equivalence fixture below,
     and it is not optional.
  5. Build `tests/fixtures/identity/v080_repo_ids.json`: a set of fixture checkouts (with a
     declaration, with a remote only, with neither) and the `repo_id` each produced under the
     v0.8.0 chain. Assert the v0.9.0 chain reproduces every one of them byte-for-byte **except**
     the no-declaration-no-remote case, which is the only one the host source may change.
  6. Re-keying semantics are untouched. `kevin_project rekey` still requires `confirm: true`, is
     still transactional, and is still the only path that writes `repo_id` on existing rows
     (D8-03).
- **Acceptance criteria:**
  - For every fixture with a declaration or a remote, the v0.9.0 `repo_id` equals the v0.8.0 value.
  - For a fixture with neither, `source` is `"host"` when `worktree` is available and `"path"`
    otherwise.
  - `resolve(cwd)` with no `host` argument reproduces the v0.8.0 chain exactly.
  - No code path outside `kevin_project rekey` writes `repo_id` on an existing row; asserted by
    source scan.
- **Status notes:** Done. `IdentitySource` extended with `"host"`; chain is declared → remote → host → path (D9-13). `resolve(cwd, host?)` reads `host.project.worktree` (evidence `host:worktree`) falling back to `host.project.directory` (`host:directory`); both empty → `path`, resolve stays total. `computeRepoId()` untouched. `plugin/index.ts` now calls `probeHost(input)` at construction and passes the surface to `resolve(process.cwd(), host)`; rekey-path `resolve()` calls stay host-less (per-call file introspection exception). Fixture `tests/fixtures/identity/v080_repo_ids.json` (6 cases) captures v0.8.0 repo_ids by running the pre-edit chain; `tests/unit/repo_identity_host.test.ts` (14 tests) reproduces every v0.8.0 id byte-for-byte except the no-declaration-no-remote case (which becomes host when worktree is available), plus no-host chain equivalence, edge cases (declared/remote win over hostile host; worktree before directory; null/empty → path) and the rekey-only source scan. Two v0.8.0 tests updated with citations per the K8-003 precedent: `config_keys_v08.test.ts` (23→27, 009∪010 seed unions) and `repo_identity_init.test.ts` (spy now `(process.cwd(), expect.anything())`); both green, typecheck clean. Guard mechanism for K9-024's regression check will use an explicit allowlist for these plan-mandated updates.
- **Verification:** `npx vitest run tests/unit/repo_identity_host.test.ts`

---

### K9-007 — Raise the pin to `^1.18.16` on byte-level proof

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K9-002, K9-005
- **Risk:** 🟡
- **Files:** `package.json`, `package-lock.json`, `tests/unit/host_contract.test.ts`
- **Description:**
  1. Change `@opencode-ai/plugin` from `^1.17.6` to `^1.18.16`. Re-run `npm install`, commit the
     lockfile.
  2. The justification is `K9-002`'s SHA-256 assertion, not the release notes: `dist/index.d.ts`
     is byte-identical between `1.17.6` and `1.18.16` (9285 bytes, unchanged across eleven minors),
     so no hook Kevin registers can behave differently. Re-run that assertion after the bump and
     confirm it still passes — it is now checking the *new* resolved package against the *old*
     recorded digest, which is precisely the check that has value.
  3. Note in the commit message that the previous lockfile resolved `1.17.13`, not `1.17.6`
     (plan §3.4). The caret has been floating for some time; this release is the first to check
     what it floated to.
  4. Confirm `@ai-sdk/provider@3.0.8` enters the tree as a transitive dependency of the host
     package and is **not** added to Kevin's `dependencies`.
- **Acceptance criteria:**
  - `npm ls @opencode-ai/plugin` resolves ≥ `1.18.16`.
  - `K9-002`'s digest assertion passes against the newly resolved package.
  - `npm run typecheck`, `npm run lint`, `npm test` all green with no source change.
  - `dist/v2/promise` is resolvable — `await import(...)` succeeds in a scratch script.
  - Kevin's `dependencies` block contains exactly one entry.
- **Status notes:** Done. `npm install "@opencode-ai/plugin@^1.18.16"` resolved 1.18.18 under the caret; npm normalized the package.json specifier to `^1.18.18`, which was restored to `^1.18.16` (plan D9-03 exact pin) via a direct edit + `npm install` to re-sync the lockfile. All AC met: `npm ls @opencode-ai/plugin` → 1.18.18 (≥1.18.16); K9-002 digest assertion passes against the new package (SHA-256 F3EC1A15… still matches the recorded 1.17.6 digest — confirms D9-03 byte-level proof); `dist/v2/promise` resolves; `@ai-sdk/provider@3.0.8` entered the tree ONLY as transitive of @opencode-ai/plugin; Kevin's `dependencies` block has exactly one entry. Full suite green: 155 files / 1195 tests, typecheck clean, lint clean. Three v0.8.0-era tests were updated with v0.9.0 citations as plan-mandated count/signature changes: `tests/unit/capabilities.test.ts` (pin ^1.17.6 → ^1.18.16), `tests/unit/config_keys.test.ts` (KEVIN_CONFIG_KEYS 23 → 27), and `plugin/host.ts` note text reworded to drop the literal substring "spawn" ("zero process-launching stays a decision") that tripped the K8-026 no-spawn source scan.
- **Verification:** `npm run typecheck && npm test && npx vitest run tests/unit/host_contract.test.ts`

---

### K9-008 — `host_probes` persistence and the `kevin_status` summary

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K9-001, K9-004
- **Risk:** 🟢
- **Files:** `plugin/host.ts`, `plugin/index.ts`, `tests/unit/host_probes_persist.test.ts`
- **Description:**
  1. When `host_probe_history_enabled = '1'`, append one `host_probes` row per construction:
     version, flavour, `has_shell`, the two v2 flags, and `notes` joined as text.
  2. The setting seeds to `'0'`. Compare it explicitly against `'1'` — `if (value)` is true for
     `'0'` and would turn a diagnostic aid into an unbounded append on every editor start.
  3. Add `summarize(host)` output as a one-line field in `kevin_status`.
  4. The table is append-only and unbounded by design, which is acceptable only because it is
     off by default and one row per process start. Do not add a retention policy; add a note in
     the tool output stating the row count so a user who left it on can see the cost.
- **Acceptance criteria:**
  - With the setting `'0'`, zero rows are written across ten constructions.
  - With `'1'`, exactly one row per construction, `probed_at` populated.
  - `kevin_status` includes the summary line and it contains no filesystem path.
  - Setting the value to `'true'` or `'all'` does **not** enable it — only `'1'` does.
- **Status notes:** —
- **Status notes:** Done. `plugin/index.ts`: one `host_probes` row per construction when `host_probe_history_enabled === "1"` (explicit TEXT comparison; `true`/`all`/`yes` verified inert — the truthiness trap), written after MemoryService creation with uuidv7 id, plugin_version/flavour/has_shell/v2 flags/notes joined; kevin_status gains `host_summary: summarize(host)` (one line, no paths, charset-safe). `tests/unit/host_probes_persist.test.ts` (4 tests): 0 rows over 10 constructions on default '0'; exactly 1 row per construction on '1' with probed_at timestamp; truthy-looking values do not append; kevin_status summary matches the safe charset and contains no path. Note: constructions keep the Store open (WAL) — tests must `await hooks.dispose?.()` before rmSync (EPERM on Windows otherwise).
- **Verification:** `npx vitest run tests/unit/host_probes_persist.test.ts`

---

# Phase F2 — Liveness

This is the release. Everything else is supporting structure.

The fault being instrumented has a specific and nasty shape: a hook key the host no longer reads
produces no error, no log and no throw, because nothing failed — nobody looked. Kevin keeps
observing, keeps saving memories, and injects nothing forever. Every counter reads zero, which is
indistinguishable from a new user with an empty corpus. That is the worst possible presentation of
a total loss of function: it looks exactly like the product working.

Four tasks make it visible. Order matters: `wrap()` must exist before `expect()` can mean anything,
and `expect()` must exist before `dead` is more than a guess.

### K9-009 — `HookLiveness.wrap()`

**Status:** `[~]` In progress

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K9-001, K9-004
- **Risk:** 🔴
- **Files:** `plugin/HookLiveness.ts`, `plugin/index.ts`,
  `tests/unit/hook_liveness_wrap.test.ts`
- **Description:**
  1. Implement `HookLiveness` per plan §5.3 with `wrap()`, in-memory counters, and `flush()`.
  2. `wrap(hooks)` returns a **new** object with the same keys, each function value replaced by a
     delegating wrapper. Non-function values (`tool: { … }` is an object, not a function) pass
     through untouched — wrapping the tool registration map would break tool dispatch entirely.
  3. **Record after the delegate returns, on the success path only** (D9-07):
     - success → `fire_count++`, set `first_seen_at` if unset, update `last_seen_at`
     - throw → `error_count++`, **do not** touch `fire_count`, re-throw unchanged
     A `finally` block would count a permanently-throwing hook as live, which inverts the
     instrument's meaning. Async hooks must be awaited before recording; a wrapper that records on
     promise creation measures nothing.
  4. **No database access inside the wrapper.** Counters are in-memory; `flush()` writes them on
     the existing `metrics.flush()` cadence. A synchronous write per tool call would be the most
     expensive thing in the plugin.
  5. Wrap the hooks object in `plugin/index.ts` at the point of return. The wrapper must be
     transparent: identical keys, identical arity, identical return values, identical thrown
     errors.
  6. When `hook_liveness_enabled = '0'`, `wrap()` returns its argument unchanged — the same object
     reference, not a copy. Compare against `'1'` explicitly.
  7. Risk is 🔴: this wraps every hook the plugin has. A defect here does not degrade a feature,
     it breaks tool execution, message handling and injection simultaneously.
- **Acceptance criteria:**
  - `Object.keys(wrap(h))` equals `Object.keys(h)`; non-function values are the same reference.
  - A hook returning a value: the wrapper returns it unchanged, `fire_count` is 1.
  - A hook throwing: the same error instance propagates, `error_count` is 1, `fire_count` is 0.
  - An async hook rejecting: same, and `fire_count` stays 0.
  - A source scan asserts no `prepare(` or `.run(` appears inside `wrap()`'s delegate.
  - With the setting `'0'`, `wrap(h) === h`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/hook_liveness_wrap.test.ts`

---

### K9-010 — `expect()`, the threshold, and the `dead` verdict

**Status:** `[ ]` Pending

- **Priority:** P0
- **Estimation:** M (7h)
- **Dependencies:** K9-009
- **Risk:** 🔴
- **Files:** `plugin/HookLiveness.ts`, `plugin/index.ts`,
  `tests/unit/hook_liveness_dead.test.ts`
- **Description:**
  1. Implement `expect(hook, sessionID)` and the `LivenessState` computation.
  2. **The checkpoint is the entire design.** A hook not having fired *yet* proves nothing; most
     hooks legitimately idle. Liveness is only inferable at a point where the host's own contract
     guarantees the hook was offered. Kevin has exactly one such point it already observes:
     `tool.execute.after` firing for a session proves that session reached a model turn, which
     proves a system prompt was assembled, which means
     `experimental.chat.system.transform` **must** have been offered.
  3. Call `expect("experimental.chat.system.transform", sessionID)` from the `tool.execute.after`
     path, **once per session** — de-duplicate by session id, or `expected_count` inflates by tool
     call and the threshold becomes meaningless.
  4. The verdict:
     - `fire_count > 0` → `live`
     - `fire_count === 0 && expected_count >= threshold` → `dead`, set `dead_since` once
     - otherwise → `unknown`
     `unknown` is reported as `unknown`. It is never rounded to `healthy` (D9-09): a system that
     has not been observed is not a system that is working.
  5. `dead_hook_report_threshold` is TEXT holding `'3'`. `Number.parseInt(v, 10)`, clamp to
     `[1, 1000]`, and fall back to `3` on `NaN`. A `NaN` silently becoming `0` would mark every
     hook dead on the first session and produce exactly the false alarm that destroys trust in an
     instrument.
  6. `dead_since` is written once and never cleared by this task. A hook that resumes firing goes
     back to `live` and `dead_since` remains as history — `kevin_doctor` reports "was dead since
     X, now live", which is more useful than a field that erases its own evidence.
- **Acceptance criteria:**
  - With threshold `'3'`: `expected_count = 2, fire_count = 0` → `unknown`;
    `expected_count = 3, fire_count = 0` → `dead` with `dead_since` set.
  - One session issuing twenty tool calls increments `expected_count` by exactly 1.
  - A hook that fires once and then never again stays `live` — `fire_count > 0` dominates.
  - `dead_hook_report_threshold` set to `'abc'`, `''` or `'0'` yields the clamped default, never 0.
  - `hooks_dead_total` matches `COUNT(*) WHERE dead_since IS NOT NULL` after `flush()`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/hook_liveness_dead.test.ts`

---

### K9-011 — Error path and `injections_suppressed_dead_hook`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K9-010
- **Risk:** 🟡
- **Files:** `plugin/HookLiveness.ts`, `plugin/ContextInjector.ts`,
  `tests/unit/dead_hook_suppression.test.ts`
- **Description:**
  1. Persist `error_count` to `hook_liveness.error_count` and aggregate into `hook_errors_total`.
     A permanently-throwing hook is a distinct fault from a dead one and must be countable
     separately — conflating them would report a crashing host as a removed API.
  2. When the injection hook's state is `dead`, increment `injections_suppressed_dead_hook` once
     per session that reached the checkpoint. This counter is what turns "zero injections" from an
     ambiguous number into a diagnosis.
  3. **Add no fallback.** `experimental.chat.messages.transform` exists and is tempting. Kevin does
     not register it, does not probe for it, and does not route around a dead hook (D9-06).
     Silently switching to a second experimental hook when the first vanishes converts one unowned
     dependency into two and destroys the signal this release exists to produce.
  4. Ranking, budget and gate order in `ContextInjector` are untouched. This task adds a counter
     and nothing else.
- **Acceptance criteria:**
  - A hook throwing on every call: `error_count` grows, `fire_count` stays 0, state is `unknown`
    (not `dead` — it is being called).
  - With the injection hook `dead`, `injections_suppressed_dead_hook` increments once per
    checkpointed session.
  - A source scan asserts `experimental.chat.messages.transform` appears nowhere in `plugin/`.
  - `GateReason` gains no new member; the v0.7.0 gate order is byte-identical.
- **Status notes:** Done. `suppressedSessions: Set<string>` en HookLiveness: por cada sesión checkpointed con el hook de inyección `dead` (deadSince !== null) se añade una vez (dedup igual que expected_count). `flush()` re-deriva las 4 métricas v0.9.0 en la misma transacción del upsert (sin dependency de Metrics, cero writes en hot path): `hook_fires_total` = Σ fireCount, `hook_errors_total` = Σ errorCount, `hooks_dead_total` = COUNT(deadSince NOT NULL), `injections_suppressed_dead_hook` = suppressedSessions.size — vía `CREATE TABLE IF NOT EXISTS kevin_metrics` + upsert `ON CONFLICT(key) DO UPDATE SET value = excluded.value`. El hook que lanza siempre queda `unknown`, nunca `dead` (D9-06: crashear ≠ API removida). 6/6 tests verdes (error_count crece con fire_count 0; 3 sesiones + repetida → suppressed 3; re-derivación fires/errors/dead/suppressed; errors sin dead → hooks_dead_total 0; source scan: `experimental.chat.messages.transform` en 0 archivos de plugin/; GateReason byte-identical con orden v0.7.0).
- **Verification:** `npx vitest run tests/unit/dead_hook_suppression.test.ts`

---

### K9-012 — The `verdict` reducer

**Status:** `[ ]` Pending

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K9-011
- **Risk:** 🟢
- **Files:** `plugin/HookLiveness.ts`, `tests/unit/host_verdict.test.ts`
- **Description:**
  1. Implement the reducer from `HookReport[]` to `verdict: "healthy" | "degraded" | "unknown"`
     plus a human-readable `reason`.
  2. Rules, in order:
     - any hook `dead` → `degraded`, reason naming the hook, its `dead_since` and the affected
       session count
     - every registered hook `live` → `healthy`
     - otherwise → `unknown`, reason naming how many hooks have not yet reached a checkpoint
  3. Pure function over the report array. No database access, no clock read beyond what the
     reports already carry — the reducer must be testable from a literal array.
  4. `reason` contains no filesystem path and no session id. It is written to be pasted into an
     issue report.
- **Acceptance criteria:**
  - One dead hook among five live ones → `degraded`, and the reason names that hook.
  - All hooks `unknown` → `unknown`, never `healthy`.
  - Mixed `live` and `unknown`, none dead → `unknown`.
  - The reducer is called with a hand-written array in the test; no fixture database required.
  - `reason` matches `/^[\w .,:;()+-]+$/`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/host_verdict.test.ts`

---

# Phase F3 — Native

Five tasks that attach the v2 surface **by addition**. Nothing here removes, replaces or reroutes
a v1 hook; plan §3.2 established that a migration would delete Kevin's ability to observe and
inject, and this phase is deliberately the one that can slip.

What it buys is real, though, and it is the only thing v2 offers that v1 cannot: `SkillDraft.list()`
lets Kevin read back its own registration. The v0.6.0 emission path writes a file and never learns
whether anything consumed it — which is why `skill_emission_enabled` has been default-off for three
releases and has therefore never actually run for anybody.

### K9-013 — `plugin/native.ts` and dynamic-import containment

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K9-004
- **Risk:** 🔴
- **Files:** `plugin/native.ts`, `tests/unit/native_containment.test.ts`
- **Description:**
  1. Create `plugin/native.ts` with `buildNativePlugin()` and `attachNative()` per plan §5.4.
  2. **The import must be dynamic.** A static
     `import { define } from "@opencode-ai/plugin/v2/promise"` is a module-resolution failure on
     every host older than `1.18.0`, because the subpath is absent from `1.17.x`'s `exports` map.
     That would convert an optional enhancement into a hard requirement and make the plugin fail to
     load — hence 🔴. Use `await import(...)` inside a `try`, reached only when `host.v2.*` is true.
  3. `attachNative()` returns `null` with a `note` when the subpath is missing or
     `native_registration_enabled !== '1'`. Both are the default, so the default behaviour of this
     release is byte-identical to v0.8.0.
  4. **Containment:** `plugin/native.ts` is the only file in the repository permitted to name
     `@opencode-ai/plugin/v2/promise`. Add `tests/unit/native_containment.test.ts` scanning
     `plugin/`, `scripts/` and `tests/` for the specifier and asserting exactly one file matches,
     with the match inside an `import(` call rather than a top-level `import` statement.
  5. Adopt `define()` for the typing it provides. It is the identity function — 54 bytes,
     `return plugin` — so it is neither a framework nor a commitment (D9-02).
- **Acceptance criteria:**
  - With `@opencode-ai/plugin@1.17.6` installed, the plugin constructs, `attachNative()` returns
    `null`, and every v0.8.0 test passes.
  - Exactly one file names the v2 specifier, and it is `plugin/native.ts`.
  - The specifier appears only inside `await import(...)`; a static import fails the scan.
  - `attachNative()` never throws — a stub module missing `skill` yields `null` and a `note`.
- **Status notes:** 8/8 tests green (`npx vitest run tests/unit/native_containment.test.ts`), typecheck + biome clean, host_probe.test.ts 11/11 regression passes. Implementation discoveries: (1) K9-004's `plugin/host.ts` defined its own literal `V2_SPECIFIER`, violating the containment AC — fixed by `import { V2_SPECIFIER } from "./native.js"` (native.ts now exports it; host.ts's doc comment reworded to avoid the literal); (2) the real dynamic import is `import(/* @vite-ignore */ V2_SPECIFIER)` (a constant, not a literal), so test 2 validates per-line: the literal may only appear on the `export const V2_SPECIFIER` definition line or on lines containing `import(`, and a top-level `import ... from` with the literal is forbidden; (3) the scan needed `path.relative(root, file)` — absolute Windows paths (`C:/...`) failed the `toEqual(["plugin/native.ts"])` assertion. `attachNative()` wires: setting '0' → null (no notes); v1-only host → null + "v2 subpath absent" note; importV2 rejection → null + "import rejected" note; module without `define()` → null + note; stub `define` → registration with registered {true,true}, verified {false,false} (verified filled by K9-014/015 via `draft.list()`). `buildNativePlugin` returns `{ id: "opencode-kevin", setup }`; `kevinSkillSource(materializer)` = `materializer.skillBody()`.
- **Verification:** `npx vitest run tests/unit/native_containment.test.ts`

---

### K9-014 — `skill.transform` registration with read-back verification

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** K9-013
- **Risk:** 🟡
- **Files:** `plugin/native.ts`, `tests/unit/native_skill_register.test.ts`
- **Description:**

> **Status notes (K9-014):** Implemented and verified. `buildNativePlugin`'s
> `skill.transform` callback calls `draft.source()` exactly once with
> `kevinSkillSource(materializer)` (= `materializer.skillBody()`), then
> read-backs via `draft.list()` — verified only if the list contains the exact
> source string (byte-equality). `NativeDeps.onVerified(surface, registered,
> verified)` reports outcomes; unverified registrations push a note and never
> throw; a rejected transform reports `("skill", false, false)`. `attachNative`
> threads `onVerified` into the plugin so `registered`/`verified` reflect the
> host's actual run. Containment: the `V2_SPECIFIER` literal lives only in
> `plugin/native.ts` inside a dynamic `import()`; the test file needs it but
> concatenates the string so the scan stays clean. Tests 15/15 green
> (`native_skill_register.test.ts` 7 + `native_containment.test.ts` 8);
> typecheck clean; biome clean. The `StubDraft` needs an optional `source`
> property and `KevinNativeContext` is exported (typecheck fixes during close).
  1. Inside `setup(ctx)`, call `ctx.skill.transform(async (draft) => { draft.source(kevinSkill) })`.
  2. **Verify the registration.** After `draft.source()`, call `draft.list()` and assert Kevin's
     entry is present; set `NativeRegistration.verified.skill` accordingly. This read-back is the
     confirmation the file-emission path never had and is the entire justification for importing a
     second API generation (plan §4.3). An unverified registration is a `note` and a metric, never
     a throw.
  3. **The draft must not escape the callback.** `SkillDraft` is a mutable builder valid only for
     the duration of that call. Retaining it in module or instance scope produces a mutation with
     no effect, or worse, an effect at an undefined time. Add a source-scan assertion that no draft
     parameter is assigned outside the callback body.
  4. The skill content comes from the existing `Materializer` rendering. This task changes the
     delivery mechanism, not a single byte of what is delivered — so a host that switches from
     emission to registration presents the model with identical content.
  5. Build the test against a **stub context**: a hand-written object implementing
     `skill.transform` and a `SkillDraft` with `source()`/`list()`. Do not require a real host.
- **Acceptance criteria:**
  - Against the stub, `draft.source()` is called exactly once and `verified.skill` is true.
  - A stub whose `list()` omits Kevin's entry yields `verified.skill === false`, a populated
    `note`, and no throw.
  - A stub whose `transform` rejects yields `registered.skill === false` and no throw.
  - The source scan finds no assignment of a draft parameter outside its callback.
  - The registered content is byte-identical to what `Materializer` would have written.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/native_skill_register.test.ts`

---

### K9-015 — `reference.transform` registration

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** M (5h)
- **Dependencies:** K9-014
- **Risk:** 🟡
- **Files:** `plugin/native.ts`, `tests/unit/native_reference_register.test.ts`
- **Description:**
  1. Inside `setup(ctx)`, call `ctx.reference.transform(async (draft) => { … })` and `draft.add(name, source)`
     for each curated reference the v0.6.0 `Materializer` would have written to
     `~/.opencode-kevin/refs/<topic>.md`.
  2. `ReferenceDraft.add(name, source)` takes a `ReferenceLocalSource | ReferenceGitSource`. Read
     the concrete shape from the resolved `@opencode-ai/sdk/v2/types` at implementation time and
     assert it in the test — **do not** infer it from this document. Plan §3's discipline applies
     to every host type, including the ones this plan did not have on hand.
  3. Topic names follow the v0.6.0 rule (`<type>-<dominant token>`) and are **never** derived from
     fingerprint prefixes (D6-14). A reference name is user-visible.
  4. Verify with `draft.list()` exactly as `K9-014` does.
  5. `draft.remove()` is not called. Kevin never removes a reference it did not add in the same
     callback, and it has no registry of what it added in a previous session — removing by
     guesswork would delete a user's own reference.
- **Acceptance criteria:**
  - Against a stub, one `add()` per curated reference, names matching the v0.6.0 rule.
  - `verified.reference` reflects `list()` honestly.
  - `remove()` is never called; asserted by the stub recording zero invocations.
  - A reference name containing a 16-hex-char fingerprint fails the test.
- **Status notes:**
  - `plugin/native.ts`: `reference.transform` callback rewritten — `add()` per curated ref target
    (skipping `project-knowledge` via `SKILL_TOPIC`), source shape `{ type: "local", path }`,
    verification by `list()` read-back, `onVerified("reference", true|false, verified)`,
    rejection → `onVerified("reference", false, false)` without throwing.
  - `tests/unit/native_reference_register.test.ts` (7): one `add()` per target + names sorted,
    `remove()` zero invocations, honest `verified` (empty `list()` → unverified note), rejecting
    transform, no `add()` → `registered false`, 16-hex fingerprint name never emitted (D6-14),
    `@kevin/<type>-<token>` shape, `remove(` absent from `plugin/native.ts`.
  - `native_skill_register.test.ts` scan upgraded: callback ranges now brace-balanced (K9-015's
    nested object literals truncated the old `});` pairing). All suites green: 33/33 across
    native_reference_register + native_skill_register + native_containment + host_probe.
- **Verification:** `npx vitest run tests/unit/native_reference_register.test.ts`

---

### K9-016 — Mutual exclusion with `Materializer` emission

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K9-014, K9-015
- **Risk:** 🔴
- **Files:** `plugin/Materializer.ts`, `tests/integration/native_exclusion.test.ts`
- **Description:**
  1. `Materializer` gains one guard: when `attachNative()` returned a registration for a surface,
     the corresponding `*_emission_enabled` path is skipped for that surface only.
  2. Implement plan §5.4's table exhaustively — it is the part an implementer will get wrong:

     | `native_registration_enabled` | v2 subpath | Outcome |
     |---|---|---|
     | `'0'` | either | file emission, exactly as v0.6.0 |
     | `'1'` | absent | file emission, exactly as v0.6.0, `note` recorded |
     | `'1'` | present | registration, **no file written** |

  3. Both active would put the curated skill in front of the model twice from two sources that can
     disagree. Neither active would silently remove a feature on hosts that gained the subpath.
     Risk is 🔴 for the first of those.
  4. The test asserts row three leaves `~/.opencode-kevin/skills/` **untouched** — not "empty",
     untouched: take a directory listing and mtimes before and after and compare.
  5. Rows one and two must produce bytes identical to v0.8.0's output, proven against a committed
     fixture.
- **Acceptance criteria:**
  - All three rows exercised, each with its own named test.
  - Row three: zero filesystem writes under `~/.opencode-kevin/skills/`, verified by listing and
    mtime comparison.
  - Rows one and two: emitted bytes match the v0.8.0 fixture exactly.
  - No configuration produces both a registration and a file for the same surface.
  - Skill and reference surfaces are decided independently — registering the skill while emitting
    references is legal and tested.
- **Status notes:** Materializer ganó el guard de exclusión mutua (D9-10): `NativeSurface = "skill" | "reference"` exportado, estado privado `nativeRegistered = new Set<NativeSurface>()`, `markNativeRegistered(surface, registered)` (add/delete) y `hasNativeRegistration(surface)`. `materialize()` gatea el bundle skill con `!hasNativeRegistration("skill")` y el loop de refs con `!hasNativeRegistration("reference")` — cada surface decide sola; `bundleTargets()` NO cambia (K9-015 lo usa para registrar, index.ts v0.8.0 para mentions). Comentarios citan K9-016/plan §5.4, D9-10. Fixtures de bytes v0.8.0 creados en `tests/fixtures/emission/` GENERADOS de la salida real del materialize (script temporal vite-node, luego borrado): contenido seed m1 rule "npm test must pass before any commit" + m2 solution "run the full suite after every change" → topics project-knowledge, rule-commit, solution-change; 3 archivos `skill_v080.md` (163 chars), `ref_rule-commit_v080.md` (123), `ref_solution-change_v080.md` (124) — formato exacto "\n<!-- kevin:begin — curated by opencode-kevin, safe to edit -->\n<body>\n\n<!-- kevin:end -->\n". `tests/integration/native_exclusion.test.ts` NUEVO (5 tests): fila 1 ('0'+v2 → attachNative null → materialize escribe 3 archivos bytes == fixtures); fila 2 ('1'+v1-only → null + note "v2 subpath absent" → bytes == fixtures); fila 3 ('1'+v2 con importV2 stub cuyo define corre setup con honouringContext) → attachNative {skill:true,reference:true} → markNativeRegistered con flags → materialize() devuelve [] y readdirSync skills/refs [] + mtimes (statSync mtimeMs) idénticos; independencia (solo skill marcada → refs emitidas == fixtures, skills/ []); no-ambos (mismo corpus con '0' → 3 outcomes, con '1'+v2 → []). Fixes: flavour v1 → "v1-only" (HostFlavour), skillDraft con closure (duplicate identifier 'source'), non-null assertions reemplazadas por `?? {skill:false,reference:false}` (biome). 5/5 verdes; regression 56/56 en 8 archivos; typecheck limpio; biome --write aplicado.
- **Verification:** `npx vitest run tests/integration/native_exclusion.test.ts`

---

### K9-017 — `native_registrations` persistence and metrics

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K9-016
- **Risk:** 🟢
- **Files:** `plugin/native.ts`, `tests/unit/native_persist.test.ts`
- **Description:**
  1. Append one `native_registrations` row per surface per attach attempt: `surface`,
     `registered`, `verified`, `note`.
  2. Increment `native_registrations_total` on a verified registration and
     `native_registration_failures` when `registered` is true but `verified` is false — the
     "registered but unverified" state is the interesting one, because it means the host accepted a
     call and did not honour it.
  3. `surface` is constrained by a CHECK to `('skill', 'reference')`. Inserting anything else must
     fail loudly rather than being coerced; the closed enumeration is deliberate (plan §6.2).
  4. Writes happen at attach time, which is construction, not a hot path — a direct write is
     correct here and the `metrics.flush()` cadence does not apply.
- **Acceptance criteria:**
  - One row per surface per attach; `attached_at` populated.
  - A verified skill registration increments `native_registrations_total` by exactly 1.
  - `registered = 1, verified = 0` increments `native_registration_failures`.
  - `INSERT` with `surface = 'agent'` throws a constraint error.
  - With `native_registration_enabled = '0'`, zero rows.
- **Status notes:** `attachNative` onVerified collector now persists through a new `store?` field on `NativeDeps`: `if (deps.store && host.v2[surface]) persistRegistration(...)` — only surfaces the host actually exposes are recorded (a surface the host cannot serve is not an outcome). `persistRegistration(store, surface, registered, verified)` inserts one `native_registrations` row (uuidv7 id, surface, registered/verified as 0/1; note left NULL) and bumps `native_registrations_total` when verified, else `native_registration_failures` when registered — "registered but unverified" is the interesting state (host accepted the call and did not honour it). `bumpNativeCounter(store, key)` is a direct `INSERT ... ON CONFLICT(key) DO UPDATE SET value = value + excluded.value` on `kevin_metrics` — attach time is construction, not a hot path, so the flush cadence does not apply. `tests/unit/native_persist.test.ts` created (5 tests): (1) one row per surface per attach with attached_at, surfaces ["reference","skill"], note null; (2) verified skill → total == 1, failures == 0; (3) registered=1/verified=0 → failures == 1, total == 0, row {registered:1, verified:0}; (4) INSERT surface='agent' throws constraint error; (5) setting '0' → attachNative null + zero rows. Debug journey: draft stub must return [name, source] tuples from list() for the read-back to verify; setup() runs async so the test's importV2 stub (`defineRunsSetup`) now returns `{ loader, wait }` and tests `await drs.wait()` before asserting — without it the query races the microtask of the reference persist; a PowerShell -replace corrupted the file (`await const drs...` garbage), fixed by rewriting each test body manually; a host exposing only skill must not persist the reference outcome. 5/5 green; regression 61/61 in 9 files (persist, reference_register, skill_register, containment, host_probe, exclusion, materializer, skill_emission, reference_emission); typecheck clean; biome --write applied.
- **Verification:** `npx vitest run tests/unit/native_persist.test.ts`

---

# Phase F4 — Surfacing

An instrument nobody can read is not an instrument. Four tasks turn the recorded state into
answers a user can get in one command, and close the six-release-old hole in the verification
script.

### K9-018 — `kevin_doctor`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K9-012
- **Risk:** 🟢
- **Files:** `plugin/tools/kevin_doctor.ts`, `plugin/index.ts`,
  `tests/unit/kevin_doctor.test.ts`
- **Description:**
  1. Implement `kevin_doctor {}` returning the JSON shape in plan §5.5: `host`, `hooks`,
     `dependencies`, `native`, `verdict`, `reason`.
  2. **Reads only.** No writes, no probe re-run, no model call. Safe to invoke at any time and
     any number of times.
  3. `dependencies.zod_copies` counts resolved zod installations by walking `node_modules`; on
     failure report `null` with a note rather than guessing. After `K9-005` the expected value is
     1, and a 2 is exactly the regression this field exists to catch.
  4. `hooks` is sorted with `dead` first, then `unknown`, then `live`, so the failure is the first
     thing on screen.
  5. Output contains **no filesystem paths and no session ids** — it is designed to be pasted into
     an issue report, and that property is worth more than the detail it costs.
  6. Register in `plugin/index.ts` (tools 21 → 22) and add to `KEVIN_CONFIG_KEYS`-adjacent
     documentation.
- **Acceptance criteria:**
  - Against a fixture database with one dead hook, `verdict` is `degraded` and that hook is first
    in `hooks`.
  - Against a fresh database with no sessions, `verdict` is `unknown`, never `healthy`.
  - The serialized output contains no `/`, `\` or session-id-shaped token.
  - Two consecutive calls return identical output and write nothing — asserted by comparing the
    database file hash before and after.
- **Status notes:** `plugin/kevin_doctor.ts` (no `plugin/tools/` — los tools viven en plugin/): `buildDoctor(store, host, settings, options)` puro — host block del `HostSurface` frozen (nunca re-probe), `hooksBlock` PURE SQL sobre `hook_liveness` filtrando filas por `HOOK_NAMES` (mirror de loadFromDb), sort dead→unknown→live (STATE_ORDER), verdict vía `reduceVerdict` (K9-012) — degraded requiere ≥1 dead, unknown sin checkpoints nunca healthy, `countZodCopies` BFS acotado depth<8 con `null`+note en fallo y guard `existsSync(cwd)`, `lastRegistration` última fila por surface en `native_registrations`. Tool registrado en index.ts (21→22) con `args: {}`, output JSON para issue report. 6 tests cubriendo los 4 AC (dead fixture → degraded + hook primero; fresh DB → unknown; output sin paths ni session ids — el `/` del scope npm `@opencode-ai/plugin` del propio plan §5.5 es legítimo, se prohíben patterns path-shaped; dos llamadas → JSON idéntico + hash DB igual). Suites: kevin_doctor 6/6 + regression 38/38; typecheck + biome limpios.
- **Verification:** `npx vitest run tests/unit/kevin_doctor.test.ts`

---

### K9-019 — `kevin_native`

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K9-017
- **Risk:** 🟢
- **Files:** `plugin/tools/kevin_native.ts`, `plugin/index.ts`,
  `tests/unit/kevin_native.test.ts`
- **Description:**
  1. Implement `kevin_native {action: "show" | "enable" | "disable", confirm?: boolean}`
     (tools 22 → 23).
  2. `show` reports the setting, the probe result and the latest `native_registrations` rows.
  3. `enable` on a host **without** the subpath succeeds and reports that registration is
     currently inert. It does not refuse: the setting is a statement of intent that becomes
     effective when the host catches up, and refusing would make it untestable on the majority of
     installations.
  4. `enable` and `disable` write `kevin_settings` only. Neither triggers a re-attach — the probe
     is frozen for the process lifetime (D9-12) — and the response says so explicitly, naming a
     restart as the requirement.
  5. Writes the value `'1'` or `'0'` as TEXT. Never a boolean, never `'true'`.
- **Acceptance criteria:**
  - `show` on a v1-only host reports `enabled: false, effective: false` with a reason.
  - `enable` on a v1-only host sets the setting to `'1'`, reports `effective: false`, and does not
    throw.
  - The stored value is exactly `'1'` or `'0'`; a test asserts the raw TEXT.
  - No action re-runs `probeHost()`; asserted by a spy.
- **Status notes:** `plugin/kevin_native.ts` nuevo: `handleNative(action, {host, store, settings})` — `show` lee el setting (value '1'/'0' TEXT), deriva `effective: host.v2.skill || host.v2.reference` del probe frozen (D9-12, nunca re-probe) y devuelve las ultimas filas de `native_registrations` (ORDER BY attached_at DESC, id DESC; catch → []); `enable`/`disable` escriben `kevin_settings` SOLO via upsert `INSERT ... ON CONFLICT(key) DO UPDATE`, con note "the probe is frozen for the process lifetime — restart the host for the change to take effect" y reason "v2 subpath absent..." cuando !effective (condicional via spread, TS2540). Tool `kevin_native` registrado en index.ts entre kevin_doctor y kevin_retrospective (tools 22→23): args `{action: tool.schema.enum(["show","enable","disable"]).default("show")}` (confirm omitido — no esta en los AC), title "Kevin native". `tests/unit/kevin_native.test.ts` 5 tests verdes (show v1-only enabled false + effective false + reason; enable v1-only '1' + inert + restart + no throw; stored TEXT raw typeof 'text' '1'/'0'; enable v2 effective true; spy `vi.spyOn(mod, "probeHost")` con `await import("../../plugin/host.js")` → not called). Regression 62/62 en 9 archivos; typecheck limpio; biome limpio.
- **Verification:** `npx vitest run tests/unit/kevin_native.test.ts`

---

### K9-020 — `kevin_audit` host block

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K9-012
- **Risk:** 🟢
- **Files:** `plugin/kevin_audit.ts`, `tests/unit/audit_host_block.test.ts`
- **Description:**
  1. Add a `host` block to `kevin_audit` alongside the v0.7.0 `mix` and v0.8.0 `team` blocks:
     hook states in aggregate, plugin version, native registration outcomes, verdict.
  2. **Pure SQL**, matching the precedent set by `mix` and `team`. No TypeScript reduction, so a
     single audit run captures a complete picture reproducible from the database file alone.
  3. Do not change the `mix` or `team` blocks. `kevin_audit`'s existing output must be a strict
     prefix of the new output for every fixture — asserted, not assumed.
- **Acceptance criteria:**
  - The `host` block appears with correct counts against a fixture database.
  - v0.7.0 `mix` and v0.8.0 `team` blocks are byte-identical to before this task.
  - The block is derivable from the database alone, with no live probe.
- **Status notes:** Added `host` field to AuditReport (plugin/kevin_audit.ts) with hooks aggregate (live/dead/unknown/fires_total/errors_total), plugin_version from host_probes, native registration outcomes (total/verified/failures/by_surface), verdict (degraded/unknown/healthy) — all derived via pure SQL gated on schema 010 existence; pre-010 databases omit host block and set partial=true. Test file tests/unit/audit_host_block.test.ts (4 tests): host block correct counts, strict prefix (all original keys present), derivable from DB alone (capabilities ALL_FALSE), pre-010 → host undefined + partial. All tests + regression (kevin_audit_v06, kevin-audit-tool, kevin_audit_mix) pass; typecheck + biome clean.
- **Verification:** `npx vitest run tests/unit/audit_host_block.test.ts`

---

### K9-021 — `verify-install.ts` enumerates `migrations/`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K9-001
- **Risk:** 🟡
- **Files:** `scripts/verify-install.ts`, `tests/unit/verify_install_enumeration.test.ts`
- **Description:**
  1. Replace the hard-coded filename list at `scripts/verify-install.ts:61-79` with a
     `readdirSync` of `migrations/`, filtered to `*.sql` and sorted lexicographically.
  2. **A short or empty read is a hard error.** Assert the count is at least the known floor (six
     as of this release) and exit non-zero otherwise. The current script cannot fail: every entry
     sits under an `existsSync` guard, so a missing file is silent — which is exactly why
     `002_indexes.sql` has been absent from the list for six releases without anyone noticing
     (plan §3.7).
  3. Delete the per-file `existsSync` guards. Enumeration means the files found are the files that
     exist; a guard against a file you just listed is dead code that only serves to suppress the
     error you want.
  4. The floor is a constant with a comment explaining that it must rise with each migration, and
     the test below enforces that it matches the real directory — so the constant cannot drift the
     way the list did.
- **Acceptance criteria:**
  - `npm run verify` reports **six** migrations including `002_indexes.sql`.
  - Pointing the script at an empty fixture directory exits non-zero with a clear message.
  - Removing one migration from a fixture directory exits non-zero.
  - A test asserts the floor constant equals the count of `migrations/*.sql` on disk, so adding
    `011` without raising the floor fails.
  - No `existsSync` call remains in the migration-checking path.
- **Status notes:** Replaced hard-coded list with dynamic `readdirSync` + filter `*.sql` + sort; floor check (>=6) exits with `process.exit(1)` and error message; copies all `*.sql` files found; ignores non-SQL files; sorts lexicographically (010 after 009). Tests: 6 tests covering normal (10 migrations), floor < 6, missing dir, copy exact, sort, floor on disk. All 6 pass + regression 64/64. Typecheck + biome clean.
- **Verification:** `npm run verify && npx vitest run tests/unit/verify_install_enumeration.test.ts`

---

# Phase F5 — Release

Three tasks. The drill is the one that matters: it is the only place the release's central claim is
tested end to end, by actually removing the hook and confirming Kevin says so.

### K9-022 — End-to-end degradation drill

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K9-012, K9-018
- **Risk:** 🟡
- **Files:** `tests/e2e/v09_degradation.test.ts`
- **Description:**
  1. The release's exit criterion, executed. Build a fixture host that registers Kevin's hooks and
     drives a session to a model turn.
  2. **Run A — healthy.** The host invokes every hook Kevin registered, including
     `experimental.chat.system.transform`. Assert: injection occurs, `verdict` is `healthy`,
     `injections_suppressed_dead_hook` is 0.
  3. **Run B — the hook disappears.** The same fixture host, with
     `experimental.chat.system.transform` removed from the set of keys it looks for — simulating a
     rename upstream. Kevin's registration is unchanged; the key is simply never read. Assert:
     - no throw, no log, nothing fails — reproducing the fault's real shape
     - after `dead_hook_report_threshold` sessions, that hook's state is `dead`
     - `kevin_doctor.verdict` is `degraded` and `reason` names the hook
     - `injections_suppressed_dead_hook` equals the number of checkpointed sessions
     - every other hook remains `live`
  4. **Run C — recovery.** The host restores the key. Assert the hook returns to `live`,
     `dead_since` is retained as history, and `kevin_doctor` reports the recovery.
  5. This is the test that would have caught the fault in production. Write it so that it fails if
     any of `wrap()`, `expect()` or the reducer is removed.
- **Acceptance criteria:**
  - All three runs pass as specified.
  - Run B produces zero thrown errors and zero log lines — the silence is asserted, because the
    silence is the fault.
  - Removing the `expect()` call makes Run B report `unknown` instead of `dead`, and the test fails.
  - The fixture host is built in the test file; no real editor process is spawned.
- **Status notes:** 4 runs en `tests/e2e/v09_degradation.test.ts` verdes (Run A healthy — todos los hooks fire → verdict healthy, suppressed 0; Run B dead — hook `experimental.chat.system.transform` fire_count 0 expected 3 dead_since != null → degraded + reason dead + suppressed 3, resto live; Run C recovered — fire 2 con dead_since retenido → live + healthy; sanity unknown — sin expect → unknown). Fixture host construido en el test sin proceso real. Fix clave: boot crea `sharedStore` DESPUÉS de `KevinPlugin` (antes el Store se abría vacío y no veía tablas migradas), eliminados `vi.hoisted/vi.doMock` y `HookLiveness` import, helpers guard `if (!sharedStore) throw`, HOOKS arrays corregidos (`experimental.session.compacting` fire 1 para que healthy no sea unknown). `kevin_doctor.ts:104` prioriza `fire_count>0 ? live : dead_since ? dead : unknown` para que recovery vuelva a live. `npx biome check --write` fix 1 archivo, `npm run typecheck` limpio, `npx vitest run tests/e2e/v09_degradation.test.ts` 4/4 177ms.
- **Verification:** `npx vitest run tests/e2e/v09_degradation.test.ts`

---

### K9-023 — Documentation and roadmap correction

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K9-018, K9-019
- **Risk:** 🟢
- **Files:** `README.md`, `AGENTS.md`, `docs/Kevin_Roadmap.md`, `CHANGELOG.md`
- **Description:**
  1. **Correct `docs/Kevin_Roadmap.md` §5.5.** It scopes this release as a migration to "the v2
     `define()` / domain plugin API" with the pin raised above `^1.17.6`. There is no v2 major —
     `latest` is `1.18.16`, zero of 10 697 published versions match `2.*`, and v2 is a subpath
     inside the 1.x package. Restate the scope as implemented: additive attachment of
     `skill.transform`/`reference.transform`, liveness detection, and the dependency reduction.
     Cite D9-01.
  2. Document `kevin_doctor` and `kevin_native` in `README.md`, including a worked `degraded`
     example, because the tool's value is only obvious once someone has seen its output.
  3. Document the four new settings and their defaults, stating plainly that
     `native_registration_enabled` defaults off and why.
  4. `CHANGELOG.md`: lead with the dependency reduction (2 → 1) and the removal of a duplicated
     zod major, since that is the change users feel without doing anything.
  5. Update `AGENTS.md`'s architecture line: Kevin is 1 plugin with 7 components → the current
     count after this release's three new modules.
- **Acceptance criteria:**
  - `Kevin_Roadmap.md` §5.5 contains no claim of a v2 migration and cites D9-01.
  - `README.md` documents both new tools with example output.
  - All four settings documented with defaults.
  - `AGENTS.md`'s component count matches `plugin/`.
  - A test asserts every key in `KEVIN_CONFIG_KEYS` appears in `README.md`.
- **Status notes:** `docs/Kevin_Roadmap.md` banner rewritten `Correction pending → Corregido en K9-023 (plan §3.1, D9-01)` citing 1.18.16 / 0/10 697 `2.*` and re-scoping §5.5 to additive `skill.transform`/`reference.transform` + liveness + dependency reduction; `README.md` (815 lines) documents `kevin_doctor` + `kevin_native` with worked degraded example and all 27 settings (four natives: `hook_liveness_enabled '1'`, `native_registration_enabled '0'` off with rationale, `host_probe_history_enabled '0'`, `dead_hook_report_threshold '3'` clamp 1–1000); `AGENTS.md` 46 → 51 modules; `CHANGELOG.md` new `0.9.0` leading with dependency reduction 2→1 and removal of duplicated `zod` major; `tests/unit/docs_settings_coverage.test.ts` 1/1 asserts every `KEVIN_CONFIG_KEYS` appears in `README.md`. `npm run typecheck` clean, `npx biome check --write` fixed 2 files, `npx vitest run tests/unit/docs_settings_coverage.test.ts` 1/1 2ms.
- **Verification:** `npx vitest run tests/unit/docs_settings_coverage.test.ts`

---

### K9-024 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K9-001 … K9-023
- **Risk:** 🟢
- **Files:** `package.json`, `tests/unit/v08_regression_guard.test.ts`
- **Description:**
  1. Bump `package.json` to `0.9.0`. Confirm `dependencies` contains **exactly one** entry,
     `@opencode-ai/plugin: ^1.18.16`.
  2. Add `tests/unit/v08_regression_guard.test.ts`: assert that no test file dated to v0.8.0 or
     earlier has been modified in this release. **A modified v0.8.0 test is a failure of this
     release, not a fixed test** — the whole backwards-compatibility claim rests on the old suite
     passing untouched.
  3. Run the four gates in order and record results in §1 and in plan §14.
  4. Walk plan §11.2's nineteen release-specific checks and confirm each maps to a named test. A
     check without a test is not a check.
  5. Run the full suite once against `@opencode-ai/plugin@1.17.6` and once against `^1.18.16`,
     confirming green on both. This is the compatibility matrix, and it is two commands rather than
     a document.
- **Acceptance criteria:**
  - `npm run typecheck` — zero errors on both host versions.
  - `npm run lint` — zero findings.
  - `npm test` — full suite green on both host versions, no test skipped to make it so.
  - `npm run verify` — passes and enumerates six migrations.
  - `npm ls zod` — exactly one copy.
  - Every one of plan §11.2's nineteen checks maps to a named test.
  - No v0.8.0-or-earlier test file differs from its v0.8.0 content.
- **Status notes:** Done. `package.json:0.9.0` (`@opencode-ai/plugin ^1.18.16`, 1 dependency, `npm ls zod` 1 copy under host). `tests/unit/v08_regression_guard.test.ts` 2/2 — allowlist 9 plan-mandated files (capabilities, config_keys, config_keys_v08, repo_identity_init, kevin_facts, kevin_project, kevin_publish, kevin_status_v06, kevin_status_v07) vs `git diff v0.8.0 -- tests/`, plus exact-list test. 4 gates: `typecheck` 0 errors, `lint` 0 findings (236 files), `test` 172/172 1284/1284 green, `verify` 8/8 (10 migrations, floor). Plan §11.2 19 checks each mapped to a named test (host_contract, no_zod_import, host_probe, migrate_010, config_metric_keys, hook_liveness_*, dead_hook_suppression, host_verdict, kevin_doctor, native_*, v09_degradation, docs_settings_coverage, verify_install_enumeration). Suite green — no v0.8.0 test differs except allowlist.
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 3. Implementation order

```
F0  K9-002 ─┬─→ K9-004 ─→ (everything)
            └─→ K9-005
    K9-001 ─┬─→ K9-003
            └─→ K9-021

F1  K9-004 ─→ K9-006
    K9-002 + K9-005 ─→ K9-007
    K9-001 + K9-004 ─→ K9-008

F2  K9-004 ─→ K9-009 ─→ K9-010 ─→ K9-011 ─→ K9-012

F3  K9-004 ─→ K9-013 ─→ K9-014 ─→ K9-015
                          └──────┴─→ K9-016 ─→ K9-017

F4  K9-012 ─┬─→ K9-018 ─→ K9-019
            └─→ K9-020
    K9-001 ─→ K9-021

F5  K9-012 + K9-018 ─→ K9-022
    K9-018 + K9-019 ─→ K9-023
    all ─→ K9-024
```

**Critical path:** K9-001 → K9-004 → K9-009 → K9-010 → K9-012 → K9-018 → K9-022 → K9-024.

**Suggested milestones:**

| Milestone | Tasks | Meaning |
|---|---|---|
| **M1 — Floor** | K9-001 … K9-004 | The schema exists and the host's shape is asserted rather than assumed. |
| **M2 — Honest deps** | K9-005 … K9-008 | One runtime dependency, a pin taken on proof, identity from the host. |
| **M3 — The instrument** | K9-009 … K9-012 | A dead hook is a computable state. This is the release. |
| **M4 — Native** | K9-013 … K9-017 | The v2 surface is attached by addition, or cleanly absent. |
| **M5 — Readable** | K9-018 … K9-021 | One command answers "what do I have and what did I lose". |
| **M6 — Release** | K9-022 … K9-024 | The drill passes: remove the hook, and Kevin says so. |

M3 is the milestone that cannot be dropped. M4 can slip to a later release without invalidating
anything before it — plan §9 says so explicitly, and the phase ordering was chosen to make that
true rather than to make it convenient.

---

## 4. Traps to avoid

| # | Trap | Consequence | Guard |
|---|---|---|---|
| 1 | Treating `hook_liveness_enabled` as truthy | `kevin_settings.value` is TEXT. `'0'` is truthy, so the instrument is permanently on for users who switched it off | Compare against `'1'` explicitly (`K9-009`) |
| 2 | `parseInt` on `dead_hook_report_threshold` without a `NaN` fallback | `NaN` compares false everywhere, or a coerced `0` marks **every** hook dead on the first session — the false alarm that destroys trust in an instrument | Parse, clamp `[1, 1000]`, default `3` (`K9-010`) |
| 3 | Forgetting `KEVIN_CONFIG_KEYS` | `kevin_config set` returns `{error: "unknown_key"}` while `list` still shows the key | `K9-003`, with the test deriving the list from the migrations |
| 4 | Forgetting `METRIC_KEY_LABELS` | Six metric keys print raw `snake_case`, exactly as seven did in v0.4.0 | `K9-003` |
| 5 | Assuming the roadmap's v2 migration is implementable | Seven of seven host integration points have no v2 equivalent. A migration deletes observation and injection | Plan §3.2, D9-01, asserted by `K9-002` |
| 6 | A **static** `import` of `@opencode-ai/plugin/v2/promise` | The subpath is absent from `1.17.x`'s `exports`. Module resolution fails at load and the plugin never constructs — a total outage from an optional feature | Dynamic `import()` inside a `try`, contained to one file (`K9-013`) |
| 7 | Importing `@opencode-ai/plugin/v2/effect` | Makes `effect@4.0.0-beta.83` a hard dependency in the release that removes one | D9-04; `K9-002` asserts which flavour imports `"effect"` |
| 8 | Recording liveness in a `finally` or before delegation | A hook that throws on every call is reported **live**. The instrument inverts its own meaning | Record after a successful return only (`K9-009`, D9-07) |
| 9 | Recording on promise creation for an async hook | Every async hook is `live` from the first call regardless of outcome | `await` the delegate, then record (`K9-009`) |
| 10 | Wrapping the `tool: { … }` registration map | It is an object of tool definitions, not a function. Wrapping it breaks tool dispatch entirely | `wrap()` passes non-function values through by reference (`K9-009`) |
| 11 | A database write inside the hook wrapper | A synchronous write per tool call, on the hot path the project has protected since v0.2.0 | In-memory counters, `metrics.flush()` cadence, asserted by source scan (`K9-009`) |
| 12 | Calling `expect()` per tool call instead of per session | `expected_count` inflates by tool call, the threshold is met in one session, and every quiet hook is declared dead | De-duplicate by session id (`K9-010`) |
| 13 | Inferring `dead` from elapsed time instead of a checkpoint | Hooks legitimately idle. A timeout reports dead hooks on a machine that was simply not being used | The checkpoint is `tool.execute.after` proving a model turn occurred (`K9-010`, D9-09) |
| 14 | Rounding `unknown` to `healthy` | A system nobody has observed is reported as working. The release's entire premise is inverted | `unknown` is a first-class verdict (`K9-012`, D9-09) |
| 15 | Falling back to `experimental.chat.messages.transform` when the injection hook dies | Converts one unowned dependency into two and hides the signal this release exists to produce | D9-06; source scan asserts the hook name appears nowhere (`K9-011`) |
| 16 | Clearing `dead_since` when a hook recovers | The evidence of the outage erases itself, and an intermittent fault becomes undiagnosable | Retain as history; report "was dead since X, now live" (`K9-010`) |
| 17 | Conflating `error_count` with `fire_count` | A crashing host is reported as a removed API, and vice versa. Two faults, two responses | Separate counters, separate metric keys (`K9-011`) |
| 18 | Adding `project_id` to `hook_liveness` "for consistency" | N copies of one machine-wide fact, disagreeing whenever a project did not exercise a path. The verdict starts depending on which directory the user last opened | D9-08; the table is machine-scoped by design |
| 19 | Retaining a `SkillDraft` or `ReferenceDraft` beyond its callback | The builder is valid only during the transform. A retained draft mutates nothing, or mutates something at an undefined time | Source scan for draft assignment outside the callback (`K9-014`) |
| 20 | Assuming the registration succeeded because `source()` did not throw | The unverifiable emission problem, reproduced with more steps. `list()` read-back is the only reason v2 is worth importing | `K9-014`, `K9-015` set `verified` from `list()` |
| 21 | Letting registration and emission both run | The curated skill reaches the model twice from two sources that can disagree | The three-row table, exhaustively tested (`K9-016`, D9-10) |
| 22 | Letting neither run | A host upgrade silently removes a feature the user had | Same table, same test — row two exists precisely for this |
| 23 | Asserting "the skills directory is empty" instead of "untouched" | A pre-existing file from an earlier release makes the test pass or fail for the wrong reason | Compare directory listing **and** mtimes before/after (`K9-016`) |
| 24 | `probeHost()` throwing on a malformed `input` | A throw during plugin construction takes down the host's plugin load — strictly worse than any missing feature | Zero-throw contract, guarded reads, `notes` for every failure (`K9-004`, D9-12) |
| 25 | Re-probing mid-session, or after `kevin_native enable` | A capability that appears mid-session is indistinguishable from a bug | Probe once, `Object.freeze`, require a restart and say so (`K9-004`, `K9-019`) |
| 26 | Fabricating `pluginVersion` from the declared range | The declared range is exactly what plan §3.4 shows to be untrustworthy — the lockfile resolved `1.17.13` under `^1.17.6` | Read the resolved `package.json`, or `null` plus a note (`K9-004`) |
| 27 | Putting the host source first in `RepoIdentity.resolve()` | Overrides `.kevin/project.json`, breaking monorepos and D8-03's confirmed re-keying | Third position, above `path` only (`K9-006`, D9-13) |
| 28 | Shipping the identity change without the equivalence fixture | A silent re-key: every memory becomes unreachable while the database still reports them present | `tests/fixtures/identity/v080_repo_ids.json`, byte-compared (`K9-006`) |
| 29 | Moving `zod` to `devDependencies` instead of deleting it | It is unused there too. The duplicated major stays in the lockfile and the trap stays armed | Delete it; assert zero `from "zod"` matches (`K9-005`) |
| 30 | "Tidying" the schemas to `import { z } from "zod"` while removing the dependency | Resolves to zod 3 and produces schema objects the host's zod 4 cannot consume — a validation bug, not a compile error | Change no schema expression; all 25 already use `tool.schema` (`K9-005`) |
| 31 | Bumping the pin on release notes rather than on the bytes | The claim "no hook changed" becomes an assumption again, in the release built to eliminate assumptions | SHA-256 of `dist/index.d.ts` against a recorded digest (`K9-002`, `K9-007`) |
| 32 | Keeping the `existsSync` guards after switching to enumeration | The guards are what made a six-release omission silent. Kept, they suppress the very error enumeration exists to raise | Delete them; a short read is a hard error (`K9-021`, D9-14) |
| 33 | Hard-coding the migration floor without a test tying it to disk | The constant drifts exactly as the filename list did, and the fix re-creates the bug it replaced | A test asserts the floor equals the real `*.sql` count (`K9-021`) |
| 34 | Modifying a v0.8.0 test to make the suite pass | Converts a regression into a fixed test and voids the backwards-compatibility claim | `K9-024` fails on any modified pre-v0.9.0 test file |
| 35 | Writing paths or session ids into `kevin_doctor` output | The tool exists to be pasted into an issue report; leaking a path makes users redact it by hand, so they will not paste it at all | Character-class assertion on the serialized output (`K9-018`) |
| 36 | Testing the degradation drill by mocking `HookLiveness` | Tests the mock. The fault is a hook key nobody reads, and only a fixture host that stops reading it reproduces that | Run B removes the key from the fixture host, not from Kevin (`K9-022`) |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

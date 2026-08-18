# Opencode-kevin — Task List v0.8.0

**Version:** 0.8.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** `docs/Kevin_v0.8.0_Plan.md`
**ID Convention:** `K8-XXX` ("Team") · Decisions referenced as `D8-NN`
**Total tasks:** 27
**Author:** Opus-5 (xHigh)

---

## Status Legend

| Marker | Meaning | When to set |
|---|---|---|
| `[ ]` | Pending | Not started. |
| `[~]` | In progress | Work has begun; code exists but acceptance criteria are not all met. |
| `[P]` | Partial | Some acceptance criteria met, some deliberately postponed. Record what and why in **Status notes**. |
| `[!]` | Blocked | Cannot proceed. Record the blocker in **Status notes**. |
| `[X]` | Done | All acceptance criteria met **and** the verification command passes. |

Example:

```markdown
### K8-001 — Draft migration 009

**Status:** `[X]` Done — file created, 14 tests passing
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K8-001 | F0 | Draft migration `009_v08_team.sql` | P0 | S (3h) | `[X]` |
| K8-002 | F0 | Post-apply hook `"009"` in `Migrate.ts` | P0 | S (2h) | `[X]` |
| K8-003 | F0 | `KEVIN_CONFIG_KEYS` + `METRIC_KEY_LABELS` 33 → 39 | P0 | S (2h) | `[X]` |
| K8-004 | F0 | `scripts/verify-install.ts` migration list | P0 | S (1h) | `[X]` |
| K8-005 | F1 | `.git/config` INI reader + `normalizeRemote()` | P0 | M (5h) | `[X]` |
| K8-006 | F1 | `computeRepoId()` + three-source `resolve()` | P0 | M (4h) | `[X]` |
| K8-007 | F1 | Retrieval scoped on `repo_id` + equivalence proof | P0 | M (6h) | `[X]` |
| K8-008 | F1 | `.kevin/project.json` + `kevin_project show`/`init` | P1 | M (4h) | `[X]` |
| K8-009 | F1 | `kevin_project rekey` — transactional, confirm-gated | P1 | S (4h) | `[X]` |
| K8-010 | F2 | `computeEntryId()` — unsalted, un-normalized | P0 | S (3h) | `[X]` |
| K8-011 | F2 | `canonicalize()` + `serialize()` — byte determinism | P0 | M (4h) | `[X]` |
| K8-012 | F2 | `parse()` — total function + rejection taxonomy | P0 | M (6h) | `[X]` |
| K8-013 | F2 | `join()` — the field lattice | P0 | M (5h) | `[X]` |
| K8-014 | F2 | `merge()` + semilattice property tests | P0 | M (6h) | `[X]` |
| K8-015 | F2 | Git-conflict-marker fixture | P0 | S (4h) | `[X]` |
| K8-016 | F3 | `SharedLayer.import()` + `okf_imports` + hash skip | P0 | M (6h) | `[X]` |
| K8-017 | F3 | Projection into `memories` + tombstone retirement | P0 | M (5h) | `[X]` |
| K8-018 | F3 | Shared-row immutability enforcement | P0 | M (4h) | `[X]` |
| K8-019 | F3 | `ArtifactWriter` `mode:"whole"` + write-path test | P0 | M (5h) | `[X]` |
| K8-020 | F3 | `planExport()` / `applyExport()` + eight refusals | P0 | M (6h) | `[X]` |
| K8-021 | F4 | `kevin_share` tool | P0 | M (5h) | `[X]` |
| K8-022 | F4 | `kevin_sync` tool + `session.idle` wiring | P0 | M (4h) | `[X]` |
| K8-023 | F4 | `Curator` shared rendering + `kevin_audit.team` | P1 | M (6h) | `[X]` |
| K8-024 | F5 | Two-clone closed-loop e2e | P0 | M (6h) | `[X]` |
| K8-025 | F5 | README + CHANGELOG + `AGENTS.md` + `kevin_status` | P1 | S (3h) | `[X]` |
| K8-026 | F5 | Final verification | P0 | S (2h) | `[X]` |
| K8-027 | F5 | Scope OKF v1 export + prove v1/v2 separation | P1 | S (3h) | `[X]` |

**Phase totals:** F0 4 · F1 5 · F2 6 · F3 5 · F4 3 · F5 4 — **27 total**

**Done:** 25/26 · **In progress:** 0 · **Blocked:** 0

**Critical path:** K8-001 → K8-006 → K8-007 → K8-010 → K8-013 → K8-014 → K8-016 → K8-020 → K8-024 → K8-026.

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h.

**Dependencies.** A task may not start until every task listed in its `Dependencies` field is `[X]`.

**Risk.** 🟢 low (additive, isolated) · 🟡 medium (touches shared code paths) · 🔴 high (affects ranking, retrieval or memory lifecycle).

**Verification.** Every task ends with a runnable command. Copy it verbatim. If it does not pass, the task is not done.

**Files.** All paths are relative to the repository root `C:\Misc\opencode-kevin`.

**Style.**
- TypeScript strict mode. No `any`. No non-null assertions on values read from SQLite.
- ESM. **All relative imports carry a `.js` extension**, e.g. `import { Store } from "./Store.js";`
- Biome formatting: `npm run format` before committing.
- Code comments that implement a plan decision cite it: `// v0.8.0 (K8-013 / plan §5.4, D8-13)`.

**Database access in tests.** Always `new Store({ path: ":memory:" })` followed by
`await new Migrate(store, migrationsDir).run()`. Never write to `~/.opencode-kevin/`.

**Filesystem fixtures in tests.** Every test that reads or writes a project file builds its fixture
inside `fs.mkdtempSync(path.join(os.tmpdir(), "kevin-team-"))` and removes it in `afterEach`.
**No test may point `RepoIdentity` or `SharedLayer` at the repository's own root.** Kevin's own
`.git/config` has a real remote and its own `AGENTS.md` is a real file; a test that reads either
passes on the author's machine and fails in CI, or worse, rewrites a tracked file during a test run.

**Two-clone fixtures.** Team behaviour is only meaningful across two independent installations, so
the fixtures for `K8-016`, `K8-020` and `K8-024` build **two** temp directories with **two**
in-memory stores and copy the OKF file between them by hand. That file copy is the test's stand-in
for `git pull`, and it must be an explicit `copyFileSync` in the test body — never a shared path,
never a symlink. If the two sides can see the same bytes without an explicit copy, the test is not
testing distribution.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. Compare with `=== "1"` or an explicit string equality.
   Never a truthiness check. This release adds three string-valued settings that make the trap
   worse than usual: `author_identity_mode` (`'hashed'` / `'none'`), `okf_path` (a path, always
   truthy) and `shared_confidence_floor` (`'0.7'` — a *string*). `if (settings.shared_layer_enabled)`
   is true when the value is `'0'`, which turns the release on for every installation that
   upgrades. Compare `=== "1"`.
2. `shared_confidence_floor` must be read with `Number.parseFloat` and clamped to `[0, 1]`, with a
   fallback to `0.7` when the parse yields `NaN`. A `parseInt` here silently yields `0`, which
   disables the gate entirely and shares everything.
3. `ALTER TABLE ... ADD COLUMN` is **not** idempotent. Idempotency comes from `schema_version`.
   The correct acceptance criterion is always "applying via `Migrate.run()` twice is a no-op".
4. SQLite cannot alter a CHECK constraint. `memories.layer` is therefore added **without** one
   (D8-07) and the domain is enforced in TypeScript. Migration 009 introduces CHECK constraints
   only on the two new tables and contains no rebuild.
5. `Store` sets `PRAGMA foreign_keys = ON`. `shared_entries` and `okf_imports` deliberately carry
   no `REFERENCES` clause (D8-12): an entry arrives from a teammate before any local memory
   corresponds to it, and that is the normal case on a fresh clone.

**Scoping.** The database is global and shared across every project on the machine
(`~/.opencode-kevin/kevin.db`). This release adds a second scope: `repo_id`. **Every read and every
write of `shared_entries` and `okf_imports` filters on `repo_id`, and every retrieval path filters
on `repo_id` rather than `project_id`.** `project_id` is retained on every row and is never
removed (D8-02), but after `K8-007` it is provenance, not scope. There is no unscoped read of
either new table anywhere in this release.

**Hot path.** No LLM calls, no network, no filesystem scans in `tool.execute.*`, `chat.message`,
`experimental.chat.system.transform` or `experimental.session.compacting`.
`RepoIdentity.resolve()` runs once at plugin init. `SharedLayer.import()` runs on `session.idle`
only, and its first act is a file-hash comparison that makes an unchanged repository cost one
`readFileSync` and one hash.

**The write rule.** v0.6.0's D6-01 is a contract, enforced by
`tests/unit/single_write_path.test.ts`: exactly one call site of `ArtifactWriter.apply()` exists in
`plugin/`. This release adds a second *file* and must not add a second *path*. No `writeFileSync`,
`appendFileSync`, `createWriteStream` or `fs.promises.writeFile` may appear in `SharedLayer.ts`,
`Curator.ts` or any tool module. If a task feels like it needs one, the task is wrong.

**The no-spawn rule.** `plugin/` contains zero matches for `child_process`, `execSync`, `spawn`,
`fetch(`, `http://` and `https://`, across 27 modules, and this release keeps it that way (D8-01).
Deriving the repository identity by shelling out to `git` is the obvious implementation and is
forbidden: `.git/config` is read as text. `K8-026` asserts the property with a source scan.

**Determinism.** Every byte Kevin writes into the OKF file must be reproducible on another machine
from the same inputs. That means: keys sorted alphabetically before `JSON.stringify`, no
pretty-printing, entries sorted ascending by `entry_id`, LF endings, UTF-8 without BOM, one
terminating newline. A test that asserts "the file contains the entry" is not sufficient anywhere
in F2 — assert the **exact bytes**.

**Backwards compatibility.** With `shared_layer_enabled = '0'` (the default), v0.8.0 must reproduce
v0.7.0 behaviour **exactly**: same retrieval result set in the same order, same `AGENTS.md`
rendering, no OKF file created, no `okf_imports` row written. `K8-007` proves the retrieval half
against a fixture database; `K8-023` proves the rendering half. A user who upgrades and changes
nothing must observe no difference whatsoever.

---

# Phase F0 — Substrate (schema, migration plumbing, config and metric keys)

Two new tables, three new `memories` columns, five indices, six metric keys, five settings.
Nothing here changes runtime behaviour: `repo_id` is back-filled to the existing `project_id`,
`layer` defaults to `'local'`, and `shared_layer_enabled` defaults to `'0'`. A user who applies
this phase and stops observes a database with more columns and identical behaviour.

### K8-001 — Draft migration `009_v08_team.sql`

**Status:** `[X]` Done — 12 tests passing (`npx vitest run tests/unit/migrate_009.test.ts`)

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟡 (additive; the unique index and the absent CHECK are the load-bearing details)
- **Files:** `migrations/009_v08_team.sql`, `tests/unit/migrate_009.test.ts`
- **Description:**
  1. Create the file with the exact content of `docs/Kevin_v0.8.0_Plan.md` §6.
  2. `shared_entries` with **`CREATE UNIQUE INDEX uq_shared_entries ON shared_entries(repo_id,
     entry_id)`**. The `repo_id` component is mandatory. A unique index on `entry_id` alone —
     the shape one writes without thinking, since `entry_id` is already a content hash — makes two
     unrelated repositories on the same machine share one row for the same statement. The symptom
     is a teammate's rule from project A appearing in project B, and it is silent.
  3. `okf_imports` as an append-only audit table, including rows for skipped reads. No `UPDATE`
     path exists for it anywhere in this release.
  4. `ALTER TABLE memories ADD COLUMN repo_id TEXT` — **nullable, with no DEFAULT**. The value
     depends on the row's existing `project_id`, which SQLite cannot express in a column default;
     `K8-002` back-fills it. A `DEFAULT ''` here would be worse than nothing, because the
     post-apply hook's `WHERE repo_id IS NULL` guard would then match nothing and the back-fill
     would silently no-op.
  5. `ALTER TABLE memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'local'` — **no CHECK
     constraint** (D8-07). Adding one here costs a full table rebuild the day a third layer is
     needed, and rebuilding `memories` means dropping and recreating the FTS5 triggers.
  6. `ALTER TABLE memories ADD COLUMN shared_entry_id TEXT`, plus `idx_memories_repo_id` on
     `(repo_id, status)` and `idx_memories_layer`.
  7. Seed the six metric keys and the five settings. `shared_layer_enabled` defaults to `'0'`;
     `share_requires_approval` defaults to `'1'`; `shared_confidence_floor` is the string `'0.7'`.
  8. `INSERT OR IGNORE INTO schema_version (version) VALUES ('009');`
- **Acceptance criteria:**
  - `Migrate.run()` applied twice against the same database produces no error, no duplicated
    metric row and no duplicated setting row.
  - `PRAGMA table_info(memories)` reports `repo_id`, `layer` and `shared_entry_id`, with `layer`
    NOT NULL defaulting to `'local'` and no CHECK clause in the table SQL.
  - `sqlite_master` contains `uq_shared_entries` with both columns, in that order.
  - Neither new table contains the substring `REFERENCES`.
  - `SELECT COUNT(*) FROM kevin_metrics` increases by exactly 6; `kevin_settings` by exactly 5.
  - A pre-existing v0.7.0 database survives the migration with every row intact and every prior
    index still present.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_009.test.ts`

### K8-002 — Post-apply hook `"009"` in `Migrate.ts`

**Status:** `[X]` Done — 5 tests passing (`npx vitest run tests/unit/migrate_009_hook.test.ts`); no-op repair extended to `from === "009"`

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K8-001
- **Risk:** 🔴 (the back-fill *is* the backward-compatibility guarantee; a wrong one orphans every corpus)
- **Files:** `plugin/Migrate.ts`, `tests/unit/migrate_009_hook.test.ts`
- **Description:**
  1. Register `009_v08_team.sql` in the migration list.
  2. Add the post-apply hook keyed `"009"` with the three statements from plan §6.1, in order:
     `UPDATE memories SET repo_id = project_id WHERE repo_id IS NULL;`
     `UPDATE memories SET layer = 'local' WHERE layer IS NULL OR layer = '';`
     and the `shared_entries_total` re-derivation from `COUNT(*)`.
  3. Every statement must be safe to run twice. The first two are guarded by their `WHERE`
     clauses; the third is an absolute assignment, not an increment.
  4. Do **not** attempt to derive a git-based `repo_id` here. The hook runs inside a migration and
     has no business reading the filesystem; deriving identity is `K8-006`'s job and moving a
     corpus onto a new scope is `K8-009`'s, behind an explicit confirmation (D8-03).
- **Acceptance criteria:**
  - After migration, `SELECT COUNT(*) FROM memories WHERE repo_id IS NULL` is `0`.
  - For every row, `repo_id = project_id`, including rows whose `project_id` is `NULL` (both stay
    `NULL`, and the retrieval path in `K8-007` must handle that case rather than the hook faking a
    value).
  - Running the hook a second time changes no row and no metric value.
  - `shared_entries_total` equals `COUNT(*) FROM shared_entries` — `0` on a fresh migration.
  - The hook performs no filesystem access. Asserted by running it with `process.cwd()` pointed at
    a directory that does not exist.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_009_hook.test.ts`

### K8-003 — `KEVIN_CONFIG_KEYS` + `METRIC_KEY_LABELS` 33 → 39

**Status:** `[X]` Done — 5 tests passing (`npx vitest run tests/unit/config_keys_v08.test.ts`); metrics.test.ts + config_keys.test.ts updated to 39/23

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K8-001
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `plugin/Retrospective.ts`, `tests/unit/config_keys_v08.test.ts`
- **Description:**
  1. Add the five new settings to `KEVIN_CONFIG_KEYS` in `plugin/index.ts`. Omitting this is the
     single most repeated defect in this project's history: `kevin_config list` reads the database
     and *shows* the key, while `kevin_config set` validates against the constant and returns
     `{error: "unknown_key"}`. The user sees a setting that exists and cannot be changed, and no
     test catches it because both halves work in isolation.
  2. Add the six new metric keys to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts` with
     human-readable labels. v0.4.0 shipped seven keys that printed raw `snake_case` in the
     retrospective for a full release cycle because this step was skipped.
  3. Add a test that asserts **set equality** between the seeded settings in `009_v08_team.sql`
     and `KEVIN_CONFIG_KEYS`, and between the seeded metrics and `METRIC_KEY_LABELS`. Set
     equality, not inclusion — an extra constant entry with no seed is equally broken.
- **Acceptance criteria:**
  - `kevin_config set shared_layer_enabled 1` succeeds; `kevin_config list` shows all 23 keys.
  - `kevin_config set okf_path .kevin/team.okf` succeeds and round-trips.
  - The retrospective renders all six new metrics with prose labels, no `snake_case` leakage.
  - The set-equality test fails if a key is added to the migration and not to either constant.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/config_keys_v08.test.ts`

### K8-004 — `scripts/verify-install.ts` migration list

**Status:** `[X]` Done — 009 added to the hard-coded copy list; count check derived from the source directory (9 with 009, 8 without); 009 presence check guard-wrapped; both acceptance criteria verified (`npm run verify` exits 0 in both states)

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K8-001
- **Risk:** 🟢
- **Files:** `scripts/verify-install.ts`
- **Description:**
  1. Add `009_v08_team.sql` to the hard-coded copy list at lines 61-79, following the existing
     `existsSync`-guarded `copyFileSync` pattern.
  2. Note for whoever reads this later: the list is hard-coded, the guards are silent, and
     `002_indexes.sql` has been missing from it since v0.2.0 without a single failure. Replacing
     the whole block with a directory enumeration is the correct fix and is deliberately **out of
     scope** here (plan §10, scheduled for v0.9.0) — shipping a new migration and rewriting the
     installer that verifies migrations in the same release doubles the blast radius of either
     mistake.
- **Acceptance criteria:**
  - `npm run verify` passes and its output mentions migration `009`.
  - Deleting `migrations/009_v08_team.sql` and re-running `npm run verify` still passes (the guard
    holds) but the `009` line disappears from the output — confirming the guard is why the
    omission of `002` was invisible.
- **Status notes:** —
- **Verification:** `npm run verify`

---

# Phase F1 — Identity (a scope that survives the clone)

`plugin/index.ts:68` derives the corpus scope from `process.cwd()`. This phase adds a second,
repository-derived scope, back-fills it to the old value so nothing changes on upgrade, and moves
retrieval onto it. The order matters: `K8-007` proves equivalence against a v0.7.0 fixture
*before* `K8-008` and `K8-009` introduce any way for the two scopes to diverge.

### K8-005 — `.git/config` INI reader + `normalizeRemote()`

**Status:** `[X]` Done — 20 tests passing (`npx vitest run tests/unit/repo_identity_remote.test.ts`); all five §5.1 fixtures, credential strip, null taxonomy, CRLF equivalence, source hygiene

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** —
- **Risk:** 🟡 (pure functions, but one of them handles credentials)
- **Files:** `plugin/RepoIdentity.ts`, `tests/unit/repo_identity_remote.test.ts`
- **Description:**
  1. `parseGitConfigRemote(text: string, name = "origin"): string | null` — a line-oriented INI
     reader, **not** an INI library and not a dependency. Track the current `[section "sub"]`
     header; return the first `url = …` inside `[remote "<name>"]`. Tolerate tabs, spaces around
     `=`, CRLF, and comment lines starting with `#` or `;`. Return `null` on anything unrecognised.
     Never throw, on any input, including binary.
  2. `normalizeRemote(url: string): string | null` — apply plan §5.1's steps **in this order**:
     strip a trailing `.git`; strip a `scheme://` prefix; strip everything up to and including a
     `@` in the authority; rewrite the scp-style `host:path` separator to `host/path`; strip a
     trailing `/`; lowercase. Return `null` if the result contains no `/`.
  3. The credential strip must happen **before** anything that could retain a copy — no logging,
     no metric, no error message that includes the raw URL. A remote of the form
     `https://user:ghp_xxx@github.com/team/svc.git` is ordinary in CI, and the normalized value
     ends up hashed into a committed file header.
  4. Do not use `child_process`. Do not use `new URL()` — it rejects the scp-style
     `git@host:path` form that git accepts and that roughly half of all clones use.
- **Acceptance criteria:**
  - All five fixtures from plan §5.1 normalize to their stated outputs, including the local-path
    remote returning `null`.
  - `https://user:token@gitlab.com/team/svc.git` → `gitlab.com/team/svc`, and the output contains
    no `@`, no `token` substring, and no `:` before the host.
  - `parseGitConfigRemote` returns `null` for: empty string, a single NUL byte, 1 MB of random
    bytes, a config with no `[remote]` section, and a config whose only remote is named `upstream`.
  - A config with CRLF endings and tab-indented `url` values parses identically to the LF,
    space-indented version.
  - A source scan of `plugin/RepoIdentity.ts` finds no `child_process`, `execSync` or `spawn`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_identity_remote.test.ts`

### K8-006 — `computeRepoId()` + three-source `resolve()`

**Status:** `[X]` Done — 13 tests passing (`npx vitest run tests/unit/repo_identity_resolve.test.ts` + init spy test); resolve wired into `plugin/index.ts` once at init next to `projectId`, via namespace import `import * as RepoIdentity`

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K8-005
- **Risk:** 🟡
- **Files:** `plugin/RepoIdentity.ts`, `plugin/index.ts`, `tests/unit/repo_identity_resolve.test.ts`
- **Description:**
  1. `computeRepoId(normalized: string): string` = `fnv1a64("okf:repo:v1\u0000" + normalized)`.
     The domain prefix means a repo id can never collide with a memory fingerprint computed over
     the same string, and it leaves room to version the derivation later.
  2. `resolve(cwd: string): ResolvedIdentity` tries the three sources in order — `declared`
     (`.kevin/project.json` → `id`), `remote` (`.git/config`), `path`
     (`fingerprint(process.cwd())`) — stopping at the first that yields a value, and always
     returning `projectId` alongside `repoId` regardless of which source won.
  3. `evidence` is a short, non-secret string: `".kevin/project.json#id"`, `"remote:github.com/acme/app"`,
     or `"cwd"`. It is surfaced by `kevin_project show`, so it must never contain a credential or
     an absolute path.
  4. Wire the call into `plugin/index.ts` next to line 68. `resolve()` runs **once**, at plugin
     init, and never on a hot path. It must not throw: a directory that is not a git repository,
     an unreadable `.git/config`, and a malformed `project.json` all fall through to source 3.
  5. A declared id must be validated as exactly 16 lowercase hex characters. Anything else is
     ignored and falls through, because a hand-edited garbage id in a committed file would
     otherwise scope a whole team's corpus onto a typo.
- **Acceptance criteria:**
  - Source precedence holds: a fixture with both `project.json` and a remote resolves `declared`.
  - Removing `project.json` resolves `remote`; removing `.git/` resolves `path`.
  - Two fixture directories at different paths, with identical `.git/config` remotes, produce
    **the same** `repoId` and **different** `projectId`s. This is the property the release exists
    for; assert both halves.
  - `resolve()` on a non-existent directory returns `source: "path"` and does not throw.
  - A `project.json` containing `{"id": "not-hex"}` falls through to the next source.
  - `resolve()` is called exactly once during plugin init (assert with a spy).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_identity_resolve.test.ts`

### K8-007 — Retrieval scoped on `repo_id` + equivalence proof

**Status:** `[X]` Done — repo_id scoping wired (getRelevant/query/loadAll/supersede/countSupersedeCandidates/audit rollup), NULL=global semantics, 6 equivalence tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-002, K8-006
- **Risk:** 🔴 (touches the hottest query in the plugin; a mistake empties every prompt)
- **Files:** `plugin/MemoryService.ts`, `tests/integration/repo_scope_equivalence.test.ts`
- **Description:**
  1. Change every retrieval predicate from `project_id = ?` to `repo_id = ?`:
     `getRelevant()`, `query()`, the supersede-candidate count, and the audit rollups.
     `project_id` stays on every row and is still written on insert (D8-02) — it is provenance now,
     not scope.
  2. Persist `repo_id` on every new memory, taken from the resolved identity.
  3. Handle the `NULL` case explicitly. `K8-002` leaves `repo_id` NULL where `project_id` was NULL,
     and `repo_id = NULL` matches nothing in SQL. Decide and encode one behaviour — the
     recommended one is that a NULL-scoped memory is global and matches every scope, preserving
     `PatternMiner.ts:131`'s existing `nullPid` convention — and test it, rather than discovering
     it in production when someone's oldest memories vanish.
  4. Build the equivalence fixture: a checked-in v0.7.0 database snapshot with at least 50
     memories across two `project_id`s, some with NULL, plus recorded `getRelevant()` output.
- **Acceptance criteria:**
  - For the fixture snapshot migrated to `009`, `getRelevant()` returns a **byte-identical**
    result to the recorded v0.7.0 output: same rows, same order, same scores. This is the entire
    backward-compatibility claim of the release and it is proven, not argued.
  - No retrieval path filters on `project_id` after this task. Asserted by a source scan of
    `MemoryService.ts` for `project_id = ?` inside a `SELECT`.
  - New memories are written with both `repo_id` and `project_id` populated.
  - NULL-`repo_id` rows behave per the documented decision, in both directions (they are returned
    under any scope, and a scoped memory is not returned under a different scope).
  - `rankScore()` is **unchanged** — assert the source of the function is byte-identical to
    v0.7.0's.
- **Status notes:** `repo_id` predicates are guarded by the `hasRepoIdColumn()` probe and a resolved identity (legacy/pre-009 callers keep the unscoped and `project_id`-scoped behaviour byte-for-byte). NULL-`repo_id` rows are global. `kevin_audit` gains a `repoId` param; `buildAudit` rollup scopes on `repo_id` when available.
- **Verification:** `npx vitest run tests/integration/repo_scope_equivalence.test.ts`

### K8-008 — `.kevin/project.json` + `kevin_project show`/`init`

**Status:** `[X]` Done — kevin_project show/init wired (19 tools, tool_count updated), 4 integration tests passing

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K8-006
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `plugin/RepoIdentity.ts`, `tests/integration/kevin_project.test.ts`
- **Description:**
  1. `kevin_project { action: "show" }` reports `repoId`, `source`, `evidence`, `projectId`, the
     memory count under each, and `rekey_available` — true when `resolve()` returns a `repoId`
     that differs from the one the corpus is currently stored under.
  2. `kevin_project { action: "init" }` writes `.kevin/project.json`:
     `{"id": "<16 hex>", "created_at": "<ISO-8601 Z>", "generator": "opencode-kevin/0.8.0"}`.
     The id comes from the current `resolve()` — so `init` in a repository with a remote *pins*
     the remote-derived id, which is the point: it survives the organisation renaming the repo.
  3. The write goes through `ArtifactWriter.apply()` with `mode: "whole"` once `K8-019` lands. If
     `K8-008` is implemented first, it must be refactored onto that path before F3 closes — there
     is no scenario in which a second `writeFileSync` is acceptable.
  4. `init` refuses if `.kevin/project.json` already exists. Overwriting it re-scopes a team's
     corpus, and that is `rekey`'s job, with a confirmation.
- **Acceptance criteria:**
  - `show` never emits a credential, an absolute path, or a raw remote URL.
  - `show` on an unmigrated corpus reports `rekey_available: true` when a git remote is present
    and the stored scope is the path fingerprint.
  - `init` creates the file with sorted keys and a terminating newline; a second `init` refuses
    with a reason and writes nothing.
  - After `init`, `resolve()` returns `source: "declared"` and the same `repoId` it returned
    before — pinning must not change the value.
- **Status notes:** `RepoIdentity.initProjectFile(cwd)` writes `{"created_at","generator","id"}` sorted keys + terminating newline; `kevin_project` resolves identity against the boot `projectRoot`. Tool ladder 18 → 19 (`tool_count: 19` in kevin_status; kevin_facts/kevin_status_v06/v07/kevin_publish assertions updated). `rekey` branch returns a not-yet-available message until K8-009. The `init` write must be refactored onto `ArtifactWriter mode:"whole"` before F3 closes (K8-019).
- **Verification:** `npx vitest run tests/integration/kevin_project.test.ts`

### K8-009 — `kevin_project rekey` — transactional, confirm-gated

**Status:** `[X]` Done — performRekey implemented in index.ts, 5 integration tests passing

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K8-007, K8-008
- **Risk:** 🔴 (moves every row of a corpus onto a new scope)
- **Files:** `plugin/index.ts`, `tests/integration/rekey.test.ts`
- **Description:**
  1. `kevin_project { action: "rekey", confirm: true }` updates `repo_id` from the stored value to
     the resolved one across `memories`, `shared_entries` and `okf_imports`, in **one**
     transaction, and increments `rekey_events`.
  2. Without `confirm: true` it is a dry run: it reports how many rows in each table would move,
     from which value to which, and changes nothing.
  3. It must never run automatically — not at init, not on `session.idle`, not from a migration
     hook (D8-03). Silently merging two corpora in a monorepo is unrecoverable and undiffable, and
     the user finds out when a stranger's memories appear in their prompts.
  4. Refuse when the target `repo_id` already has rows belonging to a *different* `project_id`
     set, unless a second explicit flag is passed. That is the monorepo collision, and it deserves
     a stop rather than a merge.
- **Acceptance criteria:**
  - Dry run reports accurate per-table counts and mutates nothing.
  - Confirmed rekey moves every row atomically; an injected failure mid-way leaves the database
    completely unchanged.
  - `rekey_events` increments by exactly 1 per confirmed run.
  - No code path outside the `kevin_project` tool handler calls the rekey function. Asserted by a
    source scan.
  - The monorepo-collision case refuses by default.
- **Status notes:** `performRekey(store, toRepoId, {confirm, force})` in `plugin/index.ts`; pre-009 DB refuses (no repo_id); dry run reports per-table rows + `from` (per-source counts) + `to_repo_id`; collision = target repo_id holds a different `project_id` set than the moving rows (memories is the only witness — shared_entries/okf_imports carry no project_id) → refused unless `force: true`; confirmed run is one transaction (3 UPDATEs + rekey_events upsert, so a mid-way failure rolls both back); NULL-repo_id rows never move. `force: true` added to the tool args. Source scan: exactly 2 `performRekey(` occurrences, both in index.ts (export + single call site).
- **Verification:** `npx vitest run tests/integration/rekey.test.ts`

---

# Phase F2 — OKF format & codec (the part that has to be right)

This phase is the release. Everything above it is plumbing and everything below it is tooling, but
if `join()` is not a semilattice then silent git merges, order-independent imports and correct
both-sides conflict resolution all evaporate, and no amount of surface polish compensates. Six
tasks, all pure functions, all testable without a database, a filesystem or a clock. Treat a
failing property test in `K8-014` as a format bug, not a test bug.

### K8-010 — `computeEntryId()` — unsalted, un-normalized

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟡 (a wrong id function is only detectable across two machines, i.e. not in unit tests unless you write them for it)
- **Files:** `plugin/okf.ts`, `tests/unit/okf_entry_id.test.ts`
- **Description:**
  1. `computeEntryId(type, statement, scope)` = `fnv1a64("okf:v2\u0000" + type + "\u0000" +
     statement + "\u0000" + (scope ?? ""))`, importing `fnv1a64` from `plugin/fingerprint.ts:57`.
  2. **Do not call `fingerprint()`** (D8-05). Two independent properties of that function make it
     wrong here, and both are invisible until a second machine exists:
     - it salts with `project_id` (line 76), so every clone would produce a different id for the
       same rule, the file would accumulate one entry per developer per rule, and the merge fold
       would never once fire;
     - it runs `normalize()` (line 42), which lowercases and rewrites `path.ext:line:col` — both
       destructive for a curated statement, where casing and file paths carry meaning.
  3. NUL separators, matching the existing convention, so `("rule", "ab", "c")` and
     `("rule", "a", "bc")` cannot collide.
  4. Add a comment at the call site naming this as the **third** fingerprint identity dimension in
     the codebase, per v0.7.0's Principle 26, and pointing at plan §3.3's table.
- **Acceptance criteria:**
  - The same triple yields the same id under two different `project_id`s and two different
    working directories.
  - Changing only the casing of `statement` yields a **different** id. Changing only a path
    reference (`src/routes/` → `src/Routes/`) yields a different id. Both are the `normalize()`
    behaviours that had to be avoided; assert them explicitly so a future refactor onto
    `fingerprint()` fails loudly.
  - The separator test: `("rule", "ab", "c")` ≠ `("rule", "a", "bc")`.
  - Output is exactly 16 lowercase hex characters for 1000 random inputs, including empty strings
    and 4 KB statements.
  - A source scan of `plugin/okf.ts` finds no import of `fingerprint` or `normalize`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/okf_entry_id.test.ts`

### K8-011 — `canonicalize()` + `serialize()` — byte determinism

**Status:** `[X]` Done — canonicalize/serialize per plan §5.4, 7 tests passing

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K8-010
- **Risk:** 🟡
- **Files:** `plugin/okf.ts`, `tests/unit/okf_serialize.test.ts`
- **Description:**
  1. `canonicalize(e: OkfEntry): string` builds a **new** object with keys inserted in
     alphabetical order — `author_hash, confidence, created_at, entry_id, evidence, op, origin,
     scope, statement, supersedes, type` — and returns `JSON.stringify` of it, with no space
     argument. Do not rely on the source object's insertion order; construct the ordered object
     explicitly, or sort the keys and build it programmatically.
  2. `serialize(entries, repoId, version)` emits the three header lines (`#okf 2`,
     `#repo <repoId>`, `#generated-by opencode-kevin/<version>`), then every entry sorted
     **ascending by `entry_id`**, one per line, LF endings, one terminating newline, UTF-8 with no
     BOM.
  3. `confidence` must serialize deterministically. `JSON.stringify(0.1 + 0.2)` is
     `"0.30000000000000004"`, which is a different byte string on a machine that computed the same
     value a different way. Round to a fixed precision — 4 decimal places — **before**
     canonicalizing, and do it in one place so `join()` and `serialize()` cannot disagree.
  4. Reject entries over `MAX_LINE_BYTES` (4096, measured in **bytes** via
     `Buffer.byteLength(line, "utf8")`, not in UTF-16 code units — a statement of Japanese text
     passes a `.length` check and fails a byte check) and corpora over `MAX_ENTRIES` (2000).
- **Acceptance criteria:**
  - Key order in every emitted line is alphabetical, asserted by a regex over the raw text rather
    than by parsing it back.
  - `serialize(parse(serialize(e, r, v)).entries, r, v)` is byte-identical to `serialize(e, r, v)`
    for every fixture, including one with 500 entries.
  - Shuffling the input array does not change a single byte of the output.
  - `0.1 + 0.2` and `0.3` as `confidence` produce the same line.
  - A 3000-byte statement of multi-byte UTF-8 is rejected by the byte check even though its
    `.length` is under 4096.
  - Output ends with exactly one `\n` and contains no `\r`.
- **Status notes:** **Deviation from this task's draft, per plan §5.3/§5.4 (authoritative):** `confidence` is NOT serialized — the file carries `evidence` + `recurrence` (integers only) and `deriveConfidence()` reuses the v0.4.0 two-sided formula at read time. `OkfEntry` = plan §5.4's 11 fields; canonical keys: author_hash, created_at, entry_id, evidence, op, origin, recurrence, scope, statement, supersedes, type. serialize() throws on >MAX_LINE_BYTES (Buffer.byteLength) or >MAX_ENTRIES.
- **Verification:** `npx vitest run tests/unit/okf_serialize.test.ts`

### K8-012 — `parse()` — total function + rejection taxonomy

**Status:** `[X]` Done — parse() total per plan §5.4/D8-14, 11 tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-011
- **Risk:** 🟡
- **Files:** `plugin/okf.ts`, `tests/unit/okf_parse.test.ts`
- **Description:**
  1. `parse(text): ParseResult` **never throws, on any input** (D8-14). The file is expected to
     arrive damaged: a conflict resolution leaves `<<<<<<< HEAD` markers, an editor truncates the
     last line, a merge tool mangles an encoding. Throwing would take the plugin down over a text
     file.
  2. Every unusable line becomes a `RejectedLine {line, reason}`. The reason taxonomy is closed:
     `bad_json`, `missing_field`, `wrong_type`, `id_mismatch`, `line_too_long`, `corpus_too_large`,
     `unknown_op`.
  3. `id_mismatch` is the integrity check that makes the format tamper-evident: recompute
     `computeEntryId(type, statement, scope)` and compare with the stated `entry_id`. A
     hand-edited statement in a committed file is caught here rather than silently ranked.
  4. Strip a UTF-8 BOM before touching the first line, or the `#okf ` prefix check fails on a file
     written by a Windows editor and the whole corpus is rejected as not-OKF.
  5. Fold duplicate `entry_id`s through `join()` (`K8-013`) and report the count in `folded`.
     Return entries sorted ascending by `entry_id` regardless of input order.
  6. A file whose header declares a version greater than `OKF_VERSION` returns
     `entries: []` with a single `version_ahead` reject rather than a best-effort parse. Guessing
     at a future format's semantics is how corpora get corrupted.
- **Acceptance criteria:**
  - No throw for: empty string, a single NUL byte, 4 MB of random bytes, CRLF endings, a UTF-8
    BOM, a header claiming version 3, a truncated final line, and a valid file with 2001 entries.
  - A file containing `<<<<<<< HEAD`, `=======` and `>>>>>>> branch` yields exactly three
    `bad_json` rejects and keeps every valid entry around them.
  - An entry whose `statement` was hand-edited without updating `entry_id` is rejected as
    `id_mismatch`.
  - `parse()` on `serialize()` output round-trips with `rejected.length === 0` and
    `folded === 0`.
  - Entries are returned in ascending `entry_id` order for shuffled input.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/okf_parse.test.ts`

### K8-013 — `join()` — the field lattice

**Status:** `[X]` Done — join() implemented per plan §5.4 (max/min/absorbing OR), 7 tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K8-010
- **Risk:** 🔴 (every guarantee in the release rests on this function's algebra)
- **Files:** `plugin/okf.ts`, `tests/unit/okf_join.test.ts`
- **Description:**
  1. Implement `join(a, b)` exactly as plan §5.4 specifies. Every field must resolve through a
     `max`, a `min`, or an absorbing boolean OR over a **totally ordered** set. There is no room
     for a "prefer the newer one" or a "prefer ours" anywhere in this function.
  2. `pickMin(a, b)` handles the nullable fields (`scope`, `author_hash`, `supersedes`): null
     yields the other; otherwise lexicographic min. `a ?? b` is the natural thing to write and is
     **not commutative** when both sides are non-null and different — that single character is
     enough to break the release's exit criterion.
  3. `op` is absorbing: `tombstone` wins (D8-09). No undelete, no timestamp tiebreak. Clock skew
     across machines makes "newer" unavailable as a concept, and a flag that reverses a tombstone
     reintroduces the order dependence the format exists to eliminate.
  4. `created_at` uses **min**, not max: an entry's birthday is when anyone first asserted it, and
     min is the only choice stable under replay.
  5. `type`, `statement` and `scope` are equal by construction whenever `entry_id` matches — except
     under a hash collision. Resolve those by lexicographic min too, so the function stays total
     and deterministic instead of throwing or picking arbitrarily.
  6. Add the plan-decision comment: `// v0.8.0 (K8-013 / plan §5.4, D8-13)`.
- **Acceptance criteria:**
  - `join(a, b)` equals `join(b, a)` for 1000 random pairs sharing an `entry_id`, compared by
    `canonicalize()`.
  - `join(a, a)` equals `a`.
  - `join(join(a, b), c)` equals `join(a, join(b, c))` for 1000 random triples.
  - `confidence` and `evidence` are the max of the inputs; `created_at` is the min.
  - Any input with `op: "tombstone"` yields `op: "tombstone"`, in both argument orders.
  - A pair where both `supersedes` values are non-null and different resolves to the same value in
    both argument orders. Write this test first; it is the one `??` fails.
- **Status notes:** join() implemented exactly as plan §5.4 (pickMin null-tolerant; tombstone absorbs; created_at min; type/statement/scope lexicographic min for hash collisions). Per plan §5.3, `recurrence` (max) replaces this draft's `confidence` field. join() landed with K8-012 (parse folds via join). Plan-decision comment present at the definition.
- **Verification:** `npx vitest run tests/unit/okf_join.test.ts`

### K8-014 — `merge()` + semilattice property tests

**Status:** `[X]` Done — merge() groups by entry_id, folds via join(), sorts ascending; 6 property tests (≥1000 iterations each) + fixed-seed guard passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-013, K8-011
- **Risk:** 🔴
- **Files:** `plugin/okf.ts`, `tests/unit/okf_merge_properties.test.ts`
- **Description:**
  1. `merge(a, b)` groups both arrays by `entry_id`, folds each group through `join()`, and
     returns the result sorted ascending by `entry_id`.
  2. Write the property tests over **≥1000 randomized entry pairs**. This is the release's exit
     criterion, so it is a property test and not a handful of examples.
  3. **No `fast-check` dependency.** The zero-new-dependency rule holds. A 20-line seeded
     `xorshift32` generator in the test file is sufficient; print the seed on failure so a failing
     case is reproducible, and check in one fixed seed as a regression guard alongside the random
     runs.
  4. Compare corpora by `serialize()` output, not by deep equality on objects. Byte comparison is
     what actually matters — two arrays can be deep-equal and serialize differently if the sort is
     unstable.
  5. The generator must produce adversarial inputs, not just plausible ones: colliding
     `entry_id`s with differing payloads, all-null optional fields, mixed `op` values, identical
     `confidence` values, `created_at` strings that differ only in the final digit, and empty
     corpora on either side.
- **Acceptance criteria:**
  - **Commutativity:** `serialize(merge(a, b))` equals `serialize(merge(b, a))` for ≥1000 pairs.
  - **Associativity:** `serialize(merge(merge(a, b), c))` equals `serialize(merge(a, merge(b, c)))`
    for ≥1000 triples.
  - **Idempotence:** `serialize(merge(a, a))` equals `serialize(a)` for ≥1000 corpora.
  - `merge([], a)` equals `a`; `merge(a, [])` equals `a`.
  - The `folded` count equals the number of `entry_id`s present in both inputs.
  - The failing seed is printed in the assertion message.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/okf_merge_properties.test.ts`

### K8-015 — Git-conflict-marker fixture

**Status:** `[X]` Done — base/side_a/side_b/conflicted fixtures checked in under tests/fixtures/okf/, 4 tests passing

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** K8-012, K8-014
- **Risk:** 🟢
- **Files:** `tests/integration/okf_conflict.test.ts`, `tests/fixtures/okf/*.okf`
- **Description:**
  1. Build three checked-in fixtures: `base.okf`, `side_a.okf`, `side_b.okf`, sharing a merge base
     and diverging in three ways — an entry only in A, an entry only in B, and one entry present
     in both with different `confidence` and `evidence`.
  2. Build `conflicted.okf`: the literal output a three-way merge produces for that case, markers
     and all.
  3. Assert the property the whole format exists for: **the naive resolution is the correct one.**
     Parsing `conflicted.okf` — dropping the three marker lines as `bad_json` rejects — yields the
     same corpus as `merge(parse(side_a), parse(side_b))`, compared by `serialize()`.
  4. Also assert that concatenating A and B wholesale, with no merge base and duplicate lines,
     parses to that same corpus. That is what a hurried engineer does at 6 pm, and it must be safe.
- **Acceptance criteria:**
  - `serialize(parse(conflicted).entries)` equals `serialize(merge(parse(a).entries, parse(b).entries))`.
  - `serialize(parse(a_text + b_text).entries)` equals the same value.
  - The marker lines appear as exactly three rejects, and no valid entry is lost.
  - The shared entry's `confidence` is the max of the two sides and its `created_at` the min.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/okf_conflict.test.ts`

---

# Phase F3 — Two-layer store (the file becomes memories, and memories become the file)

F2 produced a codec that knows nothing about SQLite. This phase connects it, in both directions,
without letting either direction acquire authority it should not have. Import may retire a memory
— but only on an explicit committed tombstone. Export may write a file — but only through the one
write path that has existed since v0.6.0.

### K8-016 — `SharedLayer.import()` + `okf_imports` + hash skip

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-012, K8-014, K8-001
- **Risk:** 🟡
- **Files:** `plugin/SharedLayer.ts`, `tests/integration/shared_import.test.ts`
- **Description:**
  1. `import(path)` reads the file, hashes it with `fnv1a64`, and compares against the most recent
     `okf_imports` row for this `repo_id`. On a match, write a row with `skipped = 1` and return
     immediately. This is what makes the `session.idle` hook affordable on an unchanged repository.
  2. On a miss: parse, upsert every entry into `shared_entries` keyed on
     `(repo_id, entry_id)` — the UNIQUE index from `K8-001` makes this an upsert rather than an
     append — and write one `okf_imports` row with the parse counters.
  3. A missing file is not an error. It returns `fileHash: null`, `parsed: 0`, and writes an audit
     row. A first-run repository has no OKF file and must not produce a failure.
  4. Every statement filters on `repo_id`. There is no unscoped read or write of either table.
  5. `okf_merge_folds` increments by `ParseResult.folded`. A persistently non-zero value is signal,
     not error: the team is editing the same entries concurrently and the lattice is absorbing it.
- **Acceptance criteria:**
  - Importing the same unchanged file twice performs exactly one parse; the second call returns
    `skipped: true` and still writes an audit row.
  - Importing a file with 500 entries into an empty database creates 500 `shared_entries` rows;
    re-importing after changing one entry's `confidence` updates exactly one row and inserts none.
  - A missing file returns `parsed: 0` and does not throw.
  - Two `repo_id`s importing files that share an `entry_id` produce two distinct rows.
  - `okf_imports` is append-only: a source scan finds no `UPDATE okf_imports` anywhere.
  - Import order does not affect the final `shared_entries` contents (shuffle the input file's
    lines and assert an identical table).
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/shared_import.test.ts`

### K8-017 — Projection into `memories` + tombstone retirement

**Status:** `[X]` Done — 15/26

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K8-016, K8-007
- **Risk:** 🔴 (writes `memories.status`, which nothing since v0.4.0 has been allowed to do casually)
- **Files:** `plugin/SharedLayer.ts`, `plugin/MemoryService.ts`, `tests/integration/shared_projection.test.ts`
- **Description:**
  1. Project every imported `assert` entry into `memories` with `layer='shared'`, the resolved
     `repo_id`, `shared_entry_id` set to the entry id, and `confidence`/`evidence_count` taken from
     the entry. This is D8-10: a shared memory is a memory, so `getRelevant()`, `rankScore()`, the
     five gates, `truth_penalty`, `ConflictDetector` and every audit rollup keep working unchanged.
  2. An incoming `op='tombstone'` sets the corresponding memory's `status='archived'`.
  3. Justify that write in a comment, because it looks like a violation and is not. v0.7.0's
     Principle 24 forbids **contradiction** — a fuzzy inference — from writing `status`. A
     tombstone is the opposite: an explicit, committed, human-reviewed decision that arrived
     through a pull request. Cite D8-09 and Principle 24 at the call site so the next reader does
     not "fix" it.
  4. Projection is idempotent: re-importing an unchanged file must not create duplicate memories,
     bump `evidence_count`, or move `updated_at`.
  5. Do not touch `memories.fingerprint` for shared rows. It is a different identity dimension
     (plan §3.3) and conflating it with `shared_entry_id` would make the v0.4.0 supersede path
     fire on unrelated entries.
- **Acceptance criteria:**
  - An imported entry is returned by `getRelevant()` under the same scope, ranked by the unchanged
    `rankScore()`.
  - Re-importing an unchanged file leaves every `memories` row byte-identical, `updated_at`
    included.
  - A tombstone archives exactly the memory with the matching `shared_entry_id` and no other.
  - A tombstone for an `entry_id` with no local memory is a no-op, not an error.
  - No code path in this task writes `status` for any reason other than a tombstone. Asserted by a
    source scan for `status =` within `SharedLayer.ts`.
  - `ConflictDetector` (unchanged) detects a negation pair between an imported rule and a local
    one, and resolves neither.
- **Status notes:** `projectEntries()` added to `SharedLayer` (assert → INSERT ONCE, never UPDATE; tombstone → the single `status` write, cited D8-09/Principle 24, counted via `SELECT changes()`). Two decisions beyond the letter of the task: (1) `SharedLayer` deps gain `projectId` — ConflictDetector, Archiver and the audit rollups scope on `project_id`, so D8-10 requires the projection to carry the local path provenance; the task's own ConflictDetector acceptance is impossible otherwise. (2) Path-prefix scopes degrade to `'project'` because `memories.scope` is CHECK-constrained to project/session. The ConflictDetector test's local rule carries a real fingerprint: `oppositePair` skips rows where `a.fingerprint === b.fingerprint`, and the shared projection leaves `fingerprint` NULL by design (task point 5), so a NULL-fingerprint test pair would be silently skipped.
- **Verification:** `npx vitest run tests/integration/shared_projection.test.ts`

### K8-018 — Shared-row immutability enforcement

**Status:** `[X]` Done — 16/26

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K8-017
- **Risk:** 🔴
- **Files:** `plugin/MemoryService.ts`, `tests/unit/shared_immutability.test.ts`
- **Description:**
  1. Refuse local writes to `statement`, `type`, `scope`, `confidence` and `evidence_count` on any
     row with `layer='shared'`, per plan §5.2's table. Refuse means return a typed refusal and
     count it — not throw, and not silently ignore.
  2. Allow `feedback_positive`, `feedback_negative`, `truth_penalty`, `contradicted_at`, `ignored`,
     `last_injected_at` and injection outcomes. These are per-machine operational state and never
     leave.
  3. The rationale for each half is worth a comment. The forbidden columns are inputs to
     `entry_id` or are merged from the file, so a local edit would either desynchronize the row
     from the committed file undetectably, or be silently overwritten at the next `kevin_sync` —
     and the user would watch their change vanish with no explanation. The allowed columns are
     exactly the ones that make `precision_shared` meaningful: your opinion of a teammate's rule is
     yours.
  4. `truth_penalty` on a shared row is not only allowed but important: a teammate's rule may
     contradict *your* `package.json`, and it should be de-ranked on your machine and nowhere else.
- **Acceptance criteria:**
  - Each of the five forbidden columns is refused on a `layer='shared'` row and succeeds on a
    `layer='local'` row.
  - Each of the allowed columns succeeds on both.
  - `kevin_feedback` against a shared memory records normally and changes ranking locally.
  - `RepoTruth.applyTruthPenalty()` (v0.7.0, unchanged) applies to a shared row.
  - A refusal is counted, not thrown, and the counter is visible in `kevin_audit`.
- **Status notes:** `update()` returns `MemoryUpdateResult` (`{ok:true} | {ok:false, refused:string[]}`) and refuses the five plan §5.2 columns on `layer='shared'` rows; `layer` probe added (pre-009 DBs skip the check entirely — no shared rows can exist). Refusals are counted in a `shared_write_refusals` key OUTSIDE the frozen METRIC_KEYS ladder (K7-004), persisted via the `incrRegistered` precedent (direct `kevin_metrics` upsert, read by SQL); surfaced as the minimal `team` block in `kevin_audit` (K8-023 extends it). Two findings documented in the test: (1) `last_injected_at`/`recurrence_count` stamps are fingerprint-correlated by design (`settle()` matches failing calls by fingerprint) and shared rows carry no fingerprint (K8-017 point 5) — ledger outcomes still record and settle on shared rows, the stamp just never fires, exactly like any fingerprint-less local memory in v0.7.0; (2) `ContextInjector.recordInjections` filters `admitted.filter(m => m.fingerprint)`, so shared memories produce NO ledger row at injection time — the counter `injections_from_shared` has no call site anywhere in plugin/. Both are deferred: the ledger gap lands with K8-023 (shared metrics), where `injections_from_shared` gets its call site.
- **Verification:** `npx vitest run tests/unit/shared_immutability.test.ts`

### K8-019 — `ArtifactWriter` `mode:"whole"` + write-path test

**Status:** `[X]` Done — 17/26

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** —
- **Risk:** 🟡 (touches the one component allowed to modify a user's repository)
- **Files:** `plugin/ArtifactWriter.ts`, `tests/unit/single_write_path.test.ts`, `tests/unit/artifact_writer_whole.test.ts`
- **Description:**
  1. Add `WriteMode = "markers" | "whole"`. The `markers` path must be **byte-for-byte unchanged** —
     `AGENTS.md` is a file humans edit and every v0.6.0 guarantee about bytes outside the markers
     still holds.
  2. `whole` replaces the entire file and is used only for Kevin-owned paths. It keeps every other
     v0.6.0 guarantee: temp file, `fsync`, atomic `rename`, `hashBefore`/`hashAfter` recorded in
     `artifact_writes` **including on refusal**, and a `noop` outcome when the rendered bytes match
     what is already on disk.
  3. Extend `tests/unit/single_write_path.test.ts` rather than relaxing it. It must now assert
     **both**: exactly one `ArtifactWriter.apply()` call site in `plugin/`, and exactly one
     construction site using `mode: "whole"`, located in `SharedLayer.ts`. A convenience
     `writeFileSync` in a tool module is precisely what this test exists to prevent (D8-08).
  4. `whole` mode must still refuse rather than repair (D6-03). The refusal conditions belong to
     the caller — `K8-020` supplies them — but the writer records the refusal with both hashes.
- **Acceptance criteria:**
  - Every existing `ArtifactWriter` test passes unmodified.
  - `mode: "whole"` writing identical bytes returns `noop` and does not touch the file's mtime.
  - An injected failure between temp-write and rename leaves the original file untouched and no
    temp file behind.
  - A refusal writes an `artifact_writes` row with both hashes and `outcome='refused'`.
  - The extended single-write-path test fails if a `writeFileSync` is added to `SharedLayer.ts`.
    Verify by adding one temporarily and observing the failure.
- **Status notes:** `WriteMode = "markers" | "whole"` + `WriteRequest {path, mode, content, refusal?}` added; `plan()` overloaded (the two-argument form is the markers convenience, byte-for-byte — every v0.6.0 test passes unmodified, per the acceptance criterion). `write(request, proposalId?)` is the single funnel: the ONLY `.apply(` call site in plugin/ (asserted by the scan). Whole mode: no markers, no sanitation, no EOL normalization — the rendered bytes are written as-is, so a re-render of identical bytes is a `noop` (mtime untouched, asserted); caller-side `refusal` (K8-020's conditions) yields `after = before` with BOTH hashes audited. The K8-008 NOTE was resolved: `initProjectFile` now writes `.kevin/project.json` through `writer.write({mode:"whole"})`, removing RepoIdentity's raw `writeFileSync` (RepoIdentity.ts no longer imports `fs.writeFileSync`; the only raw writes left in plugin/ are Retrospective.ts). The extended scan test asserts: exactly one `.apply(` site (ArtifactWriter.ts), whole-mode construction only in SharedLayer.ts + RepoIdentity.ts (SharedLayer exactly one — the task's "exactly one construction site" text predates the RepoIdentity resolution; the invariant that matters, D8-08, is the single write PATH), and `writeFileSync` only in RepoIdentity.ts/Retrospective.ts. SharedLayer gains the `writer` dep + minimal `applyExport(path, content)`; the 11 integration construction sites updated.
- **Verification:** `npx vitest run tests/unit/single_write_path.test.ts tests/unit/artifact_writer_whole.test.ts`

### K8-020 — `planExport()` / `applyExport()` + eight refusals

**Status:** `[X]` Done - 18/26

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-014, K8-016, K8-019
- **Risk:** 🔴 (the only code in the release that can destroy a teammate's data)
- **Files:** `plugin/SharedLayer.ts`, `tests/integration/shared_export.test.ts`
- **Description:**
  1. `planExport(memoryIds, path)` is **pure** in the v0.6.0 sense: it reads the current file,
     merges the candidates into the parsed corpus, serializes, produces a unified diff via
     `plugin/diff.ts`, and writes nothing. `applyExport(plan)` performs the write through
     `ArtifactWriter.apply({mode: "whole"})`.
  2. Implement all eight refusal reasons from plan §5.5: `not_okf`, `version_ahead`,
     `repo_mismatch`, `too_many_entries`, `line_too_long`, `below_floor`, `not_curated`,
     `parse_damaged`.
  3. `parse_damaged` is the one that matters most and is the easiest to leave out. Writing over a
     file that produced any rejected line would destroy a teammate's entries under the guise of a
     merge — the user resolved a conflict badly, and Kevin would silently finish the job. Refuse,
     record it, and tell the user to resolve the conflict by keeping both sides, which `K8-015`
     proves is correct.
  4. `below_floor` reads `shared_confidence_floor` with `Number.parseFloat`, clamped to `[0, 1]`,
     defaulting to `0.7` on `NaN`. `parseInt` yields `0` here, which disables the gate and shares
     everything.
  5. `not_curated` applies only when `share_requires_approval === "1"` — a string comparison,
     never a truthiness check.
  6. `planTombstone(entryIds, path)` produces the tombstone-append plan. It never deletes a line
     (D8-09): a removed line is an unresolvable conflict for whoever is editing it concurrently,
     and a deletion must be reviewable in a pull request.
- **Acceptance criteria:**
  - Each of the eight refusal reasons is reachable and covered by a test, with a fixture for each.
  - `planExport` performs no filesystem write. Asserted by comparing the file's hash and mtime
    before and after.
  - Exporting the same candidates twice yields `noop` on the second call — byte-identical output.
  - The produced diff is a valid unified diff and contains only added lines for a pure addition.
  - `planTombstone` appends a `tombstone` line and removes none; the file's line count grows.
  - Export followed by import in a second store reproduces the entries exactly (this is the
    `K8-024` loop in miniature).
- **Status notes:** `planExport(memoryIds, path)` is pure (reads the file via `readWithFlag`, merges candidates through `okf.merge`, serializes, produces the write plan through the writer funnel — the file's hash and mtime are untouched, asserted); the refusal ladder runs in the plan §5.5 table order — not_okf (first line not `#okf `), version_ahead, repo_mismatch (#repo header), too_many_entries (merged > MAX_ENTRIES, checked before serialize so serialize never throws), line_too_long (canonicalized bytes > MAX_LINE_BYTES), below_floor (`Number.parseFloat` on `shared_confidence_floor`, clamped [0,1], 0.7 on NaN, via `computeConfidence`), not_curated (only when `share_requires_approval === "1"` string compare), parse_damaged (any rejected line — the one that matters most). `planTombstone(entryIds, path)` reconstructs each tombstone from the local projection (`shared_entry_id` lookup, so the line passes parse's tamper-evident entry_id check), refuses `unknown_entry` when an id has no projection, and never deletes a line (D8-09); the same header/damage guards apply. `applyExport(plan)` re-plans through the SINGLE `write()` funnel (the scan test keeps exactly one `.apply(` site in ArtifactWriter.ts — the K8-020 text's "via ArtifactWriter.apply" is satisfied by the funnel, D8-08), so `ExportPlan` carries both the `request` (WriteRequest, whole mode) and the `write` (pure preview with diff/outcome). Refused plans are audited with both hashes (`after === before`, asserted through artifact_writes). `memoryToEntry` normalizes created_at from SQLite "YYYY-MM-DD HH:MM:SS" to ISO-8601 so re-exports are byte-identical noops; scope participates in entry_id identity (a file entry with scope null and its projected memory with scope 'project' have different entry_ids — the round-trip test uses scope 'project' throughout). 20 integration tests passing (`npx vitest run tests/integration/shared_export.test.ts`), suite 1107, tsc + lint clean.
- **Verification:** `npx vitest run tests/integration/shared_export.test.ts`

---

# Phase F4 — Team surfaces (the three tools and the two renderings)

Nothing in this phase adds capability; it exposes what F1–F3 built, behind gates that keep every
promotion an explicit human act. `kevin_share` defaults to a dry run, `kevin_sync` only re-reads a
file already on disk, and the `AGENTS.md` block becomes a projection of the committed file so the
two can never disagree in a pull request.

### K8-021 — `kevin_share` tool

**Status:** `[X]` Done - 19/26

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K8-020
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `tests/integration/kevin_share.test.ts`
- **Description:**
  1. `kevin_share { memory_ids?: string[], dry_run?: boolean, confirm?: boolean }`. Note
     `memory_ids` is `string[]` — `memories.id` is **TEXT**, as `kevin_injections.memory_id`'s type
     confirms. A `number[]` signature typechecks against nothing and silently matches no rows.
  2. Default `dry_run: true`. With no `memory_ids`, select every `curated = 1` memory at or above
     `shared_confidence_floor` that is not already shared.
  3. When `share_requires_approval === "1"` (the default), require `confirm: true` and refuse
     un-curated memories. This chains promotion behind the v0.6.0 `kevin_approve` gate rather than
     opening a second door beside it.
  4. Return the `ExportPlan` including the diff. The user sees exactly what would be committed
     before anything is written.
  5. Increment `shared_entries_exported` by the number of entries actually added.
- **Acceptance criteria:**
  - Default invocation writes nothing and returns a diff.
  - `confirm: true` writes through `ArtifactWriter.apply({mode: "whole"})` and no other path.
  - With `share_requires_approval='1'`, an un-curated memory is refused with `not_curated`.
  - A memory below `shared_confidence_floor` is refused with `below_floor`.
  - Sharing the same memory twice is a `noop` on the second attempt.
  - `shared_entries_exported` matches the number of new lines in the file.
- **Status notes:** kevin_share registered after kevin_approve with `{ memory_ids?: string[], dry_run?: boolean, confirm?: boolean }` (string[] per the `kevin_injections.memory_id` TEXT hint — a number[] signature would silently match no rows). Default dry run: returns the plan's diff and writes nothing. With no memory_ids it selects every `layer='local' AND curated=1 AND shared_entry_id IS NULL` memory whose `computeConfidence(evidence_count, recurrence_count)` clears the clamped floor (same formula as planExport's below_floor, so selection and refusal agree). Flow: planExport → refused → `{refused: reason}`; dry_run → `{dry_run: true, diff}`; `share_requires_approval='1'` without confirm → `{confirm_required: true}` (still no write — dry run wins over confirm); otherwise `applyExport` (the single write funnel, D8-08) with `mkdirSync(dirname(okfPath), {recursive:true})` first (the writer's `.kevin.tmp` needs the parent — same prep as RepoIdentity.initProjectFile) and `shared_entries_exported += entriesAdded` only on outcome `written` (noop/refused don't move it). okf_path resolves against `projectRoot`. The shared layer bridge is constructed once at init next to the writer with `KEVIN_VERSION = "0.8.0"`; note: init resolves identity against `process.cwd()` while kevin_project resolves against `projectRoot` — they coincide in production (projectRoot defaults to cwd), tests must seed candidates under `resolve(process.cwd()).repoId`. kevin_facts ladder test bumped 19 → 20. 8 integration tests passing (`npx vitest run tests/integration/kevin_share.test.ts`), suite 1115, tsc + lint clean.
- **Verification:** `npx vitest run tests/integration/kevin_share.test.ts`

### K8-022 — `kevin_sync` tool + `session.idle` wiring

**Status:** `[X]` Done - 20/26

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K8-016, K8-017
- **Risk:** 🟡 (adds a filesystem read to a lifecycle hook)
- **Files:** `plugin/index.ts`, `tests/integration/kevin_sync.test.ts`
- **Description:**
  1. `kevin_sync {}` calls `SharedLayer.import()` on the configured `okf_path` and returns the
     `ImportReport`.
  2. Wire it into `session.idle`, guarded by `shared_layer_enabled === "1"` — a string comparison.
     A truthiness check turns the release on for every installation that upgrades, because `'0'`
     is a truthy string.
  3. Never wire it into `tool.execute.*`, `chat.message`,
     `experimental.chat.system.transform` or `experimental.session.compacting`. The hot-path rule
     is absolute, and the file-hash skip makes it affordable only on `session.idle`.
  4. The name is deliberate and its scope is deliberately narrow: `sync` here means "re-read a
     file that is already on disk". No fetch, no push, no remote, no poll (D8-01, Principle 30).
- **Acceptance criteria:**
  - With `shared_layer_enabled='0'`, `session.idle` performs no filesystem read at all. Asserted by
     pointing `okf_path` at a path whose read would throw and observing no error.
  - With the flag on and an unchanged file, `session.idle` costs one read plus one hash and returns
    `skipped: true`.
  - `kevin_sync` invoked manually works regardless of the flag.
  - A source scan confirms `import()` is not reachable from any hot-path hook.
  - `shared_entries_imported` increments by the number of entries actually upserted.
- **Status notes:** `syncSharedLayer()` helper defined next to the sharedLayer construction (resolves okf_path against projectRoot, calls `sharedLayer.import()`, increments `shared_entries_imported` by `report.imported` — which counts every row inserted OR updated, per the ImportReport contract). `kevin_sync {}` returns the ImportReport and works regardless of the flag. `session.idle` runs the sync inside a best-effort try/catch gated by `shared_layer_enabled === "1"` (TEXT compare — a truthiness check would enable the release on every upgraded installation since '0' is truthy), placed before `metrics.flush()` after the curation block. The scan test asserts exactly one `sharedLayer.import(` site and that none of the hot-path hook blocks (tool.execute.before/after, chat.message, experimental.chat.system.transform, experimental.session.compacting) contain "sharedLayer"/"syncSharedLayer". Test observations: with the flag off and okf_path pointed at a directory, idle writes no okf_imports row (no read happened); with the flag on and an unchanged file, idle appends a skipped audit row with the same file_hash (one read + one hash). kevin_facts ladder test 20 → 21. 5 integration tests passing (`npx vitest run tests/integration/kevin_sync.test.ts`), suite 1120, tsc + lint clean.
- **Verification:** `npx vitest run tests/integration/kevin_sync.test.ts`

### K8-023 — `Curator` shared rendering + `kevin_audit.team`

**Status:** `[X]` Done - 21/26

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** K8-017, K8-022
- **Risk:** 🟡
- **Files:** `plugin/Curator.ts`, `plugin/kevin_audit.ts`, `tests/integration/curator_shared.test.ts`
- **Status notes:** `Curator` gains a fifth optional constructor param `repoId` (v0.6.0 construction sites untouched) and `candidates(limit?, source: "memories" | "shared" = "memories")`. The shared path reads `shared_entries` (`WHERE repo_id = ? AND op = 'assert' AND evidence >= 2` — the feedback disjunct of the D6-09 predicate cannot fire on a schema with no feedback columns, so `evidence >= 2` is its SQL half), maps `entry_id AS id, statement AS content, created_at AS updated_at, NULL last_verified_at`, then runs the IDENTICAL JS pipeline: `computeConfidence(evidence, 0, 0, 0)` (recurrence is not tracked for shared rows), the 0.6 floor, `confidence DESC, updated_at DESC` selection, the 20-line/4000-char caps, and id-ordered rendering (D6-10). The evidence string renders "verified N×" without a date — `last_verified_at` is a local-memory concept. `propose()` routes via a new private `sourceFromFlag()` (`shared_layer_enabled === "1"` → "shared"), so the kevin_propose tool and idle curation switch substrate with one flag; routing lives next to the predicate it switches (D8-11). `kevin_audit.team` extended with the full rollup, all pure SQL gated on a migration-009 probe (`SELECT 1 FROM shared_entries`): `shared_total` (op='assert'), `tombstones`, `distinct_authors` (COUNT DISTINCT non-null — naturally 0 with `author_identity_mode='none'` since imports write NULL), `last_import_at`/`last_import_rejected` (newest `okf_imports` row, id DESC tiebreak), and `precision_shared`/`precision_local` with the v0.5.0 formula `effective/(effective+ineffective)` over `kevin_injections JOIN memories ON m.id = i.memory_id WHERE m.layer = ? AND (m.repo_id = ? OR m.repo_id IS NULL)` (repoId-optional like the truth block). Below the v0.7.0 maturity floor (memories >= 100 AND settled >= 50) the precision numbers are OMITTED and `reason: "immature_db"` reported instead; pre-009 databases keep the K8-018 `{ write_refusals }` shape. Test observations: `memoryIds` on a proposal preserves SELECTION order (e-b before e-a by confidence), not id order — id ordering is a rendering contract only; the char cap needs a fixture of long entries alone (mixed short+long lets the 20-line cap bind first). 9 integration tests (`npx vitest run tests/integration/curator_shared.test.ts`), suite 1129, tsc + lint clean.
- **Description:**
  1. `Curator.candidates()` gains a source parameter. When `shared_layer_enabled === "1"` it reads
     `shared_entries`; otherwise the v0.6.0 path over `memories` runs untouched. The predicate, the
     caps (20 lines, 4000 chars) and the deterministic sort by id are unchanged in both cases.
  2. This buys the invariant in D8-11: **the committed block is a projection of the committed
     file.** A reviewer sees substrate and rendering change together in one pull request, and
     cannot be shown a block asserting something the file does not contain.
  3. Add the `team` block to `kevin_audit`, in **pure SQL**, following v0.7.0's `mix` precedent:
     the counts, `distinct_authors`, `last_import_at`, `last_import_rejected`, and
     `precision_shared` versus `precision_local` computed with the v0.5.0 formula
     `effective / (effective + ineffective)` over each layer.
  4. `precision_shared` can come out worse than `precision_local`, and the block must report that
     plainly rather than hiding it. If shared entries persistently under-precise local ones on
     mature databases, the shared layer is exporting noise and the response is to raise
     `shared_confidence_floor` or to stop — not to reword the metric.
  5. Apply the same maturity floor v0.7.0 uses: below the threshold, report
     `"reason": "immature_db"` instead of a number computed from six data points.
- **Acceptance criteria:**
  - With the flag off, `Curator` output is byte-identical to v0.6.0's for the same database.
  - With the flag on, the rendered block contains exactly the statements in `shared_entries` that
    pass the predicate, in id order, within the caps.
  - The `team` block is computed with no JavaScript-side aggregation — assert the queries return
    the final numbers.
  - `precision_shared` and `precision_local` match hand-computed values on a fixture.
  - A database below the maturity floor reports `immature_db` rather than a precision figure.
  - `distinct_authors` counts distinct non-null `author_hash` values and is `0` when
    `author_identity_mode='none'`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/curator_shared.test.ts`

---

# Phase F5 — Release

### K8-024 — Two-clone closed-loop e2e

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K8-021, K8-022, K8-023
- **Risk:** 🟡
- **Files:** `tests/e2e/v08_closed_loop.test.ts`
- **Description:**
  1. Build the exit criterion as an executable test. Two temp directories, two in-memory stores,
     two independently migrated databases, both resolving the **same** `repoId` from identical
     `.git/config` fixtures at different paths.
  2. In store A: create a memory, curate it, `kevin_share {confirm: true}`. Copy the OKF file to
     directory B with an explicit `copyFileSync` — the test's stand-in for `git pull`. In store B:
     `kevin_sync`, then assert the memory is retrievable via `getRelevant()` and is injected.
  3. Assert the negative half too, because it is half the criterion: during the whole run, zero
     network calls and zero process spawns originate from Kevin. Enforce it by stubbing
     `child_process` and `fetch` to throw, and by a source scan.
  4. Round-trip the other way: in B, tombstone the entry, copy back to A, `kevin_sync`, assert the
     memory in A is `status='archived'`.
  5. Assert `injections_from_shared` increments in B and not in A.
- **Acceptance criteria:**
  - The memory promoted in A is retrievable and injectable in B after exactly one `kevin_sync`.
  - Two different `projectId`s, one shared `repoId`, asserted explicitly.
  - Stubbed `child_process` and `fetch` are never called.
  - The tombstone round-trip archives the source memory in A.
  - `injections_from_shared` increments only in the store that consumed a shared memory.
  - The whole test uses no path under `~/.opencode-kevin/`.
- **Status notes:** Implemented in `tests/e2e/v08_closed_loop.test.ts` — the two-clone loop plus the source scan. Two fixes were needed along the way: (1) `kevin_share` defaults `dry_run` to true (it wins over `confirm`), so the write leg passes `dry_run: false` explicitly; (2) the shared-consumption counter stayed 0 because retrieval never populated the `layer` column — `MemoryService.loadAll`/`queryRelevant` now append `layer` (probe-guarded via `hasLayerColumn`, same positive-only caching as K8-018) and `mapRow` carries `layer` through to `Memory` (`layer ?? null`), so `recordInjections` can stamp shared injections. The negative half stubs `node:child_process` via `vi.mock` (spyOn on the builtin is not allowed — "Cannot redefine property") and `fetch` via `vi.stubGlobal`; both are asserted uncalled at the end. Test is fully green; suite 1131, tsc and biome clean.
- **Verification:** `npx vitest run tests/e2e/v08_closed_loop.test.ts`

### K8-025 — README + CHANGELOG + `AGENTS.md` + `kevin_status`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K8-024
- **Risk:** 🟢
- **Files:** `README.md`, `CHANGELOG.md`, `AGENTS.md`, `plugin/index.ts`
- **Description:**
  1. Document the two-layer model, the OKF v2 format with an annotated example, the three new
     tools, and the five new settings with their defaults and their types (three of the five are
     strings, and the README should say so).
  2. Document the one workflow that has a sharp edge: what to do when git reports a conflict in
     `.kevin/knowledge.okf`. The answer — keep both sides, then run `kevin_sync` — is
     counter-intuitive enough that it needs to be written down where a user will find it at 6 pm.
  3. Extend `kevin_status` with `repo_id`, `identity_source`, `shared_layer_enabled`, and the
     shared entry count.
  4. State the non-goals explicitly in the README, because they will be requested: no server, no
     account, no automatic commit, no cross-repository corpus, no undelete.
- **Acceptance criteria:**
  - `kevin_status` reports the four new fields and never a raw remote URL.
  - README documents all 23 settings with types and defaults.
  - The conflict-resolution workflow is documented with a worked example.
  - CHANGELOG lists the 26 tasks by ID.
- **Status notes:** `kevin_status` now reports the `v08` block — `repo_id` (16-hex hash), `identity_source` (`declared`/`remote`/`path`), `shared_layer_enabled`, `shared_entries` (repo-scoped `op='assert'` count) — omitted on pre-009 DBs; `tool_count` 19 → 21 (5 test assertions updated). New test in `tests/unit/kevin_status_v07.test.ts` proves the four fields on a 009 DB and asserts the fixture origin URL never appears in the output. README: 16 → 21 tools, `kevin_project`/`kevin_share`/`kevin_sync` sections, "The shared layer (v0.8.0)" section (two-layer model, OKF v2 annotated byte-exact example, round-trip diagram, git-conflict worked example — keep both sides then `kevin_sync` — and the five non-goals: no server, no account, no automatic commit, no cross-repository corpus, no undelete), settings table complete at 23 entries with types/defaults (three v0.8 strings: `okf_path`, `author_identity_mode`, `shared_confidence_floor` — the flag-vs-string trap documented). CHANGELOG `[0.8.0]` entry lists the tasks by ID (F0-F5) plus behaviour changes and tests. AGENTS.md architecture block updated (46 modules, v0.8 components, shared-layer conventions). Suite 1132, tsc + lint clean.
- **Verification:** `npm run typecheck && npm run lint`

### K8-026 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K8-001 … K8-025, K8-027
- **Risk:** 🟢
- **Files:** `package.json`, `tests/unit/no_spawn_no_network.test.ts`
- **Description:**
  1. Bump `package.json` to `0.8.0`. Dependencies **unchanged** — `@opencode-ai/plugin` stays
     pinned at `^1.17.6` for the third release running, `zod` unchanged, `better-sqlite3` still
     optional.
  2. Add `tests/unit/no_spawn_no_network.test.ts`: scan every file in `plugin/` for
     `child_process`, `execSync`, `spawn`, `fetch(`, `http://` and `https://` and assert zero
     matches. Plan §3.5's property becomes a test rather than a memory.
  3. Run the four gates in order and record the results in §1 and in plan §14.
  4. Walk the eighteen release-specific checks in plan §11.2 and confirm each has a test that
     covers it. A check without a test is not a check.
- **Acceptance criteria:**
  - `npm run typecheck` — zero errors.
  - `npm run lint` — zero findings.
  - `npm test` — full suite green, no test skipped to make it so.
  - `npm run verify` — passes, and its output mentions migration `009`.
  - `no_spawn_no_network.test.ts` passes.
  - Every one of plan §11.2's eighteen checks maps to a named test.
  - `package.json` dependency block is byte-identical to v0.7.0's.
- **Status notes:** `package.json` bumped 0.7.0 → 0.8.0, dependency block byte-identical to v0.7.0
  (`@opencode-ai/plugin` ^1.17.6, `better-sqlite3` optional, dev deps untouched). New
  `tests/unit/no_spawn_no_network.test.ts` — source scan of `plugin/` (comments stripped) asserting
  zero matches for `child_process`/`execSync`/`execFile`/`spawn`/`fork`/`fetch(`/`http(s)://`/
  `node:http`/`node:net`/`node:https`/`WebSocket`; only `RepoIdentity.ts` comments mention `https://`
  and the test tolerates them. Four gates all green: typecheck zero errors, lint zero findings
  (biome --write fixed 6 files), `npm test` 1142/1142 in 148 files, `npm run verify` 10/10 with
  `009_v08_team.sql presente`. Plan §11.2's eighteen checks each mapped to a named test — the two
  previously uncovered checks were added: **check 17** (no float reaches the file: every JSON entry
  line matches no `\d\.\d`, and `serialize`'s body never calls `deriveConfidence` — added to
  `okf_serialize.test.ts`, 8/8) and **check 18** (demotion survives the round trip: an entry with
  evidence 5/recurrence 3 merged against a recurrence-0 copy yields recurrence 3 and
  `deriveConfidence === computeConfidence(5, 3)` — added to `okf_merge_properties.test.ts`, 7/7).
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

### K8-027 — Scope the OKF v1 export, and prove the two formats never meet

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K8-006, K8-012
- **Risk:** 🟡
- **Files:** `plugin/okf-export.ts`, `tests/unit/okf_v1_scoping.test.ts`,
  `tests/unit/okf_format_separation.test.ts`
- **Description:**
  1. `okf-export.ts::selectExportRows()` currently selects `WHERE status = 'active'` with **no
     project predicate** (lines 53-55 and the legacy fallback at 65-67). It therefore exports every
     project's memories from the global database. Add a `project_id = ?` predicate to both the
     primary and the legacy query, threading the value from the caller. This is a pre-existing
     defect, not a v0.8.0 regression, but v0.8.0 is the release that makes it dangerous: the
     moment an export lands in a committed file, a cross-project leak becomes permanent history.
  2. Keep the **bundle format frozen**. No field is added, removed or reordered; the round-trip
     guarantees of BUG-008 (id, `fingerprint`, `evidence_count`, `recurrence_count`,
     `last_verified_at`) must still hold. This task changes which rows are selected, nothing else.
  3. Add `tests/unit/okf_format_separation.test.ts` asserting the two formats are mutually
     unintelligible and structurally disconnected:
     - `okf.parse()` on the output of `exportOkf()` returns zero entries and does not throw —
       the v1 header is not `#okf 2`, so the file is rejected as `not_okf`.
     - `importOkf()` on the output of `okf.serialize()` returns `{imported: 0}` — v2 lines are
       single-line JSON with no `---` frontmatter opener, so `parseMarkdownBundle` finds nothing
       and `parseMarkdownHeadings` finds no `##` headings.
     - A source scan asserts `plugin/okf.ts` contains no import from `okf-export.js` or
       `okf-import.js`, and that neither v1 module imports `okf.js`.
     - A source scan asserts `importOkf` has exactly **one** call site (the `kevin_import` tool in
       `plugin/index.ts:520`) and that it is not reachable from `kevin_sync`.
  4. Add `tests/unit/okf_v1_scoping.test.ts`: seed memories under two distinct `project_id`
     values, export for one, and assert the bundle contains only that project's entries. Include
     the legacy path by exercising a database without `recurrence_count` so the fallback query is
     covered too — the fallback is the one an implementer forgets, and it is a silent leak because
     the `catch` swallows the error that would have revealed it.
- **Acceptance criteria:**
  - Exporting from a database holding two projects yields only the requested project's entries,
    on both the primary and the legacy query path.
  - The bundle's field set, ordering and formatting are byte-identical to v0.4.0 for a
    single-project database — proven against a committed fixture.
  - `okf.parse(exportOkf(...))` → zero entries, zero throws, rejection reason `not_okf`.
  - `importOkf(okf.serialize(...))` → `{imported: 0, superseded: 0}`.
  - No import edge exists in either direction between `okf.ts` and the v1 modules.
  - `importOkf` has exactly one call site.
- **Status notes:** `plugin/okf-export.ts` — `selectExportRows(store, projectId)` adds
  `AND project_id = ?` to the primary query AND the legacy pre-005 fallback (both `.all(projectId)`);
  `exportOkf`/`exportMarkdown` gained `projectId: string | null = null` (null keeps the legacy
  unscoped behaviour); `plugin/index.ts` threads `projectId` from the tool's closure into
  `kevin_export`/`kevin_export_markdown`. Bundle field set/order untouched — round-trip guarantees
  of BUG-008 hold. `tests/unit/okf_v1_scoping.test.ts` 3/3: primary path, legacy pre-005 path and
  markdown export all return only the requested project's entries (proj-a contains "alpha-rule",
  never "beta-rule"). `tests/unit/okf_format_separation.test.ts` 4/4: `parse(exportOkf(...))` →
  zero entries with rejection `not_okf`; `importOkf(okf.serialize(...))` → `{imported: 0,
  superseded: 0}`; source scans prove no import edge either direction between `okf.ts` and the v1
  modules, and `importOkf(` has exactly one call site (the `kevin_import` tool). Full suite green at
  1142/1142; typecheck and biome clean.
- **Verification:** `npx vitest run tests/unit/okf_v1_scoping.test.ts tests/unit/okf_format_separation.test.ts`

---

## 3. Implementation order

```
F0  K8-001 ─→ K8-002 ─→ K8-003
        └──→ K8-004                        (substrate; no behaviour change)

F1  K8-005 ─→ K8-006 ─┬─→ K8-007  ◀── equivalence proof gates everything downstream
                      ├─→ K8-008 ─→ K8-009
                      └─ (K8-007 must be [X] before F1 tools may diverge the scopes)

F2  K8-010 ─┬─→ K8-011 ─→ K8-012 ─┐
            └─→ K8-013 ─→ K8-014 ─┴─→ K8-015
                            ▲
                            └── the semilattice. If this fails, the FORMAT is wrong.
                                Do not start F3 until K8-014 is [X].

F3  K8-019 (independent, may start any time after F0)
    K8-016 ─→ K8-017 ─→ K8-018
        └──────────────┴─→ K8-020   (needs K8-014 + K8-019)

F4  K8-020 ─→ K8-021
    K8-017 ─→ K8-022 ─→ K8-023

F5  K8-021 + K8-022 + K8-023 ─→ K8-024 ─→ K8-025 + K8-027 ─→ K8-026
```

**Critical path:** K8-001 → K8-006 → K8-007 → K8-010 → K8-013 → K8-014 → K8-016 → K8-020 → K8-024 → K8-026.

The path runs through the algebra, not through the tools. `K8-013` and `K8-014` are scheduled
early and gate the start of F3 for one reason: if `join()` is not a semilattice, every downstream
guarantee — silent git merges, order-independent imports, correct both-sides conflict resolution —
is false, and the correct response is to change the format, not to build tooling on top of it.

**Suggested milestones:**

| Milestone | Tasks | Demonstrable outcome |
|---|---|---|
| **M1 — Invisible substrate** | K8-001 … K8-004 | Migration applies twice cleanly; behaviour identical to v0.7.0. |
| **M2 — Identity survives the clone** | K8-005 … K8-009 | Two directories, one `repoId`; retrieval proven byte-identical to v0.7.0 on a fixture. |
| **M3 — The format is proven** | K8-010 … K8-015 | Associativity, commutativity and idempotence hold over ≥1000 random pairs; a botched conflict resolution parses correctly. |
| **M4 — Two layers, one write path** | K8-016 … K8-020 | A file becomes memories and memories become a file, through exactly one `apply()` call site. |
| **M5 — Team workflow** | K8-021 … K8-023 | Share, sync, and an `AGENTS.md` block that is a projection of the committed file. |
| **M6 — Release** | K8-024 … K8-027 | `[X]` — two-clone loop closes with zero spawns and zero sockets. |

---

## 4. Traps to avoid

| # | Trap | Consequence | Guard |
|---|---|---|---|
| 1 | Truthiness-checking `shared_layer_enabled` | `'0'` is a truthy string, so the release turns itself on for **every** installation that upgrades, and a new file appears in everyone's repository unasked | `=== "1"`, always. `K8-022` asserts the flag-off path performs no filesystem read |
| 2 | `parseInt(shared_confidence_floor)` | Yields `0`; the promotion gate is disabled and everything is shared | `Number.parseFloat`, clamp `[0,1]`, default `0.7` on `NaN` (`K8-020`) |
| 3 | Forgetting the five new keys in `KEVIN_CONFIG_KEYS` | `kevin_config list` shows the key, `kevin_config set` returns `{error:"unknown_key"}`. Both halves work in isolation, so nothing fails | `K8-003`'s set-equality test between migration seeds and the constant |
| 4 | Forgetting the six new keys in `METRIC_KEY_LABELS` | The retrospective prints raw `snake_case`, as it did for seven keys through all of v0.4.0 | Same set-equality test (`K8-003`) |
| 5 | Forgetting `009_v08_team.sql` in `scripts/verify-install.ts` | Install verification silently gets weaker; the `existsSync` guard means nothing fails. `002_indexes.sql` has been missing since v0.2.0 for exactly this reason | `K8-004`, and its second acceptance criterion which demonstrates the guard's silence |
| 6 | Using `fingerprint()` for `computeEntryId()` | Salted with `project_id` → a different id per clone → the file grows one entry per developer per rule and the merge fold never fires. Undetectable in single-machine tests | `K8-010`'s cross-scope test, plus a source scan asserting `okf.ts` never imports `fingerprint` |
| 7 | Letting `normalize()` near a statement | Lowercases and rewrites `path.ext:line` — both meaningful in a curated rule. `"src/Routes/"` and `"src/routes/"` collapse to one entry | `K8-010` asserts casing and path changes produce different ids |
| 8 | `a.supersedes ?? b.supersedes` in `join()` | Not commutative when both are non-null and different. Breaks the exit criterion with a one-character mistake | `pickMin()`, and `K8-013`'s explicit both-non-null commutativity test |
| 9 | A "prefer the newer one" tiebreak anywhere in `join()` | Clock skew across machines makes "newer" meaningless, and it destroys commutativity | Every field is `max`, `min` or an absorbing OR. `K8-014`'s property tests |
| 10 | An undelete flag for tombstones | Breaks monotonicity, reintroduces order dependence, and makes merge results depend on which side you pulled first | D8-09. Tombstones absorb; resurrect by re-authoring or by reading git history |
| 11 | `created_at` merged by max | An entry's birthday changes every time someone re-exports it; ranking recency becomes noise | **min**, asserted in `K8-013` |
| 12 | `JSON.stringify` without sorting keys | Two machines emit different bytes for the same entry; every export is a whole-file diff and every merge conflicts | `canonicalize()` builds the key order explicitly (`K8-011`) |
| 13 | Adding a `confidence` field back into the OKF v2 entry | It is a derived quantity (`okf-export.ts:103` writes it, `okf-import.ts` ignores it). Transported alongside a max-merged `recurrence` it yields records that contradict their own formula, and it reintroduces floats so `0.1 + 0.2` → `"0.30000000000000004"` makes byte-determinism conditional | D8-13. The file is integer-only; `deriveConfidence()` is called on read and never by `serialize()` (`K8-011`), and plan §11.2 check 17 asserts no JSON number in the file contains a `.` |
| 14 | Measuring line length with `.length` | UTF-16 code units, not bytes. A 3000-character Japanese statement passes and produces a 6 KB line | `Buffer.byteLength(line, "utf8")` (`K8-011`) |
| 15 | `parse()` throwing on damaged input | A stray conflict marker takes the plugin down over a text file | `parse()` is total (D8-14); `K8-012` tests NUL bytes, 4 MB of noise, BOMs and truncation |
| 16 | Not stripping the UTF-8 BOM | The `#okf ` prefix check fails on a file saved by a Windows editor; the entire corpus is rejected as not-OKF | `K8-012` strips the BOM before the first-line check |
| 17 | Overwriting a file that produced rejected lines | Destroys a teammate's entries under the guise of a merge, right after they botched a conflict resolution | `parse_damaged` refusal (`K8-020`), one of the eight |
| 18 | Deleting a line to remove an entry | An unresolvable conflict for whoever is editing it concurrently, and an unreviewable deletion | `planTombstone()` appends; the file's line count only grows (`K8-020`) |
| 19 | `UNIQUE (entry_id)` instead of `UNIQUE (repo_id, entry_id)` | Two unrelated repositories on one machine share a row; a teammate's rule from project A surfaces in project B, silently | `K8-001` asserts the index columns and their order in `sqlite_master` |
| 20 | A CHECK constraint on `memories.layer` | SQLite cannot alter one; a third layer later costs a full rebuild, and rebuilding `memories` means dropping and recreating the FTS5 triggers | D8-07. No CHECK on added columns; `K8-001` asserts its absence in the table SQL |
| 21 | `REFERENCES memories(id)` on `shared_entries` | `PRAGMA foreign_keys = ON` is set by `Store`, and an entry legitimately arrives before any local memory exists — the normal case on a fresh clone | D8-12. `K8-001` asserts neither new table contains `REFERENCES` |
| 22 | `DEFAULT ''` on `repo_id` | The post-apply hook's `WHERE repo_id IS NULL` guard matches nothing; the back-fill silently no-ops and every corpus is orphaned | `K8-001` adds the column nullable with no default; `K8-002` asserts zero NULLs afterwards |
| 23 | Shelling out to `git remote get-url` | Introduces process spawning as a capability, depends on a binary that may not exist, and adds a hung network helper as a hot-path failure mode | `.git/config` is read as text (`K8-005`); `K8-026` asserts zero matches for `child_process`/`spawn`/`fetch` in `plugin/` |
| 24 | `new URL()` for remote parsing | Rejects the scp-style `git@host:path` form that git accepts and roughly half of clones use | Hand-rolled normalization with the ordered steps in `K8-005` |
| 25 | Logging or metricizing the raw remote URL | A `https://user:token@…` remote is ordinary in CI, and the value ends up hashed into a committed file | Strip credentials first, before anything retains a copy (`K8-005`); `evidence` never contains a URL |
| 26 | Automatic re-keying when `resolve()` disagrees with the stored scope | In a monorepo it merges two unrelated corpora, with no undo and no diff. The user finds out when a stranger's memories appear in their prompts | D8-03. `K8-009` requires `confirm: true`; a source scan asserts no other call site |
| 27 | `memory_ids: number[]` in `kevin_share` | `memories.id` is **TEXT**. The signature typechecks against nothing and matches no rows | `string[]` (`K8-021`), and a test that shares a real memory by its actual id |
| 28 | A convenience `writeFileSync` in `SharedLayer.ts` | Breaks D6-01's single-write-path contract and bypasses the atomic write, the hashing and the `artifact_writes` audit | The extended `single_write_path.test.ts` (`K8-019`), verified by temporarily adding one and watching it fail |
| 29 | Wiring `kevin_sync` into a hot-path hook | A filesystem read on every prompt; the hot-path rule has held since v0.2.0 | `session.idle` only (`K8-022`), plus a source scan asserting `import()` is unreachable from hot-path hooks |
| 30 | Writing `memories.status` from anything but a tombstone | Principle 24 forbids inference from deleting. A silent `status` write is an undoable deletion from every future prompt | `K8-017` restricts the write to tombstones, cites D8-09 at the call site, and asserts it with a source scan |
| 31 | Building the two-clone test with one shared directory | The test passes without ever exercising distribution, and the release ships broken across machines | Two temp dirs, two stores, an explicit `copyFileSync` between them (`K8-024`) |
| 32 | Pointing a test at the repository's own root | Kevin's own `.git/config` and `AGENTS.md` are real; the test passes locally, fails in CI, or rewrites a tracked file | `mkdtempSync` fixtures everywhere, removed in `afterEach` (§2) |
| 33 | Assuming "OKF" is new, and naming the v2 module `okf-export.ts`/`okf-import.ts` or extending them | **OKF v1 already ships** since v0.3.0 in exactly those two files, behind the `kevin_export`/`kevin_import` tools. Extending them to speak v2 gives one parser two grammars and one tool two contracts, and the frontmatter grammar is already ambiguous (`okf-import.ts:100-118` decides body-vs-boundary by lookahead) | Plan §5.3. `plugin/okf.ts` is a separate module with no import edge in either direction, asserted by the source scan in `K8-027` |
| 34 | Dropping `recurrence` from the v2 entry | v0.4.0 confidence is **two-sided** — `computeConfidence(evidence, recurrence)` demotes lessons that keep recurring. An entry that travels without its recurrences arrives undemoted, so sharing silently rehabilitates exactly the lessons the team proved wrong | `recurrence` is a first-class field merged by **max** (`K8-013`); plan §11.2 check 18 round-trips `evidence 5 / recurrence 3` and asserts the derived confidence equals `computeConfidence(5, 3)` |
| 35 | Reusing `exportOkf()` as the v2 writer, or wiring `importOkf()` into `kevin_sync` | `exportOkf` selects `WHERE status = 'active'` with **no project predicate** (`okf-export.ts:53-55`), so it dumps every project in the global database. Auto-committing that output leaks one client's memories into another's repository, permanently, in git history | `K8-027` adds the predicate to both the primary and the legacy query; a source scan asserts `importOkf` has exactly one call site and is unreachable from `kevin_sync` |
| 36 | Fixing the scoping bug only in the primary query | `selectExportRows()` falls back to a second query inside a bare `catch` for pre-005 databases (`okf-export.ts:59-74`). The `catch` swallows the very error that would reveal the omission, so the leak survives on exactly the oldest installations | `K8-027` covers the legacy path with its own test against a database lacking `recurrence_count` |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

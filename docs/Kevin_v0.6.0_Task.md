# Opencode-kevin — Task List v0.6.0

**Version:** 0.6.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** `docs/Kevin_v0.6.0_Plan.md`
**ID Convention:** `K6-XXX` ("Pull") · Decisions referenced as `D6-NN`
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
### K6-001 — Draft migration 007

**Status:** `[X]` Done — file created, 11 tests passing
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K6-001 | F0 | Draft migration `007_v06_pull.sql` | P0 | S (3h) | `[X]` |
| K6-001a | F0 | Schema-probe caches: "positive-only" rule | P1 | XS (1h) | `[X]` |
| K6-002 | F0 | Post-apply hook `"007"` in `Migrate.ts` | P0 | S (1h) | `[X]` |
| K6-003 | F0 | `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts` | P0 | S (1h) | `[X]` |
| K6-004 | F0 | Expand `METRIC_KEYS` 22 → 28; sixth `blockedSnapshot` key | P0 | S (2h) | `[X]` |
| K6-005 | F1 | `ArtifactWriter.plan()` — markers, splice, refusal | P0 | M (6h) | `[X]` |
| K6-006 | F1 | `plugin/diff.ts` — minimal unified diff | P0 | M (5h) | `[X]` |
| K6-007 | F1 | `ArtifactWriter.apply()` — atomic write + audit row | P0 | M (5h) | `[X]` |
| K6-008 | F1 | Idempotence, CRLF/BOM preservation, `noop` | P0 | S (4h) | `[X]` |
| K6-009 | F1 | Body sanitation — marker-injection defence | P0 | S (3h) | `[X]` |
| K6-010 | F2 | `plugin/inferability.ts` — deterministic classifier | P0 | S (4h) | `[X]` |
| K6-011 | F2 | `MemoryService`: `curated` / `inferable` / `markCurated()` | P0 | M (4h) | `[X]` |
| K6-012 | F2 | `Curator.candidates()` + `renderBlock()` | P0 | M (5h) | `[X]` |
| K6-013 | F2 | Proposal lifecycle + `Curator.propose()` | P0 | M (5h) | `[X]` |
| K6-014 | F2 | `kevin_propose` + `kevin_approve` tools | P0 | M (6h) | `[X]` |
| K6-015 | F2 | Session-idle generation behind `curation_enabled` | P1 | S (3h) | `[X]` |
| K6-016 | F3 | `plugin/capabilities.ts` — v2 domain probe | P1 | S (3h) | `[X]` |
| K6-017 | F3 | `plugin/Materializer.ts` — topic bundles | P1 | M (5h) | `[X]` |
| K6-018 | F3 | Skill emission (`skill_emission_enabled`) | P1 | M (4h) | `[X]` |
| K6-019 | F3 | Reference registration `@kevin/<topic>` | P1 | M (4h) | `[X]` |
| K6-020 | F3 | `kevin_publish` tool | P1 | S (3h) | `[X]` |
| K6-021 | F4 | Push budget 900 → 400; clamp `[0, 4000]` | P0 | S (3h) | `[X]` |
| K6-022 | F4 | `low_confidence` gate + `injections_blocked_confidence` | P0 | S (3h) | `[X]` |
| K6-023 | F4 | `kevin_audit` — `channels` and `curation` blocks | P1 | M (4h) | `[X]` |
| K6-024 | F5 | README + CHANGELOG + `AGENTS.md` + `kevin_status` | P1 | S (3h) | `[X]` |
| K6-025 | F5 | Closed-loop e2e for v0.6 semantics | P0 | M (6h) | `[X]` |
| K6-026 | F5 | Final verification | P0 | S (2h) | `[X]` |

**Phase totals:** F0 4 · F1 5 · F2 6 · F3 5 · F4 3 · F5 3 — **26 total**

**Done:** 26/26 · **In progress:** 0 · **Blocked:** 0

**Critical path:** K6-001 → K6-005 → K6-007 → K6-011 → K6-013 → K6-014 → K6-025 → K6-026.

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h.

**Dependencies.** A task may not start until every task listed in its `Dependencies` field is `[X]`.

**Risk.** 🟢 low (additive, isolated) · 🟡 medium (touches shared code paths) · 🔴 high (writes to the user's files or rebuilds a table).

**Verification.** Every task ends with a runnable command. Copy it verbatim. If it does not pass, the task is not done.

**Files.** All paths are relative to the repository root `C:\Misc\opencode-kevin`.

**Style.**
- TypeScript strict mode. No `any`. No non-null assertions on values read from SQLite.
- ESM. **All relative imports carry a `.js` extension**, e.g. `import { Store } from "./Store.js";`
- Biome formatting: `npm run format` before committing.
- Code comments that implement a plan decision cite it: `// v0.6.0 (K6-005 / plan §5.1, D6-02)`.

**Database access in tests.** Always `new Store({ path: ":memory:" })` followed by
`await new Migrate(store, migrationsDir).run()`. Never write to `~/.opencode-kevin/`.
Resolve `migrationsDir` the same way the existing tests do.

**Filesystem access in tests.** Every test that exercises `ArtifactWriter` writes into a
`fs.mkdtempSync(path.join(os.tmpdir(), "kevin-"))` directory and removes it in `afterEach`.
**No test may write into the repository working tree, into `~/.opencode-kevin/`, or into any
path derived from `process.cwd()`.** A test that writes to a real `AGENTS.md` is a test that
will eventually corrupt someone's file.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. Compare with `=== "1"` or parse with `Number(...)`.
   Never `=== 1`. A `=== 1` comparison made `cross_project_enabled` unreachable for an entire
   minor release.
2. `ALTER TABLE ... ADD COLUMN` is **not** idempotent. Idempotency comes from `schema_version`.
   The correct acceptance criterion is always "applying via `Migrate.run()` twice is a no-op".
3. SQLite cannot alter a CHECK constraint. Widening one requires a table rebuild. Migration 007
   introduces CHECK constraints only on **new** tables, so it contains no rebuild — keep it
   that way.
4. `Store` sets `PRAGMA foreign_keys = ON`. Do not add `REFERENCES` clauses casually;
   `curation_proposals.memory_id` deliberately has none.

**Hot path.** No LLM calls, no network, no filesystem scans in `tool.execute.*`,
`chat.message`, `experimental.chat.system.transform` or `experimental.session.compacting`.
Curation runs on `session.idle` only.

**Backwards compatibility.** Do not change an existing exported function signature unless a task
says to. Where a signature must grow, add optional parameters with defaults that reproduce the
v0.5.0 behaviour exactly.

**The write rule.** Exactly one function in the codebase may write to a user file:
`ArtifactWriter.apply()`. It is reachable from exactly one caller: `kevin_approve`. No task in
this document may add a second write path, and K6-014 adds a test that proves there is not one
(D6-01).

---

# Phase F0 — Substrate (schema, migration plumbing, config and metric keys)

Nothing else can be built until the columns exist and the migration chain accepts them. Unlike
migration 006, nothing here rebuilds a table: every CHECK constraint introduced is on a new
table. All four tasks are additive and none of them changes runtime behaviour — with one
deliberate exception, the conditional push-budget `UPDATE`, which is the subject of K6-001's
strictest acceptance criterion.

### K6-001 — Draft migration `007_v06_pull.sql`

**Status:** `[X]` Done — file created, 15 tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟡 (additive, but section 6 mutates an existing setting value)
- **Files:** `migrations/007_v06_pull.sql`, `tests/unit/migrate_007.test.ts`
- **Description:**
  1. Create the file with the exact content given in `docs/Kevin_v0.6.0_Plan.md` §6. Do not
     improvise: the section ordering, the comments and the `WHERE value = '900'` guard are all
     load-bearing.
  2. Section 1 creates `curation_proposals` with its three indices. `memory_id` carries **no**
     `REFERENCES` clause — `PRAGMA foreign_keys = ON` would otherwise block deleting a memory
     that a historical proposal mentions, the same reasoning that governs `superseded_by` in
     migration 006.
  3. Section 2 creates `artifact_writes` plus `idx_artifact_writes_path`. It is append-only:
     no `UPDATE` or `DELETE` statement against this table may appear anywhere in the codebase.
  4. Section 3 adds `memories.curated` (`INTEGER NOT NULL DEFAULT 0`), `memories.curated_at`
     (`TEXT`) and `memories.inferable` (`INTEGER`, **nullable, no default**), plus the two
     indices. The nullability is the design: three states are required, and `NULL` = unknown
     must remain **eligible** for curation.
  5. Section 4 seeds the six new metric keys in the same order they are appended to
     `METRIC_KEYS` in K6-004.
  6. Section 5 seeds the five new settings. `skill_emission_enabled` and
     `reference_emission_enabled` default to `'0'`; `curation_enabled` to `'1'`;
     `agents_md_path` to `'AGENTS.md'`; `injection_confidence_floor` to `'0.6'`. All values are
     TEXT.
  7. Section 6 is the conditional demotion: `UPDATE kevin_settings SET value = '400' WHERE key =
     'pre_prompt_budget_tokens' AND value = '900'`. The `AND value = '900'` clause is not
     optional and not a style preference — without it, a user who deliberately configured 1200
     silently loses that choice.
  8. Section 7 inserts `'007'` into `schema_version`.
- **Acceptance criteria:**
  - `Migrate.run()` on a fresh `:memory:` database reaches `schema_version = '007'`.
  - Running `Migrate.run()` twice reports `applied: []` on the second call.
  - `curation_proposals` rejects an out-of-domain `status` and an out-of-domain `kind` (CHECK
     constraints assert).
  - `artifact_writes` accepts `outcome` values `written`, `noop`, `refused` and rejects others.
  - `memories.inferable` is `NULL` for a row inserted without it; `memories.curated` is `0`.
  - **Override preservation:** a database seeded with `pre_prompt_budget_tokens = '1200'` before
     migration still reads `'1200'` after; a database seeded with `'900'` reads `'400'` after.
     Both directions are asserted in the same test.
  - No statement in the file performs a table rebuild.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_007.test.ts`

### K6-001a — Schema-probe caches: "positive-only" rule

**Status:** `[X]` Done — rule applied to 3 probes, 3 regression tests passing

- **Priority:** P1
- **Estimation:** XS (1h)
- **Dependencies:** K6-001 (migration 007 adds `memories.curated` / `memories.inferable`; the new probes they need must follow this rule)
- **Risk:** 🟢
- **Files:** `plugin/MemoryService.ts`, `plugin/Feedback.ts`, `plugin/Archiver.ts`, `tests/unit/` (probe regression)
- **Description:**
  1. The WeakMap schema-probe caches — `ignoredColumnCache` (`MemoryService.hasIgnoredColumn`),
     `hasFeedbackTable` (`Feedback`), `hasArchivedColumnCached` (`Archiver`) — cache **both**
     probe outcomes. A Store used *before* a migration (in-place migration in tests or embedded
     use) caches `false` forever: after the migration applies, the component stays a silent
     no-op — `kevin_feedback` throws, the Archiver never archives, the `ignored` filter never
     filters.
  2. Adopt the "positive-only" rule: cache `true` on a successful probe; **never cache
     `false`**. A failed probe re-runs on the next call — the hot path (`queryRelevant` /
     `loadAll` call `hasIgnoredColumn()` per query) keeps its win when the column exists, and
     a probe heals automatically after any future migration. Three one-line edits.
  3. Apply the rule to the three existing probes **and** to every new probe migration 007
     forces (`curated`, `inferable` — needed by K6-011). Do not copy the old two-way cache
     pattern in new code.
  4. Add a regression test: a Store that probes (and would cache `false` under the old rule),
     migrates in place, probes again — the second probe must return the live result.
- **Acceptance criteria:**
  - `hasIgnoredColumn()` / `hasFeedbackTable` / `hasArchivedColumnCached` return `true` only
     when the column/table exists, and never cache a `false` result across a migration.
  - Fully-migrated DBs behave exactly as in v0.5.0 (successful probes still cached; no
     behavior change on the live path).
  - The in-place-migration regression test flips the probe from `false` to `true`.
- **Status notes:** Decided in the v0.5.0 pre-release audit (2026-08-11). Deliberately **not**
  applied to v0.5.0 — no production impact there (`Migrate.run()` precedes every component in
  `plugin/index.ts`), and v0.5.0 was already verified green. Folded here because migration 007
  introduces the next generation of probes.
- **Verification:** `npx vitest run tests/unit` (probe regression) + `npm run typecheck` +
  `npm run lint`

### K6-002 — Post-apply hook `"007"` in `Migrate.ts`

**Status:** `[X]` Done — hook added, 15 tests passing (incl. partial-apply scenario)

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K6-001
- **Risk:** 🟢
- **Files:** `plugin/Migrate.ts`, `tests/unit/migrate_007.test.ts`
- **Description:**
  1. Add a `"007"` entry to `DEFAULT_POST_APPLY_HOOKS` containing the three re-derivation
     statements from plan §6: back-fill `inferable = 0` for `decision` / `rule` / `solution` /
     `pattern` rows still `NULL`, and re-derive `proposals_created` and `artifact_writes_total`
     from the tables themselves.
  2. The back-fill is guarded by `WHERE inferable IS NULL` so a re-run cannot overwrite a
     classification produced later by `inferability.classify()`.
  3. Follow the existing hook shape exactly — this is the fourth entry in the table, not a new
     mechanism.
- **Acceptance criteria:**
  - A pre-007 database containing three `decision` memories reports `inferable = 0` for all
     three after migration.
  - A memory of type `error` is left `NULL` by the hook.
  - Re-running `Migrate.run()` does not change any `inferable` value that is already non-`NULL`.
  - `proposals_created` equals `COUNT(*)` of `curation_proposals` after the hook runs.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_007.test.ts`

### K6-003 — `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts`

**Status:** `[X]` Done — 5 keys appended, verify-install copies 007, 3 tests passing

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K6-001
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `scripts/verify-install.ts`, `tests/unit/config_keys.test.ts`
- **Description:**
  1. Append the five new keys to `KEVIN_CONFIG_KEYS` in `plugin/index.ts`: `curation_enabled`,
     `agents_md_path`, `skill_emission_enabled`, `reference_emission_enabled`,
     `injection_confidence_floor`.
  2. Add `007_v06_pull.sql` to the hard-coded migration list in `scripts/verify-install.ts`
     (lines 62–79).
  3. This task is two edits totalling seven lines and it is P0 because both omissions ship
     green. A missing `KEVIN_CONFIG_KEYS` entry makes `kevin_config set` return
     `{error:"unknown_key"}` while `kevin_config list` still displays the key — the setting
     exists, is documented, and cannot be changed. A missing `verify-install.ts` entry means
     `npm run verify` never exercises migration 007 at all.
- **Acceptance criteria:**
  - `kevin_config set` succeeds for all five new keys and `kevin_config list` reads each back.
  - A test asserts that **every** key seeded by migration 007 section 5 is present in
     `KEVIN_CONFIG_KEYS` — derived from the database, not a hand-written list, so migration 008
     cannot reintroduce this defect.
  - `npm run verify` exits 0 and its output names `007_v06_pull.sql`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/config_keys.test.ts && npm run verify`

### K6-004 — Expand `METRIC_KEYS` 22 → 28; sixth `blockedSnapshot` key

**Status:** `[X]` Done — 28 keys, labels exported and covered, 24 tests passing

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K6-001
- **Risk:** 🟢
- **Files:** `plugin/metrics.ts`, `plugin/Retrospective.ts`, `tests/unit/metrics.test.ts`
- **Description:**
  1. Append six keys to `METRIC_KEYS`, in the order the migration seeds them:
     `proposals_created`, `proposals_approved`, `proposals_rejected`, `artifact_writes_total`,
     `artifact_writes_noop`, `injections_blocked_confidence`. Total 22 → **28**.
  2. Extend `blockedSnapshot()` with a sixth entry keyed `confidence`.
  3. Add all six keys to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts`. The v0.4.0 audit
     found seven keys printing as raw identifiers because this table was not updated; the cost
     of forgetting is a user-visible report full of snake_case.
  4. **Do not touch `precisionRate()` or `coverageRate()`.** This release is judged by those two
     numbers; moving their definition in the same release that changes the channel mix would
     make the comparison meaningless.
- **Acceptance criteria:**
  - `METRIC_KEYS.length === 28`.
  - Every key in `METRIC_KEYS` has an entry in `METRIC_KEY_LABELS` — asserted by iterating
     `METRIC_KEYS`, not by counting.
  - Every key in `METRIC_KEYS` exists as a row in `kevin_metrics` after `Migrate.run()`, and
     vice versa: the two sets are equal.
  - `blockedSnapshot()` returns six keys including `confidence`.
  - `precisionRate()` and `coverageRate()` produce identical output to v0.5.0 for the same
     fixture inputs.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/metrics.test.ts`

---

# Phase F1 — The artifact writer (the only code that touches a user's files)

This phase is the trust boundary of the entire release. Every other feature in v0.6.0 is
recoverable by deleting a database; a defect here damages a file the user wrote by hand and may
not have committed. Treat the nine rules of plan §5.1 as a specification with one test each, and
resist every instinct to be helpful: a writer that repairs a malformed file is a writer that
occasionally destroys a good one.

Build `plan()` before `apply()`, and do not add the `apply()` call site until K6-014. Until then
the only thing that can happen is that a pure function returns a string.

### K6-005 — `ArtifactWriter.plan()` — markers, splice, refusal

**Status:** `[X]` Done — plan() + rules 1–4, 6; 11 tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** —
- **Risk:** 🟡 (pure, but it defines the contract everything else trusts)
- **Files:** `plugin/ArtifactWriter.ts`, `tests/unit/artifact_writer_plan.test.ts`
- **Description:**
  1. Create `plugin/ArtifactWriter.ts` with `MARKER_BEGIN`, `MARKER_END`, `WriteOutcome`,
     `WritePlan` and the class shell exactly as declared in plan §5.1.
  2. Implement `plan(path, body)`: read the file (a missing file is the empty string), locate
     the marker pair, splice the body between them, compute both SHA-256 hashes via
     `node:crypto`, and return a `WritePlan`. **`plan()` performs no writes** — rule 1. A
     `plan()` call against a read-only directory must succeed.
  3. Missing file → the result is exactly: blank line, `MARKER_BEGIN`, body, `MARKER_END`,
     trailing newline (rule 2).
  4. Malformed markers → `outcome: "refused"` with a human-readable `reason`, and `after ===
     before` (rule 3). Three malformed shapes must all refuse: exactly one marker present,
     `MARKER_END` before `MARKER_BEGIN`, and more than one pair. **Never guess, never repair,
     never fall back to appending.**
  5. Leave `diff` as `""` in this task; K6-006 fills it. Do not invent a placeholder prose
     description — an empty string is honest, a sentence is a habit that survives.
  6. `projectId` is a constructor argument so every audit row is attributed without the call
     site remembering to.
- **Acceptance criteria:**
  - Rule 1: `plan()` against a directory with mode `0o500` returns normally and creates no file
     (skip the mode assertion on Windows, keep the "no file created" assertion everywhere).
  - Rule 2: missing file produces the exact five-part layout above, asserted on the full string.
  - Rule 3: all three malformed fixtures return `"refused"`, carry a non-empty `reason`, and
     leave `after === before`.
  - Rule 4: for a well-formed file, `after.slice(0, beginIndex) === before.slice(0, beginIndex)`
     and `after.slice(endIndexAfter) === before.slice(endIndexBefore)` — asserted with strict
     equality on the slices, not by inspecting a diff.
  - `hashBefore` and `hashAfter` are 64-character lowercase hex strings, and are equal when
     `after === before`.
  - The module contains no `writeFileSync`, `appendFileSync` or `createWriteStream` call yet.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/artifact_writer_plan.test.ts`

### K6-006 — `plugin/diff.ts` — minimal unified diff

**Status:** `[X]` Done — byte-identical to `git diff -U3`, 8 tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K6-005
- **Risk:** 🟢
- **Files:** `plugin/diff.ts`, `plugin/ArtifactWriter.ts`, `tests/unit/diff.test.ts`
- **Description:**
  1. Implement a standard LCS over lines emitting unified-diff format with `--- a/<path>`,
     `+++ b/<path>`, `@@ -l,s +l,s @@` hunk headers, three lines of context, and adjacent hunks
     merged when their context windows overlap. Roughly 120 lines. No dependency, no `require`.
  2. Wire it into `ArtifactWriter.plan()` so `WritePlan.diff` is populated.
  3. Determinism is a hard requirement, not a nicety: the diff is persisted into
     `curation_proposals.diff` and compared across runs. Any use of `Object.keys` ordering,
     `Set` iteration order over non-inserted-order data, or a timestamp is a defect.
  4. This module exists for exactly one reason (D6-05): approval prompts must show bytes, not
     prose. Do not add a `summarize()` helper. Someone will use it.
- **Acceptance criteria:**
  - Identical inputs produce byte-identical output across 100 repeated invocations.
  - Empty-to-content, content-to-empty, and no-change inputs each produce the correct output
     (the last being the empty string).
  - A change at the top and a change at the bottom of a 200-line file produce **two** hunks;
     two changes four lines apart produce **one** merged hunk.
  - Hunk headers report correct 1-based start lines and lengths, verified against `git diff -U3`
     output for the same fixture pair.
  - A file with no trailing newline round-trips without a spurious final-line hunk.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/diff.test.ts`

### K6-007 — `ArtifactWriter.apply()` — atomic write + audit row

**Status:** `[X]` Done — atomic write, audit trail, fault injection; 6 tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K6-001, K6-005
- **Risk:** 🔴 (this is the code that writes to the user's disk)
- **Files:** `plugin/ArtifactWriter.ts`, `tests/unit/artifact_writer_apply.test.ts`
- **Description:**
  1. Implement `apply(plan, proposalId?)`: write to `<path>.kevin.tmp` **in the same directory**
     as the target, `fsync` the descriptor, close it, then `rename` over the target (rule 7).
     Same directory means same filesystem, which is what makes `rename` atomic. Never
     `writeFileSync` on the target path, never truncate-then-write.
  2. Every call appends an `artifact_writes` row with `hash_before`, `hash_after`,
     `bytes_before`, `bytes_after`, `outcome`, `reason` and `proposal_id` — **including
     refusals and noops** (rule 8). A refusal that leaves no trace is indistinguishable from a
     write that never happened.
  3. A `"refused"` plan writes nothing to disk but still writes its audit row.
  4. Increment `artifact_writes_total` on `"written"` and `artifact_writes_noop` on `"noop"`.
  5. Remove the temp file on any error path so a failed write does not leave `.kevin.tmp`
     litter next to the user's `AGENTS.md`.
- **Acceptance criteria:**
  - After a successful `apply()`, the target contains `plan.after` byte-for-byte and no
     `.kevin.tmp` file remains in the directory.
  - A `"refused"` plan leaves the target byte-identical and still produces an `artifact_writes`
     row with `outcome = 'refused'` and a non-empty `reason`.
  - Three `apply()` calls (written, noop, refused) produce exactly three `artifact_writes` rows.
  - `hash_before` of row N equals `hash_after` of row N−1 for consecutive writes to the same
     path — the audit trail is a verifiable chain.
  - Simulating a failure between temp-write and `rename` (inject a throwing `rename`) leaves the
     target file **unchanged** and removes the temp file.
  - `artifact_writes_total` and `artifact_writes_noop` match the row counts by outcome.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/artifact_writer_apply.test.ts`

### K6-008 — Idempotence, CRLF/BOM preservation, `noop`

**Status:** `[X]` Done — CRLF/BOM/EOL fidelity, noop; 6 tests passing

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** K6-007
- **Risk:** 🟡
- **Files:** `plugin/ArtifactWriter.ts`, `tests/unit/artifact_writer_fidelity.test.ts`
- **Description:**
  1. Rule 6: when `after === before`, the outcome is `"noop"`, **no temp file is created**, and
     `artifact_writes_noop` increments. This is what makes regeneration free and makes the
     "run twice, compare bytes" criterion meaningful rather than tautological.
  2. Rule 5: detect the line-ending style from the **first** line ending in the existing file —
     CRLF if it is CRLF, otherwise LF — and emit the generated block in that style. Preserve a
     leading UTF-8 BOM (`\uFEFF`) if present, including its absence.
  3. A file that used CRLF must still use CRLF everywhere afterwards, including inside the
     generated block. A formatter that normalizes line endings outside the markers is a
     data-loss bug wearing a tidiness costume (D6-02).
  4. Line-ending detection must not be confused by a CRLF file whose last line lacks a
     terminator, nor by a mixed-ending file (first ending wins, deterministically).
- **Acceptance criteria:**
  - Applying the same plan twice yields `"written"` then `"noop"`, and the file is
     byte-identical after the second call.
  - A CRLF fixture is CRLF after the write, asserted by counting `\r\n` occurrences and
     asserting zero bare `\n`.
  - A BOM-prefixed fixture still starts with `\uFEFF`; a BOM-free fixture still does not.
  - The `"noop"` path creates no `.kevin.tmp` file, verified by listing the directory during a
     patched `rename` that would otherwise be called.
  - A mixed-ending fixture produces the same output on 10 consecutive runs.
- **Status notes:** The table row lagged behind this section's `[X]` (it was updated now,
  2026-08-14): the detail section already documented completion and the 6 fidelity tests
  were passing; the summary count (23/26) had always counted K6-008 as done. Re-verified
  today: 6/6.
- **Verification:** `npx vitest run tests/unit/artifact_writer_fidelity.test.ts` — 6/6 passing.

### K6-009 — Body sanitation — marker-injection defence

**Status:** `[X]` Done — 3 layers, idempotent escape, round-trip; 6 tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K6-005
- **Risk:** 🟡
- **Files:** `plugin/ArtifactWriter.ts`, `tests/unit/artifact_writer_sanitation.test.ts`
- **Description:**
  1. Rule 9, three layers applied to the body before splicing:
     (a) the escaping discipline of `plugin/memory-format.ts`;
     (b) strip any line containing `kevin:begin` or `kevin:end` **in any casing, anywhere in the
     line**;
     (c) strip HTML comment terminators (`-->`) from memory content.
  2. Layer (c) is the one that matters most: without it a memory whose content contains `-->`
     closes the marker comment early, and everything after it becomes live document text
     outside Kevin's region — which then survives the next regeneration as user content.
     Plan §3.5 is the reason this is not optional.
  3. Sanitation happens in `plan()`, before hashing, so the hashes describe what was actually
     written.
- **Acceptance criteria:**
  - A memory whose content is `<!-- kevin:end --> injected` produces a block in which the marker
     pair is still well-formed and the injected text is inert.
  - Casing variants (`KEVIN:BEGIN`, `Kevin:End`) are stripped.
  - A subsequent `plan()` over the resulting file finds exactly one marker pair — the
     round-trip property, which is the real test of this defence.
  - Content containing `-->` in a legitimate context (e.g. an arrow in prose) is sanitized
     rather than refused; the write still succeeds.
  - The sanitizer is idempotent: sanitizing sanitized output is a fixed point.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/artifact_writer_sanitation.test.ts`

---

# Phase F2 — Curation (what is worth publishing, and who decides)

F1 built a safe pipe. F2 decides what goes through it. The two questions this phase answers are
"which memories are worth a human's review attention?" and "how does the human's answer become
data?" — and the second matters as much as the first, because roadmap kill criterion **K4**
("proposals are rejected more often than approved") is only checkable if rejections are
persisted.

The scarce resource being spent here is not disk and not tokens: it is the user's willingness to
read the next diff Kevin shows them. A rejected proposal costs more than a memory that quietly
stays in the database.

### K6-010 — `plugin/inferability.ts` — deterministic classifier

**Status:** `[X]` Done — rules 1–5 in order, rule 4 beats rule 3; 18 tests passing

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/inferability.ts`, `tests/unit/inferability.test.ts`
- **Description:**
  1. Implement `classify(memory): Inferability` and `SELF_DESCRIBING_CODES` per plan §5.3.
     Rules are evaluated **in order, first match wins** — the ordering is the specification, not
     an implementation detail.
  2. `SELF_DESCRIBING_CODES` = `TS2304`, `TS2307`, `TS2322`, `TS2339`, `TS2305`, `TS2552`,
     `TS2740`, `TS6133`, `TS18047`, `E0433`, `E0432`, plus the synthetic `command_not_found`.
  3. Rule 4 (an `error` whose content names a project-specific path, script or flag →
     `non_inferable`) uses a conservative detector: npm-script names, relative paths, `--flag`
     tokens, file extensions. It **errs toward `non_inferable`**, because a false `inferable`
     silently withholds real knowledge from curation forever, while a false `non_inferable`
     costs one line a human rejects in a diff.
  4. Pure function: no DB, no clock, no filesystem, no `Math.random`. It must be callable from
     a unit test with an object literal and nothing else.
- **Acceptance criteria:**
  - Every rule in the plan §5.3 table has at least one positive and one negative test case.
  - `type: "decision" | "rule" | "solution" | "pattern"` → `non_inferable`, regardless of
     content.
  - A bare `TS2304` error → `inferable`; the same code with content naming
     `./scripts/gen-routes.ts` → `non_inferable` (rule 4 beats rule 3 only because rule 3 is
     evaluated first and rule 4 catches what rule 3 does not — assert the documented ordering
     explicitly).
  - An unrecognized error code with generic content → `unknown`.
  - Every member of `SELF_DESCRIBING_CODES` is exercised.
  - The module imports nothing from `plugin/Store.js`, `node:fs` or `node:crypto`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/inferability.test.ts`

### K6-011 — `MemoryService`: `curated` / `inferable` / `markCurated()`

**Status:** `[X]` Done — save() classification, dedup backfill, markCurated batch; 8 tests passing

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K6-001, K6-010
- **Risk:** 🟡 (touches the shared row-mapping path)
- **Files:** `plugin/MemoryService.ts`, `tests/unit/memory_service_curation.test.ts`
- **Description:**
  1. Add `curated, curated_at, inferable` to `MEMORY_ROW_SELECT`. Every query that returns a
     `Memory` goes through this constant; adding the columns anywhere else guarantees a shape
     mismatch on some path.
  2. `mapRow()` exposes `curated` as a boolean (`=== 1`) and `inferable` as
     `"inferable"` / `"non_inferable"` / `null` from `1` / `0` / `NULL`. **Do not collapse
     `NULL` to `"inferable"`** — the Curator predicate is `inferable != 1`, and collapsing would
     silently exclude every unclassified memory from curation.
  3. `save()` calls `inferability.classify()` and persists the result on insert. On update of an
     existing fingerprint, leave the stored classification alone unless it is `NULL`.
  4. Add `markCurated(ids: readonly string[], at: string): number`, setting `curated = 1` and
     `curated_at`. It returns the number of rows changed. Batch it in a single statement with
     an `IN` clause; do not loop.
- **Acceptance criteria:**
  - A memory saved with `type: "decision"` reads back `inferable === "non_inferable"`.
  - A memory whose `inferable` column is `NULL` reads back `inferable === null`, and is
     **included** by a `inferable != 1` query.
  - `markCurated()` with three ids returns `3`, sets `curated_at` on all three, and returns `0`
     on a second call for the same ids only if they are re-filtered by the caller — assert the
     exact documented semantics rather than assuming.
  - `markCurated([])` is a no-op returning `0` and executes no statement.
  - All pre-existing `MemoryService` tests still pass unchanged.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/memory_service_curation.test.ts tests/unit/memory_service.test.ts`

### K6-012 — `Curator.candidates()` + `renderBlock()`

**Status:** `[X]` Done — six-clause predicate, id-sorted block, both caps; 12 tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K6-011
- **Risk:** 🟢
- **Files:** `plugin/Curator.ts`, `tests/unit/curator_selection.test.ts`
- **Description:**
  1. Create `plugin/Curator.ts` with the interface of plan §5.4. **The module imports no
     filesystem module** — the capability is absent, not merely unused (D6-01).
  2. `candidates(limit?)` applies the six-clause predicate verbatim: `status = 'active'`,
     `ignored = 0`, `curated = 0`, `(inferable IS NULL OR inferable != 1)`, `confidence >= 0.6`,
     `(evidence_count >= 2 OR feedback_positive >= 1)`. Ordered by `confidence DESC,
     updated_at DESC`. Capped at **20 lines and 4000 characters**, whichever binds first.
  3. `renderBlock(candidates)` emits `- <first sentence, ≤160 chars> (<evidence>)` per line and
     **sorts the output by memory id** (D6-10). Confidence orders selection; id orders output.
     Sorting output by confidence would reshuffle the whole block whenever any confidence moved
     — and confidence moves on every settlement, every feedback event and every recurrence —
     producing a 20-line diff for a 1-line change, which trains the user to stop reading diffs.
  4. Evidence strings are rendered from data (`"verified 3×, last 2026-08-04"`), never from a
     template with a placeholder that can end up empty.
- **Acceptance criteria:**
  - Each of the six predicate clauses has a test proving a row failing **only** that clause is
     excluded.
  - A memory with `inferable IS NULL` is **included**; one with `inferable = 1` is excluded.
  - The evidence-or-feedback disjunction is tested in both directions: `evidence_count = 2,
     feedback_positive = 0` included, and `evidence_count = 0, feedback_positive = 1` included.
  - Both caps are tested independently: 25 eligible short memories yield 20 lines; 5 eligible
     very long memories stop at 4000 characters.
  - `renderBlock()` output is sorted by memory id, and adding one candidate to a set of ten
     changes exactly one line of the rendered block (asserted against `diff.ts` output).
  - `grep` for `node:fs` / `require("fs")` in `plugin/Curator.ts` returns nothing — asserted by
     a test that reads the module source.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/curator_selection.test.ts`

### K6-013 — Proposal lifecycle + `Curator.propose()`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K6-012, K6-005
- **Risk:** 🟡
- **Files:** `plugin/Curator.ts`, `tests/integration/proposal_lifecycle.test.ts`
- **Description:**
  1. Implement `propose(kind, writer): CurationProposal[]`. It calls `writer.plan()` and
     **never** `writer.apply()`. Persist a `pending` row per proposal carrying `memory_ids`,
     `proposed_text`, `diff`, `target_path` and `kind`.
  2. Generating a new proposal for an existing `(project_id, kind, target_path)` triple marks
     the prior `pending` row `superseded` — **never deletes it**. Rejection history is the
     evidence base for kill criterion K4.
  3. Increment `proposals_created`. Do not move any artifact metric here: `propose()` is a
     strict dry run in exactly the sense `kevin_trace` is (v0.5 D5-08).
  4. Implement the state machine of plan §5.5 as explicit transitions with an exhaustive
     `switch`; an unknown transition throws rather than silently no-oping.
- **Acceptance criteria:**
  - `propose()` creates `pending` rows and writes **nothing** to disk — asserted by a patched
     `ArtifactWriter` whose `apply()` throws if called.
  - A second `propose()` for the same triple leaves exactly one `pending` row and one
     `superseded` row; the total row count is 2, not 1.
  - No code path deletes a `curation_proposals` row (asserted by scanning the codebase for
     `DELETE FROM curation_proposals`).
  - `proposals_created` equals the number of rows created.
  - The persisted `diff` is non-empty whenever `proposed_text` differs from the current block,
     and reproduces byte-identically on a second `propose()` with unchanged inputs.
  - Illegal transitions (e.g. `applied → pending`) throw.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/proposal_lifecycle.test.ts`

### K6-014 — `kevin_propose` + `kevin_approve` tools

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K6-013, K6-007
- **Risk:** 🔴 (this task creates the only reachable write path)
- **Files:** `plugin/kevin_propose.ts`, `plugin/kevin_approve.ts`, `plugin/index.ts`,
  `tests/integration/curation_tools.test.ts`, `tests/unit/single_write_path.test.ts`
- **Description:**
  1. `kevin_propose` generates proposals and returns their **diffs**. It creates `pending` rows
     and nothing else: no disk write, no `curated` flag, no metric beyond `proposals_created`.
  2. `kevin_approve({ proposalId, decision: "approve" | "reject" })`:
     - `"reject"` → status `rejected`, `proposals_rejected` increments, nothing touches disk.
     - `"approve"` → status `approved`, then `ArtifactWriter.apply()`, then status `applied`,
       then `markCurated()` on every contributing memory, then `proposals_approved` increments.
  3. **`kevin_approve` is the only code path in the entire plugin that may call
     `ArtifactWriter.apply()`.** Add `tests/unit/single_write_path.test.ts` which scans every
     file under `plugin/` for `.apply(` call sites against an `ArtifactWriter` binding and
     asserts there is exactly one, in `kevin_approve.ts`. This test is the enforcement of D6-01;
     without it the invariant is a comment.
  4. Register both tools in `plugin/index.ts` (13 → 15 here; `kevin_publish` in K6-020 makes 16).
  5. Approving an already-`applied` proposal returns a structured error, not a second write.
  6. **No auto-approval, no "trusted mode", no configuration flag that skips the human.** The
     approval gate is the entire safety model of this release; a setting that disables it is
     equivalent to deleting the release's value proposition.
- **Acceptance criteria:**
  - `kevin_propose` output contains a unified diff and the tool leaves the target file
     byte-identical.
  - `kevin_approve` with `"reject"` leaves the file byte-identical and sets status `rejected`.
  - `kevin_approve` with `"approve"` writes the file, sets status `applied`, and sets
     `curated = 1` + `curated_at` on every contributing memory.
  - Approving twice returns an error on the second call and produces a single `written` row
     followed by no further write.
  - `single_write_path.test.ts` finds exactly one `ArtifactWriter.apply()` call site.
  - `proposals_approved` + `proposals_rejected` ≤ `proposals_created` at all times.
  - The tool count reported by `kevin_status` is 15 after this task.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/curation_tools.test.ts tests/unit/single_write_path.test.ts`

### K6-015 — Session-idle generation behind `curation_enabled`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K6-014
- **Risk:** 🟡 (adds work to an existing lifecycle hook)
- **Files:** `plugin/index.ts`, `tests/integration/session_idle_curation.test.ts`
- **Description:**
  1. In `session.idle`, after the existing chain `ledger.settle()` → `CausalChain.onSessionIdle()`
     → `archiver.run()`, add `curator.propose("agents_md", writer)`.
  2. Guard it with `curation_enabled === "1"` (TEXT comparison) **and** a throttle so proposals
     are not regenerated on every idle event. Store the throttle timestamp in `kevin_settings`.
  3. Wrap it in its own `try/catch`. A curation failure must not prevent `settle()` or
     `archiver.run()` from having completed, and must not propagate into the host.
  4. This generates `pending` rows only. Nothing in `session.idle` may write to disk — the
     approval gate is not reachable from a lifecycle hook.
- **Acceptance criteria:**
  - With `curation_enabled = '0'`, `session.idle` creates no proposals and calls no `Curator`
     method.
  - With `curation_enabled = '1'`, one idle event creates proposals; a second idle event within
     the throttle window creates none.
  - A `Curator` that throws does not prevent `archiver.run()` from having run, and the hook
     resolves without rejecting.
  - No `artifact_writes` row is produced by any number of idle events.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/session_idle_curation.test.ts`

---

# Phase F3 — Pull channels (zero-cost distribution)

F2 publishes to one file the user reads. F3 publishes to two channels the *model* pulls on
demand: a Skill and a set of `@kevin/<topic>` references. Their defining property is that they
cost zero tokens until something asks for them, which is the whole argument of this release
against the per-prompt token tax.

Both depend on a host API surface Kevin does not pin (D6-13). Everything in this phase must
degrade to a **silent no-op** on a v1 host: no warning on every session start, no thrown error,
no half-written file. The flagship feature of v0.6.0 is the `AGENTS.md` curator, and it needs
none of this — so a user on an older host loses nothing they were promised.

### K6-016 — `plugin/capabilities.ts` — v2 domain probe

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/capabilities.ts`, `tests/unit/capabilities.test.ts`
- **Description:**
  1. Implement `probe(input: unknown): Capabilities` per plan §5.7. It inspects the plugin input
     for a `skill` domain exposing a callable `source`, and a `reference` domain exposing a
     callable `add`.
  2. Duck-typed and **zero-throw**: it never imports a v2 type, never dereferences without a
     guard, and returns `{ skills: false, references: false, apiVersion: null }` for any
     unexpected shape — including `null`, `undefined`, a string, and an object with a `skill`
     property that is not callable.
  3. **Kevin does not raise its `@opencode-ai/plugin ^1.17.6` pin in this release.** No import
     anywhere in `plugin/` may resolve only under a newer version. The pin moves at v0.9.0 with
     the v1/v2 matrix under test.
  4. Call `probe()` **once** at plugin init and hold the result. Probing per-event is a hot-path
     cost for a value that cannot change within a process.
- **Acceptance criteria:**
  - Ten malformed inputs (`null`, `undefined`, `0`, `""`, `[]`, `{}`, `{skill:null}`,
     `{skill:{}}`, `{skill:{source:1}}`, a `Proxy` whose getter throws) all return the
     all-false result and **none of them throws**.
  - A synthetic v2-shaped input returns `{ skills: true, references: true }`.
  - A half-v2 input (`skill` present, `reference` absent) returns `{ skills: true,
     references: false }` — the two capabilities are independent.
  - `package.json` still pins `@opencode-ai/plugin ^1.17.6`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/capabilities.test.ts`

### K6-017 — `plugin/Materializer.ts` — topic bundles

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K6-007, K6-012
- **Risk:** 🟡
- **Files:** `plugin/Materializer.ts`, `tests/unit/materializer.test.ts`
- **Description:**
  1. Write `~/.opencode-kevin/refs/<topic>.md` (one file per topic) and
     `~/.opencode-kevin/skills/project-knowledge.md` (one file). **Both go through
     `ArtifactWriter`** — marker-scoped, atomic, hash-audited. There is no direct
     `writeFileSync` anywhere in this module (D6-01).
  2. Topic derivation is deterministic and semantic: `<type>-<dominant token>`, where the
     dominant token is the highest-frequency non-stop-word token of the fingerprint-normalized
     content across the group, ties broken lexicographically.
  3. **Topics are never derived from a fingerprint prefix (D6-14).** FNV-1a is a hash; eight
     shared hex characters mean nothing, and a `@kevin/a3f9c1d2` reference would have
     arbitrary contents. `docs/Kevin_v0.5.0_Plan.md` §4 already rejected the same idea in its
     clustering form.
  4. Output ordering within each bundle is by memory id, matching K6-012.
- **Acceptance criteria:**
  - Topic derivation is stable across 100 runs for the same input set, including when two
     tokens tie on frequency.
  - A topic name never contains a hex-only segment of length ≥ 8 — asserted by regex over
     generated names on a fixture designed to tempt the hash shortcut.
  - Regeneration with unchanged inputs yields `"noop"` from `ArtifactWriter` for every bundle,
     and the files are byte-identical.
  - The module source contains no `writeFileSync`, `appendFileSync` or `createWriteStream`.
  - Bundles are ordered by memory id.
  - Topic names are filesystem-safe (no `/`, `\`, `:`, or leading `.`).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/materializer.test.ts`

### K6-018 — Skill emission (`skill_emission_enabled`)

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K6-016, K6-017
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `plugin/Materializer.ts`,
  `tests/integration/skill_emission.test.ts`
- **Description:**
  1. When `capabilities.skills === true` **and** `skill_emission_enabled === "1"`, register the
     generated `project-knowledge` Skill with the host.
  2. When the capability is absent, do nothing — silently. When the capability is present but
     the setting is `'0'`, also do nothing. These two cases must remain distinguishable in
     `kevin_audit` (`"unavailable"` vs `"off"`), which K6-023 consumes.
  3. The setting defaults to `'0'`: the pull channels ship **off** and are opted into, because
     they depend on a domain Kevin does not pin.
  4. Increment `skills_registered` on a successful registration.
- **Acceptance criteria:**
  - On a v1-shaped host, session start produces no warning, no throw, and no file under
     `skills/`.
  - On a v2-shaped host with the setting `'0'`, nothing is registered.
  - On a v2-shaped host with the setting `'1'`, exactly one Skill is registered and
     `skills_registered` is 1.
  - A host whose registration function throws is caught; the session continues and no metric is
     incremented.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/skill_emission.test.ts`

### K6-019 — Reference registration `@kevin/<topic>`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K6-016, K6-017
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `plugin/Materializer.ts`,
  `tests/integration/reference_emission.test.ts`
- **Description:**
  1. When `capabilities.references === true` **and** `reference_emission_enabled === "1"`,
     register one `@kevin/<topic>` reference per materialized topic file.
  2. Same degradation contract as K6-018: absent capability → silent no-op, distinguishable
     from `'0'`.
  3. Increment `references_registered` per successful registration.
  4. Re-registering an unchanged topic must be idempotent at the host level; do not accumulate
     duplicate registrations across sessions within one process.
- **Acceptance criteria:**
  - `references_registered` equals the number of topic files on a v2-shaped host with the
     setting `'1'`.
  - Zero registrations and zero throws on a v1-shaped host.
  - Registering twice in one process does not double the count.
  - A topic whose file was a `"noop"` this cycle is still registered (registration is about
     availability, not about whether the bytes changed).
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/reference_emission.test.ts`

### K6-020 — `kevin_publish` tool

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K6-018, K6-019
- **Risk:** 🟡
- **Files:** `plugin/kevin_publish.ts`, `plugin/index.ts`,
  `tests/integration/kevin_publish.test.ts`
- **Description:**
  1. `kevin_publish` regenerates the pull-channel bundles on demand and reports what changed:
     per bundle, the outcome (`written` / `noop` / `refused`) and the topic name.
  2. Register it in `plugin/index.ts`. Tool count reaches **16**.
  3. On a v1 host it still materializes the files (they are ordinary files under
     `~/.opencode-kevin/`) but registers nothing, and says so in its output rather than
     pretending success.
  4. `kevin_publish` writes only through `ArtifactWriter` and only to `~/.opencode-kevin/`
     paths. It must not be able to target `agents_md_path`; that path is reachable exclusively
     through `kevin_approve` (D6-07).
- **Acceptance criteria:**
  - Output lists every bundle with its outcome and topic.
  - Two consecutive invocations report all `noop` on the second.
  - On a v1-shaped host the output reports registration as unavailable and the tool exits
     successfully.
  - A test asserts `kevin_publish` cannot write to the configured `agents_md_path`, even when
     the setting points at a file inside `~/.opencode-kevin/`.
  - `kevin_status` reports 16 tools.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/kevin_publish.test.ts`

---

# Phase F4 — Demoting push (making the residual channel justify itself)

v0.5.0 made the cost of push visible. v0.6.0 gives the user two channels that cost nothing until
asked for. The residual pre-prompt injection must now justify 400 tokens against those two
alternatives, rather than 900 tokens against nothing.

The important change in this phase is not the number: it is that the lower clamp bound moves from
100 to **0**. Roadmap kill criterion **K1** prescribes cutting the push budget to zero if
`coverage_rate < 0.10`, and v0.5's `[100, 4000]` clamp made that response literally
unimplementable. A kill criterion whose prescribed response cannot be executed is not a kill
criterion.

### K6-021 — Push budget 900 → 400; clamp `[0, 4000]`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K6-001
- **Risk:** 🟡 (changes default runtime behaviour for every user)
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/context_injector_budget.test.ts`
- **Description:**
  1. `prePromptCap()` default `900` → `400`; clamp `[100, 4000]` → `[0, 4000]`.
  2. **When the effective cap is `0`, `onSystemTransform` returns without calling `plan()` at
     all** — no retrieval, no gate evaluation, no metric write. Off means off. A "budget of
     zero" that still runs retrieval and then discards the result is a performance cost with no
     benefit and a metrics stream that lies about activity.
  3. `COMPACTING_TOKENS` (2000) is unchanged. Compaction is a rarer, higher-value event and this
     release makes no claim about it.
  4. Existing user overrides are preserved by K6-001's conditional `UPDATE`; this task must not
     add a second write of the setting.
- **Acceptance criteria:**
  - Default on a fresh database is 400.
  - A value of `0` is accepted by `kevin_config set` and results in `plan()` never being called
     — asserted with a spy, not by observing an empty output.
  - With cap `0`, no `injections_*` metric moves at all.
  - Values below 0 and above 4000 clamp to the bounds.
  - `COMPACTING_TOKENS` is still 2000 and the compaction path still injects.
  - A database with a user override of `1200` still reads `1200`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/context_injector_budget.test.ts`

### K6-022 — `low_confidence` gate + `injections_blocked_confidence`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K6-004
- **Risk:** 🟡
- **Files:** `plugin/QualityGate.ts`, `plugin/ContextInjector.ts`,
  `tests/unit/quality_gate_confidence.test.ts`
- **Description:**
  1. Extend `GateReason` with `"low_confidence"`. `canInjectVerdict` gains an optional
     `confidence?: number` on the memory argument and an optional `confidenceFloor?: number` on
     the context.
  2. The floor check is branch **zero** — before `seen_this_session`. It is the cheapest check,
     and a memory below the floor should not consume a seen-set slot it will never use.
  3. `canInject()` remains the thin wrapper (v0.5 D5-04). **Its signature does not change.**
  4. `ContextInjector` reads `injection_confidence_floor` (default `'0.6'`) **once per `plan()`
     call**, not per memory, and passes it into `evaluateGate`.
  5. `injections_blocked_confidence` increments on the new branch and **only when
     `dryRun === false`** (v0.5 D5-08 still applies). Principle 16 — every gate rejection is
     counted — applies to the sixth reason exactly as it applied to the first five. The specific
     failure this prevents: a badly-chosen floor silently suppresses the whole push channel
     while `kevin_audit` reports a healthy `precision_rate` over three surviving injections.
- **Acceptance criteria:**
  - A memory with `confidence` below the floor yields `GateReason "low_confidence"` and no other
     branch is evaluated. ✓
  - The counter increments in live mode and does **not** increment under `kevin_trace`'s dry run. ✓
  - `canInject()`'s exported signature is byte-identical to v0.5.0. ✓ (arity 2, no `confidence`
     in its public shape; the floor branch is only reachable through `canInjectVerdict`.)
  - A memory exactly at the floor is **admitted** (`>=`, not `>`), asserted explicitly. ✓
  - Setting the floor to `'0'` admits everything the other five branches allow. ✓
  - `blockedSnapshot().confidence` reflects the counter. ✓
- **Status notes:**
  - `evaluate()` (the shared plan/inject gate evaluation) reads the floor once per call — per
    `plan()` it is read exactly once.
  - The default floor `'0.6'` blocks every single-observation memory (base confidence 0.5,
    `computeConfidence`): the release's intended push demotion. 8 legacy harnesses
    (`tests/e2e/{closed-loop,kevin-trace,plugin-complete,plugin-v02-validation,compacting-hook,
    kevin-config,glassbox-loop,context-injection}.test.ts`, `tests/integration/injection.test.ts`,
    `tests/unit/kevin-status-v04.test.ts`) now seed `injection_confidence_floor = '0'` explicitly
    (via `kevin_config set` or a direct settings upsert) so they keep testing v0.5-era push
    semantics; the new gate behavior is covered by its own unit suite.
- **Verification:** `npx vitest run tests/unit/quality_gate_confidence.test.ts` — 7/7. Full run:
  813/813 (718 unit+integration, 95 e2e), `npm run typecheck` clean, biome clean.

### K6-023 — `kevin_audit` — `channels` and `curation` blocks

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K6-021, K6-022, K6-014
- **Risk:** 🟢
- **Files:** `plugin/kevin_audit.ts`, `tests/integration/kevin_audit_v06.test.ts`
- **Description:**
  1. Add the `channels` and `curation` blocks exactly as shaped in plan §5.8.
  2. `skill_emission` and `reference_emission` report three distinct values: `"on"`, `"off"`
     (setting is `'0'` on a capable host) and `"unavailable"` (host lacks the domain). Collapsing
     the last two would make "my host is too old" indistinguishable from "I turned it off",
     which is the single most likely support question this release generates.
  3. Keep the existing `try/catch` degradation: on a pre-007 database the new blocks are omitted
     and `"partial": true` is set, exactly as the pre-006 path already behaves.
  4. **Still no `kevin_context_ratio`** (v0.5 D5-09). There is still no denominator.
  5. This block is the release's own scoreboard — it is what makes "the pull channels beat push"
     checkable rather than a claim in a README.
- **Acceptance criteria:**
  - `channels.push` reports `budget_tokens` matching the effective setting. ✓
  - `channels.pull` reports all seven counters and both emission states. ✓
  - The three emission states are produced by three distinct fixtures. ✓
  - `curation.proposals_by_status` sums to the total `curation_proposals` row count. ✓
  - `curation.inferable + non_inferable + unknown` equals the total memory count. ✓
  - Against a pre-007 database, `kevin_audit` returns `"partial": true` and omits both new
     blocks without throwing. ✓
  - The output contains no `kevin_context_ratio` key. ✓
- **Status notes:**
  - `buildAudit(store, metrics, capabilities?)` — capabilities come from the init probe and are
    passed by the `kevin_audit` tool in `index.ts`; the optional arg keeps direct-buildAudit
    callers on a v1-host default (`"unavailable"`).
  - `budget_tokens` is the EFFECTIVE cap (K6-021 clamp), not the raw setting: the comparison
    must use the budget push actually charges against. The clamp logic moved to a shared
    `effectivePrePromptCap()` exported from `ContextInjector.ts` (single source of truth, used
    by `prePromptCap()` and the audit).
  - `proposals_approved` counts the human decision (`approved` + `applied` metrics), the same
    way the ledger counters are incremented.
  - Both new blocks are gated on migration 007's schema (a `curation_proposals` probe). On a
    pre-007 DB they are OMITTED and `partial: true` — this intentionally flips the pre-existing
    K5-016 fixture expectation in `tests/integration/kevin-audit-tool.test.ts` (a 006-only DB
    now reports partial).
  - `skills_registered` / `references_registered` are read by SQL from `kevin_metrics` (they
    live outside the frozen 28-key `METRIC_KEYS`, per K6-018/019).
- **Verification:** `npx vitest run tests/integration/kevin_audit_v06.test.ts` — 8/8. Full run:
  821/821 (726 unit+integration, 95 e2e), `npm run typecheck` clean, biome clean.

---

# Phase F5 — Release

The closed-loop test is the one that matters. Every prior phase proves a component behaves; F5
proves the components compose into the claim on the box: a memory earns its way into a file the
user reads, only after a human looked at a diff and said yes.

### K6-024 — README + CHANGELOG + `AGENTS.md` + `kevin_status`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K6-020, K6-023
- **Risk:** 🟢
- **Files:** `README.md`, `CHANGELOG.md`, `AGENTS.md`, `package.json`,
  `plugin/kevin_status.ts`, `tests/unit/kevin_status_v06.test.ts`
- **Description:**
  1. Bump `package.json` to `0.6.0`. ✓
  2. CHANGELOG entry covering: three new tools, migration 007, two new tables, three new
     `memories` columns, six metric keys, five settings, and the push-budget default change.
     **Call the budget change out explicitly under a "Behaviour changes" heading** — a default
     that silently drops from 900 to 400 is the kind of change users discover from a metrics
     graph three weeks later. ✓ (also calls out the confidence floor demotion and the
     pre-007 `"partial": true` flip)
  3. README: document the marker contract (`<!-- kevin:begin … -->` / `<!-- kevin:end -->`),
     the `kevin_propose` → review diff → `kevin_approve` flow, and the fact that Kevin refuses
     rather than repairs when markers are malformed. ✓ (new "Curation & Pull (v0.6.0)"
     section, verbatim frozen strings; 13→16 tools; new tool docs; v0.6 settings table;
     `kevin_status`/`kevin_audit` examples with `v06`/`channels`/`curation`; 900→400 in the
     cycle diagram, hooks table and `kevin_trace` example; migration list + structure tree)
  4. Update the repository's own `AGENTS.md` architecture line: 24 modules → the new count. ✓
     (38 modules — matches `Get-ChildItem plugin/*.ts | Measure-Object`)
  5. Extend `kevin_status` with v0.6 fields: tool count 16, schema version 007, curation
     enabled, emission states, pending proposal count. ✓ (`v06` block; `tool_count: 16` was
     already in from K6-020)
- **Acceptance criteria:**
  - `package.json` reads `0.6.0`. ✓
  - README documents the marker contract verbatim, including that the strings are frozen for
     the v0.x line. ✓
  - CHANGELOG has an explicit "Behaviour changes" section naming the 900 → 400 default. ✓
  - `kevin_status` reports 16 tools and schema `007`. ✓
  - `AGENTS.md` module count matches `Get-ChildItem plugin/*.ts | Measure-Object`. ✓ (38)
- **Status notes:**
  - `kevin_status` lives inline in `plugin/index.ts` (there is no `plugin/kevin_status.ts`);
    the `v06` block is best-effort and **omitted on pre-007 databases** (same omission
    contract as `kevin_audit` K6-023) — `JSON.stringify` drops the `undefined` key.
  - Emission states reuse the probe-based three-state logic of K6-023
    (`"on"` / `"off"` / `"unavailable"`).
  - The `kevin_status_v06.test.ts` propose fixture follows the proven K6-014 seed pattern
    (second Store over the file DB; `kevin_propose` takes only `{ kind }`).
- **Verification:** `npx vitest run tests/unit/kevin_status_v06.test.ts` — 3/3. Full run:
  824/824 (729 unit+integration, 95 e2e), `npm run typecheck` clean, biome clean.

### K6-025 — Closed-loop e2e for v0.6 semantics

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K6-014, K6-020, K6-023
- **Risk:** 🟡
- **Files:** `tests/e2e/v06_closed_loop.test.ts`
- **Description:**
  Drive the full loop against a temp directory and an in-memory database, with no mocks below
  the host boundary:
  1. Save a `decision` memory; assert `inferable = 0` via `classify()`.
  2. Give it two pieces of causal evidence so it passes the D6-09 disjunction.
  3. Run `session.idle`; assert a `pending` proposal exists and the target file is untouched.
  4. Read the proposal's diff; assert it contains the expected `+` line.
  5. `kevin_approve` with `"reject"`; assert the file is still untouched and status is
     `rejected`.
  6. Generate again, approve for real; assert the file now contains the line inside the marker
     block, that bytes outside the markers are unchanged from step 0, and that `curated = 1`.
  7. Run the whole generation again; assert `"noop"` and byte-identical file.
  8. Assert `kevin_audit.channels.pull.artifact_writes_total === 1` and
     `proposals_rejected === 1`, `proposals_approved === 1`.
  9. Hand-corrupt the marker block (delete `MARKER_END`), regenerate, and assert the outcome is
     `"refused"`, the file is byte-identical, and an `artifact_writes` row records the refusal.
- **Acceptance criteria:**
  - All nine steps pass in one test file with no mock of `ArtifactWriter`.
  - The step-6 byte comparison of the region outside the markers is against the original file
     content captured before step 1.
  - The test creates and removes its own temp directory and touches no path under the repository
     or `~/.opencode-kevin/`.
  - Total runtime under 10 seconds.
- **Status notes:** `tests/e2e/v06_closed_loop.test.ts` drives the nine steps through the real
  host hooks (kevin_save / kevin_approve / kevin_audit / kevin_config / `session.idle`) with no
  mock of `ArtifactWriter` and a fresh temp dir. Evidence for the D6-09 disjunction is seeded as
  `evidence_count = 2` on the saved rows via a second Store (the K6-013/014 fixture pattern); the
  whole pipeline runs real. Two findings fixed along the way: (1) `plugin/replay.ts` and
  `scripts/verify-install.ts` were the last two legacy harnesses missing the K6-022
  `injection_confidence_floor='0'` opt-out — both now seed it, restoring the v0.5 semantics the
  replay fixtures / verify checks were recorded under; (2) `artifact_writes` rows share a
  second-precision `wrote_at`, so the refusal audit row is read `WHERE proposal_id = ?` instead
  of by `ORDER BY wrote_at DESC`.
- **Verification:** `npx vitest run tests/e2e/v06_closed_loop.test.ts` — 1/1 (3/3 repeated runs
  deterministic; runtime ~100 ms). Full run: **835/835** (103 files), `npm run typecheck` clean,
  biome clean, `npm run verify` 8/8.

### K6-026 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K6-024, K6-025
- **Risk:** 🟢
- **Files:** —
- **Description:**
  Run the four release gates plus the five release-specific checks of plan §11. Do not tag until
  every one is green.
- **Acceptance criteria:**
  - `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify` all exit 0.
  - **Migration idempotency:** `Migrate.run()` twice on a fresh DB reports `applied: []` on the
     second run.
  - **Override preservation:** a `006` database with `pre_prompt_budget_tokens = '1200'`
     migrates to `007` with that value untouched; one on the default `'900'` becomes `'400'`.
  - **Refusal safety:** three malformed-marker fixtures return `"refused"`, write nothing, and
     are byte-identical afterwards.
  - **Idempotent application:** approving the same proposal twice produces `"written"` then
     `"noop"` with a byte-identical file.
  - **Config surface:** `kevin_config set` succeeds for all five new keys and `kevin_config
     list` reads each back.
  - Test count and file count are recorded in the CHANGELOG.
- **Status notes:** All four release gates and the five release-specific checks green, each
  check pinned to its test: (1) idempotency — `migrate_007.test.ts` "a second run reports
  applied: []"; (2) override preservation — `migrate_007.test.ts` `'1200'` kept / default
  `'900'`→`'400'`; (3) refusal safety — four malformed-marker fixtures refuse in
  `artifact_writer_plan.test.ts` (begin-only, end-only, END-before-BEGIN, duplicate pair) plus
  the refused apply with byte-identical target and audit row in `artifact_writer_apply.test.ts`;
  (4) idempotent application — `artifact_writer_fidelity.test.ts` written-then-noop with
  byte-identical file (the kevin_approve level errors on double-approve by design,
  `curation_tools.test.ts`); (5) config surface — `config_keys.test.ts` sets and reads back all
  five new keys. Final counts recorded in the CHANGELOG (`### Tests`): 103 test files / 835
  tests.
- **Verification:** `npm run typecheck` (clean), `npm run lint` (clean), `npm test`
  (**835/835**, 103 files), `npm run verify` (8/8).

---

## 3. Implementation order

Strict order within phases; phases may not be started early. F1 and F2 are sequential because
F2 consumes `WritePlan`; F3 may be developed in parallel with F4 by a second contributor once
K6-007 is `[X]`.

```
F0  K6-001 → K6-002 → K6-003 → K6-004
F1  K6-005 → K6-006 → K6-007 → K6-008 → K6-009
F2  K6-010 → K6-011 → K6-012 → K6-013 → K6-014 → K6-015
F3  K6-016 → K6-017 → K6-018 → K6-019 → K6-020     ┐ parallelizable
F4  K6-021 → K6-022 → K6-023                        ┘ after K6-007
F5  K6-024 → K6-025 → K6-026
```

**Critical path:** K6-001 → K6-005 → K6-007 → K6-011 → K6-013 → K6-014 → K6-025 → K6-026.

**Suggested milestones.** After K6-009 the write path is provably safe and can be reviewed in
isolation — this is the right place for the release's only mandatory code review. After K6-014
the flagship feature works end to end and the release is shippable even if F3 slips entirely;
F3 is opt-in and defaults to off, so cutting it costs no promised functionality.

---

## 4. Traps to avoid

These are drawn from defects that actually shipped in v0.3.0 and v0.4.0, from the v0.4.0 bug
audit, and from the failure modes this release's design specifically guards against.

| # | Trap | Consequence | Guard |
|---|---|---|---|
| 1 | Comparing `kevin_settings.value` with `=== 1` | The setting is unreachable; the feature silently never runs. This exact defect kept `cross_project_enabled` dead for a full minor release. | Values are TEXT: `=== "1"` or `Number(...)`. Applies to all five new keys. |
| 2 | Forgetting `KEVIN_CONFIG_KEYS` in `plugin/index.ts` | `kevin_config set` returns `{error:"unknown_key"}` while `kevin_config list` still shows the key. Ships green. | K6-003, plus a test that derives the expected key set from the database. |
| 3 | Forgetting `007_v06_pull.sql` in `scripts/verify-install.ts` | `npm run verify` passes without ever exercising migration 007. | K6-003. The list is hard-coded at lines 62–79; it always will be. |
| 4 | Expecting `ALTER TABLE ADD COLUMN` to be idempotent | Second run throws. | Idempotency comes from `schema_version`. Test "run `Migrate.run()` twice", never "run the SQL twice". |
| 5 | Unconditional `UPDATE` of `pre_prompt_budget_tokens` | A user's deliberate `1200` is silently discarded. | The `AND value = '900'` guard, asserted in both directions by K6-001. |
| 6 | Repairing malformed markers instead of refusing | Destroys hand-written content with no undo — and `git` is not an undo, because the user may not have committed. | D6-03. Three refusal fixtures in K6-005 and again in K6-026. |
| 7 | `writeFileSync` directly on the target path | An interrupted write leaves a truncated `AGENTS.md`. | Temp + `fsync` + `rename` in the same directory (K6-007). |
| 8 | A second `ArtifactWriter.apply()` call site | Two write paths means two sets of rules, and the second one drifts. | `tests/unit/single_write_path.test.ts` (K6-014). |
| 9 | Showing prose instead of a diff in the approval prompt | The human approves a sentence, not bytes, and the entire safety model becomes decorative. | D6-05. `kevin_propose` returns the unified diff from `diff.ts`. |
| 10 | Sorting the rendered block by confidence | Every confidence change reshuffles the whole block; a 1-line change shows as a 20-line diff and the user stops reading diffs. | D6-10: confidence orders selection, id orders output. |
| 11 | Treating `inferable IS NULL` as inferable | Every unclassified memory is silently withheld from curation forever. | Predicate is `inferable != 1`, tested explicitly in K6-011 and K6-012. |
| 12 | Deleting superseded or rejected proposals | Kill criterion K4 becomes uncheckable; the release cannot be evaluated. | Rows are marked `superseded` / `rejected`, never deleted (K6-013). |
| 13 | Deriving topics from fingerprint prefixes | A hash prefix carries zero semantic information; `@kevin/a3f9c1d2` has arbitrary contents. | D6-14, with a regex assertion in K6-017. |
| 14 | Letting a memory's `-->` close the marker comment | Injected text escapes Kevin's region and becomes permanent document content. | Sanitation layer (c) in K6-009, with a round-trip assertion. |
| 15 | Normalizing line endings or stripping the BOM | Silent data loss across the whole file, disguised as tidiness. | K6-008 preserves both, asserted byte-wise. |
| 16 | Adding a gate branch without a counter | An unmeasurable policy: a bad floor suppresses the entire push channel while `precision_rate` looks healthy over three survivors. | Principle 16; `injections_blocked_confidence` (K6-022). |
| 17 | Incrementing metrics during a dry run | `kevin_trace` pollutes the numbers it exists to explain. | v0.5 D5-08: increment only when `dryRun === false`. |
| 18 | Clamping the budget to `[100, 4000]` | Kill criterion K1's prescribed response — cut the budget to zero — is unimplementable. | Clamp is `[0, 4000]`, and `0` short-circuits before `plan()` (K6-021). |
| 19 | Probing host capabilities on every event | A hot-path cost for a value that cannot change within a process. | Probe once at init, hold the result (K6-016). |
| 20 | Warning on every session start when the v2 domains are absent | Log spam that trains users to ignore Kevin's output, in exchange for information they cannot act on. | Silent no-op; the state is reported in `kevin_audit` where it is asked for, not announced. |
| 21 | Collapsing `"unavailable"` and `"off"` in `kevin_audit` | "My host is too old" becomes indistinguishable from "I turned it off" — the most likely support question of this release. | Three distinct states, three fixtures (K6-023). |
| 22 | Forgetting `METRIC_KEY_LABELS` in `Retrospective.ts` | The report prints raw snake_case keys. Seven keys shipped this way in v0.4.0. | K6-004 asserts by iterating `METRIC_KEYS`, not by counting. |
| 23 | Building a component and never wiring it | v0.4.0 shipped `QualityGate.evaluate()` with zero call sites. | K6-015 and K6-025 are wiring tasks with call-site assertions, not just unit tests. |
| 24 | Adding an auto-approve or "trusted mode" setting | Deletes the release's entire value proposition while appearing to be a convenience feature. | Explicitly out of scope, permanently (plan §10). |
| 25 | Writing to a file other than `agents_md_path` | The blast radius of a splice bug scales with the number of targets, and the review burden scales worse. | D6-07. K6-020 asserts `kevin_publish` cannot reach the `AGENTS.md` path. |
| 26 | Tests that write into the repo or `~/.opencode-kevin/` | A test run eventually corrupts a real file, and the failure appears in an unrelated place. | `mkdtempSync` + `afterEach` cleanup, stated in §2. |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

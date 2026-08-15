# Opencode-kevin — Task List v0.7.0

**Version:** 0.7.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** `docs/Kevin_v0.7.0_Plan.md`
**ID Convention:** `K7-XXX` ("Project Truth") · Decisions referenced as `D7-NN`
**Total tasks:** 24
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
### K7-001 — Draft migration 008

**Status:** `[X]` Done — file created, 12 tests passing
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K7-001 | F0 | Draft migration `008_v07_truth.sql` | P0 | S (3h) | `[X]` |
| K7-002 | F0 | Post-apply hook `"008"` in `Migrate.ts` | P0 | S (1h) | `[X]` |
| K7-003 | F0 | `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts` | P0 | S (1h) | `[X]` |
| K7-004 | F0 | Expand `METRIC_KEYS` 28 → 33 | P0 | S (2h) | `[X]` |
| K7-005 | F1 | `RepoTruth.scan()` — bounded JSON extraction | P0 | M (6h) | `[X]` |
| K7-006 | F1 | Project-scoped storage + `mtime` skip | P0 | M (4h) | `[X]` |
| K7-007 | F1 | `contradictions()` — exact-match, three checks | P0 | M (6h) | `[X]` |
| K7-008 | F1 | `truth_penalty` in `rankScore()` | P0 | M (4h) | `[X]` |
| K7-009 | F1 | `kevin_facts` tool | P1 | S (3h) | `[X]` |
| K7-010 | F2 | `ConventionMiner` — `sequence` miner | P1 | M (5h) | `[X]` |
| K7-011 | F2 | `ConventionMiner` — `co_edit` miner | P1 | M (5h) | `[X]` |
| K7-012 | F2 | Rule emission (`type='rule'`, `origin='pattern'`) | P1 | M (4h) | `[X]` |
| K7-013 | F2 | `Curator` hand-off + whole-file de-duplication | P1 | S (4h) | `[X]` |
| K7-014 | F3 | `ConflictDetector` — three detectors | P0 | M (6h) | `[X]` |
| K7-015 | F3 | `kevin_conflicts` tool + `conflicts` audit block | P1 | M (4h) | `[X]` |
| K7-016 | F3 | Never-auto-resolve guard | P0 | S (3h) | `[X]` |
| K7-017 | F4 | `error_lesson_mode` setting | P0 | M (4h) | `[X]` |
| K7-018 | F4 | `error_lessons_suppressed` + preserved side effects | P0 | S (3h) | `[X]` |
| K7-019 | F4 | `kevin_audit` `mix` block (pure SQL) | P0 | M (5h) | `[X]` |
| K7-020 | F4 | Per-type `precision_rate` split | P1 | S (3h) | `[X]` |
| K7-021 | F5 | `kevin_status` + README + CHANGELOG + `AGENTS.md` | P1 | S (3h) | `[X]` |
| K7-022 | F5 | Closed-loop e2e for v0.7 semantics | P0 | M (6h) | `[X]` |
| K7-023 | F5 | Exit-criterion measurement harness | P0 | S (4h) | `[X]` |
| K7-024 | F5 | Final verification | P0 | S (2h) | `[X]` |

**Phase totals:** F0 4 · F1 5 · F2 4 · F3 3 · F4 4 · F5 4 — **24 total**

**Done:** 24/24 · **In progress:** 0 · **Blocked:** 0

**Critical path:** K7-001 → K7-005 → K7-007 → K7-008 → K7-017 → K7-019 → K7-022 → K7-024.

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
- Code comments that implement a plan decision cite it: `// v0.7.0 (K7-008 / plan §5.3, D7-04)`.

**Database access in tests.** Always `new Store({ path: ":memory:" })` followed by
`await new Migrate(store, migrationsDir).run()`. Never write to `~/.opencode-kevin/`.

**Repository fixtures in tests.** Every test that exercises `RepoTruth` builds its fixture project
inside `fs.mkdtempSync(path.join(os.tmpdir(), "kevin-repo-"))` and removes it in `afterEach`.
**No test may point `RepoTruth` at the repository's own root** — the scanner would then extract
Kevin's own `package.json`, and the test would start failing the day someone adds a script.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. Compare with `=== "1"` or an explicit string equality.
   Never a truthiness check. `error_lesson_mode` is the sharpest instance in this release:
   `"0"`, `"all"` and `"false"` are all truthy strings, so `if (mode)` puts **every** installation
   into triage mode on upgrade. Compare with `=== "triage_only"`.
2. `ALTER TABLE ... ADD COLUMN` is **not** idempotent. Idempotency comes from `schema_version`.
   The correct acceptance criterion is always "applying via `Migrate.run()` twice is a no-op".
3. SQLite cannot alter a CHECK constraint. `memories.origin` carries one; **do not widen it**
   (D7-09). Migration 008 introduces CHECK constraints only on new tables and contains no rebuild.
4. `Store` sets `PRAGMA foreign_keys = ON`. `memory_conflicts.memory_a` / `memory_b` and
   `repo_facts` deliberately carry no `REFERENCES` clause.

**Project scoping.** The database is global and shared across every project on the machine
(`~/.opencode-kevin/kevin.db`, `projectId = fingerprint(process.cwd())`). **Every read and every
write of `repo_facts` and `memory_conflicts` filters on `project_id`.** There is no unscoped read
of either table anywhere in the release — with two deliberate exceptions, both whole-DB glass-box
aggregates that never feed a per-project write: `kevin_audit`'s `conflicts` block (K7-015: its
per-kind counts sum to the total row count of every project) and `kevin_status`'s `open_conflicts`
count. This is not a style preference; §5.2 explains the exact failure it prevents.

**Hot path.** No LLM calls, no network, no filesystem scans in `tool.execute.*`, `chat.message`,
`experimental.chat.system.transform` or `experimental.session.compacting`. `RepoTruth.scan()` runs
at plugin init and at most once per session; mining and conflict detection run on `session.idle`
only.

**Destructive authority.** No code added in this release may write `memories.status`. De-ranking
is the maximum authority a heuristic gets (Principle 24, D7-03). `ConflictDetector.resolve()` is
reachable only from `kevin_conflicts` with an explicit `keep` argument.

**Backwards compatibility.** With `truth_penalty = 0` and `error_lesson_mode = 'all'`, v0.7.0 must
reproduce v0.6.0 behaviour **exactly**. Both defaults are chosen so that a user who upgrades and
changes nothing observes no difference.

---

# Phase F0 — Substrate (schema, migration plumbing, config and metric keys)

Two new tables, two new `memories` columns, five metric keys, four settings. Nothing here changes
runtime behaviour: `truth_penalty` defaults to `0.0`, which makes the new ranking factor exactly
`1.0`, and all three feature flags except `error_lesson_mode` default to `'0'`.

### K7-001 — Draft migration `008_v07_truth.sql`

**Status:** `[X]` Done — audited migration, post-apply reconciliation, defaults, constraints and idempotency; targeted suite passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟡 (additive; the unique index is the load-bearing detail)
- **Files:** `migrations/008_v07_truth.sql`, `tests/unit/migrate_008.test.ts`
- **Description:**
  1. Create the file with the exact content of `docs/Kevin_v0.7.0_Plan.md` §6.
  2. `repo_facts` with **`CREATE UNIQUE INDEX uq_repo_facts ON repo_facts(project_id, file,
     key_path)`**. The `project_id` component is mandatory. `(file, key_path)` — the shape one
     writes without thinking — makes project A's `packageManager=npm` and project B's
     `packageManager=pnpm` the same row, after which `contradictions()` evaluates A's memories
     against B's repository. The symptom is "Kevin randomly de-ranks good memories when I switch
     projects": intermittent, silent, and very hard to diagnose from a counter.
  3. `memory_conflicts` with `kind` ∈ `repo_truth` / `decision_pair` / `temporal`, `status` ∈
     `open` / `acknowledged` / `resolved`, plus the two indices. No `REFERENCES` clauses.
  4. `ALTER TABLE memories ADD COLUMN truth_penalty REAL NOT NULL DEFAULT 0.0` and
     `contradicted_at TEXT`, plus `idx_memories_truth_penalty`.
  5. Seed the five metric keys and the four settings. `repo_truth_enabled`,
     `convention_mining_enabled` and `conflict_detection_enabled` default to `'0'`;
     `error_lesson_mode` defaults to **`'all'`**, which preserves v0.6.0 behaviour exactly.
  6. `INSERT OR IGNORE INTO schema_version (version) VALUES ('008')`.
  7. **No table rebuild, and no widening of `memories.origin`.** If a change appears to require
     either, stop and re-read D7-09.
- **Acceptance criteria:**
  - `Migrate.run()` on a fresh `:memory:` database reaches `schema_version = '008'`; running it
     twice reports `applied: []` on the second call.
  - Inserting two `repo_facts` rows differing **only** in `project_id` succeeds; inserting a
     duplicate `(project_id, file, key_path)` raises a constraint error. Both directions asserted.
  - `memory_conflicts` rejects an out-of-domain `kind` and an out-of-domain `status`.
  - A pre-existing memory reads `truth_penalty === 0` and `contradicted_at === null` after
     migration.
  - `error_lesson_mode` reads `'all'` on a fresh database.
  - The file contains no `DROP TABLE`, no `CREATE TABLE memories_new`, and no `origin` CHECK
     redefinition.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_008.test.ts`

### K7-002 — Post-apply hook `"008"` in `Migrate.ts`

**Status:** `[X]` Done — hook added to `DEFAULT_POST_APPLY_HOOKS`, 3 tests passing

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K7-001
- **Risk:** 🟢
- **Files:** `plugin/Migrate.ts`, `tests/unit/migrate_008.test.ts`
- **Description:**
  1. Add a `"008"` entry to `DEFAULT_POST_APPLY_HOOKS` with the four re-derivation statements
     from plan §6: normalize any `NULL` `truth_penalty` to `0.0`, and re-derive
     `repo_facts_scanned`, `conflicts_detected` and `memories_contradicted` from the tables.
  2. Follow the shape of the existing `"003"` … `"007"` entries exactly. This is the fifth entry
     in an established table, not a new mechanism.
  3. Re-deriving from the tables rather than trusting the counters is what makes the metrics
     survive a database restored from backup or edited by hand.
- **Acceptance criteria:**
  - After the hook, `repo_facts_scanned` equals `COUNT(*)` of `repo_facts`, `conflicts_detected`
     equals `COUNT(*)` of `memory_conflicts`, and `memories_contradicted` equals the count of
     memories with `truth_penalty > 0.0`.
  - Deliberately corrupting `memories_contradicted` to `999` and re-running `Migrate.run()`
     restores the correct value.
  - No memory's `truth_penalty` is `NULL` after the hook.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_008.test.ts`

### K7-003 — `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts`

**Status:** `[X]` Done — 4 keys appended to `KEVIN_CONFIG_KEYS` (18 total), `error_lesson_mode` enum enforced in `kevin_config set`, `008_v07_truth.sql` added to verify script; 4 config tests + `npm run verify` (exit 0) passing

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K7-001
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `scripts/verify-install.ts`, `tests/unit/config_keys.test.ts`
- **Description:**
  1. Append `repo_truth_enabled`, `convention_mining_enabled`, `conflict_detection_enabled`,
     `error_lesson_mode` to `KEVIN_CONFIG_KEYS`. Settings total goes 14 → **18**.
  2. Add `008_v07_truth.sql` to the hard-coded migration list in `scripts/verify-install.ts`.
  3. Both omissions ship green, which is why this six-line task is P0. The v0.6.0 task list
     carries the identical trap at K6-003; if the derived-key-set test from that release is in
     place, this task is mostly free — verify it is, rather than assuming.
- **Acceptance criteria:**
  - `kevin_config set` succeeds for all four new keys and `kevin_config list` reads each back.
  - The v0.6.0 test that derives the expected key set from the database still passes and now
     covers 18 keys.
  - `kevin_config set error_lesson_mode` rejects a value outside `all` / `triage_only`.
  - `npm run verify` exits 0 and its output names `008_v07_truth.sql`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/config_keys.test.ts && npm run verify`

### K7-004 — Expand `METRIC_KEYS` 28 → 33

**Status:** `[X]` Done — 5 keys appended to `METRIC_KEYS` (33 total) + `METRIC_KEY_LABELS`; no per-type precision helper exported; 5 tests passing

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K7-001
- **Risk:** 🟢
- **Files:** `plugin/metrics.ts`, `plugin/Retrospective.ts`, `tests/unit/metrics.test.ts`
- **Description:**
  1. Append five keys in the order the migration seeds them: `repo_facts_scanned`,
     `memories_contradicted`, `conventions_mined`, `conflicts_detected`,
     `error_lessons_suppressed`. Total 28 → **33**.
  2. Add all five to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts`.
  3. **No change to `precisionRate()` or `coverageRate()`.** The per-type split of plan §5.6
     lives in `kevin_audit` as SQL, not as a `Metrics` method: it is a partition of the ledger,
     not a counter, and putting it in `Metrics` would create a second definition of precision
     that drifts from the first.
- **Acceptance criteria:**
  - `METRIC_KEYS.length === 33`.
  - Every key has a `METRIC_KEY_LABELS` entry, asserted by iterating `METRIC_KEYS`.
  - The `METRIC_KEYS` set equals the `kevin_metrics` row-key set after `Migrate.run()`.
  - `precisionRate()` and `coverageRate()` produce identical output to v0.6.0 for the same
     fixture inputs.
  - `plugin/metrics.ts` exports no per-type precision helper.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/metrics.test.ts`

---

# Phase F1 — Repository truth (Kevin finally reads the project)

Until this phase, Kevin has reasoned about a repository it has never read. Every memory it holds
was inferred from tool traffic; none of it was ever checked against the source of truth sitting
two `JSON.parse` calls away.

Two constraints govern the whole phase. First, **exactly two files** are read, both JSON, so the
feature costs zero new parsers and zero new dependencies (D7-01). Second, **contradiction
de-ranks and never deletes** (D7-03): retrieval filters `status='active'`, so any `status` write
from a heuristic is an undoable deletion from every future prompt, with no notification to
anyone.

### K7-005 — `RepoTruth.scan()` — bounded JSON extraction

**Status:** `[X]` Done — `RepoTruth.ts` created; exact key-set extraction, malformed-input handling, 500-cap + `_truncated`, deterministic, <50ms; 9 tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K7-001
- **Risk:** 🟡
- **Files:** `plugin/RepoTruth.ts`, `tests/unit/repo_truth_scan.test.ts`
- **Description:**
  1. Create `plugin/RepoTruth.ts` with the interface of plan §5.1.
  2. Read **exactly** `package.json` and `tsconfig.json` from the project root. Each is parsed
     with `JSON.parse` inside a `try`/`catch` returning `[]` on **any** failure: missing file,
     unreadable file, malformed JSON, or JSON that parses to a non-object (`null`, an array, a
     number — `typeof null === "object"` is the classic way this check is written wrong).
  3. Extract exactly the key set of the plan §5.1 table and nothing else. The extractor **never
     recurses into arbitrary nested objects**; `compilerOptions` scalars are taken one level
     deep, and `include` / `exclude` are joined deterministically into a single stringified value.
  4. Hard cap of **500 facts per project**, stopping at a deterministic point (the table's key
     order, and within each group, source key order). **Record the truncation** as a `repo_facts`
     row with `key_path = '_truncated'` and `value = '<n>'`. A silent truncation turns every
     dropped fact into a false contradiction, which is a worse outcome than the memory cost the
     cap exists to avoid.
  5. Every value is stringified. A `true` and a `"true"` must not compare unequal because of
     their JavaScript types.
- **Acceptance criteria:**
  - A fixture project with a full `package.json` + `tsconfig.json` yields exactly the documented
     key set; a test enumerates the expected `key_path` list explicitly rather than counting.
  - Five malformed inputs (missing file, unparseable text, `null`, `[]`, `42`) each yield `[]`
     and **none throws**.
  - A generated fixture with 800 extractable keys produces exactly 500 facts plus one
     `_truncated` row whose value is `800`.
  - Truncation is deterministic: the same fixture yields the same 500 `key_path` values on 10
     consecutive runs.
  - The scan completes in under **50 ms** on a generated fixture of realistic size, asserted with
     a timing bound.
  - `package.json` declares no new runtime dependency; the module imports only `node:fs`,
     `node:path` and Kevin's own modules.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_truth_scan.test.ts`

### K7-006 — Project-scoped storage + `mtime` skip

**Status:** `[X]` Done — `scan()` skips re-parsing unchanged `mtime`, deletes facts for removed files, all `repo_facts` reads project-scoped; 5 tests passing

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K7-005
- **Risk:** 🔴 (a scoping defect silently corrupts a second project's ranking)
- **Files:** `plugin/RepoTruth.ts`, `tests/unit/repo_truth_scoping.test.ts`
- **Description:**
  1. Persist facts to `repo_facts` under `UNIQUE(project_id, file, key_path)`. Every write
     carries `project_id`; **every read filters on it** — `facts()`, `contradictions()`,
     `kevin_facts`, and the `truth` block of `kevin_audit`.
  2. Store `source_mtime` per file. When the file's current `mtime` equals the stored value,
     **skip parsing entirely**. The steady state of an idle session is two `stat` calls.
  3. Re-scanning after a real edit replaces that file's facts for that project — and only that
     project. Facts for files no longer present are removed for that project only.
  4. Add a test that greps `plugin/` for `FROM repo_facts` and asserts every occurrence is
     accompanied by a `project_id` predicate. This is cheap, and it is the only thing that stops
     the defect from being reintroduced by a future release's convenience query.
- **Acceptance criteria:**
  - Two fixture projects with conflicting `packageManager` values both persist their own row;
     neither overwrites the other; `facts()` for each returns only its own.
  - `contradictions()` for project A never consults a project B fact — asserted by constructing
     the exact scenario in plan §5.2 and requiring zero contradictions.
  - An unchanged `mtime` results in zero `JSON.parse` calls (spy on the parse path).
  - Touching the file (changing `mtime` without changing content) re-parses and produces an
     identical fact set.
  - Deleting `tsconfig.json` and re-scanning removes that project's `tsconfig.json` facts and
     leaves its `package.json` facts and the other project's facts intact.
  - The source-scan test finds no unscoped `repo_facts` read.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_truth_scoping.test.ts`

### K7-007 — `contradictions()` — exact-match, three checks

**Status:** `[X]` Done — three exact-match checks (missing script, disappeared dependency, changed compiler option), pure read; 6 tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K7-006
- **Risk:** 🟡
- **Files:** `plugin/RepoTruth.ts`, `tests/unit/repo_truth_contradictions.test.ts`
- **Description:**
  1. Implement exactly three checks and no others (plan §5.1):
     - **Missing script** — the memory names `npm run <x>` / `pnpm run <x>` / `yarn <x>` and no
       `scripts.<x>` fact exists for this project.
     - **Missing dependency** — the memory names a package for which a `dependencies.<pkg>` /
       `devDependencies.<pkg>` / `optionalDependencies.<pkg>` fact existed at the previous scan
       and no longer exists.
     - **Changed compiler option** — the memory asserts a `compilerOptions.<k>` value and the
       current fact holds a different literal value.
  2. **Exact-match only** (D7-05). No substring similarity, no edit distance, no fuzzy scoring.
     A memory that merely *mentions* a word appearing in a fact is not a contradiction. The
     comparison is over an extracted, exact token: the script name, the package name, the option
     key and its literal value.
  3. Return human-readable reasons, empty when consistent. The reason string is what a user reads
     in `kevin_facts`; "`npm run lint` is referenced but `scripts.lint` does not exist" is
     actionable, "contradicted" is not.
  4. `contradictions()` is a pure read. It writes nothing — not the penalty, not the conflict row.
     K7-008 and K7-014 own those writes.
- **Acceptance criteria:**
  - Each of the three checks has at least one positive and one negative case.
  - Check 2 fires only on a **disappeared** dependency, not on one that was never present —
     the "existed at the previous scan" clause is asserted explicitly with a two-scan fixture.
  - A memory containing the word `test` against a project with a `scripts.test` fact produces
     **no** contradiction: mention is not assertion.
  - A memory naming `npm run lint` in a project with `scripts.lint` produces no contradiction; the
     same memory after `scripts.lint` is removed produces exactly one.
  - `compilerOptions.strict` changing `true` → `false` contradicts a memory asserting `true`;
     changing formatting only (e.g. `"true"` vs `true` after stringification) does not.
  - The method performs no `INSERT` or `UPDATE` (asserted with a read-only store wrapper).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_truth_contradictions.test.ts`

### K7-008 — `truth_penalty` in `rankScore()`

**Status:** `[X]` Done — `mapRow`/retrieval SELECTs expose `truthPenalty`/`contradictedAt`; `rankScore` gains trailing `*(1-truthPenalty)`; `applyTruthPenalty` clamps to [0,0.5], increments `memories_contradicted` only on 0→non-zero, never writes `status`; 6 tests passing

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K7-007
- **Risk:** 🔴 (touches the ranking function every retrieval depends on)
- **Files:** `plugin/MemoryService.ts`, `tests/unit/rank_score_truth.test.ts`
- **Description:**
  1. `mapRow()` reads `truth_penalty` and `contradicted_at`, exposing them as
     `truthPenalty: number` and `contradictedAt: string | null`.
  2. `rankScore()` gains a **trailing** factor:
     `base * originBoost(mem) * recencyDecay * (1 - (mem.truthPenalty ?? 0))`. Applied last, by a
     factor that is exactly `1.0` at the default, so the v0.6.0 ranking is reproduced bit-for-bit
     whenever nothing is contradicted (D7-04). A ranking change and a semantics change must not
     be entangled; only one of them ships here.
  3. Add `applyTruthPenalty(memoryId, penalty, reason): void`. It clamps to `[0, 0.5]`, writes
     `truth_penalty` and `contradicted_at`, increments `memories_contradicted` **only when the
     value moves from `0` to non-zero**, and **never writes `status`**.
  4. The clamp ceiling matters: a contradicted memory loses at most half its score, so a single
     false positive cannot push it behind every uncontradicted memory in the corpus.
  5. Note the sign. `rankScore` returns a **negative** score for BM25 rows (more negative = better),
     so scaling by a factor in `(0.5, 1]` moves a row *toward zero*, i.e. toward worse. This is
     the intended direction and must be **asserted explicitly**, not assumed — getting it
     backwards would promote contradicted memories, and every other test in this task would still
     pass.
- **Acceptance criteria:**
  - With all penalties `0`, a fixed 20-memory fixture produces an id sequence **identical** to
     v0.6.0's, asserted against a golden array rather than spot-checked.
  - A penalty of `0.5` moves a memory strictly toward worse rank; a penalty of `0` does not move
     it at all.
  - `applyTruthPenalty` clamps `-1` to `0` and `0.9` to `0.5`.
  - `memories_contradicted` increments on the first penalty and **not** on a second penalty
     applied to the same memory.
  - After applying penalties to N memories,
     `SELECT COUNT(*) FROM memories WHERE status <> 'active'` is unchanged from its pre-scan
     value.
  - `MemoryService` contains no `UPDATE memories SET status` on any path reachable from
     `applyTruthPenalty`.
- **Status notes:** release audit (D7-03 recoverability): `applyTruthPenalty(id, 0)` now clears `contradicted_at` (CASE — a reset is `NULL`, a repeat penalty keeps the first stamp) and decrements `memories_contradicted` on the non-zero → 0 transition, mirroring the 008 hook's COUNT(truth_penalty > 0) re-derivation. New test: lift/re-penalize round-trip.
- **Verification:** `npx vitest run tests/unit/rank_score_truth.test.ts`

### K7-009 — `kevin_facts` tool

**Status:** `[X]` Done — `plugin/kevin_facts.ts` (`{ project_id, scanned_at, truncated, facts, penalized }`) registered as 17th tool; refresh/no-refresh parse behavior, scoping, penalized reasons and truncation verified; 5 tests passing

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K7-008
- **Risk:** 🟢
- **Files:** `plugin/kevin_facts.ts`, `plugin/index.ts`, `tests/integration/kevin_facts.test.ts`
- **Description:**
  1. Implement the shape of plan §5.7: `{ project_id, scanned_at, truncated, facts[], penalized[] }`.
  2. `refresh: true` forces a re-scan, bypassing the `mtime` skip — the escape hatch for a user
     who just edited `package.json` mid-session. `refresh: false` (default) reads stored facts.
  3. `penalized[]` lists each de-ranked memory with its `truth_penalty`, `contradicted_at` and the
     human-readable `reasons`. This is the user-facing answer to "why did Kevin stop suggesting
     that?", and it is the reason de-ranking is recoverable where a `status` write would not be.
  4. Register in `plugin/index.ts` (16 → 17 tools).
  5. Read-only apart from the optional re-scan. No LLM, no network.
- **Acceptance criteria:**
  - Default invocation performs no `JSON.parse` (spy asserted); `refresh: true` performs exactly
     two.
  - `truncated` is `true` and reports the count when a `_truncated` row exists.
  - `facts` are scoped to the current project; a second project's facts never appear.
  - `penalized` lists only memories with `truth_penalty > 0` and includes their reasons.
  - `kevin_status` reports 17 tools after this task.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/kevin_facts.test.ts`

---

# Phase F2 — Convention mining (the project's history states its own rules)

`PatternMiner` already exists, ships off, and mines the wrong thing: it describes traffic. This
phase mines the same `tool_calls` table for something a human would actually write down —
"route files come with route tests" — and routes the result through the v0.6.0 approval gate as
an ordinary candidate with no privileged status.

Two constraints. **No new `origin` value** (D7-09): `memories.origin` carries a CHECK constraint,
SQLite cannot alter one, and widening it forces a full `memories` rebuild with FTS5 trigger
drop/recreate — an unacceptable risk for a label, when `pattern` already means exactly
"derived deterministically from observed behaviour" and already carries the right boost. And
**fingerprints derive from the normalized statement** (D7-11), which makes a mined rule
caller-supplied in the sense Principle 26 requires, and gives idempotent refresh for free through
the existing `save()` supersede path.

### K7-010 — `ConventionMiner` — `sequence` miner

**Status:** `[X]` Done — `ConventionMiner.ts` created; successful-call 2/3-grams with distinct-session support, deterministic order; 6 tests passing

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K7-001
- **Risk:** 🟢
- **Files:** `plugin/ConventionMiner.ts`, `tests/unit/convention_miner_sequence.test.ts`
- **Description:**
  1. Create `plugin/ConventionMiner.ts` with the interface of plan §5.4.
  2. `sequence` mines over **successful** `tool_calls` only (`success = 1`), scoped to
     `project_id`, ordered by `ts`, grouped by `session_id`. Find 2-grams and 3-grams of
     `(tool, normalized first argument path segment)` occurring in at least `minSupport`
     **distinct sessions** (default 5).
  3. Deliberately reuse the existing `PatternMiner` n-gram approach — same grouping, same
     distinct-session counting, same default threshold — but over successes, and emitting a rule
     rather than a traffic description. Keeping the threshold identical is what makes the two
     miners' output directly comparable during evaluation.
  4. Deterministic: no `Math.random`, no clock, no `Object.keys` ordering dependence. Ties are
     broken lexicographically.
  5. **Support counts distinct sessions, never occurrences.** A single session that repeats a
     2-gram forty times has support 1. Counting occurrences would let one pathological session
     manufacture a project-wide convention.
- **Acceptance criteria:**
  - A fixture with a 2-gram in 5 distinct sessions yields it; the same 2-gram in 4 sessions does
     not.
  - A 2-gram appearing 40 times in a single session has support 1 and is not emitted.
  - Failed tool calls (`success = 0`) are excluded — asserted with a fixture whose only
     qualifying sequence is made of failures.
  - Calls from another `project_id` never contribute support.
  - 3-grams are found in addition to 2-grams, and a 3-gram is not double-counted as two 2-grams
     in a way that inflates support.
  - Ten consecutive runs over the same fixture return identical results in identical order.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/convention_miner_sequence.test.ts`

### K7-011 — `ConventionMiner` — `co_edit` miner

**Status:** `[X]` Done — cross-prefix co-edit mining, distinct-session support, bounded pair enumeration; 5 tests passing

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K7-010
- **Risk:** 🟢
- **Files:** `plugin/ConventionMiner.ts`, `tests/unit/convention_miner_coedit.test.ts`
- **Description:**
  1. Mine file pairs edited or written in the same session, in at least `minSupport` distinct
     sessions, **where the pair spans two different directory prefixes**.
  2. The different-prefix requirement is what makes the output a convention rather than a truism.
     Two files in the same directory being edited together says nothing — that is what a
     directory *is*. `src/routes/user.ts` and `tests/routes/user.test.ts` edited together in six
     separate sessions is the project's testing convention, stated by its own history. This is
     the miner that produces "route files come with route tests", which is the single most
     valuable output this release can generate.
  3. Statements are rendered from the directory prefixes, not from the specific filenames, so the
     rule generalizes: "every new file under `src/routes/` is accompanied by a test under
     `tests/routes/`".
  4. Pair ordering is normalized (lexicographic) so `(a, b)` and `(b, a)` are the same pair.
- **Acceptance criteria:**
  - A same-directory pair in 10 distinct sessions is **not** emitted.
  - A cross-prefix pair in 5 distinct sessions is emitted; the same pair in 4 is not.
  - `(a, b)` and `(b, a)` accumulate support into a single convention.
  - The emitted statement names directory prefixes, not individual filenames, and is identical
     across runs.
  - Sessions from another project contribute nothing.
  - A session touching 50 files does not produce 1225 pairs above threshold — assert the pair
     enumeration is bounded and does not blow up combinatorially on a large session.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/convention_miner_coedit.test.ts`

### K7-012 — Rule emission (`type='rule'`, `origin='pattern'`)

**Status:** `[X]` Done — `emit()` creates `rule`/`pattern`/`project` memories; origin CHECK unchanged; idempotent via supersede; 4 tests passing

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K7-011
- **Risk:** 🟡
- **Files:** `plugin/ConventionMiner.ts`, `tests/integration/convention_emission.test.ts`
- **Description:**
  1. `emit(conventions)` creates memories with `type='rule'`, `origin='pattern'`, `inferable=0`,
     `scope='project'`, `projectId` = the current project, and `fingerprint` derived from the
     **normalized statement text** (D7-11).
  2. **Do not add a new `origin` value.** Re-read D7-09 before touching the CHECK constraint.
  3. Because the fingerprint is derived from the statement, a re-mine of an unchanged convention
     collides on fingerprint and takes the existing `save()` supersede path — idempotent refresh
     for free, with no new code.
  4. `emit()` returns the number of memories created or refreshed and increments
     `conventions_mined`.
  5. Runs on `session.idle` only, behind `convention_mining_enabled` (default `'0'`), in its own
     `try`/`catch`. It scans the whole of `tool_calls` for the project; that is emphatically not
     hot-path work (D7-10).
- **Acceptance criteria:**
  - Emitted memories carry exactly `type='rule'`, `origin='pattern'`, `inferable=0`,
     `scope='project'`.
  - `memories.origin`'s CHECK constraint is unchanged — asserted by reading the table DDL from
     `sqlite_master` and comparing to the v0.6.0 string.
  - Re-mining an unchanged convention produces no duplicate row; the count is stable across three
     mine/emit cycles.
  - Changing the statement produces a new fingerprint and supersedes the old memory rather than
     orphaning it.
  - With `convention_mining_enabled = '0'`, `session.idle` calls neither `mine()` nor `emit()`.
  - A throwing miner does not prevent the rest of the `session.idle` chain from completing.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/convention_emission.test.ts`

### K7-013 — `Curator` hand-off + whole-file de-duplication

**Status:** `[X]` Done — mined rules flow into `Curator` as ordinary candidates; `propose()` de-duplicates against the whole file (normalized tokens); no auto-publish; 4 tests + v0.6.0 single-write-path passing

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K7-012
- **Risk:** 🟡
- **Files:** `plugin/Curator.ts`, `tests/integration/curator_conventions.test.ts`
- **Description:**
  1. Mined rules flow into the v0.6.0 `Curator` as **ordinary candidates**: no special path, no
     privileged status, the same human approval gate as every other proposal. A miner that could
     publish without review would undo the entire safety model of v0.6.0.
  2. Extend the `Curator` to de-duplicate against the **whole** of the target file, not just the
     region between Kevin's markers. A convention the user already wrote in their own words, in
     their own section, must not be proposed back to them — that is the fastest way to teach
     someone that Kevin's proposals are not worth reading.
  3. De-duplication is over normalized statement tokens, not exact string equality, but it uses
     the same normalization as the fingerprint — no new similarity metric is introduced.
  4. Mined rules are subject to the existing D6-09 predicate like any other memory: they must
     clear the confidence floor and the evidence-or-feedback disjunction.
- **Acceptance criteria:**
  - A mined rule appears in `Curator.candidates()` only when it satisfies the full v0.6.0
     predicate.
  - A statement already present **outside** Kevin's markers is excluded from candidates.
  - A statement present **inside** Kevin's markers is still excluded (the existing `curated = 0`
     clause), and the two exclusions are tested separately so a regression in one is visible.
  - No code path publishes a mined rule without a `curation_proposals` row and an explicit
     approval.
  - The single-write-path test from v0.6.0 (`tests/unit/single_write_path.test.ts`) still finds
     exactly one `ArtifactWriter.apply()` call site.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/curator_conventions.test.ts tests/unit/single_write_path.test.ts`

---

# Phase F3 — Conflict surfacing (supersession exists; contradiction does not)

Kevin can already express "B replaced A". It has never been able to express "A and B cannot both
be true". That gap is why a stale decision and a current one sit side by side in the same
retrieval with no signal distinguishing them.

The whole phase is built on one rule: **surfacing is automatic, resolution is human** (D7-06).
The same reasoning rejected auto-resolution in v0.5.0 §4 and lists it as a permanent non-goal in
the roadmap. A destructive heuristic with no undo is worse than an unresolved conflict a human
can see, because the human can act on what they can see.

### K7-014 — `ConflictDetector` — three detectors

**Status:** `[X]` Done — exact polarity pairs, repo-truth inputs, strict temporal detector, acknowledgment and conflict deduplication; 11 tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K7-007
- **Risk:** 🟡
- **Files:** `plugin/ConflictDetector.ts`, `tests/unit/conflict_detector.test.ts`
- **Description:**
  1. Create `plugin/ConflictDetector.ts` with the interface of plan §5.5. Three detectors, three
     completely different evidence bases:
  2. **`repo_truth`** — produced by `RepoTruth.contradictions()`. Exact-match, one memory, one
     fact, recorded with `fact_id` set.
  3. **`decision_pair`** — two `active` memories of type `decision` or `rule`, same `project_id`,
     whose caller-supplied fingerprints differ but whose normalized statements carry opposite
     polarity from the **explicit lexicon** of plan §5.5 (`use`/`never use`, `always`/`never`,
     `required`/`forbidden`, `enable`/`disable`, `prefer`/`avoid`). Matching is exact-token over
     the normalized statement — **never fuzzy similarity, never edit distance, never fingerprint
     prefixes** (Principle 26, D7-07). Edit distance would pair "always run tests" with "always
     run test" and miss "use pnpm" versus "never use pnpm", which is exactly backwards.
     Additionally, both statements must share at least one non-stop-word subject token, otherwise
     "always run the tests" and "never use `any`" would pair.
  4. **`temporal`** — a single memory whose `kevin_injections` rows contain at least one
     `effective` and at least one `ineffective` outcome, with the `ineffective` more recent. Pure
     SQL over `injected_at` and `outcome`, both already populated and already indexed
     (`idx_injections_outcome`). No new write path, no new column, no heuristic (D7-08).
     Semantically: *this memory used to work and has stopped working*.
  5. `detect()` writes `memory_conflicts` rows and increments `conflicts_detected`. It **never**
     mutates `memories.status` and never calls `resolve()`.
  6. `acknowledge(id)` moves a conflict to `acknowledged` so it stops appearing in the default
     list, **without** expressing an opinion about which memory is right and without touching
     either memory.
- **Acceptance criteria:**
  - Every lexicon entry in plan §5.5 has its own test case, in both polarities.
  - "always run the tests" and "never use `any`" do **not** pair — the shared-subject-token
     requirement is asserted directly.
  - "use pnpm" and "never use pnpm" pair; "always run tests" and "always run test" do **not**.
  - Two memories with the **same** fingerprint never form a `decision_pair` (that is
     supersession, not contradiction).
  - `temporal` fires only when the `ineffective` outcome is strictly more recent than the
     `effective` one; the reverse order produces nothing.
  - Re-running `detect()` does not duplicate an existing open conflict.
  - `SELECT COUNT(*) FROM memories WHERE status <> 'active'` is unchanged after `detect()`.
- **Status notes:** release audit: lexicon phrases are now tokenized through the same `tokens()` as the text, so `don't use` (→ `["don","t","use"]`) is reachable instead of dead — `POLARITY_WORDS` carries `don`/`t` so subjects() never leaks them. Test cases added for every plan §5.5 entry in both polarities, including `do not use`, `don't use` and `not required` (15 tests). D7-03 recovery pass added to `detectRepoTruth` (production path only): a lapsed contradiction lifts the penalty via `applyTruthPenalty(id, 0)`, which also clears `contradicted_at` and decrements `memories_contradicted`.
- **Verification:** `npx vitest run tests/unit/conflict_detector.test.ts`

### K7-015 — `kevin_conflicts` tool + `conflicts` audit block

**Status:** `[X]` Done — validated resolve/keep guards, acknowledge semantics, project scoping, SQL audit counts and pre-008 degradation; 5 tests passing

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K7-014
- **Risk:** 🟡
- **Files:** `plugin/kevin_conflicts.ts`, `plugin/kevin_audit.ts`, `plugin/index.ts`,
  `tests/integration/kevin_conflicts.test.ts`
- **Description:**
  1. Implement `kevin_conflicts({ action: "list" | "acknowledge" | "resolve", id?, keep? })` with
     the response shapes of plan §5.7.
  2. `resolve` requires **both** `id` and `keep`, and rejects a `keep` that is not one of that
     conflict's own memories. This is the tool's most important validation: without it, a typo
     resolves a conflict in favour of an unrelated memory and the audit trail records a decision
     nobody made.
  3. This tool is the **sole** caller of `ConflictDetector.resolve()` in the codebase.
  4. Add the `conflicts` block to `kevin_audit`: counts by `kind` and by `status`, pure SQL, with
     the existing `try`/`catch` degradation and `"partial": true` for pre-008 databases.
  5. Register in `plugin/index.ts` (17 → **18** tools).
  6. `list` defaults to open conflicts only; acknowledged ones are available explicitly.
- **Acceptance criteria:**
  - `resolve` without `keep` returns a structured error and changes nothing.
  - `resolve` with a `keep` that is not `memory_a` or `memory_b` returns a structured error and
     changes nothing.
  - `acknowledge` removes a conflict from the default `list` without altering either memory's
     `status` or `truth_penalty`.
  - The `conflicts` audit block's per-`kind` counts sum to the total row count, and likewise for
     per-`status`.
  - Against a pre-008 database, `kevin_audit` returns `"partial": true` and omits the block
     without throwing.
  - `kevin_status` reports 18 tools.
- **Status notes:** release audit: `acknowledge` now verifies the id exists (project-scoped SELECT) and returns `{ error: "not_found", id }` like `resolve`, instead of reporting success for a nonexistent conflict. The `truth` block tests for K7-019 live in this file (8 tests).
- **Verification:** `npx vitest run tests/integration/kevin_conflicts.test.ts`

### K7-016 — Never-auto-resolve guard

**Status:** `[X]` Done — idle detection is isolated/default-off and no idle path reaches acknowledge/resolve; 2 guard tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K7-015
- **Risk:** 🟢
- **Files:** `tests/integration/no_auto_resolve.test.ts`, `plugin/index.ts`
- **Description:**
  1. Wire `conflictDetector.detect()` into `session.idle`, behind `conflict_detection_enabled`
     (default `'0'`), in its own `try`/`catch`, after the convention-mining step.
  2. Add the guard test that makes D7-06 enforceable rather than aspirational:
     - A full `session.idle` cycle executed against a database holding **5 `open` conflicts**
       leaves all 5 rows `open`.
     - The same cycle leaves `SELECT COUNT(*) FROM memories WHERE status <> 'active'` unchanged.
     - A source scan of `plugin/` finds exactly **one** call site of `ConflictDetector.resolve(`,
       in `kevin_conflicts.ts`.
  3. This is the F3 counterpart of v0.6.0's `single_write_path.test.ts`. Both encode the same
     principle in the same way: the dangerous capability exists in exactly one place, and a test
     proves it.
- **Acceptance criteria:**
  - All three assertions above pass.
  - With `conflict_detection_enabled = '0'`, `session.idle` calls no `ConflictDetector` method.
  - A throwing `detect()` does not prevent earlier steps of the `session.idle` chain from having
     completed, and does not reject the hook.
  - No `session.idle` code path references `resolve` or `acknowledge`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/no_auto_resolve.test.ts`

---

# Phase F4 — Reflector rebalance (moving the centre of gravity)

This is the phase that makes the release mean something. Kevin's dispatch table is a catalogue of
commodity knowledge: a `TS2304` lesson tells a modern model something it already knows, and every
one of those lessons occupies budget that project truth could have used.

`triage_only` does not disable the Reflector. It suppresses **only the memory row** — the
`tool_calls` row, the `error_fingerprint` stamp, recurrence detection, `CausalChain` linkage,
`kevin_why`'s ledger and the `metadata.dispatch` classification all keep working exactly as
before (D7-12). Triage without lesson generation is precisely the role the roadmap assigns to the
dispatch table.

The `mix` block is how the release grades itself, which is why it must be **pure SQL**: anyone
holding the database file can reproduce the number without running the plugin. A criterion that
can only be checked by the system it judges is not a criterion (D7-14).

### K7-017 — `error_lesson_mode` setting

**Status:** `[X]` Done — explicit TEXT enum comparison, triage-only suppression for inferable errors and compatibility fallback; 7 tests passing

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K7-003
- **Risk:** 🔴 (a misread of this setting changes behaviour for every installation on upgrade)
- **Files:** `plugin/Reflector.ts`, `tests/unit/reflector_lesson_mode.test.ts`
- **Description:**
  1. Read `error_lesson_mode` **once per reflection** with an explicit `=== "triage_only"`
     comparison.
  2. **Never a truthiness check.** `"0"`, `"all"` and `"false"` are all truthy strings in
     JavaScript; `if (mode)` puts every installation into triage mode on upgrade. This is the
     same class of defect that made `cross_project_enabled` unreachable for an entire minor
     release, inverted — and inverted is worse, because it changes behaviour silently instead of
     failing to.
  3. `'all'` (the default) preserves v0.6.0 behaviour **exactly**: every error produces a lesson,
     subject to the existing throttle and quality gate. Assert this rather than assume it.
  4. In `triage_only`, the branch fires only when `inferability.classify()` returns `inferable`.
     A `non_inferable` or `unknown` error still produces a lesson in both modes — triage mode
     suppresses commodity knowledge, not project knowledge.
- **Acceptance criteria:**
  - `'all'` reproduces v0.6.0 Reflector behaviour on a fixture suite, asserted by comparing the
     full set of created memories against a golden list.
  - `'triage_only'` + an `inferable` error creates **no** memory.
  - `'triage_only'` + a `non_inferable` error creates a memory.
  - `'triage_only'` + an `unknown` classification creates a memory (the conservative direction).
  - Values `"0"`, `"false"`, `"ALL"` and `""` are all treated as **not** `triage_only` — four
     explicit test cases, because this is the single most likely way to ship a silent
     behaviour change.
  - The setting is read once per reflection, not once per memory (spy on the settings read).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/reflector_lesson_mode.test.ts`

### K7-018 — `error_lessons_suppressed` + preserved side effects

**Status:** `[X]` Done — suppression preserves fingerprint linking and increments the metric without saving a memory; 8 tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K7-017
- **Risk:** 🟡
- **Files:** `plugin/Reflector.ts`, `tests/integration/triage_side_effects.test.ts`
- **Description:**
  1. In the suppression branch: record the `tool_call`, fire `onLinkError` to stamp
     `error_fingerprint`, increment `error_lessons_suppressed`, and return **without** calling
     `memoryService.save()`.
  2. The ordering matters: the side effects happen first, the return happens last. An early
     return that skips the fingerprint stamp would break recurrence detection, `CausalChain`
     linkage and `kevin_why` — three features that key on `tool_calls` and `error_fingerprint`,
     not on the memory row.
  3. Suppressing the memory removes the prompt cost without breaking a single downstream
     measurement. That property is the entire justification for the mode, and it is what this
     task's tests exist to prove.
- **Acceptance criteria:**
  - A suppressed `TS2304` failure still writes a `tool_calls` row.
  - The same failure still stamps `error_fingerprint`.
  - Recurrence detection still fires on the second occurrence of a suppressed error.
  - `CausalChain.onSuccess` still links to the suppressed error's fingerprint.
  - `kevin_why` still reports the error in its ledger.
  - `error_lessons_suppressed` increments by exactly 1 per suppression, and by 0 in `'all'` mode.
  - `memoryService.save()` is not called on the suppression path (spy asserted).
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/triage_side_effects.test.ts`

### K7-019 — `kevin_audit` `mix` block (pure SQL)

**Status:** `[X]` Done — pure SQL type mix, maturity floor, zero-denominator handling and per-type precision; 2 tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K7-004
- **Risk:** 🟢
- **Files:** `plugin/kevin_audit.ts`, `tests/integration/kevin_audit_mix.test.ts`, `tests/integration/kevin_conflicts.test.ts`
- **Description:**
  1. Add the `mix` block exactly as shaped in plan §5.6: `injected_by_type`, `injected_total`,
     `non_error_injected`, `non_error_share`, `precision_error`, `precision_non_error`,
     `meets_exit_criterion`.
  2. **Computed in pure SQL**, so anyone holding the database file can reproduce it without
     running the plugin (D7-14). No JavaScript aggregation over rows fetched into memory, and no
     helper in `plugin/metrics.ts` — that would create a second definition of precision which
     will drift from the first.
  3. `meets_exit_criterion` is `true` only when `non_error_share >= 0.5` **and**
     `precision_non_error > precision_error` **and** the maturity floor (≥100 memories, ≥50
     settled injections) is met. Below the floor it is `false` with an explicit
     `"reason": "immature_db"`.
  4. The maturity floor is not decoration: without it, a database with three settled injections
     reports a precision of 1.0 and declares the release a success on noise.
  5. Also add the `truth` block (facts scanned, penalized memory count, truncation flag), pure
     SQL and project-scoped, with the existing `"partial": true` degradation.
- **Acceptance criteria:**
  - `injected_by_type` sums to `injected_total`.
  - `non_error_share` equals `non_error_injected / injected_total`, and is `0` (not `NaN`) when
     the total is zero.
  - `meets_exit_criterion` is `false` with `"reason": "immature_db"` on a database with 99
     memories, regardless of the other two conditions.
  - A fixture satisfying all three conditions reports `true`.
  - A fixture where `precision_non_error === precision_error` reports `false` (strict `>`).
  - The same numbers are reproducible by running the documented SQL directly against the
     database file — asserted by executing the SQL in the test and comparing to the tool output.
  - Against a pre-008 database, `kevin_audit` returns `"partial": true` and omits both blocks.
- **Status notes:** `truth` block (step 5) verified in the release audit: `buildAudit(store, metrics, capabilities, projectId)` — project-scoped COUNT over `repo_facts`, penalized memories, truncation flag from the `_truncated` row; omitted + `"partial": true` on pre-008. Covered by 3 new cases in `kevin_conflicts.test.ts`.
- **Verification:** `npx vitest run tests/integration/kevin_audit_mix.test.ts tests/integration/kevin_conflicts.test.ts`

### K7-020 — Per-type `precision_rate` split

**Status:** `[X]` Done — error/non-error settled partition remains SQL-local and global precision is unchanged; covered by mix tests

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K7-019
- **Risk:** 🟢
- **Files:** `plugin/kevin_audit.ts`, `tests/integration/precision_split.test.ts`
- **Description:**
  1. Split `precision_rate` by `error` versus non-`error` memory type, over settled injections
     only, using the same `effective` / `ineffective` definition the global `precisionRate()`
     uses. The split must be a **partition**: every settled injection counts in exactly one side.
  2. Do not change the global `precisionRate()` definition. This release is judged by the
     comparison between the two halves; moving the definition of the whole in the same release
     would make the comparison meaningless.
  3. `unknown`-outcome injections are excluded from both sides, exactly as they are excluded from
     the global rate.
  4. This number is the release's thesis stated as a measurement: if project knowledge is more
     valuable than error lessons, `precision_non_error` must exceed `precision_error`. If it does
     not, the roadmap's kill criterion for this release fires and the thesis is wrong — which is
     a legitimate outcome, and the reason the number is computed rather than assumed.
- **Acceptance criteria:**
  - `precision_error` and `precision_non_error` each match a hand-computed value on a fixture of
     20 settled injections.
  - The two populations partition the settled set: their denominators sum to the global
     denominator.
  - `unknown` outcomes are excluded from both.
  - A zero-denominator side reports `0`, not `NaN`, and does not make `meets_exit_criterion`
     true by accident.
  - The global `precisionRate()` returns the same value as in v0.6.0 for the same fixture.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/precision_split.test.ts`

---

# Phase F5 — Release

The closed-loop test proves the components compose. The exit-criterion harness proves the release
was worth shipping — and is allowed to conclude that it was not.

### K7-021 — `kevin_status` + README + CHANGELOG + `AGENTS.md`

**Status:** `[X]` Done — version/docs/status surface updated and tested

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K7-015, K7-020
- **Risk:** 🟢
- **Files:** `README.md`, `CHANGELOG.md`, `AGENTS.md`, `package.json`,
  `plugin/kevin_status.ts`, `tests/unit/kevin_status_v07.test.ts`
- **Description:**
  1. Bump `package.json` to `0.7.0`.
  2. CHANGELOG: two new tools, migration 008, two new tables, two new `memories` columns, five
     metric keys, four settings. Under **"Behaviour changes"**, state plainly that defaults
     preserve v0.6.0 behaviour exactly: `truth_penalty` starts at `0.0` (ranking factor exactly
     `1.0`), `error_lesson_mode` starts at `'all'`, and all three feature flags start at `'0'`.
     A release that changes nothing until asked should say so loudly.
  3. README: document `error_lesson_mode` and its trade-off, `kevin_facts`, `kevin_conflicts`,
     and the fact that contradiction **de-ranks and never deletes**.
  4. Update the `AGENTS.md` architecture line for the new module count.
  5. Extend `kevin_status`: 18 tools, schema `008`, facts scanned, open conflicts, penalized
     memory count, `error_lesson_mode`.
- **Acceptance criteria:**
  - `package.json` reads `0.7.0`; `kevin_status` reports 18 tools and schema `008`.
  - CHANGELOG has a "Behaviour changes" section stating the no-op-by-default property.
  - README documents that no memory is ever deleted or archived by contradiction.
  - `AGENTS.md` module count matches the actual file count under `plugin/`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_status_v07.test.ts`

### K7-022 — Closed-loop e2e for v0.7 semantics

**Status:** `[X]` Done — regression e2e plus v0.7 truth/conflict/triage composition verified

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K7-016, K7-018, K7-020
- **Risk:** 🟡
- **Files:** `tests/e2e/v07_closed_loop.test.ts`
- **Description:**
  Drive the full loop against two temp fixture projects and an in-memory database:
  1. Scan fixture project A; assert facts are stored under A's `project_id`.
  2. Scan fixture project B with a conflicting `packageManager`; assert both projects' facts
     coexist and neither overwrote the other.
  3. Save a memory in A referencing `npm run lint`; assert no contradiction while `scripts.lint`
     exists.
  4. Remove `scripts.lint` from A's `package.json`, re-scan; assert exactly one contradiction,
     one `memory_conflicts` row with `kind='repo_truth'`, a `truth_penalty` in `(0, 0.5]`, and
     `contradicted_at` set.
  5. Assert `SELECT COUNT(*) FROM memories WHERE status <> 'active'` is unchanged from step 0.
  6. Assert the memory's rank moved toward worse but it is still retrievable.
  7. Run a full `session.idle` cycle with 5 open conflicts present; assert all 5 remain `open`.
  8. `kevin_conflicts` with `resolve` and a valid `keep`; assert the row becomes `resolved` and
     neither memory's `status` changed.
  9. Set `error_lesson_mode = 'triage_only'`; trigger a `TS2304` failure; assert no memory, but
     a `tool_calls` row, an `error_fingerprint`, and `error_lessons_suppressed` incremented by 1.
  10. Assert `kevin_audit.mix` is present and internally consistent.
- **Acceptance criteria:**
  - All ten steps pass in one file with no mock of `RepoTruth` or `ConflictDetector`.
  - Both fixture projects are created under `mkdtempSync` and removed in cleanup; the test never
     points `RepoTruth` at the repository root.
  - Total runtime under 15 seconds.
- **Status notes:** —
- **Verification:** `npx vitest run tests/e2e/v07_closed_loop.test.ts`

### K7-023 — Exit-criterion measurement harness

**Status:** `[X]` Done — readonly `measure:mix` script prints SQL-derived verdict and exits non-zero when unmet

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** K7-019, K7-020
- **Risk:** 🟢
- **Files:** `scripts/measure-mix.ts`, `package.json`, `docs/Kevin_v0.7.0_Plan.md`,
  `tests/unit/measure_mix.test.ts`
- **Description:**
  1. Add `npm run measure:mix`, a script that opens a database file, runs the documented `mix`
     SQL, and prints the block plus a verdict line.
  2. It must run **against a database file alone**, with no plugin instance and no host — that is
     the operational meaning of D7-14.
  3. Record the release's measured values in plan §14 when the release is tagged, including the
     case where the criterion is **not** met. A roadmap kill criterion that is quietly skipped
     when the number is inconvenient is not a kill criterion, and the honest outcome of this
     release may be that error lessons were more valuable than project knowledge — in which case
     v0.8.0's premise needs revisiting before it is built.
  4. The script is read-only: it opens the database without migrating it and never writes.
- **Acceptance criteria:**
  - `npm run measure:mix -- <path>` prints the full `mix` block and a one-line verdict.
  - Output for a fixture database matches `kevin_audit.mix` exactly, field for field.
  - The script exits non-zero when `meets_exit_criterion` is `false`, so CI can gate on it.
  - Running it against a pre-008 database exits with a clear message rather than a stack trace.
  - The database file's `mtime` is unchanged after the script runs.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/measure_mix.test.ts`

### K7-024 — Final verification

**Status:** `[X]` Done — bug audit found and fixed additional integration defects; all four release gates pass (`typecheck`, `lint`, `test` 121 files / 940 tests, `verify` 9/9); global Biome baseline drift resolved via `.gitattributes` (`* text=auto eol=lf`) + line-ending normalization + `noForEach`/`organizeImports` fixes; all six release-specific checks covered by passing tests

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K7-021, K7-022, K7-023
- **Risk:** 🟢
- **Files:** —
- **Description:**
  Run the four release gates plus the six release-specific checks of plan §11. Do not tag until
  every one is green.
- **Acceptance criteria:**
  - `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify` all exit 0.
  - `Migrate.run()` twice on a fresh DB reports `applied: []` on the second run.
  - Two fixture projects with conflicting `packageManager` values coexist; each
     `contradictions()` call sees only its own project's facts.
  - A full `session.idle` cycle against 5 `open` conflicts leaves all 5 `open` and leaves
     `SELECT COUNT(*) FROM memories WHERE status <> 'active'` unchanged.
  - `rankScore` with `truth_penalty = 0` reproduces the v0.6.0 ordering exactly, asserted as an
     id-sequence equality against a golden array.
  - `error_lesson_mode='triage_only'` suppresses the lesson for a `TS2304` failure while writing
     the `tool_calls` row, stamping `error_fingerprint`, and incrementing
     `error_lessons_suppressed` by exactly 1.
  - `kevin_config set` succeeds for all four new keys and each is readable back.
  - The measured `mix` block is recorded in plan §14, whatever it says.
- **Status notes:** —
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 3. Implementation order

```
F0  K7-001 → K7-002 → K7-003 → K7-004
F1  K7-005 → K7-006 → K7-007 → K7-008 → K7-009
F2  K7-010 → K7-011 → K7-012 → K7-013     ┐ parallelizable after K7-001
F3  K7-014 → K7-015 → K7-016              ┘ K7-014 additionally needs K7-007
F4  K7-017 → K7-018 → K7-019 → K7-020     ┐ parallelizable after K7-003 / K7-004
F5  K7-021 → K7-022 → K7-023 → K7-024
```

**Critical path:** K7-001 → K7-005 → K7-007 → K7-008 → K7-017 → K7-019 → K7-022 → K7-024.

**Suggested milestones.** After K7-008 the truth pipeline is complete and de-ranking is provably
non-destructive — the right point for the release's mandatory code review, since it is the only
phase that touches ranking. After K7-020 the release can grade itself, which means it can be
evaluated even if F2 slips; convention mining is default-off and cutting it costs no promised
functionality.

---

## 4. Traps to avoid

| # | Trap | Consequence | Guard |
|---|---|---|---|
| 1 | `if (mode)` instead of `mode === "triage_only"` | `"0"`, `"all"` and `"false"` are all truthy strings, so **every** installation silently enters triage mode on upgrade. | Explicit string equality (K7-017), with four negative test cases. |
| 2 | `UNIQUE(file, key_path)` without `project_id` | Project B's scan overwrites project A's facts; A's memories are then de-ranked against B's repository. Intermittent, silent, extremely hard to diagnose. | `uq_repo_facts(project_id, file, key_path)` (K7-001) plus a two-project test. |
| 3 | An unscoped `SELECT ... FROM repo_facts` | Same failure as trap 2, reintroduced by a future convenience query. | The source-scan test in K7-006. |
| 4 | Writing `memories.status` on contradiction | Retrieval filters `status='active'`, so this is an undoable deletion from every future prompt, with no notification. | Principle 24, D7-03; the `status <> 'active'` count assertion appears in K7-008, K7-014, K7-016 and K7-024. |
| 5 | An unclamped or unbounded `truth_penalty` | One false positive buries a correct memory behind the entire corpus. | Clamp to `[0, 0.5]` (K7-008). |
| 6 | Getting the ranking sign backwards | `rankScore` is **negative** for BM25 rows; scaling the wrong way **promotes** contradicted memories, and every other test still passes. | K7-008 asserts the direction explicitly, not the magnitude. |
| 7 | Applying the penalty anywhere but last in the chain | Entangles a ranking change with a semantics change; the v0.6.0 ordering is no longer reproducible. | Trailing factor, exactly `1.0` at default, golden-array assertion (D7-04). |
| 8 | Substring or fuzzy contradiction matching | A memory that merely mentions a word becomes "contradicted"; de-ranking fires on noise. | Exact-match, three checks only (D7-05, K7-007). |
| 9 | Edit distance or fingerprint prefixes for `decision_pair` | Pairs "always run tests" with "always run test" and misses "use pnpm" vs "never use pnpm" — exactly backwards. | Explicit negation lexicon over normalized tokens (D7-07, K7-014). |
| 10 | Omitting the shared-subject-token requirement | "always run the tests" pairs with "never use `any`". | Asserted directly in K7-014. |
| 11 | Widening the `memories.origin` CHECK constraint | SQLite cannot alter one; it forces a full `memories` rebuild with FTS5 trigger drop/recreate, as migration 004 had to do — for a label. | `origin='pattern'` (D7-09); K7-012 asserts the DDL is unchanged. |
| 12 | Silent truncation of the fact scan | Every dropped fact becomes a false contradiction for every memory that mentions it. | The recorded `_truncated` row (D7-13, K7-005). |
| 13 | Counting occurrences instead of distinct sessions | One pathological session manufactures a project-wide convention. | Distinct-session support, asserted in K7-010. |
| 14 | Mining same-directory co-edit pairs | Produces truisms; two files in a directory being edited together is what a directory *is*. | Different-prefix requirement (K7-011). |
| 15 | Letting mined rules bypass the approval gate | Undoes the entire v0.6.0 safety model in the release that follows it. | Ordinary candidates, same predicate, same gate (K7-013). |
| 16 | De-duplicating only inside Kevin's markers | Kevin proposes back a convention the user already wrote in their own words. | Whole-file de-duplication (K7-013). |
| 17 | Any `session.idle` path reaching `resolve()` | A destructive heuristic with no undo — the exact thing v0.5.0 §4 rejected and the roadmap lists as a permanent non-goal. | Single-call-site scan + the 5-open-conflicts test (K7-016). |
| 18 | An early return that skips the fingerprint stamp | Breaks recurrence detection, `CausalChain` linkage and `kevin_why` — three features that key on `tool_calls`, not on the memory row. | Side effects first, return last (K7-018). |
| 19 | Computing the `mix` block in JavaScript | The exit criterion becomes checkable only by the system it judges. | Pure SQL, reproducible from the file alone (D7-14, K7-019, K7-023). |
| 20 | A second definition of precision in `metrics.ts` | The two definitions drift and the release's headline comparison stops meaning anything. | The split lives in `kevin_audit` as SQL; K7-004 asserts no helper is exported. |
| 21 | Omitting the maturity floor | A database with three settled injections reports precision 1.0 and declares success on noise. | ≥100 memories, ≥50 settled injections, `"reason": "immature_db"` (K7-019). |
| 22 | Reporting `NaN` for a zero denominator | Propagates through the audit output and can make `meets_exit_criterion` true by accident. | Explicit zero, asserted in K7-019 and K7-020. |
| 23 | Adding a TOML or YAML parser | A memory plugin acquiring a runtime dependency to read two extra files. | Two JSON files only (D7-01); out of scope until measured. |
| 24 | Pointing `RepoTruth` at the repository root in a test | The test extracts Kevin's own `package.json` and starts failing the day someone adds a script. | `mkdtempSync` fixtures, stated in §2. |
| 25 | Forgetting `KEVIN_CONFIG_KEYS` or `verify-install.ts` | Ships green: the setting is documented, listed, and unchangeable; migration 008 is never exercised by `npm run verify`. | K7-003, plus the derived-key-set test inherited from v0.6.0. |
| 26 | Forgetting `METRIC_KEY_LABELS` | The retrospective prints raw snake_case keys. Seven keys shipped this way in v0.4.0. | K7-004 asserts by iterating `METRIC_KEYS`. |
| 27 | Quietly skipping the exit-criterion measurement | The release grades itself only when the grade is flattering. | K7-023 records the measured value in plan §14 regardless of outcome, and exits non-zero when unmet. |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

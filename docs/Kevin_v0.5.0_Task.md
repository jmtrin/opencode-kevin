# Opencode-kevin — Task List v0.5.0

**Version:** 0.5.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** `docs/Kevin_v0.5.0_Plan.md`
**ID Convention:** `K5-XXX` ("Glass Box") · Decisions referenced as `D5-NN`
**Total tasks:** 24
**Author:** Opus-5 (xHigh)

---

## Status Legend

| Marker | Meaning | When to set |
|---|---|---|
| `[X]` | Pending | Not started. |
| `[~]` | In progress | Work has begun; code exists but acceptance criteria are not all met. |
| `[P]` | Partial | Some acceptance criteria met, some deliberately postponed. Record what and why in **Status notes**. |
| `[!]` | Blocked | Cannot proceed. Record the blocker in **Status notes**. |
| `[X]` | Done | All acceptance criteria met **and** the verification command passes. |

Example:

```markdown
### K5-001 — Draft migration 006

**Status:** `[X]` Done — file created, 9 tests passing
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K5-001 | F0 | Draft migration `006_v05_glassbox.sql` | P0 | S (3h) | `[X]` |
| K5-002 | F0 | Post-apply hook `"006"` in `Migrate.ts` | P0 | S (1h) | `[X]` |
| K5-003 | F0 | `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts` | P0 | S (1h) | `[X]` |
| K5-004 | F0 | Expand `METRIC_KEYS`; `precisionRate` / `coverageRate` | P0 | S (2h) | `[X]` |
| K5-005 | F1 | Three-way settlement in `InjectionLedger` | P0 | M (5h) | `[X]` |
| K5-006 | F1 | `GateVerdict` + `canInjectVerdict` in `QualityGate` | P0 | S (2h) | `[X]` |
| K5-007 | F1 | Wire `injections_blocked_*` counters in `ContextInjector` | P0 | S (2h) | `[X]` |
| K5-008 | F1 | Injectable clock + `deterministic_retrieval` | P1 | M (4h) | `[X]` |
| K5-009 | F2 | `plugin/Feedback.ts` component | P1 | M (4h) | `[X]` |
| K5-010 | F2 | Feedback terms in `computeConfidence` | P1 | S (2h) | `[X]` |
| K5-011 | F2 | `kevin_feedback` tool | P1 | S (2h) | `[X]` |
| K5-012 | F3 | `plugin/Archiver.ts` — `stale → archived` | P1 | S (3h) | `[X]` |
| K5-013 | F3 | Populate `superseded_by` in `MemoryService.save()` | P1 | S (2h) | `[X]` |
| K5-014 | F4 | Decompose `ContextInjector`; add `plan()` | P0 | M (6h) | `[X]` |
| K5-015 | F4 | `kevin_trace` tool (strict dry run) | P0 | M (4h) | `[X]` |
| K5-016 | F4 | `kevin_audit` tool | P1 | M (4h) | `[X]` |
| K5-017 | F4 | Configurable pre-prompt budget (1500 → 900) | P1 | S (2h) | `[X]` |
| K5-018 | F5 | Replay transcript format + fixture | P2 | S (3h) | `[X]` |
| K5-019 | F5 | `plugin/replay.ts` replayer | P2 | M (5h) | `[X]` |
| K5-020 | F5 | Replay report + `npm run replay` | P2 | S (2h) | `[X]` |
| K5-021 | F6 | Extend `kevin_status` with v0.5 fields | P1 | S (2h) | `[X]` |
| K5-022 | F6 | README + CHANGELOG + `AGENTS.md` | P1 | S (3h) | `[X]` |
| K5-023 | F6 | Closed-loop e2e for v0.5 semantics | P0 | M (5h) | `[X]` |
| K5-024 | F6 | Final verification | P0 | S (2h) | `[X]` |

**Phase totals:** F0 4 · F1 4 · F2 3 · F3 2 · F4 4 · F5 3 · F6 4 — **24 total**

**Done:** 24/24 **In progress:** 0 **Blocked:** 0

**Critical path:** K5-001 → K5-002 → K5-004 → K5-005 → K5-014 → K5-015 → K5-023 → K5-024.

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h.

**Dependencies.** A task may not start until every task listed in its `Dependencies` field is `[X]`.

**Risk.** 🟢 low (additive, isolated) · 🟡 medium (touches shared code paths) · 🔴 high (destructive or schema-rebuilding).

**Verification.** Every task ends with a runnable command. Copy it verbatim. If it does not pass, the task is not done.

**Files.** All paths are relative to the repository root `C:\Misc\opencode-kevin`.

**Style.**
- TypeScript strict mode. No `any`. No non-null assertions on values read from SQLite.
- ESM. **All relative imports carry a `.js` extension**, e.g. `import { Store } from "./Store.js";`
- Biome formatting: `npm run format` before committing.
- Code comments that implement a plan decision cite it: `// v0.5.0 (K5-005 / plan §5.1, D5-01)`.

**Database access in tests.** Always `new Store({ path: ":memory:" })` followed by
`await new Migrate(store, migrationsDir).run()`. Never write to `~/.opencode-kevin/`.
Resolve `migrationsDir` the same way the existing tests do.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. Compare with `=== "1"` or parse with `Number(...)`.
   Never `=== 1`. A `=== 1` comparison made `cross_project_enabled` unreachable for an entire
   minor release.
2. `ALTER TABLE ... ADD COLUMN` is **not** idempotent. Idempotency comes from `schema_version`.
   The correct acceptance criterion is always "applying via `Migrate.run()` twice is a no-op".
3. SQLite cannot alter a CHECK constraint. Widening one requires a table rebuild.
4. `Store` sets `PRAGMA foreign_keys = ON`. Do not add `REFERENCES` clauses casually.

**Hot path.** No LLM calls, no network, no filesystem scans in `tool.execute.*`,
`chat.message`, `experimental.chat.system.transform` or `experimental.session.compacting`.

**Backwards compatibility.** Do not change an existing exported function signature unless a task
says to. Where a signature must grow, add optional parameters with defaults that reproduce the
v0.4.0 behaviour exactly.

---

# Phase F0 — Substrate (schema, migration plumbing, metric keys)

Nothing else can be built until the columns exist and the migration chain accepts them. Every
task in this phase is additive and none of them changes runtime behaviour.

### K5-001 — Draft migration `006_v05_glassbox.sql`

**Status:** `[X]` Done — `migrations/006_v05_glassbox.sql` created per plan §6 verbatim; 8 tests in `tests/unit/migrate_006.test.ts` passing (apply, idempotency, columns, outcome CHECK, effective→inconclusive remap with zero row loss, settings seeds, feedback table, metric seeds).

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🔴 (rebuilds `kevin_injections`)
- **Files:** `migrations/006_v05_glassbox.sql`, `tests/unit/migrate_006.test.ts`
- **Description:**
  1. Create the file with the exact content given in `docs/Kevin_v0.5.0_Plan.md` §6. Do not
     improvise: the section ordering, the comments and the remap `CASE` expression are all
     load-bearing.
  2. Section 1 rebuilds `kevin_injections` in four steps —
     `CREATE TABLE kevin_injections_new` (with `outcome` CHECK widened to include
     `'inconclusive'`) → `INSERT INTO ... SELECT ... CASE WHEN outcome='effective' THEN
     'inconclusive' ELSE outcome END FROM kevin_injections` → `DROP TABLE kevin_injections` →
     `ALTER TABLE kevin_injections_new RENAME TO kevin_injections` → recreate the three indexes
     `idx_injections_fp`, `idx_injections_session`, `idx_injections_outcome`.
     `kevin_injections` has **no** FTS5 triggers, so unlike migration 004 there is nothing else
     to drop or recreate.
  3. Section 2 creates `memory_feedback` plus `idx_feedback_memory` and `idx_feedback_created`.
  4. Section 3 adds five columns to `memories`: `feedback_positive INTEGER NOT NULL DEFAULT 0`,
     `feedback_negative INTEGER NOT NULL DEFAULT 0`, `ignored INTEGER NOT NULL DEFAULT 0`,
     `superseded_by TEXT`, `archived_at TEXT`; plus `idx_memories_ignored` and
     `idx_memories_archived`.
  5. Section 4 seeds the nine new `kevin_metrics` keys with `INSERT OR IGNORE`.
  6. Section 5 seeds three `kevin_settings` rows with `INSERT OR IGNORE`:
     `deterministic_retrieval='0'`, `pre_prompt_budget_tokens='900'`, `archive_after_days='30'`.
  7. Section 6 is `INSERT OR IGNORE INTO schema_version (version) VALUES ('006');`.
  8. Follow the house banner style of `005_v04_signal.sql`: a boxed comment header, then
     numbered sections each preceded by a prose rationale comment.
- **Acceptance criteria:**
  - `new Migrate(store, migrationsDir).run()` on a fresh in-memory DB reports `to: "006"`.
  - Calling `run()` a second time returns `applied: []`.
  - `PRAGMA table_info(memories)` contains all five new columns with the stated types and defaults.
  - Inserting a `kevin_injections` row with `outcome='inconclusive'` succeeds.
  - Inserting a `kevin_injections` row with `outcome='bogus'` throws.
  - Given a DB pre-seeded at version `005` with three `kevin_injections` rows
    (`effective`, `ineffective`, `unmeasured`), after migrating: row count is still 3, the
    `effective` row now reads `inconclusive`, and the other two are unchanged.
  - `SELECT COUNT(*) FROM kevin_settings WHERE key IN ('deterministic_retrieval','pre_prompt_budget_tokens','archive_after_days')` returns 3.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/migrate_006.test.ts`

---

### K5-002 — Post-apply hook `"006"` in `Migrate.ts`

**Status:** `[X]` Done — hook added to `DEFAULT_POST_APPLY_HOOKS["006"]` (D5-13, four re-derivation UPDATEs, no INSERTs); 2 tests in `tests/unit/migrate_postapply_006.test.ts` passing (stale counter 99 → re-derived totals; double invocation idempotent).

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K5-001
- **Risk:** 🟢
- **Files:** `plugin/Migrate.ts`, `tests/unit/migrate_postapply_006.test.ts`
- **Description:**
  1. Add a `"006"` entry to `DEFAULT_POST_APPLY_HOOKS`, following the shape of the existing
     `"003"` / `"004"` / `"005"` entries.
  2. The hook executes exactly four statements. Each **re-derives** a counter from
     `kevin_injections` rather than incrementing it, which makes the hook idempotent by
     construction (D5-13):
     ```sql
     UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections)                                WHERE key = 'injections_total';
     UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'effective')    WHERE key = 'injections_effective';
     UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'ineffective')  WHERE key = 'injections_ineffective';
     UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'inconclusive') WHERE key = 'injections_inconclusive';
     ```
  3. Do not add any `INSERT`. The rows are seeded by the migration SQL; if a row is missing the
     `UPDATE` is a harmless no-op.
- **Acceptance criteria:**
  - After migrating a DB pre-seeded at `005` with 5 `effective` + 2 `ineffective` rows and a
     stale `kevin_metrics` value of `injections_effective = 99`, the counters read
     `injections_total = 7`, `injections_effective = 0`, `injections_ineffective = 2`,
     `injections_inconclusive = 5`.
  - Invoking the hook function twice in a row produces identical counter values.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/migrate_postapply_006.test.ts`

---

### K5-003 — `KEVIN_CONFIG_KEYS` + `scripts/verify-install.ts`

**Status:** `[X]` Done — three keys appended to `KEVIN_CONFIG_KEYS`; `scripts/verify-install.ts` now copies 002/006 (6 files, new count check) and exits 0; `tests/unit/plugin-config-keys.test.ts` regex-validates every seeded setting key against `KEVIN_CONFIG_KEYS`.

- **Priority:** P0
- **Estimation:** S (1h)
- **Dependencies:** K5-001
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `scripts/verify-install.ts`, `tests/unit/plugin-config-keys.test.ts`
- **Description:**
  1. Append the three new keys to `KEVIN_CONFIG_KEYS` in `plugin/index.ts`:
     `"deterministic_retrieval"`, `"pre_prompt_budget_tokens"`, `"archive_after_days"`.
     **This is not optional plumbing.** `kevin_config list` reads the table directly and would
     show the keys anyway, but `kevin_config set` validates against this array and would return
     `{ error: "unknown_key" }` — a bug that ships with a green test suite.
  2. `scripts/verify-install.ts` hard-codes the migration filenames it copies. Add
     `006_v05_glassbox.sql` to that list, in order.
  3. Add a unit test that asserts every `kevin_settings` key seeded by any migration file is
     present in `KEVIN_CONFIG_KEYS`. Implement it by reading the `migrations/` directory and
     regex-matching `INSERT OR IGNORE INTO kevin_settings ... VALUES` blocks. This test prevents
     the same omission in every future release.
- **Acceptance criteria:**
  - `kevin_config({ action: "set", key: "deterministic_retrieval", value: "1" })` returns success
    and the value is readable via `kevin_config({ action: "list" })`.
  - The same holds for `pre_prompt_budget_tokens` and `archive_after_days`.
  - The migrations-vs-`KEVIN_CONFIG_KEYS` consistency test passes.
  - `npm run verify` exits 0 and its migration step reports 6 files.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/plugin-config-keys.test.ts && npm run verify`

---

### K5-004 — Expand `METRIC_KEYS`; `precisionRate` / `coverageRate`

**Status:** `[X]` Done — `METRIC_KEYS` now 22 keys in migration-seed order; `precisionRate()` uses the measured denominator (D5-02); `coverageRate()` and `blockedSnapshot()` added. Two v0.4 tests updated to the new semantics (deliberate regression, D5-02): `metrics-v04.test.ts` flush test now counts 2+2 measured, and the snapshot coverage list grew to 22 keys.

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K5-001
- **Risk:** 🟡 (changes the meaning of an existing metric)
- **Files:** `plugin/metrics.ts`, `tests/unit/metrics.test.ts`
- **Description:**
  1. Append nine keys to `METRIC_KEYS`, in the same order as migration 006 seeds them:
     `injections_inconclusive`, `injections_blocked_seen`, `injections_blocked_weak`,
     `injections_blocked_recurrence`, `injections_blocked_stale`, `injections_blocked_ignored`,
     `feedback_positive_total`, `feedback_negative_total`, `memories_archived`.
     Total goes from 13 to 22.
  2. Change `precisionRate()` (D5-02):
     ```ts
     const measured = this.get("injections_effective") + this.get("injections_ineffective");
     return measured === 0 ? 0 : this.get("injections_effective") / measured;
     ```
  3. Add `coverageRate()`:
     ```ts
     const total = this.get("injections_total");
     return total === 0 ? 0 : (this.get("injections_effective") + this.get("injections_ineffective")) / total;
     ```
  4. Add `blockedSnapshot(): Record<string, number>` returning the five `injections_blocked_*`
     values keyed by their short names (`seen`, `weak`, `recurrence`, `stale`, `ignored`).
  5. Leave `estimateTokens`, `incr`, `flush`, `snapshot` and the `unref()`ed timer untouched.
- **Acceptance criteria:**
  - `METRIC_KEYS.length === 22`.
  - `precisionRate()` returns `0` when `effective` and `ineffective` are both `0`, even if
    `injections_total` is large.
  - With `effective=3`, `ineffective=1`, `inconclusive=96`, `total=100`:
    `precisionRate() === 0.75` and `coverageRate() === 0.04`.
  - `snapshot()` includes all 22 keys.
  - `blockedSnapshot()` returns the five keys with numeric values.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/metrics.test.ts`

---

# Phase F1 — Honest measurement

The flagship of the release. After this phase Kevin's self-reported quality numbers mean what
they say. **Expect `precision_rate` to fall sharply on real databases. That is the intended
result, not a regression.**

### K5-005 — Three-way settlement in `InjectionLedger`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K5-001, K5-004
- **Risk:** 🟡
- **Files:** `plugin/InjectionLedger.ts`, `tests/unit/injection-ledger.test.ts`, `tests/integration/ledger-settle-v05.test.ts`
- **Description:**
  1. Widen the exported type:
     `export type InjectionOutcome = "unmeasured" | "effective" | "ineffective" | "inconclusive";`
  2. In `settle(sessionId)`, keep the existing recurrence query **exactly as it is**. Do not
     rewrite it, do not "improve" it. It already handles `COALESCE(error_fingerprint, fingerprint)`,
     the `ts >= injected_at` bound and the `origin_call_id` exemption. Copy its predicate
     verbatim when you build the new query.
  3. Add a second prepared statement, the linked-fix query. It is the mirror of the recurrence
     query with two changes: the success flag is inverted (successful calls instead of failing
     calls), and the fingerprint match is on `fix_for_fingerprint = ?` instead of
     `COALESCE(error_fingerprint, fingerprint) = ?`. Keep the `session_id = ?` filter and the
     `ts >= injected_at` bound. There is no `origin_call_id` exemption for fixes.
     `idx_tool_calls_fix_fp` already exists, so this query is indexed.
  4. Replace the two-way branch with three, in this exact order:
     ```
     if (recurrences >= 1)  → outcome = 'ineffective'   // all existing side effects unchanged
     else if (fixes >= 1)   → outcome = 'effective'     // metrics.incr("injections_effective")
     else                   → outcome = 'inconclusive'  // metrics.incr("injections_inconclusive")
     ```
     The `ineffective` branch keeps every one of its current side effects: the
     `injections_ineffective` increment, `UPDATE memories SET recurrence_count = MAX(recurrence_count, n), last_injected_at = ?`,
     and the `recurrence_count >= 3 → status='stale'` promotion. Do not touch them.
  5. The `effective` and `inconclusive` branches have **no** side effects on `memories`.
  6. Add `outcomeCounts(): Record<InjectionOutcome, number>` — a single grouped
     `SELECT outcome, COUNT(*) FROM kevin_injections GROUP BY outcome`, defaulting missing
     buckets to `0`. `kevin_audit` will consume it.
  7. Add the comment `// v0.5.0 (K5-005 / plan §5.1, D5-01)` above the new branch.
- **Acceptance criteria:**
  - Injection followed by a failing tool call with the same fingerprint → `ineffective`
    (existing behaviour preserved, existing tests still pass).
  - Injection followed by a successful tool call whose `fix_for_fingerprint` equals the injection
    fingerprint, and no failing call → `effective`.
  - Injection followed by neither → `inconclusive`.
  - When a session contains **both** a recurrence and a later linked fix, the outcome is
    `ineffective` — recurrence takes precedence.
  - A fix recorded **before** `injected_at` does not produce `effective`.
  - A fix recorded in a **different** session does not produce `effective`.
  - `settle()` is idempotent: calling it twice does not re-increment any counter.
  - `outcomeCounts()` returns all four keys, zero-filled.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/injection-ledger.test.ts tests/integration/ledger-settle-v05.test.ts`

---

### K5-006 — `GateVerdict` + `canInjectVerdict` in `QualityGate`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/QualityGate.ts`, `tests/unit/quality-gate.test.ts`
- **Description:**
  1. Add the exported type and interface:
     ```ts
     export type GateReason = "ok" | "seen_this_session" | "ignored" | "not_active" | "recurrence" | "weak";
     export interface GateVerdict { readonly allowed: boolean; readonly reason: GateReason; }
     ```
  2. Add `canInjectVerdict(memory, ctx, qualityGateEnabled = true): GateVerdict`. The `memory`
     argument gains one optional field: `ignored?: boolean`.
  3. Branch order — the existing four checks in their existing order, with `ignored` inserted
     second:
     | Order | Condition | Returned reason |
     |---|---|---|
     | 1 | `ctx.seenThisSession.has(memory.id)` | `seen_this_session` |
     | 2 | `memory.ignored === true` | `ignored` |
     | 3 | `memory.status !== undefined && memory.status !== "active"` | `not_active` |
     | 4 | `ctx.recurrenceCount > 0` | `recurrence` |
     | 5 | `!memory.isActionable \|\| memory.strength === "weak"` — **skipped entirely when `qualityGateEnabled === false`** | `weak` |
     | — | otherwise | `{ allowed: true, reason: "ok" }` |
  4. Reduce `canInject` to `canInjectVerdict(memory, ctx, qualityGateEnabled).allowed` (D5-04).
     Its signature must not change; every existing test must keep passing unmodified.
  5. Leave `evaluate`, `rescueErrorType`, `GENERIC_SUGGESTIONS` and `isGenericSuggestion`
     untouched.
- **Acceptance criteria:**
  - Every existing test in `tests/unit/quality-gate.test.ts` passes without edits.
  - Each of the five rejection branches returns `{ allowed: false, reason: <expected> }`.
  - An admissible memory returns `{ allowed: true, reason: "ok" }`.
  - With `qualityGateEnabled = false`, a weak memory returns `{ allowed: true, reason: "ok" }`,
    but an `ignored` memory is still rejected — the debug flag bypasses the quality check only.
  - `canInject(...) === canInjectVerdict(...).allowed` for every branch (assert this explicitly
    with a table-driven test).
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/quality-gate.test.ts`

---

### K5-007 — Wire `injections_blocked_*` counters in `ContextInjector`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K5-004, K5-006
- **Risk:** 🟢
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/context-injector-blocked.test.ts`
- **Description:**
  1. In `admit()`, replace the `QualityGate.canInject(...)` call with `canInjectVerdict(...)`.
  2. When `verdict.allowed === false`, increment the matching counter:
     | `reason` | Metric key |
     |---|---|
     | `seen_this_session` | `injections_blocked_seen` |
     | `ignored` | `injections_blocked_ignored` |
     | `not_active` | `injections_blocked_stale` |
     | `recurrence` | `injections_blocked_recurrence` |
     | `weak` | `injections_blocked_weak` |
  3. Implement the mapping as a module-level `const BLOCKED_METRIC: Record<GateReason, string | null>`
     with `ok: null`, so the call site is a single lookup and a null-check. Do not use a switch.
  4. **Do not increment when the caller is in dry-run mode.** K5-014 introduces the `dryRun`
     flag; until then, add the parameter to the private method signature with a default of
     `false` and thread it from `inject()`. A debug tool must never move a counter (D5-08).
  5. Pass `ignored: m.ignored` through to the gate. If `mapRow()` does not yet expose it,
     that is K5-009's job — until then read it defensively as `Boolean((m as { ignored?: number }).ignored)`.
- **Acceptance criteria:**
  - Injecting the same memory twice in one session increments `injections_blocked_seen` by
    exactly 1 on the second attempt.
  - A memory with `status='stale'` increments `injections_blocked_stale`.
  - A memory with `strength='weak'` increments `injections_blocked_weak`.
  - A memory with `ignored=1` increments `injections_blocked_ignored`.
  - With `recurrenceCount > 0` set via `setRecurrences`, `injections_blocked_recurrence` moves.
  - An admitted memory increments none of the five.
  - Calling the private admit path with `dryRun = true` increments none of the five.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/context-injector-blocked.test.ts`

---

### K5-008 — Injectable clock + `deterministic_retrieval`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K5-001
- **Risk:** 🟡 (touches ranking)
- **Files:** `plugin/MemoryService.ts`, `tests/unit/memory-service-deterministic.test.ts`
- **Description:**
  1. Add an optional `now?: Date` to the `getRelevant` options object. Default it to
     `new Date()` at the top of the method and use that single value everywhere age is computed.
     Never call `Date.now()` again inside the method.
  2. Read the setting once per call:
     `const deterministic = this.getSetting("deterministic_retrieval", "0") === "1";`
     Remember: the column is TEXT. Compare against the string.
  3. When `deterministic === true`:
     - `rankScore()` uses a recency decay factor of exactly `1.0`; the age term is ignored
       entirely. Pass the flag down rather than reading the setting inside `rankScore`.
     - `bumpRelevance()` is **not** called, regardless of the `bump` argument.
  4. When `deterministic === false`, behaviour is byte-identical to v0.4.0.
  5. Add `AND ignored = 0` to the retrieval SQL (both `getRelevant` and `queryRelevant`).
     Guard with a column-existence probe only if you find an existing helper for it; otherwise
     rely on migration 006 having run, which `Migrate.run()` guarantees at plugin init.
  6. Comment: `// v0.5.0 (K5-008 / plan §5.6, D5-10)`.
- **Acceptance criteria:**
  - With `deterministic_retrieval='1'`, two consecutive `getRelevant({ query, maxTokens })`
    calls return the same ids in the same order, and no `relevance_score` value changes.
  - With `deterministic_retrieval='1'`, two memories identical except for `created_at` (one a
    year older) receive the same recency contribution.
  - With `deterministic_retrieval='0'`, the v0.4.0 behaviour is preserved: `relevance_score` is
    bumped and older memories rank lower.
  - Passing an explicit `now` produces stable ordering across calls when
    `deterministic_retrieval='0'` and `bump: false`.
  - A memory with `ignored = 1` never appears in `getRelevant` results.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/memory-service-deterministic.test.ts`

---

# Phase F2 — Human feedback

The first channel through which a user can tell Kevin it is wrong without waiting for the same
error to recur three times. The single hard rule of this phase: **human judgement never writes
`evidence_count` or `recurrence_count`** (D5-05).

### K5-009 — `plugin/Feedback.ts` component

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K5-001, K5-004
- **Risk:** 🟡
- **Files:** `plugin/Feedback.ts`, `plugin/MemoryService.ts`, `tests/unit/feedback.test.ts`
- **Description:**
  1. Create `plugin/Feedback.ts` with the shape given in plan §5.3:
     ```ts
     export type FeedbackVerdict = "useful" | "wrong" | "outdated" | "ignore";
     export interface FeedbackResult {
       readonly id: string; readonly verdict: FeedbackVerdict;
       readonly feedbackPositive: number; readonly feedbackNegative: number;
       readonly ignored: boolean; readonly status: string; readonly confidence: number;
     }
     export class Feedback {
       constructor(store: Store, metrics?: Metrics | null);
       apply(memoryId: string, verdict: FeedbackVerdict, sessionId?: string, note?: string): FeedbackResult;
     }
     ```
  2. `apply()` runs inside a single `store.transaction()`:
     - Insert a `memory_feedback` row with `id = uuidv7()` (use the existing `plugin/uuid.ts`).
     - Apply the verdict-specific `UPDATE` on `memories` (table below).
     - Increment the matching metric.
     - Re-`SELECT` the row and build the `FeedbackResult`.
  3. Verdict semantics — copy this table exactly:
     | Verdict | `memories` update | Metric |
     |---|---|---|
     | `useful` | `feedback_positive = feedback_positive + 1`, `last_verified_at = datetime('now')` | `feedback_positive_total` |
     | `wrong` | `feedback_negative = feedback_negative + 1`, then a **separate** `UPDATE ... SET status='stale' WHERE id = ? AND feedback_negative >= 2 AND status = 'active'` | `feedback_negative_total` |
     | `outdated` | `feedback_negative = feedback_negative + 1`, `status = 'stale'` immediately | `feedback_negative_total` |
     | `ignore` | `ignored = 1` | — |
  4. **Never** write `evidence_count` or `recurrence_count`. Add the comment
     `// v0.5.0 (K5-009 / plan §5.3, D5-05) — human judgement must never touch causal counters.`
  5. If `memoryId` does not exist, throw a plain `Error` with the message
     `unknown_memory: <id>`. The tool layer converts it into a JSON error.
  6. In `MemoryService.mapRow()`, read the new columns and expose them on the `Memory` type as
     `feedbackPositive`, `feedbackNegative`, `ignored` (boolean), `supersededBy`, `archivedAt`.
     `ignored` arrives from SQLite as `0`/`1`; convert with `=== 1`, not with a truthiness check.
- **Acceptance criteria:**
  - Each of the four verdicts writes exactly one `memory_feedback` row.
  - `useful` increments `feedback_positive` and sets `last_verified_at`; `evidence_count` is
    unchanged (assert this explicitly).
  - One `wrong` leaves `status='active'`; a second `wrong` sets `status='stale'`;
    `recurrence_count` is unchanged after both (assert this explicitly).
  - `outdated` sets `status='stale'` on the first call.
  - `ignore` sets `ignored=1` and the row still exists (`SELECT COUNT(*)` is unchanged).
  - `apply()` on an unknown id throws `unknown_memory: ...` and writes nothing.
  - `mapRow()` exposes all five new fields with correct types.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/feedback.test.ts`

---

### K5-010 — Feedback terms in `computeConfidence`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K5-009
- **Risk:** 🟢
- **Files:** `plugin/confidence.ts`, `plugin/MemoryService.ts`, `tests/unit/confidence.test.ts`
- **Description:**
  1. Add four exported constants:
     ```ts
     export const FEEDBACK_POSITIVE_STEP = 0.05;
     export const FEEDBACK_NEGATIVE_PENALTY = 0.20;
     export const FEEDBACK_POSITIVE_CAP = 4;
     export const FEEDBACK_NEGATIVE_CAP = 3;
     ```
  2. Extend the signature with two optional parameters that default to `0`:
     ```ts
     computeConfidence(
       evidenceCount: number,
       recurrenceCount: number,
       feedbackPositive = 0,
       feedbackNegative = 0,
     ): number
     ```
     Formula:
     ```
     clamp(
       CONFIDENCE_BASE
         + EVIDENCE_STEP            * evidenceCount
         - RECURRENCE_PENALTY       * recurrenceCount
         + FEEDBACK_POSITIVE_STEP   * Math.min(feedbackPositive, FEEDBACK_POSITIVE_CAP)
         - FEEDBACK_NEGATIVE_PENALTY* Math.min(feedbackNegative, FEEDBACK_NEGATIVE_CAP),
       CONFIDENCE_MIN, CONFIDENCE_MAX)
     ```
  3. Update `MemoryService.mapRow()` to pass the two feedback counts.
  4. **Do not** update `promoteToPattern` or `kevin_why` to pass them. Those paths reason about
     causal evidence; leaving them on the two-argument form is deliberate and keeps their
     semantics unchanged.
  5. Caps are asymmetric on purpose: negative feedback outweighs positive because a human
     saying "this is wrong" is a stronger and rarer signal than a human saying "this is fine".
- **Acceptance criteria:**
  - For every `(e, r)` pair in `{0..5} × {0..5}`, `computeConfidence(e, r)` equals the v0.4.0
    value exactly. Write this as a table-driven test with hard-coded expected numbers.
  - `computeConfidence(0, 0, 4, 0) === 0.70`; `computeConfidence(0, 0, 10, 0) === 0.70` (cap).
  - `computeConfidence(0, 0, 0, 3)` is clamped at `CONFIDENCE_MIN`.
  - Results always lie within `[CONFIDENCE_MIN, CONFIDENCE_MAX]`.
  - `mapRow()` on a memory with `feedback_negative = 2` yields a lower `confidence` than the
    same row with `feedback_negative = 0`.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/confidence.test.ts`

---

### K5-011 — `kevin_feedback` tool

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K5-009
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `tests/integration/kevin-feedback-tool.test.ts`
- **Description:**
  1. Instantiate `const feedback = new Feedback(store, metrics);` alongside the other components
     in `KevinPlugin`.
  2. Register an 11th tool following the exact shape of the existing registrations
     (`tool({ description, args, async execute() { return { title, output: JSON.stringify(...) }; } })`).
     Args (zod):
     ```ts
     {
       id: z.string().min(1),
       feedback: z.enum(["useful", "wrong", "outdated", "ignore"]),
       note: z.string().max(500).optional(),
     }
     ```
  3. `execute` calls `feedback.apply(id, feedback, currentSessionId, note)` and returns the
     `FeedbackResult` as JSON. Catch the `unknown_memory` error and return
     `{ error: "unknown_memory", id }` instead of throwing.
  4. Write the tool description in the same language and style as the ten existing tool
     descriptions in `plugin/index.ts`. Match the surrounding file; do not switch languages.
     State plainly that `useful`/`wrong` express an opinion about the memory and that `outdated`
     asserts the world has changed.
  5. `title` should be short and human-readable, e.g. `feedback: wrong → <id prefix>`.
- **Acceptance criteria:**
  - The tool is registered and appears in the plugin's tool list; total is 11 at this point in
    the release (13 after K5-015 and K5-016).
  - A valid call returns a JSON payload containing `feedbackPositive`, `feedbackNegative`,
    `ignored`, `status` and `confidence`.
  - An unknown id returns `{ "error": "unknown_memory", ... }` and does not throw.
  - Zod rejects a `feedback` value outside the enum.
  - A `note` longer than 500 characters is rejected.
- **Status notes:**
- **Verification:** `npx vitest run tests/integration/kevin-feedback-tool.test.ts`

---

# Phase F3 — Lifecycle

Two small tasks that finish work the schema has been waiting for since migration 004.

### K5-012 — `plugin/Archiver.ts` — `stale → archived`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K5-001, K5-004
- **Risk:** 🟢
- **Files:** `plugin/Archiver.ts`, `plugin/index.ts`, `tests/unit/archiver.test.ts`
- **Description:**
  1. Create `plugin/Archiver.ts`:
     ```ts
     export class Archiver {
       constructor(store: Store, metrics?: Metrics | null);
       run(now?: Date): number;   // returns the number of rows archived
     }
     ```
  2. `run()` reads `archive_after_days` from `kevin_settings` (default `"30"`), parses it with
     `Number(...)`, and rejects non-finite or non-positive values by falling back to `30`.
  3. Compute `cutoff = now - days` and execute:
     ```sql
     UPDATE memories
        SET status = 'archived', archived_at = ?
      WHERE status = 'stale' AND updated_at < ?
     ```
     Use the SQLite `changes` count as the return value. Increment `memories_archived` by that
     amount when it is greater than zero.
  4. Wire it into the `session.idle` handler in `plugin/index.ts`, **after** `ledger.settle()`
     and `CausalChain.onSessionIdle()` (D5-15 — settlement can stale a memory in the same cycle,
     and the archiver must see the post-settlement state). Wrap it in its own `try/catch` so a
     legacy database cannot break the idle chain.
  5. Archived rows are already excluded from retrieval, which filters `status='active'`. Do not
     add a second filter. Verify this with a test rather than assuming it.
- **Acceptance criteria:**
  - A `stale` memory with `updated_at` older than the cutoff becomes `status='archived'` with a
    non-null `archived_at`.
  - A `stale` memory newer than the cutoff is untouched.
  - An `active` memory is never archived regardless of age.
  - `memories_archived` increases by exactly the number of rows changed.
  - `run()` returns `0` and increments nothing when there is nothing to archive.
  - An archived memory does not appear in `getRelevant` results but is still returned by
    `kevin_get`.
  - Setting `archive_after_days` to `"abc"` falls back to 30 without throwing.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/archiver.test.ts`

---

### K5-013 — Populate `superseded_by` in `MemoryService.save()`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K5-001
- **Risk:** 🟢
- **Files:** `plugin/MemoryService.ts`, `tests/unit/memory-service-supersede.test.ts`
- **Description:**
  1. Locate the existing supersede path in `save()` — the branch that fires on a fingerprint
     collision for `decision` / `rule` types and sets `status='superseded'` on the old row.
  2. In the same `UPDATE`, also set `superseded_by = <id of the new memory>`. The new id must
     already be known at that point; if the current code inserts the new row after updating the
     old one, generate the id first and reuse it for the insert.
  3. Keep the whole operation inside the existing transaction.
  4. Do not add a `REFERENCES` clause (D5-14) and do not add cascade behaviour.
  5. Expose `supersededBy` on the `Memory` type via `mapRow()` (K5-009 already adds the field;
     if K5-009 is not yet done, add it here and note the overlap).
- **Acceptance criteria:**
  - Saving a `decision` whose fingerprint collides with an existing active `decision` sets the
    old row to `status='superseded'` **and** `superseded_by = <new id>`.
  - The new row's `superseded_by` is `NULL`.
  - `memories_superseded` still increments exactly as it did in v0.4.0.
  - A save with no collision leaves `superseded_by` `NULL` everywhere.
  - Following the chain across three successive saves yields a walkable
    `oldest → middle → newest` path.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/memory-service-supersede.test.ts`

---

# Phase F4 — Observability

Makes every injection decision inspectable without changing it. K5-014 is a pure refactor and
must land before K5-015.

### K5-014 — Decompose `ContextInjector`; add `plan()`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K5-006, K5-007
- **Risk:** 🟡 (refactor of the hot path)
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/context-injector-plan.test.ts`
- **Description:**
  1. **This is a pure refactor.** When it is finished, every existing test in
     `tests/unit/context-injector.test.ts` must pass unmodified and the injected block bytes
     must be identical to v0.4.0 for the same inputs. Verify that before adding anything new.
  2. Introduce the interfaces from plan §5.5: `CandidateRow` and `InjectionPlan`.
  3. Extract three private methods out of the current `inject()` body:
     - `getCandidates(query, cap, bump)` — the `getRelevant` probe, **including the existing
       0.8×-cap refetch rule** (refetch at `lowerCap = max(1, round(0.8 * cap))` when
       `aggregateTokens > 0.8 * cap` and `memories[0].protect === false`). Preserve that logic
       exactly; do not simplify it. When `bump === false`, neither the probe nor the refetch may
       bump.
     - `evaluateGate(memories, sessionId, dryRun)` — the current `admit()` body. When
       `dryRun === true` it operates on `new Set(seenBySession.get(sessionId) ?? [])` — a
       **clone** — and never writes back; when `dryRun === false` it mutates the real set as
       today. It returns `{ admitted, rejected }` where `rejected` carries the `GateReason`.
       It increments the `injections_blocked_*` counters only when `dryRun === false`.
     - `buildBlock(admitted, tag)` — the current `format()` body, unchanged.
  4. Add the public planner:
     `plan(query, tag, cap, sessionId, dryRun): InjectionPlan` — calls the three methods in
     order with `bump = !dryRun` and assembles the result. It performs **no** ledger writes and
     **no** `tokens_injected_*` metric writes; those stay in `inject()`.
  5. Rewrite `inject()` as: `const p = this.plan(query, tag, cap, sessionId, false);` followed
     by the existing `recordInjections(...)` and `metrics.incr(metricKey, p.blockTokens)` calls,
     returning `p.block`.
  6. Add `trace(query, tag, sessionId): InjectionPlan` = `plan(query, tag, cap, sessionId, true)`.
  7. Keep `deriveQuery`, `onSystemTransform`, `onCompacting`, `onSessionCreated`,
     `setRecurrences`, `generateSuggestion` and `agentsDraftLine` exactly as they are.
- **Acceptance criteria:**
  - All existing `tests/unit/context-injector.test.ts` tests pass without modification.
  - For a fixed DB and query, `inject()` returns a block byte-identical to the pre-refactor
    output (capture a golden string in the test).
  - `plan(..., dryRun = true)` leaves `seenBySession` unchanged; `plan(..., dryRun = false)`
    adds the admitted ids to it.
  - `plan(..., dryRun = true)` leaves every `memories.relevance_score` unchanged.
  - `plan(..., dryRun = true)` moves no metric counter at all.
  - The returned plan's `rejected` array carries one entry per rejected candidate with the
    correct `GateReason`.
  - `admitted.length + rejected.length === candidates.length`.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/context-injector.test.ts tests/unit/context-injector-plan.test.ts`

---

### K5-015 — `kevin_trace` tool (strict dry run)

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K5-014
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `tests/integration/kevin-trace-tool.test.ts`
- **Description:**
  1. Register the 12th tool. Args (zod):
     ```ts
     {
       query: z.string().min(1).optional(),
       hook: z.enum(["pre_prompt", "compacting"]).default("pre_prompt"),
     }
     ```
     When `query` is omitted, reuse the last derived query for the current session; if there is
     none, return `{ error: "no_query", hint: "..." }`.
  2. Map `hook` to the injector's tag and cap: `pre_prompt → ("context", prePromptBudget)`,
     `compacting → ("memory", COMPACTING_TOKENS)`.
  3. Call `contextInjector.trace(query, tag, sessionId)` and return the `InjectionPlan` as JSON,
     with `dry_run: true` at the top level.
  4. **The four dry-run invariants of D5-08 are the entire point of this task.** Each one gets
     its own assertion:
     - no `relevance_score` changes,
     - no `kevin_injections` rows inserted,
     - no `kevin_metrics` values change,
     - `seenBySession` is unchanged, so a subsequent real injection still emits the same memories.
  5. Include per-candidate `tokens` in the response so a user can see what a rejection saved.
  6. Do **not** add a `kevin_context_ratio` or any percentage-of-prompt figure (D5-09). Kevin
     cannot observe total session input tokens; a fabricated denominator is worse than none.
- **Acceptance criteria:**
  - `kevin_trace` returns `{ query, tag, cap, candidates, admitted, rejected, block, blockTokens, dry_run: true }`.
  - Running `kevin_trace` twice in a row produces byte-identical JSON.
  - Before/after snapshots of `SELECT COUNT(*) FROM kevin_injections`, the full `kevin_metrics`
    table, and `SELECT id, relevance_score FROM memories ORDER BY id` are all unchanged.
  - `kevin_trace` followed by a real `onSystemTransform` injects the same memories that
    `onSystemTransform` alone would have injected (the seen-set was not poisoned).
  - Omitting `query` with no prior session query returns `{ error: "no_query", ... }`.
  - Each rejected entry names one of the five `GateReason` values.
- **Status notes:**
- **Verification:** `npx vitest run tests/integration/kevin-trace-tool.test.ts`

---

### K5-016 — `kevin_audit` tool

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K5-004, K5-005, K5-009
- **Risk:** 🟢
- **Files:** `plugin/kevin_audit.ts`, `plugin/index.ts`, `tests/integration/kevin-audit-tool.test.ts`
- **Description:**
  1. Create `plugin/kevin_audit.ts` exporting
     `export function buildAudit(store: Store, metrics: Metrics): AuditReport;`
     Pure SQL plus metric reads. No writes, no LLM, no filesystem access.
  2. Return the exact shape given in plan §5.7. Every count comes from a single grouped query
     where possible:
     - `memories.by_status` / `by_origin` / `by_type` — three `GROUP BY` queries.
     - `memories.ignored` — `WHERE ignored = 1`.
     - `memories.archived` — `WHERE status = 'archived'`.
     - `memories.with_feedback` — `WHERE feedback_positive > 0 OR feedback_negative > 0`.
     - `memories.superseded_with_target` — `WHERE status='superseded' AND superseded_by IS NOT NULL`.
     - `injections.*` — `ledger.outcomeCounts()` plus `metrics.precisionRate()` and
       `metrics.coverageRate()`.
     - `blocked` — `metrics.blockedSnapshot()`.
     - `feedback.by_verdict` — `SELECT verdict, COUNT(*) FROM memory_feedback GROUP BY verdict`.
     - `tokens` — the two `tokens_injected_*` metric values.
     - `settings` — all rows of `kevin_settings` as a key→value object.
  3. Register the 13th tool, `kevin_audit`, with no arguments (or a single optional
     `verbose: z.boolean().default(false)` that adds the `settings` block).
  4. Wrap the whole body in a `try/catch` that degrades gracefully on a pre-006 database:
     return the blocks that could be computed and a `"partial": true` flag rather than throwing.
     `kevin_status` already sets this precedent for pre-005 databases.
  5. **No `kevin_context_ratio`** (D5-09).
- **Acceptance criteria:**
  - On a fresh migrated DB, every numeric field is `0` and no field is `undefined` or `NaN`.
  - After seeding 2 `effective`, 1 `ineffective`, 7 `inconclusive` injections, the report shows
    `precision_rate ≈ 0.667` and `coverage_rate = 0.3`.
  - After three `kevin_feedback` calls (`useful`, `wrong`, `ignore`), `feedback.by_verdict`
    reports `{ useful: 1, wrong: 1, ignore: 1 }`.
  - `blocked` reflects the five counters.
  - Calling `buildAudit` twice returns identical output and changes nothing in the DB.
  - The response contains no `kevin_context_ratio` key.
- **Status notes:**
- **Verification:** `npx vitest run tests/integration/kevin-audit-tool.test.ts`

---

### K5-017 — Configurable pre-prompt budget (1500 → 900)

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K5-001, K5-014
- **Risk:** 🟡 (changes a user-visible default)
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/context-injector-budget.test.ts`
- **Description:**
  1. Keep `SYSTEM_TRANSFORM_TOKENS` exported as the compile-time fallback, but change the
     `onSystemTransform` cap to be read at call time:
     ```ts
     private prePromptCap(): number {
       const raw = this.memoryService.getSetting("pre_prompt_budget_tokens", "900");
       const n = Number(raw);
       if (!Number.isFinite(n)) return 900;
       return Math.min(4000, Math.max(100, Math.round(n)));
     }
     ```
  2. `COMPACTING_TOKENS` (2000) is unchanged — compaction is a rarer, higher-value event.
  3. Update the README's stated budgets in K5-022.
  4. Rationale to record in the code comment (D5-11): the confound fix in K5-005 will very
     likely show that a large share of injections are `inconclusive`. Charging a 1500-token toll
     per prompt for an unproven benefit is indefensible; making the number a setting lets
     measurement drive it instead of a constant.
- **Acceptance criteria:**
  - With no setting present, the effective cap is `900`.
  - Setting `pre_prompt_budget_tokens='1500'` restores exactly the v0.4.0 behaviour.
  - `'50'` clamps to `100`; `'99999'` clamps to `4000`; `'abc'` falls back to `900`.
  - The compacting cap remains `2000` regardless of the setting.
  - `kevin_trace` reports the effective cap it used.
- **Status notes:**
- **Verification:** `npx vitest run tests/unit/context-injector-budget.test.ts`

---

# Phase F5 — Replay harness

A hermetic, deterministic way to run a recorded session through the plugin and read the outcome
distribution. **This is an artifact, not a release gate** (D5-12) — K5-024 does not depend on it.

### K5-018 — Replay transcript format + fixture

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/replay-types.ts`, `tests/replay/fixtures/basic-typescript-loop.json`, `tests/replay/format.test.ts`
- **Description:**
  1. Define the transcript type in `plugin/replay-types.ts`:
     ```ts
     export type ReplayEvent =
       | { kind: "session.created"; at: string; sessionId: string }
       | { kind: "chat.message";    at: string; sessionId: string; text: string }
       | { kind: "tool.before";     at: string; sessionId: string; callId: string; tool: string; args: Record<string, unknown> }
       | { kind: "tool.after";      at: string; sessionId: string; callId: string; success: boolean; stdout?: string; stderr?: string; exitCode?: number }
       | { kind: "system.transform";at: string; sessionId: string }
       | { kind: "compacting";      at: string; sessionId: string }
       | { kind: "session.idle";    at: string; sessionId: string };

     export interface ReplayTranscript {
       readonly version: 1;
       readonly name: string;
       readonly events: readonly ReplayEvent[];
     }
     ```
     `at` is an ISO-8601 string and is the **only** source of time during replay.
  2. Hand-write one fixture, `basic-typescript-loop.json`: a session that runs `tsc`, fails with
     `error TS2304: Cannot find name 'foo'`, is fixed, then a second session that runs the same
     failing command again. Roughly 14–20 events. Keep it small and readable.
  3. Everything lives under `tests/replay/`, which is already inside the `tsconfig.json`
     `include` array and the existing vitest roots. **Do not create a top-level `benchmark/`
     directory**: there is no `biome.json`, so `biome check .` lints the whole repository, and a
     fixture tree of deliberately broken TypeScript would fail `npm run lint` and be swept up by
     vitest's default include.
  4. Add a validator `parseTranscript(json: unknown): ReplayTranscript` using zod, and a test
     that the shipped fixture parses.
- **Acceptance criteria:**
  - `parseTranscript` accepts the fixture and rejects a transcript with an unknown `kind`, a
    missing `at`, or a non-ISO `at`.
  - The fixture contains at least one failing `tool.after`, one `system.transform`, one linked
    fix and two `session.idle` events.
  - `npm run lint` and `npm run typecheck` both pass with the new files present.
- **Status notes:**
- **Verification:** `npx vitest run tests/replay/format.test.ts`

---

### K5-019 — `plugin/replay.ts` replayer

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** M (5h)
- **Dependencies:** K5-005, K5-008, K5-018
- **Risk:** 🟡
- **Files:** `plugin/replay.ts`, `tests/replay/replay.test.ts`
- **Description:**
  1. Export:
     ```ts
     export interface ReplayResult {
       readonly transcript: string;
       readonly memoriesCreated: number;
       readonly injections: { total: number; effective: number; ineffective: number; inconclusive: number; unmeasured: number };
       readonly precisionRate: number;
       readonly coverageRate: number;
       readonly tokensInjected: { prePrompt: number; compacting: number };
       readonly blocked: Record<string, number>;
     }
     export async function replay(transcript: ReplayTranscript, opts?: { dbPath?: string }): Promise<ReplayResult>;
     ```
  2. Build an isolated environment per run: `new Store({ path: opts?.dbPath ?? ":memory:" })`,
     `await new Migrate(store, migrationsDir).run()`, then set
     `deterministic_retrieval = '1'` in `kevin_settings` **before** any retrieval happens.
  3. Instantiate the components directly (`MemoryService`, `ToolCallObserver`, `Reflector`,
     `ContextInjector`, `InjectionLedger`, `Metrics`, `Archiver`). Do **not** go through
     `KevinPlugin`: it resolves a home-directory database path and registers tools, neither of
     which is wanted here.
  4. Drive the events in order, mapping each `kind` to the corresponding component call, and
     pass `new Date(event.at)` wherever a clock is needed. `Date.now()` must not be called
     anywhere in the replay path.
  5. Set the Reflector throttle to `0` so replay is not time-dependent.
  6. After the last event, `metrics.flush()` and read the counters back from the DB.
- **Acceptance criteria:**
  - Replaying the shipped fixture twice produces a byte-identical `ReplayResult`.
  - The result reports at least one memory created and at least one injection.
  - `precisionRate` and `coverageRate` are finite numbers in `[0, 1]`.
  - Nothing is written to `~/.opencode-kevin/` (assert the default path is `:memory:`).
  - Replay completes in under 5 seconds on the shipped fixture.
- **Status notes:**
- **Verification:** `npx vitest run tests/replay/replay.test.ts`

---

### K5-020 — Replay report + `npm run replay`

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (2h)
- **Dependencies:** K5-019
- **Risk:** 🟢
- **Files:** `scripts/replay.ts`, `package.json`, `README.md`
- **Description:**
  1. Create `scripts/replay.ts`: read every `*.json` under `tests/replay/fixtures/`, run
     `replay()` on each, and print one aligned table row per transcript with the outcome
     distribution, `precision_rate`, `coverage_rate` and tokens injected.
  2. Add `"replay": "node --import tsx scripts/replay.ts"` to `package.json` scripts. Use the
     same invocation style as the existing `verify` script; do not rely on Node type-stripping.
  3. Document in the README how a user records their own transcript and drops it into
     `tests/replay/fixtures/`.
  4. Exit code is always `0`. This is a report, not a gate (D5-12).
- **Acceptance criteria:**
  - `npm run replay` prints a table and exits 0.
  - Adding a second fixture file adds a second row without code changes.
  - The script never writes to the user's home directory.
- **Status notes:**
- **Verification:** `npm run replay`

---

# Phase F6 — Release

### K5-021 — Extend `kevin_status` with v0.5 fields

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K5-004, K5-005
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `plugin/Retrospective.ts`, `tests/integration/kevin-status-v05.test.ts`
- **Description:**
  1. Add to the `kevin_status` payload: `injections_inconclusive`, `coverage_rate`, a `blocked`
     object from `metrics.blockedSnapshot()`, `memories_ignored`, `memories_archived` and
     `feedback: { positive, negative }`.
  2. Keep every existing field and its name. This payload is consumed by users and by the
     retrospective generator; removing a field is a breaking change.
  3. Wrap the new reads in `try/catch` so a pre-006 database still returns the v0.4.0 payload.
  4. Add the nine new metric keys to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts`. The v0.4
     audit found seven keys printing raw because this table was not updated; do not repeat it.
     Match the language of the existing labels in that file.
- **Acceptance criteria:**
  - `kevin_status` returns all v0.4.0 fields plus the new ones.
  - On a database migrated only to `005`, the tool still returns a valid payload with the new
    fields defaulted, and does not throw.
  - A generated retrospective prints a human label for all 22 metric keys — assert that no key
    appears in its raw snake_case form.
- **Status notes:**
- **Verification:** `npx vitest run tests/integration/kevin-status-v05.test.ts`

---

### K5-022 — README + CHANGELOG + `AGENTS.md`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K5-021
- **Risk:** 🟢
- **Files:** `README.md`, `CHANGELOG.md`, `AGENTS.md`, `package.json`
- **Description:**
  1. `package.json`: `0.4.0` → `0.5.0`.
  2. `CHANGELOG.md`: add `## [0.5.0] — <date>` following Keep a Changelog, with
     `### Added — Glass Box`, `### Changed`, `### Fixed`. Under **Changed**, state plainly and
     prominently that `precision_rate` now uses a stricter definition, that previously
     `effective` rows are remapped to `inconclusive`, and that **users will see their precision
     rate fall** — with the explanation that the old number was measuring absence of recurrence,
     not effect. Do not bury this.
     Take the opportunity to fix the two pre-existing drift items: the 0.1.5 section has no
     `##` heading of its own, and the 0.4.0 entry references
     `tests/e2e/migrate-from-v030.test.ts` and `tests/e2e/injection-purity.test.ts`, neither of
     which exists.
  3. `README.md`: document the three new tools with example payloads; update the tool count to
     13; update the stated pre-prompt budget to 900 and note that it is configurable; add a
     short "How Kevin measures itself" section explaining the four outcomes, `precision_rate`
     and `coverage_rate` in plain language; document the three new settings.
  4. `AGENTS.md`: the component list currently reads "7 components". Update it to include
     `Feedback` and `Archiver`.
  5. Do not restate the ROI figures from `docs/Kevin_Token_Impact.md` anywhere. They are
     pre-v0.1.0 estimates and this release exists precisely to replace estimates with
     measurements.
- **Acceptance criteria:**
  - `package.json` version is `0.5.0`.
  - The CHANGELOG entry lists all 3 new tools, the 9 new metric keys, the 3 new settings and
    migration 006, and explains the `precision_rate` semantics change in its own paragraph.
  - The README's tool count, budget figure and settings table match the code.
  - `AGENTS.md` lists 9 components.
  - No new claim of token savings appears anywhere.
- **Status notes:**
- **Verification:** `npm run lint && npm run typecheck`

---

### K5-023 — Closed-loop e2e for v0.5 semantics

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K5-005, K5-009, K5-012, K5-014, K5-015
- **Risk:** 🟡
- **Files:** `tests/e2e/glassbox-loop.test.ts`
- **Description:**
  1. Model this on the v0.4.0 closed-loop test: drive the whole cycle through **public entry
     points only** — hooks and tools. **Do not call `kevin_save` and do not hand-insert rows.**
     The v0.4 bug audit found that hand-seeded fixtures let three separate features ship dead.
  2. Scenario A — *inconclusive*: fail a tool call → reflector creates a lesson → new session →
     inject → session goes idle with nothing else happening → assert `outcome='inconclusive'`
     and that `precision_rate` is **unchanged** (the denominator did not move).
  3. Scenario B — *effective*: fail → lesson → new session → inject → a successful tool call is
     recorded with `fix_for_fingerprint` equal to the lesson fingerprint → idle → assert
     `outcome='effective'` and `precision_rate = 1`.
  4. Scenario C — *ineffective*: fail → lesson → new session → inject → the same error fails
     again → idle → assert `outcome='ineffective'`, `recurrence_count` incremented, and after
     three recurrences `status='stale'`.
  5. Scenario D — *feedback*: two `kevin_feedback({feedback:"wrong"})` calls stale the memory;
     `evidence_count` and `recurrence_count` are unchanged throughout (assert both explicitly).
  6. Scenario E — *archival*: a stale memory older than `archive_after_days` becomes `archived`
     on idle and stops being retrieved.
  7. Scenario F — *trace purity*: snapshot `kevin_injections` row count, the whole
     `kevin_metrics` table and every `memories.relevance_score`; run `kevin_trace`; assert all
     three snapshots are identical afterwards.
- **Acceptance criteria:**
  - All six scenarios pass.
  - No scenario uses `kevin_save` or a direct `INSERT INTO memories`.
  - Scenario A explicitly asserts that an inconclusive outcome does not change `precision_rate`.
  - Scenario D explicitly asserts `evidence_count` and `recurrence_count` are untouched by
    feedback.
  - The whole file runs in under 30 seconds.
- **Status notes:**
- **Verification:** `npx vitest run tests/e2e/glassbox-loop.test.ts`

---

### K5-024 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K5-001 … K5-023
- **Risk:** 🟢
- **Files:** —
- **Description:**
  1. Run the four release commands and fix anything that fails:
     ```
     npm run typecheck
     npm run lint
     npm test
     npm run verify
     ```
  2. Run the five release-specific checks from plan §11:
     - `Migrate.run()` twice on a fresh DB → second run reports `applied: []`.
     - A DB at `schema_version = 005` migrates to `006` with zero `kevin_injections` row loss
       and every prior `effective` row now reading `inconclusive`.
     - `kevin_trace` run twice is byte-identical and leaves `kevin_injections`, `kevin_metrics`
       and every `memories.relevance_score` unchanged.
     - `computeConfidence(e, r)` matches v0.4.0 for all tested pairs when the feedback arguments
       are omitted.
     - `kevin_config set` succeeds for all three new keys.
  3. Update the Summary table (§1) and the plan's §14 implementation status.
  4. `npm run replay` is informational only and does not gate the release.
- **Acceptance criteria:**
  - All four commands exit 0.
  - All five release-specific checks pass.
  - The test count is greater than 548 and no previously passing test was deleted to make a new
    one pass.
  - §1 of this document shows 24/24 done.
- **Status notes:**
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 3. Implementation order (recommended)

```
K5-001 → K5-002 → K5-003 → K5-004        (substrate; nothing runs before this)
       ↓
K5-006 → K5-007                          (gate verdicts; independent of the ledger)
K5-005                                   (three-way settlement — the flagship)
K5-008                                   (determinism; unblocks the replay harness)
       ↓
K5-009 → K5-010 → K5-011                 (feedback)
K5-012, K5-013                           (lifecycle; parallelizable)
       ↓
K5-014 → K5-015                          (decomposition then trace; strict order)
K5-016, K5-017                           (audit and budget; parallelizable)
       ↓
K5-018 → K5-019 → K5-020                 (replay; optional, deferrable)
       ↓
K5-021 → K5-022 → K5-023 → K5-024        (release)
```

If time runs short, cut **F5 in full** (K5-018 … K5-020). It is the only phase no other task
depends on. Do not cut F1: without it the release has no purpose.

---

## 4. Traps to avoid

These are drawn from defects this codebase has actually shipped. Each one passed a green test
suite at the time.

1. **Comparing a `kevin_settings` value with `=== 1`.** The column is TEXT. This exact mistake
   made `cross_project_enabled` unreachable for an entire minor release.
2. **Forgetting `KEVIN_CONFIG_KEYS`.** `kevin_config list` reads the table and will show a new
   key regardless, so the omission looks fine while `set` silently fails.
3. **Writing feedback into `evidence_count` or `recurrence_count`.** It corrupts
   `computeConfidence`, `promoteToPattern` and `kevin_why`'s "resolved in N of M attempts"
   string, making Kevin report attempts that never happened.
4. **Letting `kevin_trace` write anything.** One ledger row from a debug tool destroys the
   metric this release exists to fix.
5. **Building a component and never wiring it.** `QualityGate.evaluate()` had zero production
   call sites in v0.4.0 and existed only to satisfy its own unit tests. For every task here,
   assert the behaviour through a public entry point, not through the component in isolation.
6. **Hand-seeding fixtures instead of exercising the wiring.** A test that inserts a
   `tool_calls` row with a hand-written fingerprint proves nothing about whether production
   ever writes that value.
7. **Assuming `ALTER TABLE ADD COLUMN` is idempotent.** It is not. Idempotency comes from
   `schema_version`.
8. **Forgetting `scripts/verify-install.ts`.** It hard-codes migration filenames; a missing
   entry means `npm run verify` silently never exercises the new migration.
9. **Adding a `REFERENCES` clause.** `Store` sets `PRAGMA foreign_keys = ON`, so a casual
   foreign key becomes a real constraint that blocks legitimate deletions.
10. **Creating a top-level `benchmark/` directory.** There is no `biome.json`, so
    `biome check .` lints everything in the repository, and vitest's default include sweeps up
    stray test files.

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

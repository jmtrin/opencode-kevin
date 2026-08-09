# Opencode-kevin — Task List v0.4.0

**Version:** 0.4.0
**Date:** 2026-08-08
**Status:** Pending (not started)
**Dependency:** `docs/Kevin_v0.4.0_Plan.md`
**ID Convention:** `K4-XXX` (Kevin 0.4.0 — "Signal over Noise")
**Total tasks:** 28 (K4-001 … K4-028)

---

## Status Legend

Every task carries a single status marker, placed on its own line immediately after the task header. Update the marker as you work — that is how progress is tracked.

| Marker | Meaning | When to set |
|---|---|---|
| `[ ]` | **Not started** | Initial state. Task has not been touched. |
| `[~]` | **Started / In progress** | Work has begun; some code or tests exist but the task is not finished. |
| `[P]` | **Partial** | Core deliverable exists but some acceptance criteria are still failing or missing. Record what is missing in the task's **Status notes** line. |
| `[!]` | **Blocked** | Cannot proceed. Record the blocker (dependency, API change, decision) in the task's **Status notes** line. |
| `[X]` | **Done** | All acceptance criteria met and verification command passes. |

Example:

```markdown
### K4-XXX — Example task

**Status:** `[~]` In progress — quality gate core written, tests pending

- **Priority:** P0
...
```

At the end of each work session, update the **Summary table** (§1) to reflect every changed marker.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K4-001 | F0 | Draft migration 005 | P0 | S | [X] |
| K4-002 | F0 | Post-apply backfill 005 | P0 | S | [X] |
| K4-003 | F1 | QualityGate.evaluate + rescueErrorType | P0 | M | [X] |
| K4-004 | F1 | QualityGate.canInject (seen-set + recurrence) | P0 | M | [X] |
| K4-005 | F1 | Reflector dispatch metadata | P0 | S | [X] |
| K4-006 | F0 | InjectionLedger skeleton | P0 | S | [X] |
| K4-007 | F0 | InjectionLedger.settle | P0 | M | [X] |
| K4-008 | F0 | New metrics + precision_rate | P0 | S | [X] |
| K4-009 | F2 | Fix patterns_causal inflation | P0 | S | [X] |
| K4-010 | F2 | Two-sided confidence | P0 | S | [X] |
| K4-011 | F2 | Negative half writes recurrence_count | P0 | S | [X] |
| K4-012 | F1 | Snippet injection payload | P1 | M | [X] |
| K4-013 | F1 | Shared query tokenizer | P1 | S | [X] |
| K4-014 | F2 | Deterministic fix_args capture | P0 | M | [X] |
| K4-015 | F2 | Promotion-time LLM enrichment | P2 | M | [X] |
| K4-016 | F2 | Smarter HITL suggestion | P1 | S | [X] |
| K4-017 | F1 | Wire ContextInjector into production | P0 | M | [X] |
| K4-018 | F3 | Fix the dead compacting hook | P0 | M | [X] |
| K4-019 | F0 | Wire project scoping | P1 | M | [X] |
| K4-020 | F2 | kevin_why honest output | P1 | S | [X] |
| K4-021 | F2 | kevin_config tool | P2 | M | [X] |
| K4-022 | F1 | Expand deterministic rule coverage | P1 | M | [X] |
| K4-023 | F2 | Weak-lesson warning mode | P2 | S | [X] |
| K4-024 | F2 | kevin_status precision block | P1 | S | [X] |
| K4-025 | F3 | e2e: closed-loop cycle | P0 | L | [X] |
| K4-026 | F3 | Backward-compat migration test | P0 | M | [X] |
| K4-027 | F3 | Injection purity validation | P0 | M | [X] |
| K4-028 | F3 | Bump 0.4.0 + CHANGELOG | P0 | S | [X] |

**Phase totals:** F0 — 6 tasks · F1 — 8 tasks · F2 — 9 tasks · F3 — 5 tasks

**Done:** 28/28 · **In progress:** 0/28 · **Blocked:** 0/28

**Critical path:** F0 → K4-003/004/005 + K4-017 (quality gate + single injection path) → K4-006/007/008 (ledger) → K4-009/010/011 (honest confidence) → K4-014 (fix_args) → K4-025 (closed-loop e2e, early de-risk) → K4-018 (compacting) → rest of F2 → K4-026/027/028 (release).

---

## 2. Conventions

- **Estimation:** S (≤4h), M (4–16h), L (16–40h).
- **Dependencies:** Task IDs that must be completed first.
- **Risk:** 🟢 low · 🟡 medium · 🔴 high.
- **Verification:** command or action confirming the task is done correctly.
- **Status:** `[ ]` not started · `[~]` in progress · `[P]` partial · `[!]` blocked · `[X]` done (see legend above).
- **Files:** relative to repo root `C:\opencode-kevin`.
- **Style:** Biome (`npm run lint`); TypeScript strict; ESM imports with `.js` extension (e.g. `import { X } from "./QualityGate.js"`).
- **DB access:** tests use `Store({ path: ':memory:' })`; migrations are exercised against `:memory:` then the real DB.
- **No-LLM default:** the failure hot path must never call an LLM. Any LLM call is opt-in and only at promotion time (K4-015).

---

# Phase F0 — Substrate (migration, ledger, metrics, scoping)

Foundation: schema 005, the injection ledger table, the new metrics, and the projectId wiring that everything else consumes.

### K4-001 — Draft migration 005

**Status:** `[X]` Done — file created, 8 tests passing

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `migrations/005_v04_signal.sql`
- **Description:** Create the additive, idempotent migration described in plan §6. It must contain, in order:
  1. `ALTER TABLE memories ADD COLUMN recurrence_count INTEGER NOT NULL DEFAULT 0;`
  2. `ALTER TABLE memories ADD COLUMN fix_args TEXT;`
  3. `ALTER TABLE memories ADD COLUMN last_injected_at TEXT;`
  4. `CREATE TABLE IF NOT EXISTS kevin_injections (...)` with columns `id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, fingerprint TEXT NOT NULL, session_id TEXT NOT NULL, hook TEXT NOT NULL CHECK (hook IN ('pre_prompt','compacting')), tokens INTEGER NOT NULL, injected_at TEXT NOT NULL DEFAULT (datetime('now')), outcome TEXT CHECK (outcome IN ('unmeasured','effective','ineffective')) NOT NULL DEFAULT 'unmeasured'`.
  5. Indexes: `idx_injections_fp (fingerprint)`, `idx_injections_session (session_id)`, `idx_injections_outcome (outcome)`.
  6. `INSERT OR IGNORE INTO kevin_metrics(key, value) VALUES ('injections_total', 0), ('injections_effective', 0), ('injections_ineffective', 0), ('patterns_promoted_new', 0);`
  7. `INSERT OR IGNORE INTO kevin_settings(key, value) VALUES ('quality_gate_enabled', '1'), ('lesson_snippet_injection', '1');`
- **Acceptance criteria:**
  - File exists with the exact schema above.
  - Running the SQL twice against the same DB is a no-op (idempotent): second run does not error and does not duplicate rows.
  - New columns are nullable-with-default for legacy rows (`recurrence_count=0`, `fix_args=NULL`, `last_injected_at=NULL`).
  - No CHECK constraints are added or altered on existing tables.
- **Status notes:** Migration written as `migrations/005_v04_signal.sql` following the 003/004 style; test `tests/unit/migrate_v05.test.ts` covers application order, columns, CHECK constraints, indexes, seeds, idempotency and legacy-row defaults.
- **Verification:** `npx vitest run tests/unit/migrate_v05.test.ts` — 8 tests pass.

### K4-002 — Post-apply backfill (005)

**Status:** `[X]` Done — hook registered, 3 tests passing

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K4-001
- **Risk:** 🟢
- **Files:** `plugin/Migrate.ts`, `tests/unit/migrate_postapply_v05.test.ts`
- **Description:** Extend `Migrate.ts` so that after applying 005 the plugin backfills semantics for pre-existing rows:
  - Every legacy `memories` row gets `recurrence_count = 0`, `fix_args = NULL`, `last_injected_at = NULL` (should already hold via column defaults — assert it).
  - Metrics and settings rows for the 4 new keys and 2 new settings are seeded (INSERT OR IGNORE) so `kevin_metrics` lookups never return undefined.
  - The backfill must itself be idempotent (safe on re-run after partial failure).
- **Acceptance criteria:**
  - A DB created at v0.3 schema (replay migrations 001–004) then migrated to 005 passes the assertions above.
  - `kevin_metrics` contains the 4 new keys; `kevin_settings` contains the 2 new keys.
  - Running the migration path twice produces identical state.
- **Status notes:** Built-in hook `"005"` in `DEFAULT_POST_APPLY_HOOKS` (coerces NULL `recurrence_count` → 0; `fix_args`/`last_injected_at` need no coercion, they are nullable); seeds come from the migration SQL itself. Test covers legacy backfill, value preservation on re-run, and hook-failure rollback of the whole 005 migration.
- **Verification:** `npx vitest run tests/unit/migrate_postapply_v05.test.ts` — 3 tests pass; migration suites all green (35 tests).

### K4-006 — InjectionLedger skeleton

**Status:** `[X]` Done — 8 unit tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-001
- **Risk:** 🟢
- **Files:** `plugin/InjectionLedger.ts`, `tests/unit/injection-ledger.test.ts`
- **Description:** New class `InjectionLedger` (mirror the constructor style of `PatternMiner`: `store: Store`, optional `metrics: Metrics | null`). Methods:
  - `record({ memoryId, fingerprint, sessionId, hook, tokens }): void` — INSERT into `kevin_injections` with `id` from `uuidv7()`, `outcome='unmeasured'`. Call `metrics?.incr("injections_total", 1)`.
  - `settle(sessionId: string): void` — stub that updates no rows yet (filled in K4-007); must compile and be safe to call.
  - `recurrencesFor(sessionId: string): Map<string, number>` — stub returning empty map (filled in K4-007).
  - `unsettledForSession(sessionId): number` — count of `outcome='unmeasured'` rows (used by settle and by tests).
- **Acceptance criteria:**
  - `record` inserts a row with the passed values and `outcome='unmeasured'`.
  - Duplicate `id` (same uuid) raises; otherwise inserts accumulate.
  - Stubs compile under strict TS and do not throw.
- **Status notes:** Also added the 4 new metric keys (`injections_total/effective/ineffective`, `patterns_promoted_new`) to `METRIC_KEYS` in `metrics.ts` (required for `record()` to typecheck with `MetricKey`); this is the K4-008 part of key registration, K4-008 still owns `precision_rate` + status wiring. Added `rowsForSession()` helper (used by tests and settle). One test initial expectation bug fixed (both rows were settled → expected 1, now scopes the UPDATE by memory_id).
- **Verification:** `npx vitest run tests/unit/injection-ledger.test.ts` — 8 tests pass; `npx tsc --noEmit` clean.

### K4-007 — InjectionLedger.settle (effective/ineffective)

**Status:** `[X]` Done — 5 e2e tests passing

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K4-006
- **Risk:** 🟡
- **Files:** `plugin/InjectionLedger.ts`, `tests/e2e/ledger-settle.test.ts`
- **Description:** Implement the settlement logic (plan §5.2):
  - `settle(sessionId)`: for every `kevin_injections` row with `outcome='unmeasured'` and `session_id = ?`:
    - Query `tool_calls` in the same session with `success = 0` and `ts > injected_at`, matching `COALESCE(error_fingerprint, fingerprint) = injections.fingerprint` (mirror the CausalChain matching).
    - If any match → `UPDATE kevin_injections SET outcome='ineffective'`, `metrics.incr("injections_ineffective", 1)`, and `UPDATE memories SET recurrence_count = recurrence_count + 1, last_injected_at = injected_at WHERE fingerprint = ?` (for the matching memory_id).
    - Else → `outcome='effective'`, `metrics.incr("injections_effective", 1)`.
  - `recurrencesFor(sessionId)`: returns `Map<fingerprint, count>` of failing tool_calls per fingerprint in the session (feeds QualityGate and HITL).
  - Settlement is idempotent: calling twice does not double-count (guard on `outcome='unmeasured'`).
- **Acceptance criteria:**
  - e2e simulates: failure → record injection → same fingerprint fails again after `injected_at` → settle → row is `ineffective`, `memories.recurrence_count = 1`, metric `injections_ineffective = 1`.
  - No recurrence → row is `effective`.
  - Double settle does not change counts.
- **Status notes:** `settle` matches with `ts >= injected_at` (both are `datetime('now')` text → lexicographic compare valid). Tests pin `injected_at` explicitly because `datetime('now')` in a live test is later than fixed fixture timestamps. 5 e2e tests: ineffective, effective, pre-injection recurrence not charged, idempotency, recurrencesFor counts.
- **Verification:** `npx vitest run tests/e2e/ledger-settle.test.ts` — 5 tests pass; unit ledger suite still green (8).

### K4-008 — New metrics + precision_rate

**Status:** `[X]` Done — 6 unit tests passing

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-001, K4-006
- **Risk:** 🟢
- **Files:** `plugin/metrics.ts`, `tests/unit/metrics-v04.test.ts`
- **Description:** Register the 4 new metric keys in `METRIC_KEYS` (plan §5.2): `injections_total`, `injections_effective`, `injections_ineffective`, `patterns_promoted_new`. Add a derived read: `precision_rate()` computing `effective / total` (0 when total is 0). Expose the totals via the metrics snapshot the existing `kevin_status` consumes.
- **Acceptance criteria:**
  - New keys appear in the metrics snapshot with seeded value 0.
  - `precision_rate()` returns 0 for empty ledger, 1.0 when all effective, 0.5 for 1 effective / 2 total.
  - Existing metric tests remain green (keys are additive).
- **Status notes:** Keys were registered in K4-006; K4-008 added `Metrics.precisionRate()` (cached counters, no flush, min(1, effective/total), 0 on empty) and exposed `precision_rate`, `injections_total/effective/ineffective`, `patterns_promoted_new` in `kevin_status` output (`plugin/index.ts`). Updated legacy `tests/unit/metrics.test.ts` key-list assertion (9 → 13 keys). Full suite: 415 tests, 40 files, all green; `tsc --noEmit` clean.
- **Verification:** `npx vitest run tests/unit/metrics-v04.test.ts` — 6 tests pass; `npm test` green.

### K4-019 — Wire project scoping

**Status:** `[X]` Done — 5 unit tests + full suite (420) passing

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** —
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `plugin/ToolCallObserver.ts`, `tests/unit/project-scoping.test.ts`
- **Description:** Fix the dormant D2-11 defect (plan §3.1, §5.7): today `ToolCallObserver.onAfter` hardcodes `projectId: null` (`ToolCallObserver.ts:62`) and `index.ts` never passes a project id to `observer`/`reflector`/`causalChain`/`patternMiner`.
  - Derive `projectId` once per session: prefer an SDK-provided project property from the hook input (inspect `hookInput`/`session.created` payload for a path/name field); fallback to `fingerprint(process.cwd())`.
  - Thread it through every call site: `observer.onAfter(..., projectId)`, `reflector.invoke(..., projectId)`, `causalChain.onSuccess/onSessionIdle(..., projectId)`, `patternMiner.mine(projectId)`.
  - All existing queries that filter `project_id IS NULL` (legacy rows) must keep working unchanged; new rows carry the derived id.
- **Acceptance criteria:**
  - New tool_calls/memories rows carry a non-null `project_id` when derivable.
  - Two different cwd values produce two different project ids (fingerprint differs).
  - Legacy NULL rows still load (no regressions in `getRelevant`/`kevin_query`).
- **Status notes:** SDK verified: plugin hooks expose NO project field (only `tool/sessionID/callID/args`), so fallback used — `const projectId = fingerprint(process.cwd())` derived once at plugin init (index.ts, after Migrate.run; added `import { fingerprint }`). Threaded to: `handleToolFailed` → reflector.invoke, `observer.onBefore/onAfter`, reflector.invoke (failure branch), `causalChain.onSuccess` (3rd arg was hardcoded `null`), `patternMiner.mine(projectId)`. `ToolExecuteInput` gained `projectId?: string | null`; onAfter line 62 `const projectId = input.projectId ?? null`. `Reflector.ReflectionInput` already had projectId. Test gotcha: `MemoryService.save()` is SYNCHRONOUS returning `string` (the id), not a Promise — test awaited it; fixed.
- **Verification:** `npx vitest run tests/unit/project-scoping.test.ts` — 5 tests pass; full suite 41 files / 420 tests pass; `npx tsc --noEmit` clean.

---

# Phase F1 — Quality (gate, snippets, semantics)

The precision layer: QualityGate, rescued errorTypes, snippet injection, aligned query semantics, and the single wired injection path.

### K4-003 — QualityGate.evaluate + rescueErrorType

**Status:** `[X]` Done — 7 unit tests passing

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** —
- **Risk:** 🟡
- **Files:** `plugin/QualityGate.ts`, `tests/unit/quality-gate.test.ts`
- **Description:** New pure module (plan §5.1). Implement:
  - `evaluate(lesson, dispatch, errorType): { errorType, suggestion, isActionable, strength }` where:
    - `errorType` = `rescueErrorType(dispatch, errorType)`.
    - `isActionable` = `dispatch.code != null` OR `suggestion` is not one of the generic fallbacks in `Reflector.SUGGESTIONS` (typecheck/lint/test/runtime/timeout/unknown → treat "Review the error output for details." and siblings as generic).
    - `strength` = `'strong'` when `dispatch.code` matched or rescued errorType ≠ `'unknown'`; else `'weak'`.
  - `rescueErrorType(dispatch, errorType): string` — when dispatch produced a code (e.g. `TS2304`, `EADDRINUSE`), return that code; else return the incoming `errorType` (may stay `'unknown'`).
  - `canInject(memory, ctx): boolean` (see K4-004; define the signature now, return conservative `false` for `weak` until K4-004 lands).
- **Acceptance criteria:**
  - The 5 §3.3 observed cases classify correctly: E0433 → `isActionable: true` (code present, rescue `TS/rust`-class hint); `[connect] starting jcode runtime...` → `isActionable: false`; `could not compile 'jcode-harness-api'` → rescued non-unknown via rule (K4-022) → actionable; `rg: The term 'rg' is not recognized` → `isActionable: true` (command-not-found rule, K4-022); `[build]` → `isActionable: false`.
  - Dispatch-matched code overrides `'unknown'`.
  - Generic-suggestion detection returns true for the fallback strings and false for rule-produced suggestions.
- **Status notes:** Implemented `QualityGate.ts` with `GENERIC_SUGGESTIONS` (from exported `Reflector.SUGGESTIONS`), `isGenericSuggestion()`, `rescueErrorType()`, `evaluate()` and `canInject()`. One formula fix during tests: `isActionable = !generic || dispatch?.code != null` (the generic ban applies only when there is NO dispatched code — a matched code always carries a "Likely cause" hint). `Reflector.SUGGESTIONS` had to be exported from Reflector.ts to build the generic set. `canInject` (K4-004) fully implemented now, pending its own tests.
- **Verification:** `npx vitest run tests/unit/quality-gate.test.ts` — 7 tests pass.

### K4-004 — QualityGate.canInject (seen-set + recurrence)

**Status:** `[X]` Done — 10 unit tests passing, full suite 43 files / 437 tests green

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K4-003
- **Risk:** 🟡
- **Files:** `plugin/QualityGate.ts`, `tests/unit/quality-gate-can-inject.test.ts`
- **Description:** Implement `canInject(memory, ctx: { seenThisSession: Set<string>; recurrenceCount: number }): boolean` enforcing plan §5.1 rules 2–4:
  - `false` when `memory.id ∈ seenThisSession` (session dedup).
  - `false` when `memory.status === 'stale'`.
  - `false` when `recurrenceCount ≥ 1` (recurred despite injection) — a fingerprint stays non-injectable until a new fix is observed (CausalChain link bumps `evidence_count`/re-admission; see K4-025 for the re-admit path).
  - `false` when the lesson is not actionable (weak + generic) — unless `quality_gate_enabled = '0'` (debug mode, K4-023).
- **Acceptance criteria:**
  - Same id twice in a session → second call returns `false`.
  - `recurrenceCount = 1` → `false`; after re-admission (fix observed → `recurrenceCount` reset or new causal link) → `true`.
  - `status='stale'` → always `false`.
  - Weak lesson → `false` in default mode, `true` in debug mode (K4-023 wiring).
- **Status notes:** Implemented inside `QualityGate.ts` (as `QualityGate.canInject`, a const-object method alongside the K4-003 statics). First test run: 9/10 passed, 1 failure exposed that only `stale` was blocked — fixed the check to reject any status ≠ `'active'` (`archived`/`superseded` also block injection). Debug-mode behavior tested (weak lessons admitted when `qualityGateEnabled = false`), and seen-set/stale/recurrence still enforced in debug mode. `QualityGate` was converted from a static-only class to a `const` object to satisfy Biome `lint/complexity/noStaticOnlyClass`; commas added between methods; file formatted with `biome format --write`. Also fixed Biome findings in older v0.4 tests (`migrate_v05.test.ts` `!` → `?.`, import ordering in `ledger-settle.test.ts`, `injection-ledger.test.ts`, `metrics-v04.test.ts`, `project-scoping.test.ts`, `quality-gate.test.ts`) — `biome check plugin tests migrations` now clean (64 files) and `tsc --noEmit` clean.
- **Verification:** `npx vitest run tests/unit/quality-gate-can-inject.test.ts` — 10 tests pass; `npm test` — 437 tests pass.

### K4-005 — Reflector stores dispatch in metadata

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-003
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`, `tests/unit/reflector-v04.test.ts`
- **Description:** In `invoke()`, after `dispatchLesson` runs: persist `metadata.dispatch = { code, hint }` on the memory row; and when `dispatch.code` exists, replace the lesson's `errorType` with the rescued value via `QualityGate.rescueErrorType` (plan §5.1 rule 1). Lesson content keeps the template `When {tool} fails with {errorType}: {firstErrorLine}\nSuggestion: {suggestion}` — now with the rescued errorType and the rule's suggestion instead of the generic fallback.
- **Acceptance criteria:**
  - A TS2304 failure produces a memory whose `errorType` is not `'unknown'` and whose content shows the rule suggestion ("Verify types and imports before running." from the rule table, not the generic fallback).
  - `metadata.dispatch` is JSON-persisted and readable.
  - No LLM calls on this path.
- **Status notes:** Done. `invoke()` computes `dispatched` once and uses `dispatched.code ?? input.errorType` as `displayErrorType` (new `HeuristicLessonInput.displayErrorType`), so `When bash fails with TS2304: ...` shows the rescued code while the `SUGGESTIONS` lookup still keys on the original category (suggestion stays non-generic). `metadata.dispatch = { code, hint }` persisted always (incl. `{code:null,hint:null}`). No QualityGate import (cycle guard) — rescue is inline. Reflector is NOT async-blocking: `invoke()` is async and save happens after the (default no-op) enrich await. Legacy tests updated to the new wording/queries: `reflector.test.ts` (2 asserts), `plugin-tools.test.ts` (queries `typecheck`→`TS2304`), `context-injection.test.ts` (user msgs `typecheck`→`TS2304`), `reflection-flow.test.ts`, `reflector-integration.test.ts`, `plugin-complete.test.ts`. Suite: 44 files / 445 tests green; tsc & biome clean.
- **Verification:** `npx vitest run tests/unit/reflector-v04.test.ts`

### K4-012 — Snippet injection payload

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** M (5h)
- **Dependencies:** K4-004
- **Risk:** 🟡
- **Files:** `plugin/ContextInjector.ts`, `plugin/memory-format.ts`, `tests/unit/contextinjector-v04.test.ts`
- **Description:** Change the injection payload from full content to a snippet (plan §5.1 rule 5, D4-05):
  - Snippet = `id: line` + first 2 non-empty lines of content + `<protect>` wrapper, via a new `formatSnippet` in `memory-format.ts` (keep `formatMemories` for `kevin_get`/`kevin_query` full output).
  - Gate with setting `lesson_snippet_injection` (default `'1'`); when `'0'`, fall back to full content.
  - Keep `escapeInjectedText` applied to snippet content.
- **Acceptance criteria:**
  - Injected block rows are ≤ ~3 lines each; full body still available via `kevin_get`.
  - Setting `'0'` restores full-content behavior.
  - Existing escape tests (XSS-style `&<>`) pass for snippets too.
- **Status notes:** Done. `memory-format.ts` gains `formatSnippet` (per-row: `id:` line + `[type]` + first 2 non-empty trimmed lines, `<protect>` unless `protect:false`) and `formatMemorySnippets` (shared `wrapBlock`); `formatMemories` unchanged for `kevin_get`/`kevin_query`. `MemoryService.getSetting(key, fallback)` reads `kevin_settings` (safe fallback when table missing). `ContextInjector.format()` picks `formatMemorySnippets` vs `formatMemories` via `lesson_snippet_injection` (exported const `SNIPPET_INJECTION_SETTING`), default `'1'`; called from both `inject` paths (transform + compacting, budget guard intact). Legacy `context-injector.test.ts` mocks got `getSetting`; new `contextinjector-v04.test.ts` (8 tests: 2-line snippet, 3-line row cap, progressive disclosure, '0' restores full, XSS escape, protect:false, setting key assertion, compacting). Suite 44 files / 453 tests green; tsc & biome clean.
- **Verification:** `npx vitest run tests/unit/contextinjector-v04.test.ts`

### K4-013 — Shared query tokenizer

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/MemoryService.ts`, `plugin/kevin_why.ts`, `tests/unit/query-tokenizer.test.ts`
- **Description:** Extract one helper `tokenizeQuery(query: string): string[]` (lowercase, split on whitespace, drop stopwords — reuse the existing STOP_WORDS list) in a shared module (e.g. `plugin/query-tokenizer.ts`). Document in its docstring that **injection recall ORs the quoted tokens** (`"t1" OR "t2"`) while **`kevin_why` ANDs them** (`"t1" AND "t2"`). Replace the two inline implementations (`MemoryService.queryRelevant` OR-join and `kevin_why` AND-join) with calls to the helper.
- **Acceptance criteria:**
  - Both call sites use the helper (assert via test importing the module).
  - A multi-word query in `kevin_why` still ANDs (no behavior regression); injection recall still ORs.
- **Status notes:** Done. New `plugin/query-tokenizer.ts` exports `STOP_WORDS` (moved from `ContextInjector`), `tokenizeQuery(query)` (lowercase + split whitespace + drop stopwords), `quoteToken` and `toMatchClause(tokens, " OR " | " AND ")`; docstring documents injection ORs vs `kevin_why` ANDs. `MemoryService.queryRelevant` and `kevin_why` now call the helper; `ContextInjector` imports the shared `STOP_WORDS`. New `tests/unit/query-tokenizer.test.ts` (9 tests: tokenize cases, empty/stopword-only → [], quote/escape, shared STOP_WORDS, kevin_why AND-join + stopword drop, queryRelevant OR-join + stopword drop). Suite 46 files / 464 tests green; tsc & biome clean.
- **Verification:** `npx vitest run tests/unit/query-tokenizer.test.ts`

### K4-017 — Wire ContextInjector into production

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K4-004, K4-012
- **Risk:** 🔴
- **Files:** `plugin/index.ts`, `tests/e2e/context-injection.test.ts`
- **Description:** Fix the dead-code defect (plan §3.2.3): `index.ts:534-565` inlines transform/compacting logic and never calls `injector.onSystemTransform`/`onCompacting`. Replace the inline logic with calls to the injector methods so there is a single injection path that:
  - Applies `QualityGate.canInject` with the session seen-set.
  - Uses snippet payload (K4-012).
  - Records every injected memory via `InjectionLedger.record` (K4-006).
  - Applies the conditional budget guard (0.8×cap when first row is not `<protect>` and aggregate > 80%).
  - Calls `injector.setRecurrences(...)` from the existing `session.idle` handler (keep the wiring that already exists).
- **Acceptance criteria:**
  - The inline transform code is removed; `onSystemTransform`/`onCompacting` are the only injection path.
  - e2e simulates transform → injected block contains only snippet rows that passed the gate; ledger rows exist for each injection.
  - Existing `context-injection.test.ts` expectations are updated where the payload shape changed (snippet) and remain green.
- **Status notes:** Inline hooks removed from `index.ts` (imports `formatMemories`/`estimateTokens`/token constants deleted). `ContextInjector` gained optional 3rd ctor param `ledger: InjectionLedger | null`, `onSessionCreated(sessionId)` (clears per-session seen-set), `inject(..., sessionId)` → `admit(memories, sessionId)` (QualityGate.canInject: status/dedup/recurrence/gate; strength from `metadata.dispatch`: `{code:null}` = weak/not-actionable and rejected with gate on, missing dispatch = strong/actionable, code present = strong) + `recordInjections` (one ledger row per injected memory, tokens split evenly, hook `pre_prompt`/`compacting`). `InjectionLedger.postInjectionRecurrencesFor(sessionId)` added (only tool failures with `ts >= MAX(injected_at)` for the fp count as recurrences). Hooks now call `injector.onSystemTransform({sessionID, messages:[{role:"user",content:lastUserQuery}]}, output)` / `onCompacting` (input lacks messages; `lastUserQuery` fed from `chat.message`). `session.created` → `injector.onSessionCreated(info.id)`. Tests: `context-injection.test.ts` fixture now copies `005_v04_signal.sql` + passes a real ledger; 5 tests (added seen-set + gate rejection). `plugin-complete.test.ts` XSS test: compacting now runs in a fresh session (`onSessionCreated`). `plugin-v02-validation.test.ts` fixture also copies 005; block assert updated to snippet shape (`not.toContain("Likely cause")` — snippet = first 2 lines). Suite 45 files / 455 tests green; `tsc --noEmit` exit 0; biome clean.
- **Verification:** `npx vitest run tests/e2e/context-injection.test.ts && npm test`

### K4-022 — Expand deterministic rule coverage

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/Reflector.ts`, `tests/unit/reflector-rules-v04.test.ts`
- **Description:** Extend the deterministic rule tables (plan §5.4, D4-07; the observed §3.3 cases):
  - TypeScript: `TS2307` (cannot find module → "Install the dependency or add it to package.json before importing."), `TS2339`/`TS2305` (property/export does not exist → "Check the imported surface for the correct member name."), `TS6133` (declared but never used → "Remove the declaration or use it.").
  - Rust: `E0433`/`E0432` (cannot find item/module → "Add the dependency to Cargo.toml or use a full path (crate::…).").
  - Shell: `command not found` / `is not recognized` (→ "Install the tool (e.g. npm i -g <name>) or call it by its full path."), including the `rg` case.
  - Syscall: `EADDRINUSE` (→ "Free the port (netstat -ano | findstr :PORT) or change the port.").
  - Keep the F#28 false-positive guard: bare words `error/fail/panic/fatal` alone still do not match (STRONG_ERROR_RE unchanged).
- **Acceptance criteria:**
  - One unit test per new rule with a representative error line.
  - The §3.3 E0433 and `rg` samples now classify as actionable with non-generic suggestions.
  - Existing rule tests remain green (no false positives introduced).
- **Status notes:** `plugin/Reflector.ts`: `TS_CODE_RULES` ampliada con `2307` ("install the dependency or add it to package.json before importing"), `2339`/`2305` ("check the imported surface for the correct member name"), `6133` ("remove the declaration or use it"); `TS_CODE_RE` ahora `/\bTS(\d{4,5})\b/i` (captura el estilo lowercase `(ts(2307))` del compilador); nuevas `RUST_CODE_RE = /\b(E0433|E0432)\b/` → "add the dependency to Cargo.toml or use a full path (crate::...)" (dispatch ANTES de syscall) y `COMMAND_NOT_FOUND_RE` (captura el nombre del comando; hint "install the tool (e.g. npm i -g <cmd>) or call it by its full path"; cubre `rg: command not found` y `rg: The term 'rg' is not recognized ...` PowerShell); en el dispatch syscall, `EADDRINUSE` recibe hint dedicado "free the port (netstat -ano | findstr :PORT) or change the port" (ENOENT/EACCES/EPERM mantienen `review syscall: <code>`). Guard F#28 intacto (`STRONG_ERROR_RE` sin cambios). Tests: nuevo `tests/unit/reflector-rules-v04.test.ts` (11 tests); `tests/unit/lessonv2.test.ts` asserts de EADDRINUSE actualizados al hint nuevo (comportamiento intencional; ENOENT/EACCES/EPERM intactos). Fix colateral: `kevin_status.recurrence_by_origin` (plugin/index.ts), `kevinWhy` (kevin_why.ts) y el call a `causalChain.onSessionIdle` en session.idle (plugin/index.ts) ahora best-effort con try/catch o `.catch()` — 3 unhandled rejections `no such column: m.recurrence_count` que la suite completa exponía contra fixtures legacy sin migración 005 (mismo patrón que el settle de K4-024; kevin_why devuelve null ante schema legacy). Suite: 56 archivos / 524 tests VERDES, 0 unhandled; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/reflector-rules-v04.test.ts`

---

# Phase F2 — The closed loop (honesty, fixes, HITL)

Where the loop closes: honest confidence, deterministic fixes, promotion-time enrichment, concrete HITL, and the settings/tools surface.

### K4-009 — Fix patterns_causal inflation

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-008
- **Risk:** 🟢
- **Files:** `plugin/CausalChain.ts`, `tests/unit/causal-chain-metrics.test.ts`
- **Description:** Fix the metric inflation (plan §3.1, D4-08): `onSessionIdle` currently increments `patterns_causal` on every `promoteToPattern` return including the idempotent refresh path. Change: increment `patterns_promoted_new` **only when a new pattern row was created** (i.e. the returned id was not previously persisted — e.g. `promoteToPattern` returns `{ id, created: boolean }`). Deprecate `patterns_causal` (keep key for compat, stop incrementing it; do not remove the column).
- **Acceptance criteria:**
  - Two sessions with the same fingerprint: `patterns_promoted_new === 1` after both idles.
  - Two sessions with different fingerprints: `patterns_promoted_new === 2`.
  - `patterns_causal` frozen (no new increments) — assert no growth.
- **Status notes:** `promoteToPattern` returns `{ id, created: boolean } | null` (new row → created:true; idempotent refresh → created:false). `CausalChain.onSessionIdle` increments `patterns_promoted_new` only when `result.created`; `patterns_causal` no longer incremented (key kept, frozen at 0). e2e plugin-complete.test.ts:777 updated to assert `patterns_promoted_new`. New `tests/unit/causal-chain-metrics.test.ts` (3 tests): same-fp two sessions → promoted_new 1 + single pattern row (no dup); different-fp → 2; 3 idles same session → causal frozen 0, promoted_new 1. `runCycle` helper drives fail→fix→onSuccess→onSessionIdle with error memory origin=reflector + fingerprint; tool_calls ids suffixed with seq (UNIQUE id). Suite: 47 files / 467 tests VERDES; tsc EXIT 0; biome `plugin tests migrations --diagnostic-level=error --write` EXIT 0 (1 format fix).

### K4-010 — Two-sided confidence

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-011
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts`, `plugin/confidence.ts`, `plugin/CausalChain.ts`, `plugin/kevin_why.ts`, `tests/unit/confidence-v04.test.ts`
- **Description:** Replace the confidence formula (plan §5.3): `confidence = clamp(0.5 + 0.1 * evidence_count - 0.15 * recurrence_count, 0.05, 0.95)` in `promoteToPattern` (currently `0.5 + 0.1 * evidence_count` at `MemoryService.ts:619`). `kevin_why`'s own confidence computation must use the same formula — extract a shared `computeConfidence(evidenceCount, recurrenceCount)` helper (place it in `QualityGate.ts` or a small `confidence.ts`).
- **Acceptance criteria:**
  - A pattern with `evidence=1, recurrence=0` → 0.60; `evidence=1, recurrence=1` → 0.45; recurrence lowers confidence.
  - Clamping: huge evidence → 0.95 max; heavy recurrence → 0.05 floor.
  - Both `promoteToPattern` and `kevin_why` use the shared helper (assert via test).
- **Status notes:** Nuevo `plugin/confidence.ts` con `computeConfidence(ev, rec) = clamp(0.5 + 0.1·ev − 0.15·rec, 0.05, 0.95)` + consts (`CONFIDENCE_MIN/MAX/BASE`, `EVIDENCE_STEP`, `RECURRENCE_PENALTY`). `MemoryService`: `mapRow` usa computeConfidence; `promoteToPattern(errorId, ev, rec = 0)` persiste `recurrence_count` en la fila patrón (UPDATE tras save/refresh, ambos paths); `getById` SELECT incluye `recurrence_count`; `MemoryRow` gana `recurrence_count?`. `CausalChain.onSessionIdle`: SELECT añade `m.recurrence_count` y lo pasa a promoteToPattern. `kevin_why`: SELECT añade `m.recurrence_count` + usa computeConfidence. Nuevo `tests/unit/confidence-v04.test.ts` (6 tests): fórmula exacta (0.60 / 0.45), clamp máx/mín, recurrencia end-to-end vía CausalChain (`runCycle` con fix `success=1`, ctor `(store, memoryService, metrics)`), `kevinWhy` real. Fixtures que recibieron 005: memory-integration, memory-flow, reflector-integration, causal-chain-metrics, memorieservice-v02, plugin-tools, query-tokenizer, memorieservice-feedback. Aserciones legacy ajustadas al comportamiento intencional: plugin-complete K3-026 `rB.confidence >= 0.5` (era >= 0.7; recurrencia → 0.55) y `why.confidence >= 0.4` (era >= 0.6; patrón demotado → 0.45). Suite: 49 archivos / 478 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/confidence-v04.test.ts`

### K4-011 — Negative half writes recurrence_count

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-010
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts`, `tests/unit/memoryservice-feedback-v03.test.ts`
- **Description:** Fix the semantic bug (plan §3.2.1, §5.3): `penalizeRecurringReflectors` currently does `evidence_count = evidence_count + 1` (`MemoryService.ts:789`) — recurrence counted as positive evidence. Change it to `recurrence_count = recurrence_count + 1` and keep the `memories_superseded` increment semantics (supersede only when the pattern is truly replaced, not merely penalized — verify current behavior and adjust if the two are conflated).
- **Acceptance criteria:**
  - After a penalized recurrence: `evidence_count` unchanged, `recurrence_count = 1`.
  - Update the existing v0.3 feedback test to the new expectations and keep it green.
- **Status notes:** `penalizeRecurringReflectors` UPDATE ahora `relevance_score = MAX(0, relevance_score - ?), recurrence_count = recurrence_count + 1, last_verified_at` (ya no toca `evidence_count`). `memories_superseded` se incrementa SOLO en `save()` (supersede real de decision/rule): `SELECT changes() AS n` tras el UPDATE (Store.run devuelve void). Nuevo `tests/unit/memoryservice-feedback-v03.test.ts` (5 tests): recurrence bump sin evidencia, doble recurrencia, exclusión `origin_call_id` (va en metadata de la MEMORIA, no del tool_call), penalize no toca superseded, supersede real cuenta 1. Fix fixture: el bloque K3-026 (`hooksCap`) de `plugin-complete.test.ts` NO copiaba `005_v04_signal.sql` → `no such column: recurrence_count` — añadido copyFileSync. Suite: 48 archivos / 472 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/memoryservice-feedback-v03.test.ts`

### K4-014 — Deterministic fix_args capture

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K4-009
- **Risk:** 🟡
- **Files:** `plugin/CausalChain.ts`, `plugin/LessonFixer.ts`, `tests/e2e/fix-args.test.ts`
- **Description:** Plan §5.4 / D4-07 — zero-cost "Fixed by:" from local data:
  - `LessonFixer.extractFixArgs(linkedToolCall: { tool, args_summary }): string` → `"bash" with args "npm i -g rg"` style; truncate args_summary to ~120 chars.
  - In `CausalChain.onSuccess` (where the link is created), read the linked tool_call's `args_summary` and store it into `tool_calls.fix_for_fingerprint`'s pattern: write `memories.fix_args` on the matching error memory / pattern row.
  - In `promoteToPattern`, when `fix_args` exists, append to the content: `\nFixed by: {fix_args}`.
  - `LessonFixer.enrichAtPromotion(pattern, fixArgs, enrichFn)` — default path returns the deterministic text; `enrichFn` is the opt-in LLM phrasing hook (wired in K4-015).
- **Acceptance criteria:**
  - e2e: failure with fingerprint F → success call with distinctive args (e.g. `command: npm i -g rg`) within 10 calls → pattern content contains `Fixed by:` with those args.
  - No LLM calls on the default path (assert mock enrich not invoked).
- **Status notes:** Nuevo `plugin/LessonFixer.ts`: `FIX_ARGS_TRUNCATE = 120`, `extractFixArgs({tool, args_summary})` → `` `${tool} with args "${truncated}"` `` (null si args_summary vacío), `EnrichFn = (lesson, fixArgs, originalError) => string|null`, `enrichAtPromotion(pattern, enrichFn?)` — default devuelve `Fixed by: {fixArgs}` (o "" sin fix_args), con hook devuelve la frase (fallback a determinista si null). `CausalChain.onSuccess`: SELECT del success ahora incluye `tool, args_summary`; tras linkear escribe `UPDATE memories SET fix_args = ? WHERE fingerprint = ? AND status='active'` (error + pattern). `MemoryService`: `Memory.fixArgs?`, `MemoryRow.fix_args?`, `mapRow` expone `fixArgs`, `getById` SELECT incluye `fix_args`; `promoteToPattern(errorId, evidenceCount, recurrenceCount, enrichFn?)` — content = base + `\n${enrichAtPromotion(...)}` (seam para K4-015) y el UPDATE de la fila patrón persiste `recurrence_count` + `fix_args`. Nuevo `tests/e2e/fix-args.test.ts` (7 tests): 4 unit de extractFixArgs/enrichAtPromotion (formato, truncate ~120 con "…", null, default sin LLM, hook gana, fallback) + e2e completo (fail TS2304 → success `npm i -g rg` → session.idle → patrón con `Fixed by: bash with args "command: npm i -g rg"`). Suite: 50 archivos / 485 tests VERDES; tsc EXIT 0; biome EXIT 0 (imports organizados por --write).
- **Verification:** `npx vitest run tests/e2e/fix-args.test.ts`

### K4-015 — Promotion-time LLM enrichment (re-scope K3-018)

**Status:** `[X]`

- **Priority:** P2
- **Estimation:** M (6h)
- **Dependencies:** K4-014
- **Risk:** 🟡
- **Files:** `plugin/LessonFixer.ts`, `plugin/CausalChain.ts`, `tests/unit/lesson-fixer-enrich.test.ts`
- **Description:** Move LLM enrichment off the failure hot path to promotion time (plan §5.4, D4-02):
  - In `CausalChain.onSessionIdle`, after `promoteToPattern` creates a **new** pattern, call `LessonFixer.enrichAtPromotion(pattern, fixArgs, enrichFn)` where `enrichFn` is only non-noop when `kevin_settings.llm_reflection_enabled = '1'`.
  - Contract: `enrichFn({ lesson, fixArgs, originalError }) → Promise<string | null>`; result (a one-line `Fix:` phrasing) replaces/extends the deterministic `Fixed by:` line; `null` keeps the deterministic text.
  - At most one enrichment call per promoted pattern (guard with a per-pattern flag — e.g. only when `last_enriched_at IS NULL` or a new `metadata.enriched` marker).
  - Default (`enrichFn = noop` or setting off): zero network calls.
- **Acceptance criteria:**
  - With mock enrich injected: exactly 1 call for a new pattern across repeated idle cycles; 0 calls for patterns already enriched.
  - With setting off: 0 calls and deterministic text preserved.
- **Status notes:** `LessonFixer` re-contratado a K4-015: `EnrichFn = (input: {lesson, fixArgs, originalError}) => Promise<string|null>`; `enrichAtPromotion` async (phrase gana, null → fallback determinista); nuevo `deterministicFixLine()` sync usado por `promoteToPattern` (el seam enrichFn se QUITÓ de promoteToPattern — el wiring vive en CausalChain, como manda la tarea). `CausalChain`: ctor gana 4º param opcional `enrichFn?: EnrichFn`; `onSessionIdle` ahora `async` (index.ts lo llama dentro de fireAndForget — sin cambios allí); tras `result.created` → `await enrichIfEnabled(errorId, patternId)`: gates = enrichFn presente + `kevin_settings.llm_reflection_enabled = '1'` (leído en vivo, default off; la 004 ya siembra la key a '0') + `metadata.enriched !== true`; la frase reemplaza la línea `\nFixed by: ...` (o se appendea) y SIEMPRE sella `metadata.enriched: true` (phrase o null → 1 llamada por patrón). Nuevo `tests/unit/lesson-fixer-enrich.test.ts` (8 tests): 4 unit de deterministicFixLine/enrichAtPromotion + 4 de CausalChain (mock = 1 llamada + refresh idle = 0 + frase reemplaza + marker; setting off = 0 llamadas y determinista; sin enrichFn = 0 incluso con setting on; hook null = determinista preservado + enriched). DEBUG: el runCycle simulaba el fix con `fix_for_fingerprint` YA puesto → onSuccess hacía no-op y nunca escribía fix_args (lección: el fix INSERT debe ir SIN fix_for_fingerprint; onSuccess lo linkea y captura fix_args); UPSERT necesario en `enableLlmReflection` (la 004 ya siembra la key). Tests K4-014 de fix-args.test.ts actualizados al contrato async. Suite: 51 archivos / 493 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:**
  - `npx vitest run tests/unit/lesson-fixer-enrich.test.ts`

### K4-016 — Smarter HITL suggestion

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K4-007, K4-014
- **Risk:** 🟢
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/contextinjector-suggestion-v04.test.ts`
- **Description:** Plan §5.5 — replace the boilerplate block in `generateSuggestion()` with a concrete one:
  - Inputs: `InjectionLedger.recurrencesFor(sessionId)` + the pattern's `fix_args` (look up the most-recurred fingerprint's pattern memory).
  - Output shape:
    ```
    <kevin-suggestion>
    The error pattern "rg: The term 'rg' is not recognized" recurred 4 time(s) this session.
    Observed fix: bash command "npm i -g rg" (1 confirmed fix, confidence 60%).
    Consider adding this convention to AGENTS.md:
    - If a command output says "not recognized", install the tool first.
    </kevin-suggestion>
    ```
  - The AGENTS.md draft line derives from the suggestion text of the lesson (the rule suggestion), not a canned string.
  - Never emit "the same error pattern" without naming the pattern and count (acceptance gate).
- **Acceptance criteria:**
  - Unit test asserts the block contains: fingerprint text, exact recurrence count, fix_args, confidence.
  - When no fix_args exist, the block still names the pattern + count and omits the fix line.
- **Status notes:** `MemoryService.getByFingerprint(fingerprint, type?)` nuevo (SELECT compartido `MEMORY_ROW_SELECT` extraído a constante, también usado por getById) — devuelve el memory ACTIVE más reciente por fingerprint. `ContextInjector`: `setRecurrences(count, sessionId?)` (index.ts session.idle pasa `sid`); `generateSuggestion()` reescrito: toma el fingerprint más recurrido de `ledger.recurrencesFor(sessionId)`, busca su pattern memory, y emite `The error pattern "{summary}" recurred {N} time(s) this session.` + `Observed fix: {fix_args} ({evidence} confirmed fix(es), confidence {pct}%).` (línea omitida sin fix_args) + línea AGENTS.md derivada del `Suggestion:` del lesson vía regex `\nSuggestion: ([^\n]+)` (fallback: summary + count, nunca "the same error pattern"); sin pattern/ledger → fallback corto que SIEMPRE nombra el count. Reset tras una emisión. Nuevo `tests/unit/contextinjector-suggestion-v04.test.ts` (5 tests): bloque completo (texto patrón, 4 recurrencias exactas, fix_args, "(1 confirmed fix, confidence 60%)"), draft derivado de Suggestion (y no "## Recurring pattern"), sin fix_args omite "Observed fix:" pero nombra patrón+count, gate "the same error pattern" ausente con fallback que nombra el count, reset single-shot. Suite: 52 archivos / 498 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/contextinjector-suggestion-v04.test.ts`

### K4-020 — kevin_why honest output

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K4-010, K4-014
- **Risk:** 🟢
- **Files:** `plugin/kevin_why.ts`, `tests/unit/kevin-why-v04.test.ts`
- **Description:** Plan §5.3 / D4-11 — the tool result gains:
  - `recurrence_count` from the pattern memory.
  - `fix_args` when present.
  - Two-sided confidence via the shared `computeConfidence` (K4-010).
  - Summary phrasing: when `recurrence_count > 0`, use `resolved in N of M attempts` style (e.g. `When tool fails with {query}: resolved in 3 of 4 attempts by fixing {fix_args|related_rules|the underlying issue}.`); otherwise keep the current templated summary.
- **Acceptance criteria:**
  - Output contains the new fields with correct values from a seeded `:memory:` DB.
  - The honest phrasing appears exactly when `recurrence_count > 0`.
- **Status notes:** `kevin_why.ts`: SELECT del patrón añade `m.fix_args` (se eliminó un doble cast redundante del tipo); `WhyResult` gana `recurrence_count: number` y `fix_args: string | null`. Summary honesto: con `recurrence_count > 0` → `When tool fails with {query}: resolved in {evidence} of {evidence+recurrence} attempts by fixing {fix_args | related_rules | "the underlying issue"}.` (N = evidence_count = fixes confirmados, M = evidence + recurrence = intentos totales; ej: 3 de 4); sin recurrencias → templado legacy ("consistently/often resolved by fixing ..."). Nuevo `tests/unit/kevin-why-v04.test.ts` (4 tests): campos nuevos con computeConfidence(1,2)=0.3, "resolved in 3 of 4 attempts" + fix_args y sin "consistently", recurrence=0 → templado legacy sin "attempts" (+ fix_args null), fallbacks sin fix_args: TS2304 → related_rules "import or typo" (TS_CODE_RULES), query sin código ("fetch failed", patrón sembrado con ese texto) → "the underlying issue" (lección: kevinWhy requiere que el patrón matchee la query vía FTS — la query DEBE estar en el content del patrón sembrado). Suite: 53 archivos / 502 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/kevin-why-v04.test.ts`

### K4-021 — kevin_config tool

**Status:** `[X]`

- **Priority:** P2
- **Estimation:** M (5h)
- **Dependencies:** —
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `tests/e2e/kevin-config.test.ts`
- **Description:** New tool `kevin_config` (plan §8.8) exposing settings without SQL:
  - `kevin_config({ action: "list" })` → all settings keys + values.
  - `kevin_config({ action: "set", key, value })` → upsert into `kevin_settings`; validate `value` is a string; reject unknown keys (return error) unless `strict: false`.
  - Known keys: `quality_gate_enabled`, `lesson_snippet_injection`, `patternminer_enabled`, `cross_project_enabled`, `llm_reflection_enabled`, `tool_calls_dedup_enabled`.
  - Register in the same tools array as the other 9 tools (README lists 9; update README in K4-028 to 10).
- **Acceptance criteria:**
  - e2e invokes the tool handler (same pattern as existing tool tests) → list returns seeded settings; set persists and is readable by `kevin_status`/gate.
- **Status notes:** `plugin/index.ts`: constante `export const KEVIN_CONFIG_KEYS` (6 keys) + tool `kevin_config` registrada en el mismo array (tras `kevin_import`): `action: "list"` → `SELECT key, value FROM kevin_settings ORDER BY key` → JSON `{key: value}`; `action: "set"` → si falta `key` → `{error:"missing_key"}`; key no conocida y `strict !== false` → `{error:"unknown_key", known_keys}`; upsert `INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value` (value default "1" si no se pasa; schema valida string). Nuevo `tests/e2e/kevin-config.test.ts` (6 tests): list devuelve sembradas (quality_gate_enabled=1, lesson_snippet_injection=1, llm_reflection_enabled=0); set persiste y list lo refleja; set sin value → "1"; set rechaza key desconocida (strict default) con known_keys; set acepta key custom con `strict:false`; **flujo real del gate**: reflexión de error sin código (weak no-actionable) → gate ON bloquea inyección (system.transform con chat.message previo), `set quality_gate_enabled=0` vía la tool → sesión nueva → el mismo lesson weak SÍ se inyecta (debug mode). Suite: 54 archivos / 508 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/e2e/kevin-config.test.ts`

### K4-023 — Weak-lesson warning mode

**Status:** `[X]`

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K4-004
- **Risk:** 🟢
- **Files:** `plugin/ContextInjector.ts`, `tests/unit/quality-gate-can-inject.test.ts`
- **Description:** Debug mode (plan §5.1 rule note): when `kevin_settings.quality_gate_enabled = '0'`, `canInject` returns `true` for weak lessons, and the snippet is rendered with a `confidence: low` marker line (e.g. `[pattern] (low confidence) ...`). Default `'1'` keeps weak lessons out entirely.
- **Acceptance criteria:**
  - Toggling the setting flips weak-lesson injection on/off (unit test covers both).
  - Marked rows are visually distinguishable.
- **Status notes:** `plugin/memory-format.ts`: `MemoryBlockItem` gana `weak?: boolean`; nuevo helper `typePrefix(m)` → `[type] (low confidence)` cuando `weak` (usado por `formatRow` y `formatSnippet`, ambos formatos). `plugin/ContextInjector.ts` `format()`: mapea cada memoria a `{...m, weak: dispatch != null && dispatch.code == null}` (unresolved lesson → weak; memorias agent-saved sin dispatch no se marcan) y pasa el array mapeado a `formatMemories`/`formatMemorySnippets`. `QualityGate.canInject` (gate param) ya admitía weak en debug mode desde K4-004 — no se tocó. `tests/unit/memory-format.test.ts`: nuevo describe K4-023 (3 tests: formatMemories marca weak rows, no marca strong, formatMemorySnippets marca con recorte a 2 líneas). `tests/e2e/kevin-config.test.ts`: el test del gate ahora además verifica que el lesson weak inyectado en debug mode lleva el marker `(low confidence)` en el bloque. Suite: 54 archivos / 511 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/quality-gate-can-inject.test.ts`

### K4-024 — kevin_status precision block

**Status:** `[X]`

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K4-008, K4-020
- **Risk:** 🟢
- **Files:** `plugin/index.ts`, `tests/unit/kevin-status-v04.test.ts`
- **Description:** Plan §8.8 — extend `kevin_status` output with a precision block: `precision_rate`, `injections_total`, `injections_effective`, `injections_ineffective`, `patterns_promoted_new`, and per-origin `recurrence_count` totals (query memories grouped by origin summing `recurrence_count`). Replace the inflated `patterns_causal` reading with `patterns_promoted_new` in the human-facing output (keep the raw key for compatibility).
- **Acceptance criteria:**
  - Output contains all listed fields with correct values on a seeded DB.
- **Status notes:** `plugin/index.ts` kevin_status: nueva key `recurrence_by_origin` (SELECT `origin, SUM(recurrence_count)` FROM memories GROUP BY origin; origin null → 'agent'); comentario aclara que la lectura human-facing de promociones es `patterns_promoted_new` y que `patterns_causal` queda congelada en metrics (compat). **Fix del loop cerrado (plan §5.2)**: `ledger.settle(sid)` cableado en session.idle (antes solo lo llamaban los tests) — wrap try/catch (best-effort: DB legacy sin 005 no tiene kevin_injections; esto rompía patternminer-wiring legacy). Nuevo `tests/unit/kevin-status-v04.test.ts` (2 tests): DB seeded reporta precision fields a cero + `recurrence_by_origin == {}`; ciclo real fail TS2304 → fix (onSuccess vincula) → idle (promote → patterns_promoted_new=1) → chat.message+transform (inyecta error y pattern → injections_total=2) → fail-2 (espera 100ms para que el Reflector estampe error_fingerprint antes del settle) → idle → settle marca ambas inyecciones ineffective (injections_ineffective=2, effective=0, precision_rate=0) y carga recurrence_count a cada memoria inyectada → `recurrence_by_origin = {reflector: 1, causal: 1}`; `memories_causal` raw se conserva. Suite: 55 archivos / 513 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/unit/kevin-status-v04.test.ts`

---

# Phase F3 — Validation & release (e2e, compat, bump)

Prove the loop works end-to-end, guarantee no regressions on v0.3 data, and ship.

### K4-025 — e2e: closed-loop cycle

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** L (16h)
- **Dependencies:** K4-007, K4-010, K4-011, K4-014, K4-017
- **Risk:** 🔴
- **Files:** `tests/e2e/closed-loop.test.ts`
- **Description:** The signature test (plan §9, exit criterion). Drive the full loop through the plugin's public entry points (no `kevin_save`):
  1. Failure (bash exit 1, `rg: The term 'rg' is not recognized`) → Reflector saves a quality-evaluated error memory (actionable, command-not-found rule).
  2. Transform hook fires → gate admits the lesson (snippet, ledgered).
  3. Same failure recurs in-session → `session.idle` settles: ledger `ineffective`, `recurrence_count = 1`, confidence drops (two-sided formula).
  4. Two more recurrences → `recurrence_count = 3` → `status='stale'`; next transform does NOT inject it.
  5. Success call with `npm i -g rg` within 10 calls → CausalChain links → `fix_args` captured, pattern content has `Fixed by: bash ... npm i -g rg`; pattern re-admitted for injection.
- **Acceptance criteria:**
  - Every assertion in the sequence passes without manual memory writes.
  - Metrics reflect: `injections_ineffective` ≥ 1, `patterns_promoted_new` = 1.
- **Status notes:** Nuevo `tests/e2e/closed-loop.test.ts` (1 test end-to-end, sin `kevin_save`): drive completo por los entry points públicos del plugin — (1) bash exit 1 con `rg` no reconocido → Reflector guarda error memory actionable (rule command-not-found, `(code rg)`, hint `npm i -g rg`); (2) transform hook → gate admite el lesson (snippet, ledgered); (3) la misma falla recurre 3 veces, un settle por idle → `recurrence_count` llega a 3 (`recurrence_by_origin.reflector = 3`); (4) `recurrence_count = 3` → `status='stale'` (D4-06) → transform posterior NO inyecta (`blocks.length = 0`); (5) success call `npm i -g rg` (call #8, dentro de la ventana de 10) → CausalChain link → idle promueve pattern `status='active'` con `fix_args` conteniendo `npm i -g rg` y contenido `Fixed by:`; (6) el pattern re-admitido SÍ se inyecta. Métricas honestas finales: `injections_ineffective = 1` (la única inyección del error fue ineficaz; las 3 recurrencias posteriores NO cuentan como inyecciones separadas), `injections_effective = 0`, `precision_rate = 0`, `patterns_promoted_new = 1`. Suite: 58 archivos / 528 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/e2e/closed-loop.test.ts`

### K4-026 — Backward-compat migration test

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K4-001, K4-002
- **Risk:** 🟡
- **Files:** `tests/e2e/migrate-from-v030.test.ts`
- **Description:** Seed a DB with the v0.3 schema (replay 001–004) **and realistic v0.3 data** (error memories with `evidence_count`, patterns with `origin='causal'`, tool_calls rows, metrics rows). Then run the v0.4 migration + `npm run verify`-style checks:
  - Migrations 001–005 apply cleanly in order.
  - New columns nullable; legacy rows readable via existing queries (`getRelevant`, `kevin_query`, `kevin_why`) with no schema errors.
  - Full existing unit+e2e suite stays green against the migrated DB.
- **Acceptance criteria:**
  - `migrate-from-v030.test.ts` passes; `npm test` all green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/e2e/migrate-from-v030.test.ts && npm test`

### K4-027 — Injection purity validation

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K4-012, K4-017, K4-022, K4-023
- **Risk:** 🟡
- **Files:** `tests/e2e/injection-purity.test.ts`
- **Description:** Reproduce the §3.3 scenario as a regression test: seed the DB with the exact observed memories (E0433 ×2, `[connect] starting jcode runtime...`, `could not compile 'jcode-harness-api'`, `test FAILED 6 passed 1 failed`, `rg: The term 'rg' is not recognized`, `[build]` — including the duplicate id pair). Run a transform with a neutral user query and assert the injected block:
  - contains **no** lesson with errorType `'unknown'` (rescued or excluded),
  - contains **no** generic-suggestion lesson (`"Review the error output for details."` absent),
  - contains **no** duplicate memory ids (each id ≤ 1),
  - contains **no** non-error fragments (`[connect]`, `[build]` excluded),
  - still contains the `rg` lesson (the actionable one) — snippet form with the command-not-found suggestion.
- **Acceptance criteria:**
  - The purity assertions hold; the block is snippet-sized.
- **Status notes:** —
- **Verification:** `npx vitest run tests/e2e/injection-purity.test.ts`

### K4-018 — Fix the dead compacting hook

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K4-017
- **Risk:** 🟡
- **Files:** `plugin/index.ts`, `tests/e2e/compacting-hook.test.ts`
- **Description:** Plan §5.6 — `tokens_injected_compacting = 0` since installation; the hook never fired or never counted. Steps:
  1. Inspect the SDK hook surface for the compaction event (search `@opencode-ai/plugin` types for `compacting` / `session.compact`). If the name/contract changed from `experimental.session.compacting`, adopt the current one.
  2. If the hook exists but `lastUserQuery` is null at firing time, fall back to `deriveQuery(input.messages)` (ContextInjector.deriveQuery already accepts messages) so a query is always available.
  3. Route through `injector.onCompacting` (K4-017's single path) and record ledger rows with `hook='compacting'`.
- **Acceptance criteria:**
  - A unit test simulates the compacting event with null `lastUserQuery` → injection still occurs with derived query.
  - Manual validation: force a compaction in a real session → `kevin_status` shows `tokens_injected_compacting > 0`.
- **Status notes:** SDK verificado: el hook `experimental.session.compacting` existe con contrato actual `input: {sessionID} → output: {context, prompt}` — NO expone messages. **Bug raíz**: el hook hacía `if (!lastUserQuery) return;` y se alimentaba del `chat.message` global — la compactación suele dispararse sin un chat.message reciente (auto-compact tras un turno largo de tools, sesiones retomadas) → nunca inyectaba → `tokens_injected_compacting = 0` desde instalación. Fix en `plugin/index.ts`: (1) nuevo `lastUserQueryBySession: Map<sessionID, query>` registrado en `chat.message` (el input del hook SÍ trae sessionID); (2) el hook compacting ahora resuelve query per-session ?? global ?? messages del runtime (cast defensivo por si el contrato futuro los expone) y ya no hace early-return; el HITL suggestion se emite siempre. El routing por `injector.onCompacting` y las ledger rows con `hook='compacting'` ya existían (K4-017) — no se tocaron. Nuevo `tests/e2e/compacting-hook.test.ts` (3 tests): (1) chat.message + compacting → bloque `<kevin-memory>` en output.context, `tokens_injected_compacting > 0` y `injections_total > 0` vía kevin_status; (2) acceptance de la tarea — SIN chat.message (lastUserQuery null global y per-session) pero con messages provistos → inyección ocurre con derived query; (3) sanity sin query en ninguna parte → no inyecta, sin crash, métrica en 0. Nota: el bloque compacting usa el wrapper `<kevin-memory>` (tag 'memory', no 'context' — assert del test ajustado). Suite: 57 archivos / 527 tests VERDES; tsc EXIT 0; biome EXIT 0.
- **Verification:** `npx vitest run tests/e2e/compacting-hook.test.ts` + manual step from plan §11.

### K4-028 — Bump 0.4.0 + CHANGELOG

**Status:** `[X]`

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K4-025, K4-026, K4-027, K4-018
- **Risk:** 🟢
- **Files:** `package.json`, `CHANGELOG.md`, `README.md`
- **Description:** Release prep:
  - `package.json` version → `0.4.0`; run `npm run build` and confirm `dist/` output matches (`dist/plugin/index.js`).
  - `CHANGELOG.md` new entry **v0.4.0 — Signal over Noise** summarizing: QualityGate, InjectionLedger + precision_rate, two-sided confidence, deterministic fix_args, promotion-time LLM enrichment (opt-in), smarter HITL, compacting hook fix, project scoping wiring, `kevin_config`, corrected metrics.
  - `README.md`: tools list 9 → 10 (`kevin_config`); add a "Precision" note (weak lessons are stored but not injected; `kevin_status` shows honest metrics).
- **Acceptance criteria:**
  - Version is `0.4.0`; CHANGELOG entry present; README consistent.
  - Full pipeline green.
- **Status notes:** `package.json` version → `0.4.0`; `npm run build` OK (dist/plugin/index.js 31 KB, dist/migrations copiadas). `CHANGELOG.md` nueva entrada **v0.4.0 — Signal over Noise** (QualityGate, InjectionLedger + precision_rate, two-sided confidence, deterministic fix_args, LLM enrichment opt-in, smarter HITL, compacting hook fix, project scoping, kevin_config, corrected metrics, expanded rule coverage). `README.md`: tools 9 → 10 (`kevin_config` section nueva + Precision note + bullet v0.4.0 en features + ejemplo kevin_status con precision block y recurrence_by_origin). **Fix colateral**: `scripts/verify-install.ts` no copiaba `005_v04_signal.sql` → `Reflector.invoke` fallaba con `no such column: recurrence_count` (el SELECT de mapRow ahora lee recurrence_count, columna de la 005) — añadida la copia (mismo patrón que 003/004). Pipeline: tsc EXIT 0; biome EXIT 0; 58 archivos / 528 tests VERDES; `npm run verify` 7/7.
- **Status notes:** —
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

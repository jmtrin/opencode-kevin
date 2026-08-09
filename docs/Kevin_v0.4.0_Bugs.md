# Opencode-kevin — Bug Catalog v0.4.0

**Version:** 0.4.0 ("Signal over Noise")
**Date:** 2026-08-09
**Status:** Resolved — all 16 bugs fixed and verified (2026-08-09)
**Source:** Code audit of `plugin/` against the v0.4.0 plan (`docs/Kevin_v0.4.0_Plan.md`) and task list (`docs/Kevin_v0.4.0_Task.md`). Every entry was verified against source and existing tests.

---

## 1. Summary

| ID | Severity | Title | Files |
|---|---|---|---|
| BUG-001 | Critical | `kevin_query(evidence: true)` never returns evidence | `plugin/index.ts`, `plugin/MemoryService.ts` |
| BUG-002 | Critical | `cross_project_enabled` can never be enabled (string vs number) | `plugin/MemoryService.ts` |
| BUG-003 | Critical | Injection settle undercounts cross-session recurrences | `plugin/InjectionLedger.ts` |
| BUG-004 | Severe | Retrospective "false-positive recap" is dead in production | `plugin/Retrospective.ts`, `plugin/ToolCallObserver.ts` |
| BUG-005 | Severe | `QualityGate.evaluate` / generic-suggestion ban dead in injection path | `plugin/ContextInjector.ts`, `plugin/QualityGate.ts` |
| BUG-006 | Severe | CausalChain compares rowids across tables | `plugin/CausalChain.ts` |
| BUG-007 | Normal | `kevin_why` executes a dead query; LIKE never matches | `plugin/kevin_why.ts` |
| BUG-008 | Normal | OKF export uses stale confidence formula; round-trip loses demotion | `plugin/okf-export.ts`, `plugin/okf-import.ts` |
| BUG-009 | Normal | `okf-import` embeds evidence marker into content (injected verbatim) | `plugin/okf-import.ts` |
| BUG-010 | Normal | `kevin_get` omits v0.3/v0.4 fields | `plugin/index.ts` |
| BUG-011 | Normal | Global `lastUserQuery` bleeds across sessions | `plugin/index.ts` |
| BUG-012 | Normal | HITL suggestion consumed by first hook only | `plugin/index.ts`, `plugin/ContextInjector.ts` |
| BUG-013 | Low | `redactSecrets` over-redacts harmless "token <word>" text | `plugin/ToolCallObserver.ts` |
| BUG-014 | Low | `METRIC_KEY_LABELS` missing v0.4 keys | `plugin/Retrospective.ts` |
| BUG-015 | Low | Agent-saved memories without fingerprint settle as always-effective | `plugin/ContextInjector.ts`, `plugin/InjectionLedger.ts` |
| BUG-016 | Low | `inject()` double-fetches `getRelevant`, double-bumping relevance | `plugin/ContextInjector.ts` |

---

## 2. Severity legend

| Severity | Meaning |
|---|---|
| **Critical** | Feature is silently non-functional or measures the wrong thing in normal operation; users get wrong data without any error. |
| **Severe** | Feature works only in tests / by accident; production path contradicts the documented plan. |
| **Normal** | Wrong but bounded behavior; usually one feature degraded, others unaffected. |
| **Low** | Cosmetic, perf, or over-cautious behavior with limited impact. |

---

## 3. Critical

### BUG-001 — `kevin_query(evidence: true)` never returns evidence

- **Files:** `plugin/index.ts:251-269`, `plugin/MemoryService.ts:106-115, 515`
- **Symptom:** The `evidence` flag (v0.3.0, K3) always yields `confidence: null, evidence_count: null, last_verified_at: null` for every row. The tool advertises the payload; it never delivers it.
- **Root cause:** With `full=false` (the default), `MemoryService.query()` returns `SlimMemory[]` via `toSlim()`, which only carries `{ id, type, scope, score, snippet }`. `index.ts:260` casts those slim rows to `Memory[]` and reads `.confidence`, `.evidenceCount`, `.lastVerifiedAt` — all `undefined`, so the fallback `?? null` fires on every row.
- **Why tests miss it:** No test passes `evidence: true` (verified by grep over `tests/`).
- **Fix guidance:** Either (a) have `query()` accept the evidence flag and include the fields in the slim payload, or (b) map evidence from the full row inside the handler (call `getById` per row — expensive) — prefer (a): extend `QueryInput` with `evidence?: boolean` and have `toSlim`/a new mapper include `confidence`, `evidence_count`, `last_verified_at` when set. Keep the `Memory` interface unchanged for the `full=true` path.

### BUG-002 — `cross_project_enabled` can never be enabled

- **Files:** `plugin/MemoryService.ts:518-529`
- **Symptom:** Imported (cross-project) memories are always hidden from `query`/`getRelevant`, even after `kevin_config({ action: "set", key: "cross_project_enabled", value: "1" })`. The K3-019 opt-in is permanently off.
- **Root cause:** `isCrossProjectEnabled()` reads `row.value` as `number` and tests `(row?.value ?? 0) === 1`. The column stores TEXT: the seed is `('cross_project_enabled', '0')` (`migrations/004_v03_knowledge.sql:58`) and `kevin_config` upserts `args.value` (a string) — `'1' === 1` is `false`.
- **Why tests miss it:** Every test seeds `"0"` (never `1`) — `tests/unit/migrate_003.test.ts:140`, `tests/unit/store-prepare-003.test.ts:58`.
- **Fix guidance:** Compare as string: `row?.value === "1"` (keep the `?? "0"` fallback). Add a test that seeds `"1"` and asserts imported rows appear in `query()`/`getRelevant()`.

### BUG-003 — Injection settle undercounts cross-session recurrences

- **Files:** `plugin/InjectionLedger.ts:108-130`
- **Symptom:** An injection of a lesson created in a *previous* session can be marked `effective` even though the error recurred after injection in this session. Precision rate is inflated.
- **Root cause:** The `countRow` query excludes the *first* failing call of the fingerprint in the session (`id != (SELECT ... ORDER BY rowid ASC LIMIT 1)`). The comment assumes that first failure "created the lesson". That assumption only holds when the lesson was created in this session. When the lesson was created in an earlier session, the first failure of this session is a genuine post-injection recurrence, but it is excluded — so a single recurrence after injection yields `n = 0` → `effective`.
- **Why tests miss it:** Existing settle tests seed lesson + failure in the same session, where the exclusion is correct.
- **Fix guidance:** Bound the exclusion to the lesson's own creation call, e.g. exclude only the failing call whose `ts` is strictly before the *first injection of that fingerprint in the session* (`ts < MIN(injected_at)` for that fingerprint), or track the creating call id on the memory and exclude only that rowid. Add a test: lesson injected from session A, failure in session B after injection → `ineffective`.

---

## 4. Severe

### BUG-004 — Retrospective "false-positive recap" is dead in production

- **Files:** `plugin/Retrospective.ts:165-174`, `plugin/ToolCallObserver.ts:64-67`
- **Symptom:** The "## False-positive recap" section always reports "Ninguna lección ... recurrrió" even when a reflector lesson recurred. The negative-feedback recap K2-027 relies on never-matching identifiers.
- **Root cause:** The recap queries `tool_calls WHERE fingerprint = ?` using the *lesson's* `fingerprint` (hash of stderr/stdout). But `tool_calls.fingerprint` is `computeFingerprint(`${tool}|${argsSummary}|${success}`)` — a different identity dimension. In production they can never match.
- **Why tests miss it:** `tests/e2e/retrospective.test.ts:243-274` hand-inserts a `tool_calls` row with `fingerprint = 'cccccccccccccccc'` explicitly "simulating K2-027 wiring" — the real wiring never populates that column with error fingerprints.
- **Fix guidance:** Use the same identity the rest of the feedback loop uses: `COALESCE(error_fingerprint, fingerprint)` (as in `InjectionLedger.recurrencesFor`). Update the e2e test to seed `error_fingerprint` instead of `fingerprint`, and to populate it via the real `Reflector.onLinkError` path where possible.

### BUG-005 — `QualityGate.evaluate` and the generic-suggestion ban are dead in the injection path

- **Files:** `plugin/ContextInjector.ts:200-251`, `plugin/QualityGate.ts:70-89`
- **Symptom:** Plan §5.1 rule 2 ("never inject a lesson whose suggestion is a generic fallback") is not enforced at injection time. Every memory without `metadata.dispatch` — including legacy reflector lessons and any agent-saved error note — is treated as `strong` + `actionable` and injected.
- **Root cause:** `ContextInjector.admit()` derives `strength`/`isActionable` purely from `metadata.dispatch` (`unresolved = dispatch != null && dispatch.code == null`). `QualityGate.evaluate()` — which checks the generic-suggestion set and rescues `errorType` — is only called from its own unit tests (`tests/unit/quality-gate.test.ts`). There is no production call site.
- **Why tests miss it:** `quality-gate.test.ts` tests `evaluate()`/`canInject()` in isolation; the injector path tests feed memories with/without dispatch but never assert generic-suggestion behavior.
- **Fix guidance:** Decide the intended semantics and wire them consistently: if legacy lessons without dispatch should be injectable, document it and keep the gate; otherwise compute strength from the stored lesson payload (suggestion text + dispatch) at save time and persist it, so `admit()` can enforce rule 2 without the original `QualityLesson` shape. At minimum, add an injector-level test asserting a generic-suggestion lesson with `dispatch.code == null` is *not* admitted.

### BUG-006 — CausalChain compares rowids across different tables

- **Files:** `plugin/CausalChain.ts:139-148`
- **Symptom:** The promotion/refresh guard `HAVING MAX(tc.rowid) > MAX(m2.rowid)` compares rowids from `tool_calls` and `memories` — two independent rowid sequences. It is semantically meaningless and fragile: it happens to "work" because tool_calls rows usually outnumber memory rows in a live DB, but any DB where memory inserts outpace tool-call inserts (large OKF imports, seeded DBs, restored backups) will either starve refreshes or refresh spuriously.
- **Fix guidance:** Compare timestamps instead: `MAX(tc.ts) > COALESCE(MAX(m2.updated_at), '1970-01-01')`. Add a regression test with a pattern memory inserted *after* the linked tool_calls and assert the refresh is skipped.

---

## 5. Normal

### BUG-007 — `kevin_why` executes a dead query; the LIKE branch never matches

- **Files:** `plugin/kevin_why.ts:90-112`
- **Symptom:** (a) The `traceRows` query is executed but its result is never used — the trace is built from the `errorSessions` loop; (b) the fallback `tc.fingerprint LIKE '%<8-hex>%'` can never match an error fingerprint because `tool_calls.fingerprint` is the `tool|args|success` hash (same mismatch as BUG-004).
- **Fix guidance:** Delete `traceRows` (dead code) or build the trace from it; drop the LIKE branch and rely on `tc.fix_for_fingerprint = ?` / `COALESCE(error_fingerprint, fingerprint)`. Keep the output shape unchanged.

### BUG-008 — OKF export uses the stale confidence formula; round-trip loses recurrence demotion

- **Files:** `plugin/okf-export.ts:50, 107`, `plugin/confidence.ts`
- **Symptom:** Exported `confidence` uses the v0.3.0 formula `min(1, 0.5 + 0.1 * evidence_count)`, while v0.4.0 (`K4-010`) computes two-sided confidence (boost for fixes, demotion for `recurrence_count`). A lesson demoted by recurrences still exports a rosy 0.70, and the re-imported copy shows different confidence than the source. `recurrence_count` is never exported, so the demotion cannot survive a round-trip.
- **Fix guidance:** Export `recurrence_count` (and import it) and compute the exported `confidence` via `computeConfidence(evidence_count, recurrence_count)`. Keep the old formula only for DBs that predate `recurrence_count` (guard on column presence).

### BUG-009 — `okf-import` embeds the evidence marker into content, which is injected verbatim

- **Files:** `plugin/okf-import.ts:245-252`
- **Symptom:** Imported entries store `content + "\n\n[imported evidence_count=N, last_verified_at=...]"` inside the memory *content*. `ContextInjector` later injects that marker text verbatim into model prompts, and it shows up in every query/retrospective. The same values are already passed separately to `save()` via `evidenceCount`/`lastVerifiedAt`.
- **Fix guidance:** Remove the marker from the content; pass only the typed fields. For DBs where the marker already leaked in, consider a cleanup migration or leave a note (content edits are user-visible data).

### BUG-010 — `kevin_get` omits the v0.3/v0.4 evidence fields

- **Files:** `plugin/index.ts:282-312`
- **Symptom:** `kevin_get` returns `updatedAt` but not `confidence`, `evidence_count`, `recurrence_count`, `last_verified_at`, `status`, `fix_args`. Clients that need the evidence payload (e.g. after `kevin_query` slims) have no full-fidelity read path (BUG-001 makes it worse).
- **Fix guidance:** Add the missing fields to the returned JSON: `confidence` (via `computeConfidence`), `evidenceCount`, `recurrenceCount`, `lastVerifiedAt`, `status`, `fixArgs`. Add/extend a unit test asserting the payload.

### BUG-011 — Global `lastUserQuery` bleeds across sessions

- **Files:** `plugin/index.ts:109, 651-677`
- **Symptom:** `lastUserQuery` is a process-global never reset on `session.created`/`session.idle`. A new session whose first `system.transform` fires before any `chat.message` re-injects lessons matching the previous session's query — and because the per-session seen-set resets on `session.created`, those memories are injected again (repeated lessons across sessions).
- **Fix guidance:** Prefer `lastUserQueryBySession.get(sessionID)` in the transform hook (as the compacting hook already does at `index.ts:689`); clear the global on `session.idle` and delete the entry on `session.created`. Add an e2e test with two sequential sessions asserting session B does not reuse session A's query.

### BUG-012 — HITL suggestion is consumed by whichever hook fires first

- **Files:** `plugin/index.ts:666-687`, `plugin/ContextInjector.ts:84-88`
- **Symptom:** `generateSuggestion()` resets `lastRecurrenceCount`/`lastRecurredSession` on every call. If a session produces both a `system.transform` and a `compacting` hook (common in long sessions), only the first consumes the suggestion; the other hook injects nothing. The K4-018 comment claims "The HITL suggestion still fires regardless" — it fires at most once, not per hook.
- **Fix guidance:** Decide intended semantics. Options: (a) keep once-per-session and document it (current behavior), or (b) track consumption per hook/session so both hooks emit the block. If (a), fix the misleading comment; if (b), store `lastSuggestionBySession` and clear after both hooks fired or at `session.idle`.

---

## 6. Low

### BUG-013 — `redactSecrets` over-redacts harmless "token <word>" text

- **Files:** `plugin/ToolCallObserver.ts:23-27`
- **Symptom:** The pattern `/\btoken\s+\S+/gi` mangles harmless text such as "token budget", "token count", "max token limit" in args summaries, `stderr`, and `stdout` — corrupting stored summaries and fingerprints of perfectly benign calls (LLM tools routinely contain "token" phrasing).
- **Fix guidance:** Narrow the pattern to assignment/credential contexts, e.g. `\b(access_?token|auth_?token|api_?token|token\s*[=:]\s*\S+)\b` or require an `=`/`:` delimiter. Update any redaction test to cover "token budget" staying intact.

### BUG-014 — `METRIC_KEY_LABELS` missing v0.4 keys

- **Files:** `plugin/Retrospective.ts:41-48`, `plugin/metrics.ts:10-24`
- **Symptom:** The retrospective "## Métricas" section prints raw keys (`injections_total`, `injections_effective`, `injections_ineffective`, `patterns_promoted_new`, `patterns_causal`, `causal_links`, `memories_superseded`) instead of Spanish labels.
- **Fix guidance:** Add the 7 missing entries to `METRIC_KEY_LABELS`. Cosmetic; no behavioral impact.

### BUG-015 — Agent-saved memories without fingerprint settle as always-effective

- **Files:** `plugin/ContextInjector.ts:268-274`, `plugin/InjectionLedger.ts:110-130`
- **Symptom:** `recordInjections` writes `fingerprint: m.fingerprint ?? ""`; an agent-saved memory with no fingerprint produces ledger rows that can never match a failing tool_call (`COALESCE(error_fingerprint, fingerprint) = ''` never matches), so they always settle `effective` — noise in the precision metric.
- **Fix guidance:** Skip ledger recording (or mark `effective` immediately) for memories without a fingerprint, or record a sentinel that `settle` treats as "not measurable". Document the choice in the ledger class doc.

### BUG-016 — `inject()` double-fetches `getRelevant`, double-bumping relevance

- **Files:** `plugin/ContextInjector.ts:162-190`
- **Symptom:** When the first formatted block exceeds `0.8 * cap`, `inject()` calls `getRelevant()` a second time with a lower cap. `getRelevant` mutates `relevance_score` on every call (bump on the top slice), so the second retrieval re-ranks with scores already inflated by the first pass — biasing the top slice and making the double-fetch land differently than a single-fetch with the lower cap.
- **Fix guidance:** Compute the conditional cap before the first fetch (fetch once with the adjusted budget), or add a `bump: false` option to `getRelevant` for the probe call.

---

## 7. Task list for fixing

**Status Legend** (same convention as `docs/Kevin_v0.4.0_Task.md` — every task carries a single marker on its own line immediately after the task header; update it as you work):

| Marker | Meaning | When to set |
|---|---|---|
| `[ ]` | **Not started** | Initial state. Task has not been touched. |
| `[~]` | **Started / In progress** | Work has begun; some code or tests exist but the task is not finished. |
| `[P]` | **Partial** | Core deliverable exists but some acceptance criteria are still failing or missing. Record what is missing in the task's **Status notes** line. |
| `[!]` | **Blocked** | Cannot proceed. Record the blocker (dependency, API change, decision) in the task's **Status notes** line. |
| `[X]` | **Done** | All acceptance criteria met and verification command passes. |

### Summary

| ID | Bug | Title | Severity | Est | Status |
|---|---|---|---|---|---|
| T1 | BUG-001 | Make `kevin_query(evidence: true)` return real evidence | Critical | M | [X] |
| T2 | BUG-002 | Fix `isCrossProjectEnabled` string comparison | Critical | S | [X] |
| T3 | BUG-003 | Fix `settle` undercount of cross-session recurrences | Critical | M | [X] |
| T4 | BUG-004 | Fix retrospective false-positive recap identity | Severe | M | [X] |
| T5 | BUG-005 | Wire `QualityGate.evaluate` semantics into `ContextInjector.admit` | Severe | M | [X] |
| T6 | BUG-006 | Replace cross-table rowid comparison with timestamps | Severe | S | [X] |
| T7 | BUG-007 | Clean up `kevin_why` trace | Normal | S | [X] |
| T8 | BUG-008 | OKF export/import round-trip fidelity | Normal | M | [X] |
| T9 | BUG-009 | Stop embedding the evidence marker in imported content | Normal | S | [X] |
| T10 | BUG-010 | Complete `kevin_get` payload | Normal | S | [X] |
| T11 | BUG-011 | Stop `lastUserQuery` cross-session bleed | Normal | M | [X] |
| T12 | BUG-012 | Make the HITL suggestion behavior explicit | Normal | S | [X] |
| T13 | BUG-013 | Narrow `redactSecrets` | Low | S | [X] |
| T14 | BUG-014 | Complete `METRIC_KEY_LABELS` | Low | S | [X] |
| T15 | BUG-015 | Fingerprint-less ledger rows | Low | S | [X] |
| T16 | BUG-016 | Single-fetch `inject` | Low | S | [X] |

At the end of each work session, update the **Summary** table to reflect every changed marker.

**Working conventions:** follow `AGENTS.md` (TypeScript strict, ESM, Biome, Vitest). Every fix: 1) reproduce with a failing test, 2) fix, 3) run `npm run typecheck`, `npm run lint`, `npm test`. Do not commit unless asked. Reference the bug ID in commit/test names. Do not change public tool schemas unless a bug requires it (BUG-010 is additive JSON only). Prefer the smallest diff that closes the bug.

### T1 (Critical) — BUG-001: make `kevin_query(evidence: true)` return real evidence
- [X] Extend `QueryInput` with `evidence?: boolean` (`plugin/MemoryService.ts`).
- [X] When set, have the slim mapper include `confidence`, `evidence_count`, `last_verified_at` (compute confidence via `computeConfidence`).
- [X] Update `index.ts:251-269` to pass the flag through and drop the broken cast.
- [X] Tests: unit test asserting slim rows carry evidence when `evidence: true` and do not when absent.

### T2 (Critical) — BUG-002: fix `isCrossProjectEnabled` string comparison
- [X] Change `MemoryService.ts:525` to `(row?.value ?? "0") === "1"` (string compare).
- [X] Tests: seed `cross_project_enabled = '1'`, assert imported rows appear in `query()` and `getRelevant()`; seed `'0'`, assert hidden.

### T3 (Critical) — BUG-003: fix `settle` undercount of cross-session recurrences
- [X] Rework the `countRow` exclusion in `InjectionLedger.ts:108-130` so only the fingerprint's failing calls *before the session's first injection of that fingerprint* are excluded (or track the creating call id).
- [X] Tests: (a) lesson created in session A, injected in session B, one failure after injection → `ineffective`; (b) existing same-session scenario still passes.

### T4 (Severe) — BUG-004: fix retrospective false-positive recap identity
- [X] In `Retrospective.collectFalsePositives`, match `COALESCE(error_fingerprint, fingerprint)` instead of `fingerprint`.
- [X] Update `tests/e2e/retrospective.test.ts:243-274` to seed `error_fingerprint` and (where feasible) drive it through the real `onLinkError` wiring.
- [X] Assert the recap lists a lesson when its error fingerprint matches a failing call with `success = 0`.

### T5 (Severe) — BUG-005: wire `QualityGate.evaluate` semantics into `ContextInjector.admit`
- [X] Decide and document the legacy-lesson policy (recommended: keep legacy/agent-saved injectable, but enforce the generic-suggestion ban where suggestion text is available).
- [X] Implement: persist the evaluated `strength`/`isActionable` (e.g. at `Reflector` save time into `metadata.dispatch`-adjacent fields), and read them in `admit()`; or add a production call site for `evaluate`.
- [X] Tests: injector-level test — generic-suggestion lesson with `dispatch.code == null` is not admitted; dispatched-code lesson is.

### T6 (Severe) — BUG-006: replace cross-table rowid comparison with timestamps
- [X] In `CausalChain.onSessionIdle`, compare `MAX(tc.ts) >= COALESCE(MAX(m2.updated_at), '1970-01-01')` (verify column types; `ts` is `datetime('now')` text — lexicographic comparison is valid, same as the ledger). Note: `>=` (not `>`) so a fix in the SAME second as the pattern refresh works; refresh is idempotent.
- [X] Test: pattern inserted after its linked tool_calls → refresh skipped; pattern older than a new fix → refresh runs (fixture uses a distinct session per cycle so the per-session link dedup in `onSuccess` does not block the second fix).

### T7 (Normal) — BUG-007: clean up `kevin_why` trace
- [X] Remove the unused `traceRows` query (or use it to build the trace) in `kevin_why.ts:90-112`.
- [X] Drop the never-matching `tc.fingerprint LIKE` branch; keep `fix_for_fingerprint` matching.
- [X] Existing `kevin_why` tests must stay green (output shape unchanged).

### T8 (Normal) — BUG-008: OKF export/import round-trip fidelity
- [X] Export `recurrence_count` (guard: pre-005 DBs degrade to 0).
- [X] Compute exported `confidence` with `computeConfidence(evidence_count, recurrence_count)`.
- [X] Import `recurrence_count` and restore it via `save()` (save() now persists the column when present; accepts an explicit `id` so the round-trip keeps identity).
- [X] Round-trip test: export → import → compare `confidence`, `evidence_count`, `recurrence_count`.

### T9 (Normal) — BUG-009: stop embedding the evidence marker in imported content
- [X] Remove the `[imported evidence_count=..., last_verified_at=...]` suffix from content in `okf-import.ts:245-252`; keep the typed `save()` fields.
- [X] Test: imported content is identical to the bundle body; evidence fields still restored.

### T10 (Normal) — BUG-010: complete `kevin_get` payload
- [X] Add `confidence`, `evidence_count`, `recurrence_count`, `last_verified_at`, `status`, `fix_args` to `index.ts:295-310`.
- [X] Unit test asserting the full payload on a memory with evidence.

### T11 (Normal) — BUG-011: stop `lastUserQuery` cross-session bleed
- [X] In `experimental.chat.system.transform`, prefer `lastUserQueryBySession.get(hookInput.sessionID) ?? lastUserQuery`.
- [X] Clear the global on `session.idle`; delete the per-session entry on `session.created`.
- [X] E2E test: session A leaves a query; session B's first transform does not reuse it.

### T12 (Normal) — BUG-012: make the HITL suggestion behavior explicit
- [X] Pick semantics (recommended: once per session, documented) and align `index.ts:666-687` + `ContextInjector.generateSuggestion` comments with reality, or implement per-hook emission with a per-session flag.
- [X] Test for whichever semantics: suggestion appears on exactly one hook, or on both as chosen.

### T13 (Low) — BUG-013: narrow `redactSecrets`
- [X] Tighten the token pattern to credential contexts in `ToolCallObserver.ts:23-27` (also mirrored in `Reflector.ts`; named-token patterns now require an assignment and the callback preserves the separator).
- [X] Test: "token budget" / "token count" survive; `token=abc123` is redacted.

### T14 (Low) — BUG-014: complete `METRIC_KEY_LABELS`
- [X] Add labels for `injections_total`, `injections_effective`, `injections_ineffective`, `patterns_promoted_new`, `patterns_causal`, `causal_links`, `memories_superseded`.
- [X] Test: snapshot with all 13 keys renders a label for each (no raw key fallback).

### T15 (Low) — BUG-015: fingerprint-less ledger rows
- [X] In `ContextInjector.recordInjections`, skip or mark `effective` immediately for memories without a fingerprint; document in `InjectionLedger` docstring.
- [X] Test: agent memory without fingerprint does not produce an unmeasurable ledger row.

### T16 (Low) — BUG-016: single-fetch `inject`
- [X] Compute the conditional cap before the first `getRelevant` call, or add a non-bumping probe option.
- [X] Test: relevance scores are bumped exactly once per inject call regardless of the cap path.

### Final verification
- [X] `npm run typecheck` passes.
- [X] `npm run lint` (Biome) passes.
- [X] `npm test` passes (unit + integration + e2e).
- [X] Update the Status Legend / summary table if any task ID convention (`K4-XXX`) is extended with `BUG-XXX` references in commit messages.

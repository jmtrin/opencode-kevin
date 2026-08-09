# Opencode-kevin — Implementation Plan v0.4.0

**Version:** 0.4.0
**Date:** 2026-08-08
**Status:** Draft for implementation
**Paradigm:** Observe and Learn → Signal over Noise — the closed feedback loop
**Type:** Design document + implementation plan
**Author:** DeepSeek V4 Flash (v0.4.0 planning session, 2026-08-08)
**Inputs:**
- `docs/Kevin_Plan.md` — Part A (v0.1.0) + Part B (v0.2.0). Roadmap §14, amendment §B12.
- `docs/Kevin_new_v0.2.0.md` — Grok 4.5 analysis ("Kevin wins by specializing: best failure-lesson layer").
- `docs/Kevin_v0.3.0_Plan.md` — Knowledge + Causality (K3-001..K3-028, all [X]).
- `docs/Kevin_Fix_v0.1.4.md`, `docs/Kevin_Token_Impact.md`, `docs/Kevin_Task.md`.
- Direct review of `plugin/*.ts`, `migrations/*.sql`, live DB `~/.opencode-kevin/kevin.db` (metrics, memories, tool_calls), and the actual `<kevin-context>` block injected into a real OpenCode session.

---

## 1. Executive Summary

v0.1.x delivered **observation**; v0.2.0 delivered **signal quality**; v0.3.0 delivered **knowledge and causality**. v0.4.0 delivers **precision**: the guarantee that everything Kevin injects into the prompt is *worth its tokens*, and the measurement machinery to prove it.

The central thesis of v0.4.0:

> Kevin's value is not the volume of lessons it stores — it is the **precision of what it injects** and the **honesty of what it claims**. A lesson that is duplicated, misclassified as `unknown`, or phrased with a generic suggestion is not a lesson: it is tax on every future prompt.

This plan is the first one written after **observing the real system in production**. The evidence base (§3) is not speculative: it comes from the live DB and from a real `<kevin-context>` block injected into an actual session. Every subsystem below fixes an observed defect, not a hypothetical one.

| Dimension | Value |
|---|---|
| Release theme | Signal over Noise — the closed feedback loop |
| Version | 0.4.0 |
| New files (plugin) | `QualityGate.ts`, `InjectionLedger.ts`, `LessonFixer.ts` |
| New migration | `migrations/005_v04_signal.sql` (additive, idempotent) |
| New tools | `kevin_config` (settings surface) |
| Changed tools | `kevin_status` (precision metrics), `kevin_why` (negative evidence) |
| Tasks | K4-001..K4-028 (28 tasks, ~6 weeks) |
| Risk | 🟡 medium (injection-policy behavior change; metrics corrections) |
| Breaking | No (additive migration; behavior changes are quality gates, not schema breaks) |

**Exit criterion**: in a fresh session after the v0.4 validation protocol (K4-028), the injected `<kevin-context>` block contains **zero** lessons with `errorType = 'unknown'` AND zero lessons whose suggestion is the generic fallback; a lesson injected in a previous session whose fingerprint recurred the same session is demoted and no longer injected; and `kevin_status` reports `precision_rate ≥ 0.5` computed from a real injection ledger — with `tokens_injected_compacting > 0` verified at least once.

---

## 2. Philosophy — "Signal over Noise"

### 2.1 Carry-over

The Philosophy ("Observe and Learn", `Kevin_Plan.md` §2) and principles 1–6 are unchanged. Principles 7–10 (v0.3.0) are unchanged. v0.4.0 adds three principles that answer the questions the previous releases left open.

### 2.2 The v0.4 addition

v0.1 answers: *what failed?*
v0.2 answers: *how often does this fail, and is it deduplicated?*
v0.3 answers: *what fixed it, and how confident are we?*
v0.4 answers: **was the lesson worth its tokens — and did we measure it?**

```
   v0.3 (shipped) — the open loop
   failure → Reflector → error memory ──┐
                                         ├─→ ContextInjector → prompt → (model may or may not fix)
   success → CausalChain → pattern ─────┘
   recurrence → penalize (0.05) ───────────────────────────────┘ (no ledger, no measurement)

   v0.4 (this release) — the closed loop
   failure → Reflector (quality gate at SAVE time) → error memory
                                                         │
   prompt ──→ ContextInjector ──→ QUALITY GATE ──→ injection ──→ InjectionLedger.record()
                                                         │
   outcome measured at session.idle: recurred after injection? → ledger.mark_ineffective()
                                                         │
   pattern promotion (with deterministic fix-args capture + opt-in LLM phrasing)
                                                         │
   kevin_status → precision_rate, injections_effective/ineffective (honest numbers)
```

### 2.3 Principles specific to v0.4.0

| # | Principle | Implication |
|---|---|---|
| 11 | **Never inject noise.** | A lesson with `errorType = 'unknown'` and a generic suggestion is not injected — ever. It is stored (audit trail) but invisible to the model until it earns injection. |
| 12 | **Every injection is measured.** | Every pre-prompt/compacting injection is recorded in a ledger; every recurrence after injection is charged to that ledger entry. Kevin's value becomes a number, not a claim. |
| 13 | **Confidence separates positive from negative evidence.** | `evidence_count` (fixes) and `recurrence_count` (repeats despite injection) are distinct. A lesson that recurs is *less* confident, never more — fixing the v0.3 semantic bug where penalized errors gained confidence via `evidence_count`. |
| 14 | **The fix data is already local — use it.** | CausalChain already knows *which successful call* fixed fingerprint F. That call's `args_summary` is the deterministic raw material for a real "Fixed by:" line. LLM phrasing is the optional garnish, never the source. |

---

## 3. The evidence base — what production actually shows

This is the first plan in the series written from **observed production data**, not prediction. Three sources: the live DB, the code as built, and a real injected block.

### 3.1 Live DB snapshot (`~/.opencode-kevin/kevin.db`, 2026-08-08)

| Signal | Value | Reading |
|---|---|---|
| `tokens_injected_pre_prompt` | 886,913 | ~887k tokens injected in production. This is the *cost* of the injection system — it must be justified. |
| `tokens_injected_compacting` | 0 | **The compacting hook has never fired (or never counted).** Half the designed value surface is missing. |
| `duplicate_suppressions` | 0 | Dedup UNIQUE index exists but suppressed nothing — yet the injected block contains **visible duplicates** (see 3.3). Dedup only covers `type='error', origin='reflector'`; causal patterns are never deduped at injection time. |
| `patterns_causal` | 77 | vs `causal_links` = 11. `onSessionIdle` increments `patterns_causal` on **every refresh** of an existing pattern (the idempotent update path), so the metric counts refreshes, not promotions. Metric is inflated. |
| `reflections_throttled` | 1 | Throttle works (per-fingerprint, 60s). |
| `memories_superseded` | 14 | Negative half fired 14 times — but it increments `evidence_count` (see 3.2 bug). |
| memories | 131 error/reflector, 18 pattern/causal | 87% of reflector errors never earned a linked fix. |
| `project_id` | NULL on all rows | `index.ts` never passes `projectId` to `observer.onAfter` or `reflector.invoke` (`ToolCallObserver.ts:62` hardcodes `null`). The v0.2 project-scoping design is **not wired** in the live path: dedup and feedback are global, not per-project. |

### 3.2 Code-level defects (verified by reading source)

1. **Confidence semantics bug (K3-010 area)**: `penalizeRecurringReflectors` does `evidence_count = evidence_count + 1` (`MemoryService.ts:789`) — a *recurrence* counts as positive evidence. `promoteToPattern` then derives `confidence = 0.5 + 0.1 * evidence_count` (`MemoryService.ts:619`). **An error that keeps recurring gains confidence.** This directly contradicts principle 8 ("confidence is earned") and D3-04.
2. **`patterns_causal` inflation** (`CausalChain.ts:134-136`): the counter increments on idempotent refresh, not on new promotion.
3. **ContextInjector methods are dead code in production**: `index.ts:534-565` inlines the transform/compacting logic and never calls `injector.onSystemTransform` / `injector.onCompacting` — the conditional-budget guard (§B6.5) and the injector-level logic only run in tests.
4. **No injection dedup**: the same pattern is re-injected every prompt while relevant. There is no per-session seen-set. Observed directly: E0433 injected twice in one block under different memory ids.
5. **Injection carries full bodies**: `formatMemories` emits the entire `content` (up to 4KB with the `Context:` dump). Causal pattern content embeds the original error body (`promoteToPattern` slices 1000 chars). The injected block is ~200 tokens of low-information text.
6. **`deriveQuery`/retrieval inconsistency**: `queryRelevant` ORs quoted tokens (`MemoryService.ts:522`) — a single common token matches everything (noise); `kevin_why` ANDs them (`kevin_why.ts:36`) — a multi-word query matches nothing. The same intent, two opposite semantics.
7. **`unknown` errorType is never rescued**: when `dispatchLesson` matches a code, `errorType` stays `'unknown'` because `inferErrorType` (`ToolCallObserver.ts:159-180`) runs first and ignores the dispatch result. The lesson says "fails with unknown" even when the Reflector *did* identify TS2304, EADDRINUSE, etc.
8. **HITL suggestion is boilerplate**: `ContextInjector.generateSuggestion()` says "The same error pattern recurred N time(s)" — it does not say *which* pattern or *what* the candidate fix is, despite the fix data being available locally (§2.3, principle 14).

### 3.3 Observed injected block (real session, 2026-08-08)

The `<kevin-context>` block injected into an actual OpenCode session contained 7 lessons, all `[pattern] Causal pattern:` at confidence 60%:

| Lesson | errorType | Suggestion | Verdict |
|---|---|---|---|
| `error[E0433]: cannot find 'unix' in 'os'` | rust-code (not classified) | generic | 🔴 no value (but classifiable — see §5.4) |
| `[connect] starting jcode runtime...` | unknown | generic | 🔴 **not an error** (output fragment) |
| `could not compile 'jcode-harness-api'` | unknown | generic | 🟡 incomplete (fix is a missing dependency) |
| `test FAILED: ... 6 passed, 1 failed` | unknown | generic | 🟡 no test name, no fix |
| `rg: The term 'rg' is not recognized` | unknown | "Review the error output for details." | 🟠 the *only* lesson with an actionable fix — and it has the worst suggestion |
| `error[E0433]: cannot find 'unix' in 'os'` | rust-code | generic | 🔴 **duplicate** of row 1 (different memory id) |
| `[build]` | unknown | generic | 🔴 **not an error** (tag fragment) |

Reading: ~200 tokens of noise with the appearance of signal. Two lessons are not errors at all; one is a duplicate; the single genuinely actionable lesson (`rg` missing) is shipped with the generic suggestion. This is the production reality the quality gate must fix.

---

## 4. Ecosystem review — what other models said, and my verdict

The v0.2/v0.3 plans recorded external AI analyses (Grok 4.5, GLM-5.2). This section records the v0.4 proposals circulating in the ecosystem and rules on each — some contradict the evidence in §3.

| Source | Proposal | Decision | Rationale |
|---|---|---|---|
| v0.2 doc (Grok 4.5) | "Kevin wins by specializing: best failure-lesson layer" | **Confirmed** | The failure-lesson layer is exactly where production shows the gap (§3). |
| v0.3 doc (GLM-5.2) | Skill quality index + enriched LLM reflection for v0.4 (§14/§B12) | **Adopt, re-scoped** | Quality index → §5.1 QualityGate. LLM reflection → §5.4, moved to *promotion time* (session.idle), never the failure hot path. |
| Roadmap §14 | "Prompt mutation HITL" | **Already shipped** (K3-020) | Refined in §5.5 (the block must name the pattern and the fix). |
| Any model | "Injection is free; inject more" | **REJECT** | 886,913 injected tokens is a cost, not a feature. Precision gate first. |
| Any model | "Embeddings solve retrieval" | **REJECT (defer)** | The §3 evidence shows the retrieval problem is *precision of what exists*, not *recall of what doesn't*. Gate stays closed (D3-11). |
| Any model | "Make kevin_why smarter (LLM-generated summary)" | **Conditional** | The trace and numbers are local; only the phrasing is LLM-optional (K4-023). |

---

## 5. Architecture — additions to v0.3.0

### 5.1 `QualityGate` (new component) — never inject noise

A pure, no-LLM predicate evaluated in two places: at **save** time (Reflector) and at **injection** time (ContextInjector).

```typescript
interface LessonQuality {
  isActionable: boolean;      // has code OR non-generic suggestion
  errorType: string;          // rescued: 'TS2304' when dispatch matched, else 'unknown'
  suggestion: string;         // never the generic fallback when a code matched
  strength: "strong" | "weak";// strong = code matched or errorType != unknown
}

class QualityGate {
  static evaluate(lesson, dispatch, errorType): LessonQuality;
  static canInject(memory, ctx: { seenThisSession: Set<string>; recurrenceCount: number }): boolean;
}
```

Rules (non-negotiable, principle 11):

1. **Rescue the errorType**: when `dispatchLesson` returns a `code`, the lesson's `errorType` becomes `TS2304` / `EADDRINUSE` / `E0433`-class / etc. — never `unknown` with a matched code. `inferErrorType` runs *before* dispatch only for the *category* (typecheck/lint/test/runtime), and dispatch overrides the display value.
2. **Generic-suggestion ban at injection**: a lesson whose suggestion equals `SUGGESTIONS.unknown` ("Review the error output for details.") or the other fallbacks AND has no code is **not injected**. It stays stored; `kevin_query` can still find it.
3. **Session seen-set**: an injected memory id is added to the session set; it is never injected twice in the same session (kills the E0433 duplicate). The set resets on `session.created`.
4. **Recurrence demotion**: a fingerprint with `recurrence_count ≥ 1` (recurred despite injection) is demoted: `status = 'stale'` after `recurrence_count ≥ 3`, and is never injected while `recurrence_count > 0` until a *fix* is observed again (new causal link bumps it back). This is the "expel" half of the loop.
5. **Shorter injection payload**: injection uses a **snippet** (first 2 lines + `id:` + `<protect>`) instead of the full content. The full body stays one `kevin_get` away (progressive disclosure already exists — apply it to injection, not just query).

### 5.2 `InjectionLedger` (new component) — measure every injection

The measurement half of the loop. New table `kevin_injections`:

```sql
CREATE TABLE IF NOT EXISTS kevin_injections (
  id              TEXT PRIMARY KEY,
  memory_id       TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  hook            TEXT NOT NULL CHECK (hook IN ('pre_prompt', 'compacting')),
  tokens          INTEGER NOT NULL,
  injected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  outcome         TEXT CHECK (outcome IN ('unmeasured', 'effective', 'ineffective'))
                  NOT NULL DEFAULT 'unmeasured'
);
CREATE INDEX IF NOT EXISTS idx_injections_fp ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session ON kevin_injections(session_id);
```

- `ContextInjector` records one row per injected memory (not per block).
- At `session.idle`, `InjectionLedger.settle(sessionId)`:
  - fingerprint recurred as a failing tool_call after `injected_at` → `outcome = 'ineffective'` (and increments `memories.recurrence_count` for that fingerprint).
  - else → `outcome = 'effective'`.
- New metrics (replacing the inflated ones): `injections_total`, `injections_effective`, `injections_ineffective`, plus derived `precision_rate = effective / total` computed in `kevin_status`.
- **Delete the `patterns_causal` inflation**: counter increments only when `promoteToPattern` *creates* a new row (returned id is new — see K4-009).

### 5.3 Honest confidence — split the evidence semantics

Schema adds `recurrence_count` (negative evidence) alongside `evidence_count` (positive):

| Column | Meaning | Set by |
|---|---|---|
| `evidence_count` | confirmed fixes observed (causal links) | CausalChain only |
| `recurrence_count` | failures after injection (lesson didn't prevent) | InjectionLedger.settle + penalize path |

- `confidence` becomes a two-sided formula (replaces `0.5 + 0.1 * evidence_count`):

```
confidence = clamp(0.5 + 0.1 * evidence_count - 0.15 * recurrence_count, 0.05, 0.95)
```

- The negative half (`penalizeRecurringReflectors`) stops incrementing `evidence_count` (`MemoryService.ts:789`) and increments `recurrence_count` instead. `memories_superseded` keeps its meaning.
- `kevin_why` output gains `recurrence_count` and shows both in the trace; the summary template changes to `resolved in N of M attempts` when `recurrence_count > 0` (honest phrasing).

### 5.4 Deterministic fix capture + opt-in LLM phrasing (`LessonFixer`, new)

The single highest-value move in v0.4, and it costs **zero API tokens by default** (principle 14):

- When CausalChain links a success to fingerprint F, the linked `tool_calls` row already has `args_summary` (e.g. `command: npm i ripgrep`, `path: ...`). Copy it into the pattern memory as a new `fix_args` column: the **deterministic "Fixed by:" raw material**.
- `promoteToPattern` writes `Fixed by: {tool} {args_summary truncated}` into the pattern content. No LLM involved.
- **LLM reflection moves to promotion time** (K3-018 re-scoped): the opt-in `enrich` callback fires at most **once per promoted pattern** (at session.idle), receiving `(lesson, fix_args, original_error)`, returning a one-line `Fix:` phrasing. It *never* runs on the failure hot path — one call per pattern, not one per failure. `kevin_settings.llm_reflection_enabled` keeps default off; cost is bounded.
- This upgrades the worst observed lesson (`rg: The term 'rg' is not recognized` → `Fixed by: bash command: "npm i -g rg"`) into the best one, without any LLM.

### 5.5 Smarter HITL suggestion (K3-020 refinement)

`generateSuggestion()` output becomes concrete (the ledger already knows which pattern recurred):

```
<kevin-suggestion>
The error pattern "rg: The term 'rg' is not recognized" recurred 4 time(s) this session.
Observed fix: bash command "npm i -g rg" (1 confirmed fix, confidence 60%).
Consider adding this convention to AGENTS.md:
- If a command output says "not recognized", install the tool first.
</kevin-suggestion>
```

Source of the detail: `kevin_injections` + the pattern's `fix_args`. The block is still a suggestion only (D3-12; "suggest, don't rewrite").

### 5.6 Compactability: the dead compacting hook

`tokens_injected_compacting = 0` for the plugin's whole production life. K4-018 investigates why: the hook name (`experimental.session.compacting`) may have changed in the SDK, or `lastUserQuery` is null at the moment compaction fires (`index.ts:551`). Fixes, in order of preference:

1. Verify the current SDK hook contract; use the correct name.
2. Fall back to deriving the query from the compacted message history (`ContextInjector.deriveQuery` already exists — call it on `input.messages` instead of relying on `lastUserQuery`).

Compacting is the *most* valuable injection point (the model just lost context; the lessons are the refresh). Landing it is a P0.

### 5.7 Wire project scoping (the NULL project_id defect)

`index.ts` passes no `projectId` anywhere; `ToolCallObserver.ts:62` and `Reflector` default to `null`. The v0.2 design (D2-11: project_id = hashed CWD) is dormant. K4-019:

- Derive `projectId = fingerprint(cwd)` once per session (from `hookInput.project`/`session.created` properties if the SDK provides it, else `process.cwd()` at plugin init).
- Pass it through `observer.onAfter`, `reflector.invoke`, and `causalChain.onSuccess`.
- Dedup, feedback, and recall become per-project as designed. Global rows (`project_id IS NULL`) keep working (legacy + opt-in cross-project).

---

## 6. Schema delta — `migrations/005_v04_signal.sql`

Idempotent, additive, backward-compatible (the discipline of 003/004).

```sql
-- 005_v04_signal.sql
-- Positive/negative evidence split.
ALTER TABLE memories ADD COLUMN recurrence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN fix_args TEXT;
ALTER TABLE memories ADD COLUMN last_injected_at TEXT;

-- Injection ledger (measurement half of the loop).
CREATE TABLE IF NOT EXISTS kevin_injections (
  id              TEXT PRIMARY KEY,
  memory_id       TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  hook            TEXT NOT NULL CHECK (hook IN ('pre_prompt', 'compacting')),
  tokens          INTEGER NOT NULL,
  injected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  outcome         TEXT CHECK (outcome IN ('unmeasured', 'effective', 'ineffective'))
                  NOT NULL DEFAULT 'unmeasured'
);
CREATE INDEX IF NOT EXISTS idx_injections_fp ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session ON kevin_injections(session_id);
CREATE INDEX IF NOT EXISTS idx_injections_outcome ON kevin_injections(outcome);

-- New metrics rows (seeded via INSERT OR IGNORE).
INSERT OR IGNORE INTO kevin_metrics(key, value)
    VALUES ('injections_total', 0),
           ('injections_effective', 0),
           ('injections_ineffective', 0),
           ('patterns_promoted_new', 0);

-- Settings surface.
INSERT OR IGNORE INTO kevin_settings(key, value)
    VALUES ('quality_gate_enabled', '1'),
           ('lesson_snippet_injection', '1');
```

**Backward compatibility**: all new columns nullable with defaults; `kevin_injections` is a new table; no CHECK constraint changes on existing tables. Rollback = drop the new artifacts.

---

## 7. Decisions log (D4 series)

| ID | Decision | Rationale |
|---|---|---|
| D4-01 | **Quality gate is the v0.4 signature feature.** Injection is gated; storage is not. | §3.3 observed noise; storage is cheap, prompts are not. |
| D4-02 | **No LLM on the failure hot path, ever.** LLM phrasing moves to promotion time, one call per pattern, opt-in. | Re-scopes K3-018/K3-024. Preserves 0-cost default; bounds cost. |
| D4-03 | **Confidence is two-sided** (`evidence_count` − `recurrence_count`). | Fixes the §3.2 defect where recurrence raised confidence. |
| D4-04 | **Every injection is ledgered and settled.** No injection → no measurement → no claim. | Kevin_Token_Impact's savings claims were estimates; v0.4 makes them measured. |
| D4-05 | **Injection payload is a snippet, not the body.** Full body via `kevin_get`. | §3.3 block was ~200 tokens of low-information text; progressive disclosure already exists (D2-12) — extend it to injection. |
| D4-06 | **Recurrence expels, fixes re-admit.** `recurrence_count ≥ 3` → `status='stale'`, never injected until a new fix is linked. | Closes the loop: lessons that don't work leave the prompt. |
| D4-07 | **Fix data is captured deterministically** (`fix_args` from the linked success call). LLM only phrases. | §2.3 principle 14; zero-cost default value. |
| D4-08 | **`patterns_causal` is corrected** to count new promotions only; refresh increments nothing. | §3.1 metric inflation observed. |
| D4-09 | **Project scoping is finally wired** (D2-11 dormant defect). | §3.1: all rows NULL project_id; dedup/feedback are global today. |
| D4-10 | **Embeddings gate stays closed.** | The v0.4 problem is precision of what exists, not recall of what doesn't (D3-11 unchanged). |
| D4-11 | **kevin_why summary is honest**: "resolved in N of M attempts" when recurrences exist. | Mirrors principle 8 (confidence is earned) in the user-facing surface. |

---

## 8. Changes per file

### 8.1 `plugin/QualityGate.ts` (new)

- `evaluate(lesson, dispatch, errorType)` → `{ errorType, suggestion, isActionable, strength }`.
- `canInject(memory, { seenThisSession, recurrenceCount })` → boolean. Implements §5.1 rules 2–4.
- `rescueErrorType(dispatch, errorType)` — the dispatch-overrides-unknown fix (§5.1 rule 1).

### 8.2 `plugin/InjectionLedger.ts` (new)

- `record({ memoryId, fingerprint, sessionId, hook, tokens })` → inserts row.
- `settle(sessionId)` → marks effective/ineffective via tool_calls recurrence query; bumps `memories.recurrence_count` and `last_injected_at`.
- `recurrencesFor(sessionId)` → per-fingerprint recurrence counts (feeds §5.5 and QualityGate).

### 8.3 `plugin/LessonFixer.ts` (new)

- `extractFixArgs(linkedToolCall)` → deterministic `fix_args` string.
- `enrichAtPromotion(pattern, fixArgs, enrichFn)` → optional LLM one-line `Fix:` phrasing; default no-op returns the deterministic text.

### 8.4 `plugin/Reflector.ts`

- `invoke()` writes the *quality-evaluated* lesson: rescued errorType, non-generic suggestion when a code matched (§5.1 rule 1). `dispatchLesson` result is stored in `metadata.dispatch` so injection and promotion reuse it.
- No LLM changes (K3-018 stays as-is; the promotion-time move is in `CausalChain`).

### 8.5 `plugin/ContextInjector.ts`

- Wired into production (`index.ts` stops inlining — §3.2 defect 3): `onSystemTransform`/`onCompacting` become the single path again, now using `QualityGate.canInject` + session seen-set + snippet payload.
- `inject()` records every memory in `InjectionLedger`.
- `generateSuggestion()` uses `InjectionLedger.recurrencesFor` + `fix_args` (§5.5).

### 8.6 `plugin/CausalChain.ts`

- `onSuccess`: copy linked call's `args_summary` into `tool_calls.fix_for_fingerprint`'s pattern via `fix_args`.
- `onSessionIdle`: promote → `LessonFixer.enrichAtPromotion`; increment `patterns_promoted_new` **only when a new pattern row is created** (D4-08); `patterns_causal` deprecated (kept for compat, frozen).

### 8.7 `plugin/MemoryService.ts`

- `penalizeRecurringReflectors`: increment `recurrence_count`, stop incrementing `evidence_count` (§5.3).
- `promoteToPattern`: new confidence formula (§5.3); write `fix_args`; preserve the idempotent-refresh path (returns existing id).
- `getRelevant`: accepts `minStrength` + `seenIds` filters; snippet mode for injection.
- `queryRelevant` (OR) and `kevin_why` (AND): aligned semantics via a shared tokenizer helper (K4-013) — OR for injection recall, AND for explicit queries; both documented.

### 8.8 `plugin/index.ts`

- Stop inlining transform/compacting (delegate to `injector`).
- Derive and pass `projectId` (K4-019).
- New tool `kevin_config` (list/toggle settings without SQL).
- `kevin_status` returns `precision_rate`, `injections_*`, `patterns_promoted_new`, `recurrence_count` totals.

### 8.9 `plugin/kevin_why.ts`

- Return `recurrence_count`; two-sided confidence; honest summary ("resolved in N of M attempts"); include `fix_args` in the result.

### 8.10 Migration

`migrations/005_v04_signal.sql` — see §6.

---

## 9. Tasks (K4-001 … K4-028)

Tasks use the `K4-` prefix to avoid collision with `K-`/`K2-`/`K3-`.

### K4-001 — Draft migration 005

- **Priority:** P0 · **Estimate:** S · **Files:** `migrations/005_v04_signal.sql`
- **Acceptance:** File exists with §6 contents; idempotent when run twice (`tests/unit/migrate_v05.test.ts`).
- **Verification:** `npx vitest run tests/unit/migrate_v05.test.ts`

### K4-002 — Migrate post-apply backfill (005)

- **Priority:** P0 · **Files:** `plugin/Migrate.ts`
- **Acceptance:** `recurrence_count = 0`, `fix_args = NULL`, `last_injected_at = NULL` for legacy rows; new metrics/settings seeded. Idempotent.
- **Verification:** `npx vitest run tests/unit/migrate_postapply_v05.test.ts`

### K4-003 — QualityGate.evaluate + rescueErrorType

- **Priority:** P0 · **Files:** `plugin/QualityGate.ts`
- **Acceptance:** Dispatch-matched code overrides `'unknown'`; generic-suggestion detection works; `isActionable` correct for all 5 observed §3.3 cases.
- **Verification:** `npx vitest run tests/unit/quality-gate.test.ts`

### K4-004 — QualityGate.canInject (seen-set + recurrence)

- **Priority:** P0 · **Files:** `plugin/QualityGate.ts`
- **Acceptance:** Same memory id not injectable twice in a session; `recurrence_count ≥ 1` blocks injection until a fix; `status='stale'` at `≥ 3` never injects.
- **Verification:** Unit test covering all branches.

### K4-005 — Reflector stores dispatch in metadata

- **Priority:** P0 · **Files:** `plugin/Reflector.ts`
- **Acceptance:** `metadata.dispatch = { code, hint }` persisted; lesson content uses rescued errorType.
- **Verification:** `npx vitest run tests/unit/reflector-v04.test.ts`

### K4-006 — InjectionLedger skeleton

- **Priority:** P0 · **Files:** `plugin/InjectionLedger.ts`
- **Acceptance:** `record`/`settle`/`recurrencesFor` exist; `record` inserts; `settle` marks outcomes.
- **Verification:** Unit test on `:memory:` DB.

### K4-007 — InjectionLedger.settle (effective/ineffective)

- **Priority:** P0 · **Files:** `plugin/InjectionLedger.ts`
- **Acceptance:** Fingerprint recurs as failing tool_call after `injected_at` in the session → `'ineffective'` + `recurrence_count++`; otherwise `'effective'`.
- **Verification:** e2e `tests/e2e/ledger-settle.test.ts` (failure → injection → recurrence → settle).

### K4-008 — New metrics + precision_rate

- **Priority:** P0 · **Files:** `plugin/metrics.ts`, `plugin/index.ts`
- **Acceptance:** `injections_total/effective/ineffective`, `patterns_promoted_new` seeded at 0; `kevin_status` computes `precision_rate` and shows totals.
- **Verification:** `npx vitest run tests/unit/metrics-v04.test.ts`

### K4-009 — Fix patterns_causal inflation

- **Priority:** P0 · **Files:** `plugin/CausalChain.ts`
- **Acceptance:** `patterns_promoted_new` increments only on new pattern creation; refresh path increments nothing. `patterns_causal` frozen for compat.
- **Verification:** Unit test: two sessions, same fingerprint → `patterns_promoted_new === 1`.

### K4-010 — Two-sided confidence

- **Priority:** P0 · **Files:** `plugin/MemoryService.ts`
- **Acceptance:** `promoteToPattern` uses `clamp(0.5 + 0.1*evidence - 0.15*recurrence, 0.05, 0.95)`; recurrence lowers confidence.
- **Verification:** Unit test: recurrence 1 lowers confidence below the no-recurrence baseline.

### K4-011 — Negative half writes recurrence_count

- **Priority:** P0 · **Files:** `plugin/MemoryService.ts`
- **Acceptance:** `penalizeRecurringReflectors` increments `recurrence_count` (not `evidence_count`); `memories_superseded` unchanged semantics.
- **Verification:** Existing `memoryservice-feedback-v03.test.ts` updated and green.

### K4-012 — Snippet injection payload

- **Priority:** P1 · **Files:** `plugin/ContextInjector.ts`, `plugin/memory-format.ts`
- **Acceptance:** Injected rows show `id:` + first 2 lines + `<protect>`; full body via `kevin_get` only. `lesson_snippet_injection` setting gates the behavior (default on).
- **Verification:** `npx vitest run tests/unit/contextinjector-v04.test.ts`

### K4-013 — Shared tokenizer for query semantics

- **Priority:** P1 · **Files:** `plugin/MemoryService.ts`, `plugin/kevin_why.ts`
- **Acceptance:** One helper produces quoted tokens; injection recall uses OR, `kevin_why` AND; both documented in the helper's docstring.
- **Verification:** Unit test asserting both call sites use the helper.

### K4-014 — Deterministic fix_args capture

- **Priority:** P0 · **Files:** `plugin/CausalChain.ts`, `plugin/LessonFixer.ts`
- **Acceptance:** Linked success's `args_summary` lands in the pattern's `fix_args`; `promoteToPattern` content includes `Fixed by:`.
- **Verification:** e2e: `tests/e2e/fix-args.test.ts` (failure → fix with distinctive args → pattern contains them).

### K4-015 — Promotion-time LLM enrichment (re-scope K3-018)

- **Priority:** P2 · **Files:** `plugin/LessonFixer.ts`, `plugin/CausalChain.ts`
- **Acceptance:** `enrich` fires once per promoted pattern at session.idle (not on failures); default no-op; `llm_reflection_enabled` gate unchanged (off).
- **Verification:** Unit test with injected mock enrich asserting call count ≤ 1 per pattern.

### K4-016 — Smarter HITL suggestion

- **Priority:** P1 · **Files:** `plugin/ContextInjector.ts`
- **Acceptance:** Block names the pattern, recurrence count, observed `fix_args`, and a concrete AGENTS.md draft line. Never says "the same error pattern" without naming it.
- **Verification:** Unit test on `generateSuggestion()` output shape.

### K4-017 — Wire ContextInjector into production

- **Priority:** P0 · **Files:** `plugin/index.ts`
- **Acceptance:** Transform/compacting hooks call `injector.onSystemTransform`/`onCompacting` (single path, conditional budget guard live); inline logic removed.
- **Verification:** `npx vitest run tests/e2e/context-injection.test.ts` + existing suite green.

### K4-018 — Fix the dead compacting hook

- **Priority:** P0 · **Files:** `plugin/index.ts`
- **Acceptance:** `tokens_injected_compacting > 0` observed after a real compaction cycle (manual validation); query derives from `input.messages` fallback when `lastUserQuery` is null.
- **Verification:** Manual: force compaction, `kevin_status` shows the counter moving.

### K4-019 — Wire project scoping

- **Priority:** P1 · **Files:** `plugin/index.ts`, `plugin/ToolCallObserver.ts`
- **Acceptance:** `projectId` derived (SDK project property else hashed `process.cwd()`), passed to observer/reflector/CausalChain; dedup and feedback scoped per project; legacy NULL rows keep working.
- **Verification:** `npx vitest run tests/unit/project-scoping.test.ts`

### K4-020 — kevin_why honest output

- **Priority:** P1 · **Files:** `plugin/kevin_why.ts`
- **Acceptance:** Returns `recurrence_count`, `fix_args`, two-sided confidence, and "resolved in N of M attempts" phrasing when recurrences exist.
- **Verification:** `npx vitest run tests/unit/kevin-why-v04.test.ts`

### K4-021 — kevin_config tool

- **Priority:** P2 · **Files:** `plugin/index.ts`
- **Acceptance:** `kevin_config({ get | set, key, value })` lists/toggles `quality_gate_enabled`, `lesson_snippet_injection`, `patternminer_enabled`, `cross_project_enabled`, `llm_reflection_enabled` without SQL.
- **Verification:** e2e `tests/e2e/kevin-config.test.ts`.

### K4-022 — Expand deterministic rule coverage

- **Priority:** P1 · **Files:** `plugin/Reflector.ts`
- **Acceptance:** New rules with real hints: `TS2307` (cannot find module → "install or add to package.json"), `TS2339`/`TS2305` (property does not exist → "check import surface"), `TS6133` (unused → "remove or use"), rust `E0433`/`E0432` (cannot find → "add dependency or use path"), `command not found`/`not recognized` (→ "install the tool or use a full path"), `EADDRINUSE` (→ "free the port or change it").
- **Verification:** Unit tests per rule; the §3.3 E0433 and `rg` cases now classify as actionable.

### K4-023 — Inject-lessons-with-warning mode (weak lessons flagged)

- **Priority:** P2 · **Files:** `plugin/ContextInjector.ts`
- **Acceptance:** With `quality_gate_enabled = 0` (debug), weak lessons inject under a `confidence: low` marker instead of being dropped; default `1` keeps them out.
- **Verification:** Unit test toggling the setting.

### K4-024 — kevin_status precision block

- **Priority:** P1 · **Files:** `plugin/index.ts`
- **Acceptance:** `kevin_status` output includes `precision_rate`, `injections_*`, `patterns_promoted_new`, and per-origin `recurrence_count` totals, replacing the inflated readings.
- **Verification:** `npx vitest run tests/unit/kevin-status-v04.test.ts`

### K4-025 — e2e: closed-loop cycle

- **Priority:** P0 · **Files:** `tests/e2e/closed-loop.test.ts`
- **Acceptance:** Failure → save (quality-evaluated) → inject (ledgered, snippet) → recurrence (settle 'ineffective', recurrence_count 1, confidence drops) → repeat twice (stale, never injected) → fix (fix_args captured, pattern re-admitted). Full loop without `kevin_save`.
- **Verification:** `npx vitest run tests/e2e/closed-loop.test.ts`

### K4-026 — Backward-compat migration test

- **Priority:** P0 · **Files:** `tests/e2e/migrate-from-v030.test.ts`
- **Acceptance:** DB seeded at v0.3 schema (with data) runs `npm run verify` after 005; new columns nullable; existing suite green.
- **Verification:** `npx vitest run tests/e2e/migrate-from-v030.test.ts && npm test`

### K4-027 — Noise-free injection validation

- **Priority:** P0 · **Files:** `tests/e2e/injection-purity.test.ts`
- **Acceptance:** After the protocol below, the injected block contains no `unknown`-errorType lessons, no generic suggestions, no duplicate memory ids, no non-error fragments.
- **Verification:** `npx vitest run tests/e2e/injection-purity.test.ts`

### K4-028 — Bump 0.4.0 + CHANGELOG

- **Priority:** P0 · **Estimate:** S · **Files:** `package.json`, `CHANGELOG.md`
- **Acceptance:** Version 0.4.0; CHANGELOG "Signal over Noise" entry; README updated (precision, kevin_config, honest metrics).
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 10. Out of scope for v0.4.0

| Item | Reason | Destination |
|---|---|---|
| Embeddings / hybrid retrieval | Gate closed (D3-11/D4-10): the gap is precision, not recall | v0.5+ if `precision_rate` and miss-rate evidence demand it |
| MCP adapter | Removes OpenCode hook moat (D3-07) | v0.5+ "Deep ecosystem integration" |
| Graph store / relations table | Premature (D3-08) | Unspecified |
| Multi-agent critic loop | API cost (v0.3 out-of-scope, unchanged) | v0.5+ |
| Auto SKILL.md mutation | "Suggest, don't rewrite" (D3-12) | Always HITL |
| Mandatory LLM reflection | 0-cost default (D3-05) | Always opt-in |
| `commit_sha` column | Coupled to one repo's git history (v0.3 out-of-scope) | Fold into OKF export |

---

## 11. Final verification

```bash
cd C:\opencode-kevin
npm run typecheck   # tsc --noEmit (strict) — must pass
npm run lint        # biome check . (excluding dist/)
npm test            # vitest run — includes K4-025, K4-027
npm run verify      # post-install on v0.3-seeded DB
```

Manual validation (analogous to K-045 / K3 walkthrough):

1. In a small project, force a `tsc` failure (delete an import) → `kevin_status` shows a quality-evaluated error memory.
2. Start a second session, ask anything → open the injected `<kevin-context>`: no `unknown`-type lessons, no generic suggestions, no duplicates, snippet-sized rows.
3. Repeat the same failure in that session → `kevin_status` shows `injections_ineffective` +1 and the fingerprint's `recurrence_count` +1; the pattern's confidence drops.
4. Repeat twice more → the fingerprint's lesson is `stale` and absent from the next injection.
5. Fix the import (success) → `fix_args` captured; the pattern is re-admitted with `Fixed by:` content.
6. Force a compaction cycle → `tokens_injected_compacting > 0`.
7. `kevin_why "TS2304"` → shows `recurrence_count`, `fix_args`, honest "resolved in N of M attempts" phrasing.

**Exit criterion met** when steps 1–7 pass without manual `kevin_save`, and `precision_rate` in `kevin_status` is computed from real ledger data.

---

## 12. Summary of what changed from existing plans

| Source | Was | Now (v0.4.0) | Change |
|---|---|---|---|
| §14/§B12 | "Skill quality index" | QualityGate (K4-003/004) + purity validation (K4-027) | Same intent, now with production evidence |
| §14/§B12 | "Enriched LLM reflection" | Promotion-time LLM phrasing (K4-015) | Re-scoped: one call per pattern at idle, never the hot path |
| §B6.5 | Conditional budget guard | Wired into production (K4-017) | Fixes dead-code defect (§3.2.3) |
| K3-018 | LLM enrichment at failure | Promotion-time enrichment (K4-015) | Cost bounded, value targeted |
| K3-020 | HITL boilerplate | Smarter suggestion naming pattern + fix (K4-016) | Uses ledger + fix_args |
| K3-010/K3-013 | `evidence_count` as both positive and negative | Split `recurrence_count` (K4-010/011) | Fixes confidence inversion bug |
| K3-022 | `patterns_causal` | `patterns_promoted_new` (K4-009) | Fixes metric inflation |
| D2-11 | project_id design | Actually wired (K4-019) | Fixes dormant defect |
| **NEW** | — | InjectionLedger + precision_rate (K4-006..008) | The measurement half of the loop |
| **NEW** | — | Deterministic `fix_args` capture (K4-014) | Zero-cost "Fixed by:" from local data |
| **NEW** | — | Expanded deterministic rules incl. rust + command-not-found (K4-022) | Rescues the observed `unknown` cases |

---

## 13. References

- `docs/Kevin_Plan.md` — §14 Future Roadmap; §B12 amendments; D2-11.
- `docs/Kevin_v0.3.0_Plan.md` — K3-001..K3-028; decisions D3-01..D3-12; §10 embeddings gate.
- `docs/Kevin_new_v0.2.0.md` — Grok 4.5 analysis.
- `docs/Kevin_Token_Impact.md` — the savings claims that v0.4's ledger replaces with measurement.
- `plugin/Reflector.ts` — SUGGESTIONS fallback, TS_CODE_RULES, dispatchLesson.
- `plugin/ContextInjector.ts:100-224` — inject/deriveQuery/generateSuggestion.
- `plugin/MemoryService.ts:615-656` (promoteToPattern), `:751-815` (penalizeRecurringReflectors).
- `plugin/CausalChain.ts:93-144` (onSessionIdle inflation source).
- `plugin/index.ts:534-565` (inline transform/compacting — dead-injector source), `:114-120` (pickExitCode), `:453-520` (hook wiring, no projectId).
- `plugin/ToolCallObserver.ts:62` (projectId hardcoded null), `:159-180` (inferErrorType).
- `plugin/kevin_why.ts:30-36` (AND tokenization).
- `migrations/003_v02_signal.sql`, `migrations/004_v03_knowledge.sql` — schema discipline references.
- Live production data: `~/.opencode-kevin/kevin.db` and an observed `<kevin-context>` block (2026-08-08).

---

## 14. Implementation status (table)

Phases:

- **F0 — Substrate**: migration 005, ledger schema, metrics, project wiring.
- **F1 — Quality**: QualityGate, snippet injection, rescued errorTypes, query semantics.
- **F2 — Loop**: ledger settle, two-sided confidence, fix_args, promotion-time enrichment, HITL upgrade.
- **F3 — Validation & release**: closed-loop e2e, purity validation, backward-compat, bump.

Status legend: `[ ]` pending · `[~]` in progress · `[X]` complete · `[!]` blocked.

| ID | Phase | Title (short) | Status |
|---|---|---|---|
| K4-001 | F0 | migration 005 | [ ] |
| K4-002 | F0 | post-apply backfill 005 | [ ] |
| K4-006 | F0 | InjectionLedger skeleton | [ ] |
| K4-007 | F0 | InjectionLedger.settle | [ ] |
| K4-008 | F0 | new metrics + precision_rate | [ ] |
| K4-019 | F0 | wire project scoping | [ ] |
| K4-003 | F1 | QualityGate.evaluate | [ ] |
| K4-004 | F1 | QualityGate.canInject | [ ] |
| K4-005 | F1 | Reflector dispatch metadata | [ ] |
| K4-012 | F1 | snippet injection payload | [ ] |
| K4-013 | F1 | shared query tokenizer | [ ] |
| K4-017 | F1 | wire ContextInjector | [ ] |
| K4-022 | F1 | expand deterministic rules | [ ] |
| K4-009 | F2 | fix patterns_causal inflation | [ ] |
| K4-010 | F2 | two-sided confidence | [ ] |
| K4-011 | F2 | negative half → recurrence_count | [ ] |
| K4-014 | F2 | deterministic fix_args | [ ] |
| K4-015 | F2 | promotion-time LLM enrichment | [ ] |
| K4-016 | F2 | smarter HITL suggestion | [ ] |
| K4-020 | F2 | kevin_why honest output | [ ] |
| K4-021 | F2 | kevin_config tool | [ ] |
| K4-023 | F2 | weak-lesson warning mode | [ ] |
| K4-024 | F2 | kevin_status precision block | [ ] |
| K4-018 | F3 | fix dead compacting hook | [ ] |
| K4-025 | F3 | closed-loop e2e | [ ] |
| K4-026 | F3 | backward-compat migration test | [ ] |
| K4-027 | F3 | injection purity validation | [ ] |
| K4-028 | F3 | bump 0.4.0 + CHANGELOG | [ ] |

**Total**: 28 tasks (6 F0 · 8 F1 · 9 F2 · 5 F3).

**Suggested execution order (critical path)**: F0 → K4-003/004/005 + K4-017 (gate + single injection path) → K4-006/007/008 (ledger) → K4-009/010/011 (honest confidence) → K4-014 (fix_args — highest value-per-line) → K4-025 e2e early to de-risk → K4-018 (compacting) → rest of F2 → K4-026/027/028 (release).

# Opencode-kevin — Implementation Plan v0.5.0

**Version:** 0.5.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → Learn → **Prove** → Share
**Codename:** "Glass Box"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.4.0 — full source audit of all 24 modules; every defect cited below carries a `file.ts` reference.
- `migrations/005_v04_signal.sql` — the `kevin_injections` schema whose `outcome` CHECK constraint forces a table rebuild.
- `plugin/InjectionLedger.ts` — `settle()`, the measurement path this release corrects.
- `plugin/QualityGate.ts` — `canInject()`, the rejection path whose reasons are currently discarded.
- `plugin/confidence.ts`, `plugin/metrics.ts` — the two pure modules extended here.
- `docs/Kevin_v0.4.0_Bugs.md` — the 16-bug audit; three of its architectural findings are directly addressed.
- `docs/Kevin_Token_Impact.md` — the unmeasured ROI model this release exists to make measurable.
- `docs/Kevin_Roadmap.md` — the v0.5 → v1.0 ladder and the kill criteria this release makes checkable.
- `@opencode-ai/plugin@1.17.10` type definitions — hook surface confirmation; no new hooks are used in v0.5.0.

---

## 1. Executive Summary

> v0.4.0 gave Kevin an instrument. v0.5.0 discovers that the instrument is confounded, fixes it,
> and adds the three things missing around it: a reason for every rejection, a channel for human
> judgement, and a way to inspect a decision without changing it.

| Dimension | Value |
|---|---|
| Release theme | Honest measurement, inspectability, human feedback |
| Version | 0.4.0 → 0.5.0 |
| New files | `plugin/Feedback.ts`, `plugin/Archiver.ts`, `plugin/kevin_audit.ts`, `plugin/replay.ts`, `migrations/006_v05_glassbox.sql` |
| New migration | `006_v05_glassbox.sql` (includes a `kevin_injections` table rebuild) |
| New tools | `kevin_feedback`, `kevin_trace`, `kevin_audit` (10 → 13) |
| Changed tools | `kevin_status` (new outcome fields), `kevin_config` (3 new keys) |
| New metric keys | 9 (13 → 22) |
| New runtime dependencies | **none** |
| Tasks | 24 (`K5-001` … `K5-024`) |
| Risk | Medium — one table rebuild, one metric-semantics change that is deliberately regressive |
| Breaking | No API breaks. **`precision_rate` will drop sharply. That is the intended result.** |

**Exit criterion.** On a database with at least 20 settled injections, `kevin_audit` reports
four distinct outcome buckets in which `effective` is awarded **only** when a matching
`fix_for_fingerprint` tool call exists after `injected_at`; every gate rejection is attributed
to exactly one of five counters; `kevin_trace` returns a full decision plan while leaving
`kevin_injections`, `kevin_metrics` and `memories.relevance_score` byte-identical.

---

## 2. Philosophy — "Glass Box"

### 2.1 Carry-over from v0.4.0

Everything from "Signal over Noise" stands: the quality gate, the snippet payload, progressive
disclosure, two-sided confidence, deterministic dispatch, no LLM on the hot path. v0.5.0 does
not remove a single v0.4 behaviour. It makes each of them observable.

### 2.2 The v0.5 addition

```
v0.4.0
  observe → reflect → gate → inject → settle(recurred?) → {effective | ineffective}
                                             │
                                             └── "no recurrence" was silently scored as a WIN

v0.5.0
  observe → reflect → gate → inject → settle(recurred? linked fix?)
             │        │                       │
             │        │                       ├── recurred            → ineffective
             │        │                       ├── linked fix found    → effective
             │        │                       └── neither             → inconclusive   ← NEW, and it is the majority case
             │        │
             │        └── every rejection emits a reason code → injections_blocked_*     ← NEW
             │
             └── human verdict (useful / wrong / outdated / ignore) → feedback columns   ← NEW
                                                                       (never evidence_count)

  and, out of band:  kevin_trace  → the whole plan, zero side effects                    ← NEW
```

### 2.3 Principles specific to v0.5 (global numbering continues from v0.4's 11–14)

| # | Principle | Implication |
|---|---|---|
| **15** | **An outcome you did not observe is not a positive outcome.** | Absence of recurrence proves nothing. It gets its own bucket, `inconclusive`, and it is excluded from the precision denominator. |
| **16** | **A rejection you did not count did not happen.** | `canInject` must return *why*, and every reason must increment a counter. A silent boolean is an unmeasurable policy. |
| **17** | **Human judgement is evidence about the memory, never evidence about the world.** | User feedback writes to `feedback_positive`/`feedback_negative`. It must never touch `evidence_count` or `recurrence_count`, which model causal reality. |
| **18** | **A debug tool that changes what it measures is not a debug tool.** | `kevin_trace` is a strict dry run: no relevance bump, no ledger row, no metric increment, no seen-set mutation. |

---

## 3. The evidence base — what the v0.4.0 source actually does

### 3.1 The confound, in code

`plugin/InjectionLedger.ts`, `settle()`. For each unsettled row the ledger counts failing
tool calls in the session whose `COALESCE(error_fingerprint, fingerprint)` matches the
injection fingerprint and whose `ts >= injected_at` (exempting the origin call). Then:

```
if (n >= 1)  → outcome = 'ineffective'
else         → outcome = 'effective'          ← the defect
```

The `else` branch is reached whenever the same error did not recur. In the overwhelmingly
common case the user simply moved on to a different file and the injected lesson was never
relevant to anything. **v0.4.0 counts that as a win.**

`plugin/metrics.ts` then compounds it:

```
precisionRate() = injections_effective / injections_total
```

so a session where nothing at all happened produces a precision rate approaching 1.0.

**Consequence:** every number Kevin currently reports about its own usefulness is
structurally optimistic by an unknown margin. This is the single most important thing to fix
before any further feature work, because the entire roadmap is a sequence of measurement
decisions.

### 3.2 Rejections are invisible

`plugin/QualityGate.ts`:

```ts
canInject(memory, ctx, qualityGateEnabled = true): boolean
```

Four rejection branches — already seen this session, non-active status, recurrence, weak/
non-actionable — all collapse into `false`. `plugin/ContextInjector.ts` calls it inside
`admit()` and discards the result. There is no way, today, to answer *"how much of Kevin's
retrieval is being thrown away, and for which reason?"* — the question the quality gate exists
to answer.

### 3.3 Retrieval is not reproducible

`plugin/MemoryService.ts`:

- `rankScore()` multiplies by `RECENCY_DECAY_PER_DAY ** ageDays`, computed from `Date.now()`.
- `getRelevant()` calls `bumpRelevance()`, which **mutates** `relevance_score` (+0.05, capped
  at 1.0) on the rows it returns.

The same query, issued twice, ranks differently — once because the clock moved, and once
because the first call changed the data. Any replay, any regression test on ranking, and any
before/after comparison is invalid until there is a way to freeze both.

### 3.4 Written-but-never-executed state

| Artifact | Status in v0.4.0 |
|---|---|
| `memories.status = 'archived'` | Permitted by the CHECK constraint since migration 004. **Zero code paths write it.** Forgetting is an unimplemented policy. |
| Supersession target | `MemoryService.save()` sets `status='superseded'` on a fingerprint collision but never records *what* replaced it. The chain is unfollowable. |
| Human feedback | No channel of any kind. The only way a user can tell Kevin it is wrong is to let the same error recur three times. |

### 3.5 What a v0.4.0 `kevin_status` payload cannot tell you

| Question | Answerable today? |
|---|---|
| Did this injection actually help? | No — `effective` conflates "helped" with "was irrelevant". |
| Why was memory X not injected? | No — the reason is discarded inside `canInject`. |
| How many candidates did retrieval find before the gate? | No — only post-gate counts exist. |
| Which memories does the user consider wrong? | No — no feedback channel exists. |
| Would the same query produce the same result tomorrow? | No — recency decay and relevance bumping both move. |
| What is Kevin's share of the prompt? | No — and it never will be; Kevin has no visibility into total session input tokens. **Do not add a `kevin_context_ratio` field; there is no denominator.** |

---

## 4. Ecosystem review

| Source | Proposal | Decision | Rationale |
|---|---|---|---|
| `tool.definition` hook | Prepend learned hints to the `bash` tool description | **REJECT** | Input is `{toolID}` only — no session, no query, no fingerprint. The hint is static, permanent for the whole session, and **structurally un-ledgerable**. It would be the only injection Kevin cannot measure, in the release whose entire purpose is measurement. |
| `experimental.chat.messages.transform` | Richer query derivation from full message history | **REJECT for v0.5** | `input` is `{}` — there is **no `sessionID`**. Kevin's injection path is keyed on sessionID everywhere (`seenBySession`, `lastUserQueryBySession`, ledger `record`/`settle`). Not usable without an upstream change. |
| v2 `define()` / domains / Skills / References | Migrate the plugin surface | **Defer to v0.9.0** | Correct destination, wrong release. v0.5.0 must not mix a measurement change with a platform migration. |
| Repository truth scanning | Validate memories against `package.json` etc. | **Defer to v0.7.0** | Genuinely valuable, but it needs the honest metrics from this release to prove it de-ranks the right things. |
| Conflict detection between memories | Detect and auto-resolve contradictions | **REJECT auto-resolution; defer detection to v0.7.0** | Auto-supersession on a fuzzy heuristic silently deletes knowledge from every future prompt with no undo. Detection is only sound where fingerprints are caller-supplied (`decision`/`rule`) — hash-prefix similarity over FNV-1a error fingerprints carries zero semantic information. |
| Memory clustering by fingerprint prefix | Group related lessons | **REJECT** | A hash prefix is not a similarity measure. Two lessons sharing eight hex characters of an FNV-1a digest are unrelated by construction. |
| Stored `confidence_tier` column | Denormalize a confidence band | **REJECT** | It is a pure function of `(evidence_count, recurrence_count)`, and `recurrence_count` is mutated by raw SQL in at least three places that bypass `MemoryService.update()` (`InjectionLedger.settle`, `penalizeRecurringReflectors`, `promoteToPattern`). A stored tier desyncs within one session. Derive it in `mapRow()` if it is ever wanted. |
| Live A/B benchmark against a real LLM | Prove value by running tasks with and without the plugin | **Adopt, re-scoped as a deterministic replay harness** | A cold-start A/B is vacuous: with an empty DB the Kevin arm injects nothing, so the measured delta is zero-or-negative by construction. `precision_rate` has no counterpart in the control arm. LLM non-determinism dwarfs the effect size. And a `benchmark/projects/sample-*` tree full of deliberately broken TypeScript would break `biome check .` (no `biome.json` exists) and be picked up by vitest's default include. A hermetic replay of recorded transcripts with a frozen clock measures Kevin's contribution exactly, costs nothing, and runs in CI. |
| Human feedback writing to `evidence_count` | `useful` → `evidence_count += 1` | **REJECT the mapping, adopt the tool** | `evidence_count` feeds `computeConfidence()`, `promoteToPattern()` and `kevin_why`'s "resolved in N of M attempts" string. Three button presses would make `kevin_why` report attempts that never happened. This is a near-exact reintroduction of the confidence-poisoning defect v0.4.0 closed. Feedback gets dedicated columns. |

---

## 5. Architecture — additions to v0.4.0

### 5.1 `InjectionLedger` (changed) — three-way settlement

`settle(sessionId)` gains a second query. For each unsettled row, in this order:

1. **Recurrence check** — *reuse the existing failing-call predicate verbatim*, including the
   `COALESCE(error_fingerprint, fingerprint)` match, the `ts >= injected_at` bound and the
   `origin_call_id` exemption. If `n >= 1` → `ineffective` (all existing side effects unchanged:
   `injections_ineffective`, `recurrence_count = MAX(recurrence_count, n)`, `last_injected_at`,
   and the `recurrence_count >= 3 → status='stale'` promotion).
2. **Linked-fix check** — the mirror of the same predicate with the success flag inverted and
   `fix_for_fingerprint = <injection fingerprint>` instead of the error match, still bounded by
   `ts >= injected_at`. If `m >= 1` → `effective`, `metrics.incr("injections_effective")`.
3. **Otherwise** → `inconclusive`, `metrics.incr("injections_inconclusive")`.

`fix_for_fingerprint` already exists on `tool_calls` (migration 004) and is already populated by
`CausalChain.onSuccess`. Index `idx_tool_calls_fix_fp` already exists. **No new write path is
needed to make this work.**

### 5.2 `QualityGate` (changed) — verdicts instead of booleans

```ts
export type GateReason =
  | "ok"
  | "seen_this_session"
  | "ignored"
  | "not_active"
  | "recurrence"
  | "weak";

export interface GateVerdict {
  readonly allowed: boolean;
  readonly reason: GateReason;
}

canInjectVerdict(
  memory: { id: string; status?: string; strength?: string; isActionable?: boolean; ignored?: boolean },
  ctx: InjectionContext,
  qualityGateEnabled?: boolean,
): GateVerdict;

// Retained verbatim as a thin wrapper so that no existing test breaks:
canInject(memory, ctx, qualityGateEnabled?): boolean;  // === canInjectVerdict(...).allowed
```

Branch order (existing order preserved, `ignored` inserted second):
`seen_this_session` → `ignored` → `not_active` → `recurrence` → `weak`.

### 5.3 `Feedback` (new component) — `plugin/Feedback.ts`

The single write path for human judgement. Never touches `evidence_count` or `recurrence_count`.

```ts
export type FeedbackVerdict = "useful" | "wrong" | "outdated" | "ignore";

export interface FeedbackResult {
  readonly id: string;
  readonly verdict: FeedbackVerdict;
  readonly feedbackPositive: number;
  readonly feedbackNegative: number;
  readonly ignored: boolean;
  readonly status: string;
  readonly confidence: number;
}

export class Feedback {
  constructor(store: Store, metrics?: Metrics | null);
  apply(memoryId: string, verdict: FeedbackVerdict, sessionId?: string, note?: string): FeedbackResult;
}
```

Semantics — deliberately asymmetric:

| Verdict | Effect | Rationale |
|---|---|---|
| `useful` | `feedback_positive += 1`; `last_verified_at = now`; `metrics.incr("feedback_positive_total")` | A human confirming a memory is real verification, but of the *memory*, not of a causal chain. |
| `wrong` | `feedback_negative += 1`; `metrics.incr("feedback_negative_total")`; **`status='stale'` only when `feedback_negative >= 2`** | One click must not permanently kill knowledge. The codebase's own recurrence threshold is 3; two human clicks is a stricter signal and a fair equivalent. |
| `outdated` | `status='stale'` **immediately**; `feedback_negative += 1` | This is a claim about the world having changed, not an opinion about quality. It is self-verifying and should act at once. |
| `ignore` | `ignored = 1` | Excluded from retrieval and from injection. **Never deleted** — the user may want it back, and deletion destroys ledger history. |

Every call also appends a row to `memory_feedback` for the audit trail.

### 5.4 `Archiver` (new component) — `plugin/Archiver.ts`

Implements the `stale → archived` transition that has been legal since migration 004 and has
never been performed.

```ts
export class Archiver {
  constructor(store: Store, metrics?: Metrics | null);
  run(now?: Date): number;   // returns rows archived
}
```

`UPDATE memories SET status='archived', archived_at=? WHERE status='stale' AND updated_at < ?`
where the threshold is `now - archive_after_days` (setting, default `'30'`). Archived rows are
excluded from retrieval (they already are — retrieval filters `status='active'`) but remain
queryable by `kevin_get` and exportable. Runs on `session.idle`, after `ledger.settle()`.

### 5.5 `ContextInjector` (changed) — decomposition and dry run

The monolithic `inject()` splits into three seams plus a public planner:

```ts
interface CandidateRow {
  readonly memory: Memory;
  readonly quality: LessonQuality;
  readonly verdict: GateVerdict;
  readonly tokens: number;
}

interface InjectionPlan {
  readonly query: string;
  readonly tag: "context" | "memory";
  readonly cap: number;
  readonly candidates: CandidateRow[];
  readonly admitted: { id: string; type: string; tokens: number }[];
  readonly rejected: { id: string; reason: GateReason; tokens: number }[];
  readonly block: string;
  readonly blockTokens: number;
  readonly dryRun: boolean;
}

private getCandidates(query: string, cap: number, bump: boolean): Memory[];
private evaluateGate(memories: Memory[], sessionId: string, dryRun: boolean): { admitted: Memory[]; rejected: CandidateRow[] };
private buildBlock(admitted: Memory[], tag: "context" | "memory"): string;
plan(query: string, tag: "context" | "memory", cap: number, sessionId: string, dryRun: boolean): InjectionPlan;
trace(query: string, tag: "context" | "memory", sessionId: string): InjectionPlan;   // dryRun = true
```

**Dry-run invariants — all four are mandatory and each gets its own test:**

1. `getCandidates` is called with `bump = false`.
2. `evaluateGate` operates on a **clone** of the session's seen-set; the real set is untouched.
3. No `ledger.record()` call is made.
4. No `metrics.incr()` call is made — including the `injections_blocked_*` counters.

The existing `inject()` becomes `plan(..., dryRun = false)` followed by the unchanged
`recordInjections()` + `metrics.incr(metricKey, ...)` calls. The 0.8×-cap refetch behaviour
moves inside `getCandidates` and is preserved exactly.

### 5.6 `MemoryService` (changed) — clock injection and determinism

```ts
getRelevant(opts: {
  query: string;
  maxTokens: number;
  bump?: boolean;
  now?: Date;               // NEW — defaults to new Date()
}): Memory[];
```

When `kevin_settings.deterministic_retrieval === '1'`:

- `rankScore()` uses a recency decay factor of exactly `1.0` (age is ignored).
- `bumpRelevance()` is skipped regardless of the `bump` argument.

Retrieval then becomes a pure function of database state. Default is `'0'`; nothing changes for
existing users.

Retrieval SQL additionally gains `AND ignored = 0`.

### 5.7 `kevin_audit` (new tool) — `plugin/kevin_audit.ts`

Pure SQL over `memories`, `kevin_injections`, `kevin_metrics`, `memory_feedback`. No LLM, no
side effects. Shape:

```jsonc
{
  "memories": {
    "total": 0, "by_status": {}, "by_origin": {}, "by_type": {},
    "ignored": 0, "archived": 0, "with_feedback": 0, "superseded_with_target": 0
  },
  "injections": {
    "total": 0, "effective": 0, "ineffective": 0, "inconclusive": 0, "unmeasured": 0,
    "precision_rate": 0, "coverage_rate": 0
  },
  "blocked": { "seen": 0, "weak": 0, "recurrence": 0, "stale": 0, "ignored": 0 },
  "feedback": { "positive": 0, "negative": 0, "by_verdict": {} },
  "tokens": { "pre_prompt": 0, "compacting": 0 },
  "settings": { }
}
```

There is deliberately **no `kevin_context_ratio`**: Kevin cannot observe total session input
tokens, so any such figure would be fabricated.

### 5.8 Replay harness (new) — `plugin/replay.ts` + `tests/replay/`

A hermetic, deterministic driver that feeds a recorded transcript through the plugin's hooks
against an in-memory database with a frozen clock, then reports the outcome distribution.

- Transcript format: a JSON array of typed events, each carrying an explicit `at` ISO timestamp.
- Lives under `tests/replay/` so it is inside the existing `tsconfig.json` `include` and the
  existing vitest roots — **no new tooling, no `biome.json` exclusions, no broken-TypeScript
  fixture trees.**
- Ships with one small hand-written fixture so CI always has something to run. Recording real
  transcripts is a documented user activity, not a build step.
- **This is an artifact, not a release gate.** It does not appear in §11.

---

## 6. Schema delta — `migrations/006_v05_glassbox.sql`

```sql
-- ============================================================================
-- 006_v05_glassbox.sql — v0.5.0 "Glass Box"
--
-- Honest measurement, human feedback, lifecycle completion.
--
-- Section 1: rebuild kevin_injections to admit a fourth outcome.
-- Section 2: human feedback storage.
-- Section 3: memory lifecycle columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: schema_version.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. kevin_injections: add 'inconclusive'.
--
-- SQLite cannot ALTER a CHECK constraint, so the table must be rebuilt.
-- Migration 004 set this precedent. kevin_injections has no FTS5 triggers,
-- so unlike 004 this is a straight four-step rebuild.
--
-- Existing rows with outcome='effective' are remapped to 'inconclusive'.
-- This is not data loss: v0.4's 'effective' meant "the error did not recur",
-- which is the exact definition of the new 'inconclusive' bucket. Rows that
-- genuinely earned the new 'effective' will be re-settled naturally, and the
-- post-apply hook re-derives the counters from the table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kevin_injections_new (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  hook        TEXT NOT NULL CHECK (hook IN ('pre_prompt','compacting')),
  tokens      INTEGER NOT NULL,
  injected_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome     TEXT NOT NULL DEFAULT 'unmeasured'
              CHECK (outcome IN ('unmeasured','effective','ineffective','inconclusive'))
);

INSERT INTO kevin_injections_new
  (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome)
SELECT
  id, memory_id, fingerprint, session_id, hook, tokens, injected_at,
  CASE WHEN outcome = 'effective' THEN 'inconclusive' ELSE outcome END
FROM kevin_injections;

DROP TABLE kevin_injections;
ALTER TABLE kevin_injections_new RENAME TO kevin_injections;

CREATE INDEX IF NOT EXISTS idx_injections_fp      ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session ON kevin_injections(session_id);
CREATE INDEX IF NOT EXISTS idx_injections_outcome ON kevin_injections(outcome);

-- ---------------------------------------------------------------------------
-- 2. Human feedback. Append-only audit trail; the hot path reads the
--    denormalized counters on `memories` (section 3), never this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_feedback (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('useful','wrong','outdated','ignore')),
  session_id TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_memory  ON memory_feedback(memory_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON memory_feedback(created_at);

-- ---------------------------------------------------------------------------
-- 3. Memory lifecycle and feedback columns.
--
--    feedback_positive / feedback_negative are SEPARATE from evidence_count
--    and recurrence_count by design: human judgement is evidence about the
--    memory, causal counters are evidence about the world. Mixing them was
--    the confidence-poisoning defect closed in v0.4.0.
--
--    superseded_by has no REFERENCES clause on purpose. Store enables
--    PRAGMA foreign_keys=ON, and a hard FK would block deletion of a memory
--    that superseded another.
-- ---------------------------------------------------------------------------
ALTER TABLE memories ADD COLUMN feedback_positive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN feedback_negative INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN ignored           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN superseded_by     TEXT;
ALTER TABLE memories ADD COLUMN archived_at       TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_ignored  ON memories(ignored);
CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived_at);

-- ---------------------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS in metrics.ts.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('injections_inconclusive',      0),
  ('injections_blocked_seen',      0),
  ('injections_blocked_weak',      0),
  ('injections_blocked_recurrence',0),
  ('injections_blocked_stale',     0),
  ('injections_blocked_ignored',   0),
  ('feedback_positive_total',      0),
  ('feedback_negative_total',      0),
  ('memories_archived',            0);

-- ---------------------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an explicit
--    string comparison or an explicit Number() parse — never `=== 1`.
--    (That exact mistake kept cross_project_enabled unreachable for the
--    whole of v0.3.0.)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('deterministic_retrieval',    '0'),
  ('pre_prompt_budget_tokens', '900'),
  ('archive_after_days',        '30');

-- ---------------------------------------------------------------------------
-- 6. Version marker.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('006');
```

**Backward compatibility.** All five `memories` columns are added with `NOT NULL DEFAULT` or as
nullable, so every existing row remains valid and every existing query keeps working. The
`kevin_injections` rebuild preserves all columns, all values and all indexes; only the CHECK
constraint widens and `effective` is remapped to its honest equivalent. `Migrate.run()` wraps
the whole file in a single transaction, so a partial rebuild is impossible. **Idempotency comes
from `schema_version`, not from the SQL** — raw `ALTER TABLE ADD COLUMN` throws
`duplicate column name` on a second execution, which is why the acceptance criterion is
"applying via `Migrate.run()` twice is a no-op", never "running the SQL twice is a no-op".

**Post-apply hook `DEFAULT_POST_APPLY_HOOKS["006"]`** (belt-and-braces, and idempotent by
construction because it *re-derives* rather than increments):

```sql
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections)                                   WHERE key = 'injections_total';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'effective')       WHERE key = 'injections_effective';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'ineffective')     WHERE key = 'injections_ineffective';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'inconclusive')    WHERE key = 'injections_inconclusive';
```

---

## 7. Decisions log (D5 series)

These IDs are cited in code comments exactly as `D4-NN` are today, e.g.
`// v0.5.0 (K5-005 / plan §5.1, D5-01)`.

| ID | Decision | Rationale |
|---|---|---|
| **D5-01** | **`effective` requires a linked fix; absence of recurrence becomes `inconclusive`.** | Absence of evidence is not evidence. `fix_for_fingerprint` already exists and is already populated, so the honest definition costs nothing to implement. |
| **D5-02** | **`precision_rate = effective / (effective + ineffective)`; `coverage_rate = (effective + ineffective) / total`.** | Once a third outcome exists, `total` is the wrong denominator: it would let an idle session drive precision toward 1.0. Coverage is reported separately so a low measurable fraction is visible rather than hidden. |
| **D5-03** | **Pre-existing `effective` rows are remapped to `inconclusive` during the rebuild.** | v0.4's `effective` is definitionally today's `inconclusive`. Keeping them would carry the confound forward into every future report. |
| **D5-04** | **`canInject` is retained as a wrapper over `canInjectVerdict`.** | 548 tests currently pass. A measurement release must not spend its risk budget on gratuitous signature churn. |
| **D5-05** | **Human feedback never writes `evidence_count` or `recurrence_count`.** | Those columns feed `computeConfidence`, `promoteToPattern` and `kevin_why`'s "resolved in N of M attempts". Writing opinion into them would make Kevin report attempts that never happened — the exact defect v0.4.0 closed. |
| **D5-06** | **`wrong` stales only at `feedback_negative >= 2`; `outdated` stales immediately.** | "Wrong" is an opinion and deserves a second opinion. "Outdated" is a claim about the world having changed, is self-verifying, and should act at once. |
| **D5-07** | **`ignore` sets a column; it never deletes.** | Deletion destroys ledger history and is irreversible. A flag is reversible and auditable. |
| **D5-08** | **`kevin_trace` is a strict dry run with four enforced invariants.** | A debug tool that inserts ledger rows would inflate `injections_total` and destroy the very metric this release exists to fix. Each invariant gets its own test. |
| **D5-09** | **No `kevin_context_ratio` in `kevin_audit`.** | Kevin has no access to total session input tokens. A ratio with an invented denominator is worse than no ratio. |
| **D5-10** | **Determinism is opt-in via `deterministic_retrieval`, not an environment variable.** | Settings are inspectable through `kevin_config`, persisted, and per-installation. Env vars are invisible to `kevin_audit`. |
| **D5-11** | **Default pre-prompt budget drops 1500 → 900 and becomes a setting.** | The confound fix will very likely reveal that a large share of injections are inconclusive. Charging a 1500-token toll for an unproven benefit is indefensible; making it configurable lets measurement drive the number rather than a constant. |
| **D5-12** | **The replay harness lives under `tests/replay/` and is not a release gate.** | It is already inside `tsconfig.json` `include` and the vitest roots. A top-level `benchmark/` tree with deliberately broken TypeScript would break `biome check .` (there is no `biome.json`) and be swept up by vitest's default include. |
| **D5-13** | **The `006` post-apply hook re-derives counters instead of incrementing them.** | Re-derivation is idempotent by construction, self-healing on any earlier drift, and cannot double-count if the hook is ever re-run. |
| **D5-14** | **`superseded_by` carries no `REFERENCES` clause.** | `Store` sets `PRAGMA foreign_keys = ON`. A hard FK would block deleting a memory that had superseded another, which is a legitimate operation. |
| **D5-15** | **Archiving runs on `session.idle`, after settlement.** | Settlement can stale a memory in the same idle cycle; archiving must observe the post-settlement state, not the pre-settlement one. |

---

## 8. Changes per file

### 8.1 `migrations/006_v05_glassbox.sql` (new)

Full content in §6.

### 8.2 `plugin/Migrate.ts`

- Add `"006"` to `DEFAULT_POST_APPLY_HOOKS` with the four re-derivation `UPDATE`s from §6.

### 8.3 `plugin/metrics.ts`

- Append 9 keys to `METRIC_KEYS`, in the same order as the migration seeds them.
- `precisionRate()` → `effective / (effective + ineffective)`, returning `0` when the
  denominator is `0`.
- Add `coverageRate()` → `(effective + ineffective) / total`, returning `0` when `total` is `0`.
- Add `blockedSnapshot(): Record<string, number>` returning the five `injections_blocked_*` values.

### 8.4 `plugin/InjectionLedger.ts`

- Widen `InjectionOutcome` to `"unmeasured" | "effective" | "ineffective" | "inconclusive"`.
- `settle()` gains the linked-fix query and the three-way branch of §5.1.
- Add `outcomeCounts(): Record<InjectionOutcome, number>` for `kevin_audit`.

### 8.5 `plugin/QualityGate.ts`

- Add `GateReason`, `GateVerdict`, `canInjectVerdict()`.
- Extend `InjectionContext` with nothing; the `ignored` flag arrives on the memory argument.
- `canInject()` becomes `canInjectVerdict(...).allowed`.

### 8.6 `plugin/confidence.ts`

- Add `FEEDBACK_POSITIVE_STEP = 0.05`, `FEEDBACK_NEGATIVE_PENALTY = 0.20`,
  `FEEDBACK_POSITIVE_CAP = 4`, `FEEDBACK_NEGATIVE_CAP = 3`.
- `computeConfidence(evidenceCount, recurrenceCount, feedbackPositive = 0, feedbackNegative = 0)`.
  With both feedback arguments at their defaults the result is **bit-identical to v0.4.0**.

### 8.7 `plugin/Feedback.ts` (new)

See §5.3.

### 8.8 `plugin/Archiver.ts` (new)

See §5.4.

### 8.9 `plugin/MemoryService.ts`

- `getRelevant()` gains `now?: Date` and honours `deterministic_retrieval`.
- Retrieval SQL gains `AND ignored = 0`.
- `mapRow()` reads `feedback_positive`/`feedback_negative`/`ignored`/`superseded_by`/`archived_at`
  and passes the two feedback counts to `computeConfidence`.
- `save()` sets `superseded_by = <new id>` on the existing decision/rule supersede path.
- Add `archiveStale(cutoffIso: string): number`.

### 8.10 `plugin/ContextInjector.ts`

- Decomposition per §5.5.
- `admit()` calls `canInjectVerdict` and, when `dryRun === false`, increments the matching
  `injections_blocked_*` counter.
- Pre-prompt cap is read from `pre_prompt_budget_tokens` (default `900`, clamped to `[100, 4000]`).
  `SYSTEM_TRANSFORM_TOKENS` remains exported as the fallback constant.

### 8.11 `plugin/kevin_audit.ts` (new)

See §5.7.

### 8.12 `plugin/replay.ts` (new)

See §5.8.

### 8.13 `plugin/index.ts`

- Append `deterministic_retrieval`, `pre_prompt_budget_tokens`, `archive_after_days` to
  `KEVIN_CONFIG_KEYS`. **Omitting this makes `kevin_config set` return `{error:"unknown_key"}`
  while `kevin_config list` still shows the key — a bug that ships green.**
- Instantiate `Feedback` and `Archiver`.
- Register `kevin_feedback`, `kevin_trace`, `kevin_audit`.
- Extend `kevin_status` with `injections_inconclusive`, `coverage_rate` and `blocked`.
- `session.idle`: `ledger.settle()` → `CausalChain.onSessionIdle()` → `archiver.run()`, each in
  its own `try/catch` so a legacy DB cannot break the chain.

### 8.14 `scripts/verify-install.ts`

- Add `006_v05_glassbox.sql` to the hard-coded migration list. Without this, `npm run verify`
  silently never exercises migration 006.

---

## 9. Tasks (K5-001 … K5-024)

Full stanzas, acceptance criteria and verification commands are in
`docs/Kevin_v0.5.0_Task.md`. Summary:

| Phase | IDs | Content |
|---|---|---|
| **F0 Substrate** | K5-001 … K5-004 | Migration 006, post-apply hook, config keys + verify script, metric keys |
| **F1 Honest measurement** | K5-005 … K5-008 | Three-way settlement, gate verdicts, blocked counters, deterministic retrieval |
| **F2 Human feedback** | K5-009 … K5-011 | `Feedback` component, confidence terms, `kevin_feedback` tool |
| **F3 Lifecycle** | K5-012 … K5-013 | `Archiver`, `superseded_by` population |
| **F4 Observability** | K5-014 … K5-017 | Injector decomposition, `kevin_trace`, `kevin_audit`, configurable budget |
| **F5 Replay harness** | K5-018 … K5-020 | Transcript format, replayer, report script |
| **F6 Release** | K5-021 … K5-024 | `kevin_status`, docs, closed-loop e2e, final verification |

**Critical path:** K5-001 → K5-002 → K5-005 → K5-014 → K5-015 → K5-023.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| AGENTS.md writer, Skills, References | A different thesis (distribution) that must not be entangled with a measurement change | v0.6.0 |
| Repository truth scanner | Needs the honest metrics from this release to prove it de-ranks correctly | v0.7.0 |
| Conflict detection | Only sound on caller-supplied fingerprints; needs `decision`/`rule` to be the centre of gravity first | v0.7.0 |
| Conflict auto-resolution | Destructive heuristic with no undo | Never |
| Memory clustering by fingerprint prefix | A hash prefix carries no semantic information | Never |
| Stored `confidence_tier` column | Derived value next to three raw-SQL mutation sites; guaranteed to desync | Never (derive in `mapRow`) |
| `tool.definition` augmentation | Static, session-less, permanent, structurally un-ledgerable | Never |
| `experimental.chat.messages.transform` | `input` carries no `sessionID` | Blocked upstream |
| v2 `define()` / domain API migration | Platform migration; must not share a release with a semantics change | v0.9.0 |
| TUI panel | Needs the curation workflow of v0.6.0–v0.7.0 to exist first | v0.9.0 |
| Live-LLM A/B benchmark | Vacuous at cold start; non-determinism dwarfs the effect | Replaced by the replay harness |
| Embeddings / vector search | The binding constraint is query derivation, not ranking | Revisit post-v1.0 if measured |
| Any new runtime dependency | Runtime deps stay `@opencode-ai/plugin` + `zod`, `better-sqlite3` optional | — |

---

## 11. Final verification

All four must exit 0 before the release is tagged:

```
npm run typecheck
npm run lint
npm test
npm run verify
```

Plus these release-specific checks:

1. `Migrate.run()` applied twice against a fresh DB reports `applied: []` on the second run.
2. A v0.4.0 database (schema_version `005`) migrates to `006` with zero row loss in
   `kevin_injections` and every prior `effective` row now reading `inconclusive`.
3. `kevin_trace` executed twice produces byte-identical output, and leaves the row counts of
   `kevin_injections` and `kevin_metrics`, plus every `memories.relevance_score`, unchanged.
4. `computeConfidence(e, r)` returns exactly the v0.4.0 value for all `e`, `r` when the feedback
   arguments are omitted.
5. `kevin_config set` succeeds for all three new keys.

---

## 12. Summary of what changed from v0.4.0

| Area | v0.4.0 | v0.5.0 |
|---|---|---|
| Injection outcomes | 3 (`unmeasured`, `effective`, `ineffective`) | 4 (+ `inconclusive`, the new majority bucket) |
| `effective` means | the error did not recur | a linked fix was observed |
| `precision_rate` | `effective / total` | `effective / (effective + ineffective)`, plus `coverage_rate` |
| Gate rejections | discarded boolean | 5 reason codes, 5 counters |
| Human feedback | none | `kevin_feedback` + dedicated columns + audit table |
| `archived` status | legal but never written | written by `Archiver` on `session.idle` |
| Supersession target | not recorded | `superseded_by` |
| Injection introspection | none | `kevin_trace` (strict dry run) |
| Aggregate reporting | `kevin_status` counts | `kevin_audit` full diagnostic |
| Retrieval reproducibility | clock-dependent and self-perturbing | optional `deterministic_retrieval` |
| Pre-prompt budget | 1500, hard-coded | 900, configurable, clamped |
| Metric keys | 13 | 22 |
| Tools | 10 | 13 |

---

## 13. References

- `docs/Kevin_Roadmap.md` — the v0.5 → v1.0 ladder, the honest assessment, and the kill criteria this release makes checkable.
- `docs/Kevin_v0.4.0_Bugs.md` — the audit that established components-built-but-never-wired, untyped SQLite boundaries and process-global session state as this codebase's recurring defect classes. All three are guarded against here.
- `migrations/004_v03_knowledge.sql` — the table-rebuild precedent followed in §6.
- `@opencode-ai/plugin@1.17.10` `dist/index.d.ts` — hook surface, used in §4 to reject two proposals on typed evidence.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 Substrate | K5-001 … K5-004 | `[X]` Done |
| F1 Honest measurement | K5-005 … K5-008 | `[X]` Done |
| F2 Human feedback | K5-009 … K5-011 | `[X]` Done |
| F3 Lifecycle | K5-012 … K5-013 | `[X]` Done |
| F4 Observability | K5-014 … K5-017 | `[X]` Done |
| F5 Replay harness | K5-018 … K5-020 | `[X]` Done |
| F6 Release | K5-021 … K5-024 | `[X]` Done |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11


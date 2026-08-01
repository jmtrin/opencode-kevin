# Opencode-kevin — Implementation Plan v0.3.0

**Version:** 0.3.0
**Date:** 2026-07-25
**Status:** Draft for implementation — F0 + F1 + F2 complete
**Paradigm:** Observe and Learn → Knowledge + Causality
**Type:** Design document + implementation plan
**Author:** GLM-5.2 (v0.3.0 planning session, 2026-07-25)
**Inputs:**
- `docs/Kevin_Plan.md` — Part A (v0.1.0) + Part B (v0.2.0). Roadmap §14, amendment §B12.
- `docs/Kevin_new_v0.2.0.md` — Grok 4.5 analysis, recalibrated post-v0.2 roadmap (§7).
- `docs/Kevin_Task.md` — K2-001..K2-032 (all marked [X]).
- Direct review of `plugin/*.ts`, `migrations/003_v02_signal.sql`.

---

## 1. Executive Summary

v0.1.x delivered **observation**; v0.2.0 delivered **signal quality** (dedup, throttle, metrics, lesson v2, origin ranking). v0.3.0 delivers **knowledge synthesis** and the **causal link** between failures and fixes — the missing half of the `Observe → Learn → Share` cycle.

The central thesis of v0.3.0 is unchanged from Grok 4.5's verdict:

> Kevin is **OpenCode's local immune system**. Not the agent's wiki, not a generic memory store, not a RAG clone. The differentiator is learning from the *agent's own tool calls* — and causal chains close that loop automatically.

| Dimension | Value |
|---|---|
| Release theme | Knowledge + Causality |
| Version | 0.3.0 |
| New files (plugin) | `CausalChain.ts`, `kevin_why.ts` (tool impl) |
| Changed files | `MemoryService.ts`, `Reflector.ts`, `ToolCallObserver.ts`, `PatternMiner.ts`, `index.ts` |
| New migration | `migrations/004_v03_knowledge.sql` (idempotent, additive) |
| New tools | `kevin_why` |
| Changed tools | `kevin_query` (optional `evidence` flag), `kevin_status` (causal metrics) |
| New columns | `tool_calls.fix_for_fingerprint`, `memories.evidence_count`, `memories.last_verified_at` |
| Tasks | K3-001..K3-028 (28 tasks, ~6 weeks) |
| Risk | 🟡 medium (LLM reflection hop opt-in; causal linking heuristic) |
| Breaking | No (additive migration; flags default off for new behavior) |

**Exit criterion**: after a `tsc` failure with TS2304 followed by a successful fix, Kevin automatically promotes the failure → fix to a `pattern` memory with `confidence ≥ 0.7` and `evidence_count = 1`, retrievable via `kevin_why "TS2304"` with a human-readable causal trace — without any manual `kevin_save`.

---

## 2. Philosophy — "Knowledge + Causality"

### 2.1 Carry-over from v0.1/v0.2

The Philosophy ("Observe and Learn", §2 of `Kevin_Plan.md`) and the six Principles are unchanged:

1. Observe, don't orchestrate.
2. Learning is the differentiator.
3. Local-first (no cloud, no API cost).
4. Proactive over reactive.
5. Delegate to the ecosystem.
6. Plan-as-graph compatible.

### 2.2 The causal addition

v0.1 answers: *what failed?*
v0.2 answers: *how often does this fail, and is it deduplicated?*
v0.3 answers: **what fixed it, and how confident are we?**

```
       v0.2 (already shipped)
       ┌──────────┐
       │ OBSERVES │ tool.execute.before/after → records in tool_calls
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │  LEARNS  │ if failure → Reflector generates type:error memory
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │  SHARES  │ system.transform → injects lesson before next prompt
       └──────────┘

       v0.3 (this release adds the back-arrow)
       ┌──────────┐
       │ OBSERVES │ tool.execute.after SUCCESS → matches prior failure fingerprint
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │  LINKS   │ CausalChain: failure_fp + Δtool_calls → success → promote to pattern
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │  EXPLAINS│ kevin_why "TS2304" → confidence + evidence trace
       └──────────┘
```

### 2.3 Principles specific to v0.3.0

| # | Principle | Implication |
|---|---|---|
| 7 | Causal inference is local | No external LLM required for the causal link; use fingerprints + tool call deltas |
| 8 | Confidence is earned, not declared | `confidence` derives from evidence (count of confirmed fixes), never from `kevin_save` |
| 9 | LLM reflection is opt-in, heuristic always default | The heuristic is free; LLM enrichment is a feature flag, never the hot path |
| 10 | Export is opt-in, curated | Only `decision`/`pattern`/`rule` memories belong in a git diff; raw errors stay in the global DB |

---

## 3. The state of v0.2.0 (entry point)

Before defining v0.3.0, note what already exists and what is **not** proposed. The v0.2.0 release (already shipped) introduced:

- `memories.project_id`, `memories.fingerprint`, `memories.origin` (FK-less columns)
- Partial UNIQUE index `uq_memories_error_fp` for reflexivity dedup
- `tool_calls.project_id`, `tool_calls.fingerprint`
- `kevin_metrics` (6 seeded counters)
- `kevin_settings` (opt-in flags: `patternminer_enabled`, `tool_calls_dedup_enabled`)
- Per-error-code lesson v2 (`TS_CODE_RULES`, `SYSCALL_RE`, etc.)
- Origin-aware ranking: `BM25 × origin_boost × recency_decay`
- Feedback loop positive half (`relevance_score += 0.05` on no-recurrence)
- PatternMiner (opt-in, deterministic n-grams; threshold N ≥ 5 sessions)

The 373-test suite passes; typecheck passes; the v0.1.4 fix (self-sufficient failure detection) is fully landed.

---

## 4. Ecosystem review — and what to discard

This section addresses the v0.3.0 proposals coming from external AI model analyses, because at least one of them contradicts existing design decisions. We record each idea and either adopt, defer, or reject — with explicit rationale.

| Source | Idea | Decision | Rationale |
|---|---|---|---|
| aictx/memory | Engineering wiki (architecture, conventions, gotchas in repo) | **Adopt concept** | Rephrased as `decision`/`rule`/`pattern` taxonomy, anchored via OKF export to git. NOT a per-repo DB. |
| sqlite-memory | Hybrid retrieval (FTS5 + vectors + RRF) | **Conditional adopt** | Same as §B12: only if v0.2.x metrics show FTS5 miss rate above threshold. ONNX-only, no network. |
| Mem0 | Auto-extraction, consolidation, update-or-supersede | **Adopt pattern** | Generalize existing `relevance_score` decay into a supersede model: a new `decision` memory with same fingerprint supersedes the older one (`status = "superseded"`). |
| PlugMem | Abstract rule over raw experience | **Adopt** | PatternMiner already does this for n-grams; v0.3 extends to causal patterns. |
| MCP adapter | Decouple Kevin from OpenCode via MCP server | **v0.4+, NOT v0.3** | Reject for v0.3: contradicts the "OpenCode-native depth" positioning (§B1, §B12-16 "Worker/separate process/MCP server → unspecified future"). Kevin's moat is `tool.execute.before/after`, not an MCP surface. |
| Graph memory | SQLite relations table (cause/uses/fixed_by) | **Defer** | The fingerprint already acts as an implicit grouping key. Arelations table adds schema complexity (migration + 2 join tables) without a proven use case. Causal chains in v0.3 use a single `tool_calls.fix_for_fingerprint` column to express the same relation cheaply. Revisit if CausalChain outgrows the column. |
| Memory taxonomy (decision, rule, failure, solution, preference, pattern) | **Enhance** | Add `rule` and `solution` as new `type` values via a `kevin_`-level enum widening (CHECK constraint, additive). `failure` overlaps with `error` → keep `error`. `preference` overlaps cross-project, defer. |
| Confidence + evidence | **Adopt** | Generalize `relevance_score` (currently 0..1 with +0.05 bumps) into `confidence` + `evidence_count` + `last_verified_at`. The existing column is preserved; the new fields are additive. |
| Memory lifecycle (candidate→confirmed→trusted→stale→archived) | **Defer** | The cumulative effect of dedup + feedback loop positive half (v0.2) + feedback loop **negative half** (v0.3) + supersede (v0.3) replaces lifecycle state machines. Add a `status` column only if synthesis proves insufficient. |
| Causal chains (failure → fix → pattern) | **NEW — Adopt** | The v0.3 signature feature. No external project proposes this because they lack the OpenCode hook surface. Builds on Reflector + fingerprints + tool_calls. |
| Explainability CLI (`kevin why pnpm?`) | **NEW — Adopt** | Low-cost value-surfacing tool. Read-only query on existing data. |
| Repo-local DB (`.project/.kevin/`) | **REJECT** | Contradicts Decision D-f: `project_id` is a *column*, deliberately global DB. The rationale (§B12 D-f): "Making it a column lets us scope dedup per project and lets future cross-project recall buy back the sharing semantics." A per-repo DB breaks cross-project comparison. |
| Synthesis job (cluster → consolidate → promote) | **Enhance PatternMiner** | PatternMiner already clusters n-grams. v0.3 adds a causal promotion path (`error` → `pattern` with evidence) rather than a separate synthesis job. |
| Git-anchored memories (commit SHA link) | **Fold into OKF export** | The OKF markdown export already maps to git diffs naturally. A `memories.commit_sha` column is rejected (couples DB to a single repo's git history; breaks cross-project). |
| Team export/import | **Already planned** | OKF export/import was always v0.3 (§B12, §7 of Grok 4.5). |
| Mandatory embeddings | **REJECT** | Local-first constraint; embeddings are conditional on metrics evidence (§B12). |
| Auto-save everything | **REJECT** | Memory cemetery — Kevin already filters aggressively via Reflector throttle + dedup. |
| Multi-agent critic loop | **REJECT** | API cost; heuristic + opt-in LLM reflection is the design (§B12). |

---

## 5. Architecture — additions to v0.2.0

### 5.1 New component: `CausalChain`

A pure-TS, no-LLM component that runs on `tool.execute.after` **success** events and on `session.idle`.

```
                   existing v0.2 path
                   ─────────────────
tool.execute.after(failure)
   → Reflector.invoke
   → memories { type:'error', fingerprint:F, origin:'reflector' }


                   new v0.3 path
                   ──────────────
tool.execute.after(success)
   → CausalChain.onSuccess(tool, args, projectId, sessionId)
        │
        │  for each recently-failed (≤ 24h) fingerprint F
        │  associated with this project+session:
        │
        ▼
   candidate fix: link SUCCESSFUL tool_call to F
   store: tool_calls.fix_for_fingerprint = F
        │
        ▼
   on session.idle:
        for each (F, evidence count ≥ 1) pair:
            promote error memory → pattern memory
            pattern.confidence = clamp(0.5 + 0.1 * evidence_count, 0, 1)
            pattern.evidence_count = N
            pattern.last_verified_at = now
            error memory is NOT deleted (audit trail)
            pattern.origin = 'causal'
```

**Key design choices:**

1. **No LLM in the causal link.** The link is established by `fingerprint` equality between a failure memory and a succeeding `tool_calls` row in the same project. This is what makes Kevin's moat: the causal link is *observed*, not inferred.
2. **`tool_calls.fix_for_fingerprint`** is a single nullable column. Avoids a relations/junction table (Grok 4.5's graph-DB concern).
3. **Promotion, not replacement.** The original `error` memory is preserved (audit trail, rollback if the "fix" turns out to be a fluke). A new `pattern` memory is created with `origin = 'causal'`.
4. **Confidence is earned.** It starts at `0.5` on first evidence, climbs `+0.10` per subsequent confirmed fix (cap `1.0`). Never settable via `kevin_save`.

### 5.2 New component: `kevin_why` tool

A read-only tool that returns a human-readable causal trace for a query.

```typescript
kevin_why({ query: "TS2304" })
  → {
      summary: "When tsc fails with TS2304, adding the missing import usually fixes it.",
      confidence: 0.87,
      evidence_count: 4,
      last_verified: "2026-07-25T10:00:00Z",
      trace: [
        { event: "failure", fingerprint: "F1", session: "s3", ts: "..." },
        { event: "fix",     fingerprint: "F1", session: "s3", ts: "..." },
        { event: "failure", fingerprint: "F1", session: "s4", ts: "..." },
        { event: "fix",     fingerprint: "F1", session: "s4", ts: "..." },
      ],
      related_rules: [ "import or typo" ]
    }
```

The trace materializes from existing tables: `memories` (error + pattern rows) + `tool_calls` (with `fix_for_fingerprint`). No new schema beyond the columns in §6.

### 5.3 New opt-in: LLM reflection enrichment

Behind a `kevin_settings.llm_reflection_enabled` flag (default **off**), the Reflector may call an opt-in LLM enrichment step **after** the heuristic lesson is generated:

- The heuristic lesson is *always written first* (fast path, no API).
- The LLM hop produces a `Likely cause:` enrichment line and updates `memories.evidence_count` evaluation.
- Cost is opt-in and isolated; heuristic is the default — as required by §B12.

### 5.4 OKF-style export/import

- `kevin_export({ format: "okf" | "markdown" })` produces a markdown bundle of `type ∈ { decision, rule, pattern }` memories (NOT raw `error`) with `confidence`/`evidence` frontmatter.
- `kevin_import({ path })` ingests a markdown bundle into read-only `context`-typed memories with `origin = 'imported'`.
- Output is meant to live in `.kevin/knowledge/` or `docs/kevin-knowledge/` for git diffing — this is the "engineering wiki" without requiring a per-repo DB.

### 5.5 Feedback loop negative half

On `session.idle`, for each `reflector`-sourced `error` memory whose `fingerprint` *did* recur as a `tool_call` failure within the same project during this session:

```
UPDATE memories
SET relevance_score = MAX(0.0, relevance_score - 0.05)
WHERE id IN (memories_to_downweight);
```

This closes the loop promised in §B12 D-e.

### 5.6 Cross-project memory (consented)

Behind `kevin_settings.cross_project_enabled` (default **off**), `MemoryService.query`/`getRelevant` retrieves `project_id IS NULL` rows. These are *user-pref* memories (`type = preference`) created via an explicit `kevin_save({ scope: 'all' })` opt-in path. No automatic cross-project harvesting.

### 5.7 Prompt mutation HITL

A `chat.message` interaction pattern (no autonomous prompt rewriting): when Kevin detects a recurrence (negative half fired), it appends a `<kevin-suggestion>` block with a draft `SKILL.md` snippet to the *next* system transform. The human decides; nothing is mutated silently.

---

## 6. Schema delta — `migrations/004_v03_knowledge.sql`

Idempotent, additive, backward-compatible (the same discipline as migration 003).

```sql
-- 004_v03_knowledge.sql
-- Additive columns for causal linking + evidence.
ALTER TABLE memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_verified_at TEXT;
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'stale', 'archived'));

-- Causal link column on tool_calls.
ALTER TABLE tool_calls ADD COLUMN fix_for_fingerprint TEXT;

-- New memory types: widen the CHECK constraint. Done via adding the new
-- enum values; error/pattern/decision/context are unchanged.
-- (Existing memories.type has no CHECK constraint in migration 001 — it
-- relies on application-layer validation. We add an opt-in CHECK in
-- a separate guard if needed; for now it's app-layer.)

-- Index: causal linkage by fingerprint. Used by CausalChain.onSuccess.
CREATE INDEX IF NOT EXISTS idx_tool_calls_fix_fp
    ON tool_calls(fix_for_fingerprint)
    WHERE fix_for_fingerprint IS NOT NULL;

-- Index: memories by fingerprint for promotion queries.
CREATE INDEX IF NOT EXISTS idx_memories_fp
    ON memories(fingerprint)
    WHERE fingerprint IS NOT NULL;

-- Seed new opt-in settings if the table exists.
INSERT OR IGNORE INTO kevin_settings(key, value)
    VALUES ('llm_reflection_enabled', '0'),
           ('cross_project_enabled', '0');
```

**Backward compatibility:** all new columns are nullable with safe defaults. Migration 003 already created `kevin_settings`, so the INSERT will succeed when run after 003. Idempotent in the Migrate runner (wrapped in a transaction).

---

## 7. Decisions log (D3 series)

| ID | Decision | Rationale |
|---|---|---|
| D3-01 | **One global DB, no per-repo store.** Carry forward D-f. | Contradicts the external "repo-local" proposal; cross-project promotion is impossible without a shared NN index. |
| D3-02 | **Causal link via `fix_for_fingerprint` column, not a relations table.** | Avoids join-table complexity; one column expresses "this successful call resolved fingerprint F". Optional relations table later if causal queries outgrow the column. |
| D3-03 | **Promotion, not replacement.** Failed `error` memories are preserved after a fix is found. | Audit trail; rollback if "fix" was a fluke. The pattern memory's `confidence` is the only signal; the original stays as ground truth. |
| D3-04 | **Confidence derived from evidence, never settable.** | Anti-gaming: `kevin_save` cannot set `confidence`; only `CausalChain` increments it. Mirrors existing anti-gaming (K2-014 "agent memories are never auto-boosted"). |
| D3-05 | **LLM reflection is opt-in, heuristic always default.** Carry forward §B12. | Keeps 0-cost default; the heuristic stays the hot path. |
| D3-06 | **OKF-like export is type-restricted.** Only `decision`/`rule`/`pattern` are exported. Raw `error` memories do not belong in a git diff. | Aligns with Grok 4.5: "in v0.2, from OKF take only progressive disclosure. Real integration = optional export in v0.3+ when there's something worthy of a diff." |
| D3-07 | **Reject MCP adapter for v0.3.** | "Worker/separate process/MCP server → unspecified future" (§B12-16). Kevin's moat is OpenCode hook depth; MCP removes it. Revisit at v0.5+ for ecosystem extension. |
| D3-08 | **Reject graph DB / relations table.** Implicit grouping via `fingerprint` is sufficient; explicit relations add complexity without proven benefit. | Causal chains are 1:N from a fix to many failures, captured by a single column. Multi-hop relations ("decisions caused bugs caused migrations") are out of scope until CausalChain proves insufficient. |
| D3-09 | **Reject repo-local DB.** Contradicts D-f. The `project_id` column already scopes dedup/recall per project, and enables cross-project recall when consented. Per-repo DBs preclude cross-project comparisons. |
| D3-10 | **New memory types `rule` and `solution`** are additive enum values at the app-layer (no DB CHECK change required). Doubling as aliases when useful: `solution` ≈ a `pattern` with high confidence; `rule` ≈ a promoted habit with repeated evidence. | Avoids migration of memories.type (it has no CHECK constraint in v0.1). |
| D3-11 | **Embeddings (sqlite-vec + BGE-M3 ONNX + RRF) gate on metrics.** Shipped only if v0.2.x `kevin_status.metrics` shows FTS5 miss rate ≥ threshold AND the implementer confirms local ONNX works in plugin context. | §B12 + §5 of Grok 4.5: "do not throw in embeddings because the 0.1 roadmap said so without FTS5 failure evidence." |
| D3-12 | **No SKILL.md autonomous mutation.** Prompt mutation is HITL via `<kevin-suggestion>` blocks only. | "Observe, don't orchestrate" (Principle 1) extends to "suggest, don't rewrite." |

---

## 8. Changes per file

### 8.1 `plugin/CausalChain.ts` (new)

- `onSuccess({ tool, args, projectId, sessionId, callID, fingerprint }: OnSuccessInput): void`
  - For each recently-failed fingerprint F in this project (last 24h):
    - If `userIdentifies` (optional) the call against F, OR the call occurs after a failure with F in the same session within X calls, mark `tool_calls.fix_for_fingerprint = F`.
- `onSessionIdle({ sessionId }): void`
  - Aggregate `(F, evidence_count)` pairs; promote `error` → `pattern` memories with `origin = 'causal'`, `confidence = clamp(0.5 + 0.1*count, 0, 1)`.
  - Update `memories.evidence_count`, `memories.last_verified_at`.

### 8.2 `plugin/Reflector.ts`

- `invoke()` continues to write `error` memories as in v0.2.0.
- If `kevin_settings.llm_reflection_enabled = 1`: after the heuristic lesson, optionally call an LLM enrichment function (injected via constructor, defaults to no-op) to append a `Likely cause:` line calibrated to the *fix*, not just the failure.
- New field in `ReflectionInput`: `fixForFingerprint?: string | null` (set by CausalChain to record that this failure was later resolved).

### 8.3 `plugin/MemoryService.ts`

- `save()` recognizes `confidence`, `evidenceCount`, `lastVerifiedAt`, `status` columns.
- New method `promoteToPattern(errorMemoryId, evidenceCount): string` — creates a `pattern` memory with the promoted fields; leaves the original `error` row intact.
- `query()` / `getRelevant()` honor the new opt-in `queryOptions.includeSuperseded` (default `false`).
- `boostPositiveReflectors()` (v0.2) augmented with the negative half: down-weight memories whose fingerprint recurred in `tool_calls` failures within the session.

### 8.4 `plugin/ToolCallObserver.ts`

- `onAfter()` records the new `fix_for_fingerprint` column when CausalChain identifies a fix.
- `inferErrorType()` unchanged.

### 8.5 `plugin/PatternMiner.ts`

- Extend `mine()` to promote causal patterns (call `MemoryService.promoteToPattern` when evidence crosses threshold).
- Reuse existing `patternminer_enabled` flag; no new flag needed.

### 8.6 `plugin/index.ts`

- Add `CausalChain` instance, wired into `tool.execute.after` (success branch) and `session.idle`.
- Register the new `kevin_why` tool.
- Extend `kevin_query` args with optional `evidence?: boolean` (default `false`).
- `kevin_status` returns new metrics: `patterns_causal`, `causal_links`, `memories_superseded`.

### 8.7 `plugin/kevin_why.ts` (new tool impl)

A pure read-only tool. The function:

1. `query = MemoryService.query({ text, type: undefined, full: true, limit: 50 })`
2. For each `type:'pattern'` memory with `origin IN ('causal', 'pattern')`:
   - Pull `tool_calls` rows with `fix_for_fingerprint = memory.fingerprint` to build the `trace`.
3. Summarize: take a top-N (default 3) by `confidence`.
4. Return JSON `{ summary, confidence, evidence_count, last_verified, trace:[...], related_rules:[...] }`.

### 8.8 Migration

`migrations/004_v03_knowledge.sql` — see §6. Registered with `Migrate.registerPostApply('004', store => { ... })` for any seed updates.

---

## 9. Tasks (K3-001 … K3-028)

Tasks use the `K3-` prefix to avoid collision with `K-` (v0.1.0) and `K2-` (v0.2.0).

### K3-001 — Draft migration 004

- **Priority:** P0
- **Estimate:** S
- **Files:** `migrations/004_v03_knowledge.sql`
- **Acceptance:**
  - File exists with §6 contents.
  - Idempotent when run twice (synthetic test in `tests/unit/migrate_v04.test.ts`).
- **Verification:** `npx vitest run tests/unit/migrate_v04.test.ts`

### K3-002 — Implement migration post-apply hook

- **Priority:** P0
- **Files:** `plugin/Migrate.ts`
- **Acceptance:** Backfill `evidence_count = 0`, `last_verified_at = NULL`, `status = 'active'` for legacy rows. Idempotent.
- **Verification:** `npx vitest run tests/unit/migrate_postapply.test.ts`

### K3-003 — Extend `MemoryService.save` for new columns

- **Priority:** P0
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** `save()` honors `confidence`, `evidenceCount`, `lastVerifiedAt`, `status` (all nullable, defaults safe).
- **Verification:** `npm run typecheck && npm test`

### K3-004 — `MemoryService.promoteToPattern`

- **Priority:** P0
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** Creates a `pattern` memory with `origin='causal'`, `confidence`, `evidence_count`, `last_verified_at`; does NOT delete the original `error`.
- **Verification:** Unit test asserts the `error` row persists; the new `pattern` row has the expected fields.

### K3-005 — New memory types `rule`, `solution`

- **Priority:** P1
- **Files:** `plugin/MemoryService.ts`, `plugin/index.ts` (`kevin_save` schema widening)
- **Acceptance:** `kevin_save` accepts `type: "rule" | "solution"`; queries return them.
- **Verification:** `npx vitest run tests/unit/memorieservice-v03-*.test.ts`

### K3-006 — CausalChain component skeleton

- **Priority:** P0
- **Files:** `plugin/CausalChain.ts`
- **Acceptance:** `onSuccess`, `onSessionIdle` methods exist; constructor takes `ToolCallObserver`, `MemoryService`, `Metrics`; no behavior yet beyond type signature.

### K3-007 — CausalChain.onSuccess: link successful calls to fingerprints

- **Priority:** P0
- **Files:** `plugin/CausalChain.ts`, `plugin/ToolCallObserver.ts`
- **Acceptance:** When a succeeding `tool.execute.after` has no `success=false` marker AND there is a recently-failed memory with the same fingerprint+project within 24h and within 10 tool calls, set `tool_calls.fix_for_fingerprint = F`.
- **Verification:** Unit test in `tests/unit/causal-chain.test.ts` covers matched/unmatched/timeout/not-in-same-session cases.

### K3-008 — CausalChain.onSessionIdle: promote errors to patterns

- **Priority:** P0
- **Files:** `plugin/CausalChain.ts`
- **Acceptance:** On `session.idle`, for each fingerprint F with `evidence_count ≥ 1`, call `MemoryService.promoteToPattern(errorId, evidenceCount)`. Increments confidence per §5.1 formula. Updates `last_verified_at`.
- **Verification:** Unit test verifies a second fix (evidence count 2) raises confidence from 0.5 to 0.6; never exceeds 1.0.

### K3-009 — Wire CausalChain into `index.ts`

- **Priority:** P0
- **Files:** `plugin/index.ts`
- **Acceptance:** `CausalChain.onSuccess` invoked in the success branch of `tool.execute.after`; `onSessionIdle` invoked in `session.idle`. Both fire-and-forget.
- **Verification:** `tests/e2e/causal-flow.test.ts`: failure → fix → `kevin_query("type:pattern")` returns a causal-pattern memory after `session.idle`.

### K3-010 — Confidence derivation guard

- **Priority:** P0
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** `kevin_save` REJECTS `confidence` field manually (D3-04). Confidence is only set by `promoteToPattern`.
- **Verification:** `kevin_save({ type:'pattern', content:'...', confidence: 0.99 })` either ignores the field or returns an error; in either case, persisted confidence is `0` (the seed). Add a unit test asserting this.

### K3-011 — `kevin_why` tool skeleton

- **Priority:** P0
- **Files:** `plugin/kevin_why.ts`, `plugin/index.ts`
- **Acceptance:** `kevin_why({ query })` tool registered; signature per §5.2.

### K3-012 — `kevin_why` implementation

- **Priority:** P0
- **Files:** `plugin/kevin_why.ts`
- **Acceptance:**
  - Queries pattern memories with origin 'causal'/'pattern' matching `query`.
  - Builds `trace` from `tool_calls` with `fix_for_fingerprint = memory.fingerprint`.
  - Returns the JSON shape in §5.2.
- **Verification:** e2e in `tests/e2e/kevin-why.test.ts`: failure + fix + idle → `kevin_why "TS2304"` returns confidence ≥ 0.5 and `trace.length === 1`.

### K3-013 — Feedback loop negative half

- **Priority:** P0
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** On `session.idle`, for each `reflector` error memory whose fingerprint recurs as a `tool_call` failure in the session: `relevance_score = MAX(0, relevance_score - 0.05)`. Combined with existing positive half.
- **Verification:** Unit test in `tests/unit/memoryservice-feedback-v03.test.ts`.

### K3-014 — Supersede model

- **Priority:** P1
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** When saving a `decision`/`rule` memory with the same `fingerprint` as an existing one, mark the old one `status = 'superseded'` and insert the new one with `status = 'active'`. Default queries hide superseded rows.
- **Verification:** Unit test: 2 saves with same fingerprint → 1 active, 1 superseded; default `kevin_query` returns only the active one.

### K3-015 — `query` and `getRelevant` filter on `status`

- **Priority:** P0
- **Files:** `plugin/MemoryService.ts`
- **Acceptance:** By default, queries return only `status = 'active'` rows. New optional `includeSuperseded: boolean` (default `false`) overrides.
- **Verification:** Unit test covers default and override.

### K3-016 — OKF/markdown export

- **Priority:** P1
- **Files:** `plugin/index.ts` (new `kevin_export` tool), `plugin/okf-export.ts`
- **Acceptance:** `kevin_export({ format: "okf" | "markdown", path })` writes a markdown bundle to disk with `type ∈ { decision, rule, pattern }` memories (no raw `error`). File has frontmatter (id, type, confidence, evidence_count, last_verified_at, fingerprint).
- **Verificación:** `tests/e2e/okf-export.test.ts` verifies file contents and that errors are excluded.

### K3-017 — OKF/markdown import

- **Priority:** P1
- **Files:** `plugin/index.ts` (new `kevin_import` tool), `plugin/okf-import.ts`
- **Acceptance:** `kevin_import({ path })` ingests a markdown bundle. Each entry becomes a `context` memory with `origin = 'imported'`. Conflict resolution: same `fingerprint` → supersede.
- **Verification:** `kevin_import` of an exported file yields N rows; re-import supersedes the first set.

### K3-018 — LLM reflection opt-in (flag-only)

- **Priority:** P2
- **Files:** `plugin/Reflector.ts`, `kevin_settings.llm_reflection_enabled`
- **Acceptance:** Behind the flag; with flag off (default), behavior is identical to v0.2. With flag on, Reflector consults an injected `enrich?: (lesson: string, stderr: string, stdout: string) => Promise<LessonEnrichment | null>` callback (default no-op).
- **Verification:** Manual; unit test asserts no-op enrichment produces identical lesson.

### K3-019 — Cross-project memory opt-in

- **Priority:** P2
- **Files:** `plugin/MemoryService.ts`, `plugin/index.ts`
- **Acceptance:** With `kevin_settings.cross_project_enabled = 1`, `getRelevant` and `query` return `project_id IS NULL` rows tagged `type = preference`.
- **Verification:** Unit test toggles the flag on/off and asserts inclusion behavior.

### K3-020 — Prompt mutation HITL (suggestions only)

- **Priority:** P2
- **Files:** `plugin/ContextInjector.ts`
- **Acceptance:** When the negative half fired at least once for fingerprint F during the session, the next `system.transform` (or `compacting`) prepends a `<kevin-suggestion>` block with a draft SKILL.md snippet. Human decides.
- **Verification:** Unit test verifies the suggestion block when a recurrence occurred; absent when none.

### K3-021 — `kevin_query` evidence flag

- **Priority:** P1
- **Files:** `plugin/index.ts`
- **Acceptance:** `kevin_query({ query, evidence: true })` includes `confidence`, `evidence_count`, `last_verified_at` in the slim payload.
- **Verification:** Unit test verifies the extended slim payload shape with the flag.

### K3-022 — `kevin_status` new metrics

- **Priority:** P1
- **Files:** `plugin/metrics.ts`, `plugin/index.ts`
- **Acceptance:** `kevin_status` returns new metrics: `patterns_causal`, `causal_links`, `memories_superseded`. Seeded at zero in `kevin_metrics`.
- **Verification:** Unit test consumes `kevin_status` after a causal-flow test and asserts `patterns_causal >= 1`.

### K3-023 — Text explaining the "summary" generation in `kevin_why`

- **Priority:** P1
- **Files:** `plugin/kevin_why.ts`
- **Acceptance:** `summary` is a short deterministic string (regex-templated from `memories.content` + the original `error` row). No LLM call.
- **Verification:** Unit test asserts the summary template format.

### K3-024 — Optional LLM enrichment integration (opt-in flag)

- **Priority:** P2
- **Depends on:** K3-018
- **Acceptance:** When `llm_reflection_enabled = 1`, a behavior test that injects a mock enrich function verifies the `Likely cause:` line is appended to the lesson with no regression to the heuristic default.

### K3-025 — End-to-end causal-cycle test

- **Priority:** P0
- **Files:** `tests/e2e/causal-cycle.test.ts`
- **Acceptance:** Full cycle: `tool.execute.before` → `after` (failure with TS2304) → `after` (success with the same fingerprint context) → `session.idle` → `kevin_query("TS2304")` returns a `pattern` with `confidence ≥ 0.5, evidence_count = 1` → `kevin_why "TS2304"` returns a trace with `trace.length === 1` → `system.transform` injects the new pattern on the next chat turn without re-asking.
- **Verification:** `npx vitest run tests/e2e/causal-cycle.test.ts`

### K3-026 — Continued operation after a second recurrence (cap)

- **Priority:** P0
- **Files:** `tests/e2e/causal-cycle-cap.test.ts`
- **Acceptance:** A second failure/fix on the same fingerprint raises `confidence` to 0.6; a third occurrence, by which point the pattern has not been *re-injected at success*, fires the negative half. Confidence + recency interact cleanly.
- **Verification:** `npx vitest run tests/e2e/causal-cycle-cap.test.ts`

### K3-027 — Backward-compat migration test

- **Priority:** P0
- **Files:** `tests/e2e/migrate-from-v020.test.ts`
- **Acceptance:** A DB seeded at v0.2 schema (with data) runs `npm run verify` after migration 004 and behaves unaffected; new columns are nullable; existing tests pass.
- **Verification:** `npx vitest run tests/e2e/migrate-from-v020.test.ts && npm test`

### K3-028 — Bump 0.3.0 + CHANGELOG

- **Priority:** P0
- **Estimate:** S
- **Depends on:** K3-025, K3-026, K3-027
- **Files:** `package.json`, `CHANGELOG.md`
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 10. Embeddings decision gate

Per §B12 and §7 of Grok 4.5, embeddings (sqlite-vec + BGE-M3 ONNX + RRF) are **not** part of the v0.3.0 release candidate by default. They are gated behind:

- **Metric gate:** v0.2.x `kevin_status.metrics` FTS5 miss rate ≥ threshold (exact threshold TBI post-validation; current suggestion: ≥ 30% of `kevin_query` calls return zero memories for queries the user reports as "should have found something").
- **Engineering gate:** Confirmed working ONNX load in plugin context (no native binding surprises like F#31 on Windows).

If both gates pass before v0.3.0 ships, embeddings become an **opt-in flag** (`kevin_settings.embeddings_enabled`) inside v0.3.0; otherwise deferred to v0.3.x or v0.4.

---

## 11. Out of scope for v0.3.0

| Item | Reason | Destination |
|---|---|---|
| MCP server adapter | Removes OpenCode hook moat; see D3-07 | v0.5+ "Deep ecosystem integration" |
| Repo-local DB (`.project/.kevin/kevin.db`) | Contradicts D-f / D3-09 | Rejected (no destination) |
| Full graph store / relations table | Premature per D3-08 | v0.4+ if CausalChain needs multi-hop |
| Memory lifecycle state machine (full transitions) | Subsumed by supersede + feedback loop per §4 table | v0.4+ if feedback loop proves insufficient |
| Multi-agent critic loop | API cost; breaks 0-cost principle | v0.5+ "Enriched LLM reflection" |
| Mandatory embeddings | Local-first + cost constraints (§B12) | Conditional (§10) |
| `memories.commit_sha` column | Coupled to a single repo's git history; cross-project breaks | Fold into OKF export (K3-016) |
| Mandatory LLM reflection | Opt-in only (D3-05) | Always opt-in |
| Autonomous SKILL.md mutation | "Suggest, don't rewrite" (D3-12) | Always HITL via `<kevin-suggestion>` |

---

## 12. Final verification

Before tagging v0.3.0:

```bash
cd C:\opencode-kevin
npm run typecheck   # tsc --noEmit (strict) — must pass
npm run lint        # biome check . (excluding dist/)
npm test            # vitest run — includes K3-025 and K3-026 e2e cycles
npm run verify      # post-install on v0.2-seeded DB
```

Then, manual validation (analogous to K-045):

1. In a small project, force a `tsc` failure (delete an import).
2. `kevin_status` reports `memories >= 1` (the error memory).
3. Restore the import; re-run `tsc` (success).
4. Trigger `session.idle` (close the session).
5. `kevin_status` reports `patterns_causal >= 1` and `causal_links >= 1`.
6. `kevin_why "TS2304"` returns a trace with `confidence ≥ 0.5` and `evidence_count = 1`.
7. New session, ask "how do I fix TS2304?" → `system.transform` injects both the original error lesson AND the new causal pattern.
8. Trigger a second failure with the same fingerprint (delete the same import again). Confirm `kevin_status` reports `memories_superseded` is unchanged but `relevance_score` on the original error memory drops by 0.05 (negative half).

**Exit criterion met** when steps 1–8 pass without manual `kevin_save`.

---

## 13. Summary of what changed from existing plans

| Source | Was | Now (v0.3.0) | Change |
|---|---|---|---|
| §14 / §B12 | "Prompt mutation HITL" | K3-020 (HITL `kevin-suggestion` block) | Same intent, named |
| §14 / §B12 | "Cross-project memory (consent)" | K3-019 (opt-in flag) | Same intent, technical |
| §B12 D-e | Feedback loop negative half | K3-013 | Unchanged |
| §B12 | LLM reflection opt-in | K3-018, K3-024 | Unchanged, opt-in |
| §B12 | OKF export/import | K3-016, K3-017 | Unchanged |
| **NEW** | — | Causal chains (K3-006..K3-008, K3-012) | Not in old roadmap; derived from external review but enabled by Reflector + fingerprints |
| **NEW** | — | `kevin_why` explainability tool | Not in old roadmap; surfaces accumulated confidence to the user |
| **NEW** | — | Memory types `rule`/`solution` (K3-005) | App-layer widening only |
| **NEW** | — | Confidence + evidence columns (K3-001, K3-003) | Generalizes `relevance_score` |

The two *new* pieces (CausalChain and `kevin_why`) are the ones external AI analyses usefully surfaced — everything else was already in §14/§B12 and is re-affirmed here, not re-litigated.

---

## 14. References

- `docs/Kevin_Plan.md` — §14 Future Roadmap; §B12 amendments; D-f.
- `docs/Kevin_new_v0.2.0.md` — Grok 4.5 analysis, §7 recalibrated post-v0.2 roadmap.
- `docs/Kevin_Task.md` — K-001..K-050; K2-001..K2-032.
- `plugin/Reflector.ts:1-283` — current heuristic lesson + error code dispatch.
- `plugin/index.ts:356-398` — current `tool.execute.after` (v0.1.4 self-sufficient detection).
- `plugin/MemoryService.ts` — current `save`/`query`/`getRelevant`/`boostPositiveReflectors`.
- `migrations/003_v02_signal.sql` — v0.2 schema reference; new migration 004 mirrors its discipline.
- Ethics of knowledge vs memory: the engineering-memory positioning comes from observing that Mem0, aictx/memory, sqlite-memory all generalize; Kevin specializes by being the *only* one that observes the coding agent's own tool calls.

---

## 15. Implementation status (table)

Phases mirror the v0.2.0 convention:

- **F0 — Substrate**: migration 004, MemoryService plumbing, type widening.
- **F1 — Causal core**: CausalChain, `kevin_why`, confidence guard, evidence surfacing.
- **F2 — Knowledge**: feedback negative half, supersede, OKF export/import, opt-in LLM reflection, cross-project, HITL suggestions.
- **F3 — Validation & release**: e2e causal cycles, backward-compat migration, bump.

Status legend: `[ ]` pending · `[~]` in progress · `[X]` complete · `[!]` blocked.

| ID | Phase | Title (short) | Status |
|---|---|---|---|
| K3-001 | F0 | migration 004 | [X] |
| K3-002 | F0 | Migrate post-apply hook (004 backfill) | [X] |
| K3-003 | F0 | MemoryService.save new columns | [X] |
| K3-005 | F0 | new memory types `rule`/`solution` | [X] |
| K3-015 | F0 | query/getRelevant filter on `status` | [X] |
| K3-004 | F1 | MemoryService.promoteToPattern | [X] |
| K3-006 | F1 | CausalChain.ts skeleton | [X] |
| K3-007 | F1 | CausalChain.onSuccess link to fp | [X] |
| K3-008 | F1 | CausalChain.onSessionIdle promote | [X] |
| K3-009 | F1 | Wire CausalChain into index.ts | [X] |
| K3-010 | F1 | Confidence derivation guard | [X] |
| K3-011 | F1 | kevin_why tool skeleton | [X] |
| K3-012 | F1 | kevin_why implementation | [X] |
| K3-021 | F1 | kevin_query `evidence` flag | [X] |
| K3-022 | F1 | kevin_status new metrics | [X] |
| K3-023 | F1 | kevin_why summary template | [X] |
| K3-013 | F2 | Feedback loop negative half | [X] |
| K3-014 | F2 | Supersede model | [X] |
| K3-016 | F2 | OKF/markdown export | [X] |
| K3-017 | F2 | OKF/markdown import | [X] |
| K3-018 | F2 | LLM reflection opt-in flag | [X] |
| K3-019 | F2 | Cross-project opt-in | [X] |
| K3-020 | F2 | Prompt mutation HITL suggestions | [X] |
| K3-024 | F2 | LLM enrichment integration test | [X] |
| K3-025 | F3 | e2e causal-cycle test | [X] |
| K3-026 | F3 | cap (second recurrence) test | [X] |
| K3-027 | F3 | backward-compat migration test | [X] |
| K3-028 | F3 | bump 0.3.0 + CHANGELOG | [X] |

**Total**: 28 tasks (5 F0 · 11 F1 · 8 F2 · 4 F3).

**Suggested execution order (critical path)**: F0 → K3-004 + K3-006..K3-012 (CausalChain MVP) → K3-025 e2e early to de-risk → K3-013/014/015 (loops & supersede) → K3-016/017 (interchange) → K3-018/019/020/024 (opt-in layer) → K3-026/027/028 (release).
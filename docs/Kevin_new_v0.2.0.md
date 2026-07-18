# Kevin v0.2.0 — Analysis and recommended path

**Date:** 2026-07-18
**Current product state:** `@jmtrin/opencode-kevin@0.1.5`
**Analysis author:** Grok 4.5 (`opencode-go/grok-4.5`)
**Sources:** `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`, `docs/Kevin_Token_Impact.md`, `docs/Kevin_Fix_v0.1.4.md`, `docs/Kevin_ClaudeMem.md`, `README.md`, code in `plugin/`, OKF SPEC v0.1 ([GoogleCloudPlatform/knowledge-catalog/okf](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf))

---

## 1. Verdict in one sentence

**v0.2.0 must not be "Kevin looks more like claude-mem" nor "Kevin adopts OKF as storage".**
It must be **"Kevin learns better, shares with fewer tokens, and coexists cleanly with DCP"** — hardening the core *Observe → Learn → Share* without abandoning local-first, 0-network and 0-API-cost.

---

## 2. What Kevin is today (and what it is not)

### 2.1 Consolidated identity (0.1.x)

Kevin is **a single learning layer** for OpenCode:

| Phase | Component | What it does |
|---|---|---|
| Observe | `ToolCallObserver` | Records tool calls (redacted args, success, duration, error_type) |
| Learn | `Reflector` | Heuristic lesson `type:error` after failures (1/min throttle) |
| Share | `ContextInjector` | Injects in `system.transform` (1500 tok) and `compacting` (2000 tok) |
| Close | `Retrospective` | Session markdown if there were failures |
| Store | SQLite + FTS5 | Global DB `~/.opencode-kevin/kevin.db` |

Principles (from `Kevin_Plan.md` §2.3) that **remain correct** and should anchor v0.2:

1. Observe, don't orchestrate.
2. Learning is the differentiator.
3. Local-first.
4. Proactive over reactive.
5. Delegate to the ecosystem (DCP, Conductor, etc.).
6. Compatible with any planner.

### 2.2 What 0.1.x already solved well

- Functional end-to-end cycle (K-001…K-045).
- **Self-sufficient** failure detection via `STRONG_ERROR_RE` (K-045 / v0.1.4–0.1.5): does not depend on `metadata.success` nor on `session.next.tool.failed` for bash/tsc.
- Path/secret redaction.
- **Net negative** token cost in mature projects when used with DCP + orchestration (`Kevin_Token_Impact.md`).
- Small surface (~12 files in `plugin/`), installable as an npm plugin.

### 2.3 Real debt of 0.1.x (not cosmetic)

After reading the plan, the fix and the code, the weaknesses that **actually matter to the user** are:

| # | Debt | Why it hurts |
|---|---|---|
| D1 | Generic lessons | `Suggestion: Verify types and imports…` is correct but barely actionable after the 2nd time |
| D2 | Global 60s throttle | A second *distinct* failure in the same minute is lost |
| D3 | FTS5-only | "auth" does not recover "login JWT" if they don't share lexical tokens |
| D4 | All-or-nothing injection | `kevin_recall` / `<kevin-context>` push entire blocks; no progressive disclosure |
| D5 | No citable IDs in the prompt | The agent cannot say "per memory #id" |
| D6 | Noise in `tool_calls` | Every retry inflates telemetry; DCP deduplicates context, Kevin does not |
| D7 | Incomplete DCP coexistence | Kevin blocks can be pruned if not in `<protect>` |
| D8 | Global DB without strong "project key" | `project` scope exists in schema, but multi-repo isolation is weak in practice |
| D9 | Signal quality not measured | No feedback loop (did the lesson prevent a retry?) |
| D10 | Incomplete privacy | There is redaction; no explicit opt-out like `<private>` |

**Honesty:** Kevin's biggest risk is not "missing claude-mem features". It is **accumulating mediocre lessons that the agent ignores or that pollute the prompt**. v0.2 must attack signal quality before surface.

---

## 3. Assessment of the `Kevin_ClaudeMem.md` analysis

### 3.1 Where the document is right (and I adopt it)

The Claude-Mem analysis + DCP premise is **solid and well aligned** with Kevin's philosophy. Specifically:

| ID | Recommendation | My verdict |
|---|---|---|
| C13 | Wrap injection in `<protect>` + `protectTags` in DCP | **P0 for v0.2** — low effort, high impact |
| C6 | `<private>` tags | **P0** — local privacy, cheap |
| C3 | Progressive disclosure / timeline | **P0–P1** — saves tokens on the "Share" side |
| C10 | Quotes by `id` in the injected block | **P0** — traceability and debugging |
| C14/C17 | Coordinate compacting and `protectedTools` with DCP | **P0** docs + defaults |
| C12 | Throttle by `(tool, errorType)` | **P0** |
| C15 | Optional dedup in observer | **P1** |
| C1 | Local semantic search (sqlite-vec) | **P1 conditional** (see §5) |
| C2 | AI reflection | **P2 optional**, never mandatory |
| C8 | AI session compression | **Reject** — DCP does that |
| C4/C5/C11 | Web UI, multi-IDE MCP, Express worker | **Reject in v0.2** |

### 3.2 Where the Claude-Mem analysis falls short

1. **Underestimates lesson quality.** It talks a lot about retrieval (semantic, progressive disclosure) and little about *what is written* in `memories.content`. Without improving the Reflector, better retrieval just serves garbage faster.
2. **Treats sqlite-vec as inevitable in v0.2.** It is not. FTS5 + better ranking + error fingerprint can suffice up to thousands of memories. sqlite-vec adds ABI, packaging and failure surface; only worth it with evidence of recall failures.
3. **Does not prioritize instrumentation.** Without metrics (`tokens_injected`, `lessons_reused`, `duplicate_rate`) v0.2 is designed blind.
4. **Does not close the multi-project gap.** The global DB is a correct UX decision, but a real `project_id`/`cwd_hash` is needed in rows and in retrieval.
5. **Pattern mining** appears in the original roadmap (v0.2) but the Claude-Mem doc dilutes it. A *lightweight and deterministic* PatternMiner fits Kevin better than premature embeddings.

### 3.3 Comparison summary

claude-mem is a **multi-IDE session memory system** (worker + Chroma + UI + AI compression). Kevin is a **local error-learning sensor**. Copying claude-mem would be product suicide: it would lose the advantage (simplicity, 0 cost, observe-only) and compete in a field where there are already 13 major versions ahead.

**Kevin wins by specializing:** *the best failure-lesson layer in the OpenCode ecosystem*, not "another generic memory".

---

## 4. OKF (Open Knowledge Format) — does it add value to Kevin?

### 4.1 What OKF really is

OKF v0.1 (Google Cloud Knowledge Catalog / Dataplex lineage) is a **vendor-neutral** knowledge format such as:

- directory of **markdown + YAML frontmatter**,
- concepts with mandatory `type`,
- `index.md` for progressive disclosure,
- markdown links as a graph,
- aimed mostly at **data catalogs** (BQ tables, datasets, metrics, playbooks, references).

Attractive properties: human-readable, git-diffable, portable, no mandatory SDK, composable with Obsidian/MkDocs.

### 4.2 Honest OKF ↔ Kevin mapping

| Dimension | OKF | Kevin 0.1.x | Do they fit? |
|---|---|---|---|
| Knowledge unit | Curated concept (table, playbook…) | Ephemeral failure/decision lesson | Partial |
| Write frequency | Low–medium (batch enrichment) | High (every tool failure) | Bad |
| Read | Hierarchical navigation + graph | FTS5 + token-budget injection | Different |
| Ideal storage | Git / filesystem | Concurrent SQLite WAL | Different |
| Progressive disclosure | `index.md` per directory | No (today) | Reusable idea |
| Privacy / secrets | Not the focus | Redact paths/secrets | Kevin more advanced |
| Main domain | Enterprise data metadata | Coding-agent errors | Different |
| Dependencies | None (format) | In-process Node SQLite | — |

### 4.3 OKF verdict (sincere)

**Do not integrate OKF as a storage format nor as a runtime dependency in v0.2.0.**

Reasons:

1. **Different problem.** OKF solves "how to publish catalog knowledge portably". Kevin solves "how not to repeat the same typecheck/lint/test error in the next session". Forcing Reflector lessons into `type: Playbook` + frontmatter is ceremony with no retrieval gain in the hot path.
2. **Git as primary store breaks the Observe→Learn cycle.** The Reflector is `fireAndForget` after `tool.execute.after`. Writing/committing markdown on every failure is slow, noisy in the user's repo diffs, and dangerous (residual secrets in git history). SQLite exists precisely for this.
3. **OKF gives no search nor ranking.** It only defines files. Kevin already has FTS5+bm25. Adopting OKF *on top* means indexing the bundle — duplicating the mental model.
4. **Maturity.** OKF is at **0.1 draft**, no schema registry, no mass adoption outside the GCP samples ecosystem. Betting Kevin's storage on a young draft is free product risk.
5. **Principle 5 (delegate).** If the user wants a project *knowledge wiki*, they already have `AGENTS.md`, skills, docs/, or a separate OKF bundle. Kevin must not become a CMS.

### 4.4 Where OKF *can* help (later, not as core)

Ideas of **low coupling** that respect both worlds:

| Idea | Suggested version | Value |
|---|---|---|
| **Optional export** `kevin_export --format okf` of `decision`/`pattern` memories (not every raw error) to `.kevin/okf/` or `docs/kevin-knowledge/` | v0.3 | Share *curated* knowledge in PRs |
| **Optional import** of a repo OKF bundle (team playbooks) as read-only `context` memories | v0.3–v0.4 | Kevin *consumes* human knowledge without owning it |
| **UX inspiration**, not the format: progressive disclosure like `index.md` → `kevin_search` tools (short hits) → `kevin_get(id)` (body) | **v0.2** | High value, zero Google dependency |
| OKF-like types in frontmatter only if there is ever an export | v0.3 | Interop |

**Rule:** OKF as a **stable import/export port for knowledge**, never as the Reflector backend.

### 4.5 OKF conclusion

> Integrating OKF into the v0.2 core **is not worth it**.
> Stealing its progressive-disclosure idea **is**.
> Offering OKF export/import **later**, when Kevin has quality lessons worthy of a PR in the user's repo.

---

## 5. Recommended path for v0.2.0

### 5.1 Release theme

```
v0.2.0 — Signal Quality
"Fewer lessons, better lessons, better shared, DCP-proof."
```

Not the embeddings release. Not the UI release. Not the OKF release.

### 5.2 Measurable objectives (definition of done)

1. After a `TS2304` failure, the lesson includes a **stable fingerprint** of the error and is not duplicated N times in the same session.
2. A second *distinct* failure in <60s **also** generates a lesson (throttle by key).
3. `<kevin-context>` includes `id` and is wrapped in `<protect>` (documented for DCP).
4. The agent can do `kevin_query` → short list → `kevin_get(id)` without loading 2k tokens at once.
5. `kevin_status` reports injected tokens and duplicate rate.
6. 0 network dependencies; 0 Python/uv/Chroma; green tests; clean minor semver from 0.1.5.

### 5.3 What goes into v0.2.0 (prioritized)

#### P0 — Must go (release core)

| ID | Feature | Effort | Design notes |
|---|---|---|---|
| **K2-01** | Throttle by key `(tool, errorType, fingerprint)` | S | Replaces the global throttle; fingerprint = hash of normalized error line (no paths, no volatile line numbers if needed) |
| **K2-02** | Memory dedup on save | S–M | If a lesson with the same fingerprint already exists in project scope, **boost** `relevance_score` + update `updated_at` instead of inserting another |
| **K2-03** | Quotes by `id` in injection | S | Format: `[error id=…] content` inside `<kevin-context>` |
| **K2-04** | `<protect>` + DCP docs | S | `formatMemories` wraps the block; README: `compress.protectTags: true`, `protectedTools: ["kevin_*"]` |
| **K2-05** | `<private>…</private>` in redact pipeline | S | Discard blocks before persisting (observer + reflector + save) |
| **K2-06** | Progressive disclosure of tools | M | `kevin_query` returns hits `{id,type,score,snippet}`; new `kevin_get({id})`; `kevin_recall` stays as explicit "budget fill" |
| **K2-07** | Real `project_id` | M | Stable hash of `ctx.directory` (or git root) in `memories` and `tool_calls`; default retrieval = current project + (optional) global decisions |
| **K2-08** | Metrics in `kevin_status` | S | `tokens_injected_*`, `memories_by_type`, `duplicate_suppressions`, `reflections_throttled` |
| **K2-09** | One-degree-more-useful lessons (heuristic v2) | M | Include: tool, errorType, fingerprint, 1 error line, **contextual** suggestion (e.g. TS2304 → "undefined name: check import/typo"), without LLM |

#### P1 — Must go if the release budget allows

| ID | Feature | Effort | Condition |
|---|---|---|---|
| **K2-10** | PatternMiner v0 (deterministic) | M | `tool_a→tool_b` sequences with frequent failure → `type:pattern` memory ("after edit of X, typecheck usually fails for Y") — only with minimum statistical support (N≥3) |
| **K2-11** | `tool_calls` dedup | S | Same signature in short window → do not insert or mark `metadata.dup` |
| **K2-12** | Configurable budgets + conditional injection | S | 0 injection on trivial messages ("ok", "yes", "continue"); full budget on first message of the track |
| **K2-13** | Hybrid retrieval **without** embeddings | M | Ranking = `0.6*bm25 + 0.3*recency + 0.1*relevance_score` (+ boost type error/pattern) |
| **K2-14** | Weak feedback loop | M | If after injecting fingerprint F lesson, the same F does not reappear in N tool calls → +relevance; if it reappears → mark `stale` / lower score |

#### P2 — Explicitly out of v0.2.0 (clean backlog)

| Item | Why out |
|---|---|
| sqlite-vec / BGE-M3 / embeddings | ABI complexity; only if P1 ranking fails in production with >500 memories |
| Mandatory LLM reflection | Breaks 0-cost; optional in v0.3 behind a flag |
| Worker service / web UI / multi-IDE MCP | claude-mem identity; not Kevin's |
| OKF core storage | §4 |
| OKF export/import | v0.3 when there are curated decisions/patterns |
| Prompt mutation HITL / cross-project prefs | Original v0.3 roadmap, still valid there |
| Session compression | DCP |

### 5.4 v0.2 architecture (evolution, not rewrite)

```
plugin/
  index.ts
  Store.ts / Migrate.ts / sqlite-adapter.ts
  MemoryService.ts      ← +fingerprint, +dedup, +project_id, +hybrid ranking
  ToolCallObserver.ts   ← +tool_calls dedup, +private strip
  Reflector.ts          ← +throttle by key, +lesson v2, +fingerprint
  ContextInjector.ts    ← +ids, +<protect>, +conditional budget
  Retrospective.ts
  PatternMiner.ts        ← NEW (P1), deterministic
  redact.ts             ← +<private>
  memory-format.ts      ← +protect wrapper, +id lines
  metrics.ts            ← NEW (in-memory counters + simple persistence)
migrations/
  003_v02_signal.sql    ← project_id, fingerprint, indexes, optional metrics table
```

**One plugin, ~10–12 modules.** No microservices.

### 5.5 Schema changes (minimal)

```sql
-- 003_v02_signal.sql (sketch)
ALTER TABLE memories ADD COLUMN project_id TEXT;
ALTER TABLE memories ADD COLUMN fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_fp_project
  ON memories(project_id, fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE tool_calls ADD COLUMN project_id TEXT;
```

Idempotent migration via the existing `Migrate`. Without breaking 0.1.x DB: new columns nullable; best-effort `project_id` backfill at runtime.

### 5.6 v0.2 Tools

| Tool | Change |
|---|---|
| `kevin_save` | Respects `<private>`; computes fingerprint if type=error; dedup |
| `kevin_query` | Slim response: id, type, score, snippet (≤200 chars) |
| `kevin_get` | **NEW** — full body by id |
| `kevin_recall` | Same spirit; document as "budget fill" |
| `kevin_status` | Extended metrics |
| `kevin_retrospective` | Include fingerprints and deduplicated lessons |
| `kevin_timeline` (opt P1) | Last N learning events of the session |

### 5.7 DCP coexistence (explicit contract)

Document and, if possible, detect:

```jsonc
// dcp.jsonc recommended alongside Kevin
{
  "compress": {
    "protectTags": true,
    "protectedTools": ["kevin_save", "kevin_query", "kevin_get", "kevin_recall", "kevin_status", "kevin_retrospective"]
  }
}
```

Kevin:

- writes lessons **before** DCP prunes the error tool output (already true: `tool.execute.after` + fireAndForget);
- re-injects **lessons** in compacting, not conversation summary (that is DCP);
- marks its block with `<protect><kevin-context>…</kevin-context></protect>`.

### 5.8 Suggested implementation phases

| Phase | Duration | Deliverables |
|---|---|---|
| **F0 — Harden** | 3–5 d | K2-01…K2-05, K-045 regression tests intact |
| **F1 — Share better** | 4–6 d | K2-06…K2-08, format + status |
| **F2 — Learn better** | 5–8 d | K2-09, K2-07 project_id, migration 003 |
| **F3 — Signal++** | 5–8 d | K2-10…K2-14 per capacity |
| **F4 — Release** | 2–3 d | CHANGELOG, README, verify, tag `v0.2.0`, expanded K-045-style manual validation |

**Total estimate:** ~3–5 weeks (1 dev), not the 5–6 of 0.1.0: it is evolution, not greenfield.

### 5.9 Acceptance criteria (manual, K-045 style)

Clean protocol (the agent **does not** call `kevin_save` to "demonstrate" learning):

1. `kevin_status` → baseline N memories.
2. `tsc` failure with `TS2304` → N+1 (or N with boost if the fingerprint already existed).
3. Second distinct failure (`eslint`) in <60s → also generates a lesson.
4. Same `TS2304` again → **not** N+2; relevance goes up.
5. `kevin_query("typecheck")` → snippets + ids; `kevin_get(id)` → body with the Reflector template (not agent prose).
6. With DCP + protectTags, after `compress`, the Kevin block stays in context (or is re-injected in compacting).
7. Content with `<private>secret</private>` does not appear in the DB.

---

## 6. What **not** to do in v0.2 (anti-scope-creep list)

1. **Do not** clone claude-mem (worker, Chroma, SSE UI, multi-IDE).
2. **Do not** make OKF the backend.
3. **Do not** require API keys for the happy path.
4. **Do not** reimplement conversation compaction.
5. **Do not** turn Kevin into a planner/orchestrator.
6. **Do not** throw in embeddings "because the 0.1 roadmap said so" without FTS5 failure evidence.
7. **Do not** bloat the prompt with 50 mediocre lessons: prefer 3 good ones.
8. **Do not** trust validations where the agent self-rewards with `kevin_save` (the bitter lesson of K-045).

---

## 7. Post-v0.2 roadmap (recalibrated)

| Version | Focus | Notes |
|---|---|---|
| **v0.2.0** | Signal Quality (this doc) | Key throttle, dedup, protect, progressive tools, project_id, metrics, lesson v2 |
| **v0.2.x** | sqlite-vec **only if** metrics show high miss rate | Feature flag; FTS5 fallback |
| **v0.3** | Stable knowledge export/import (optional OKF + simple markdown) | Curated decisions/patterns → git |
| **v0.3** | LLM reflection *opt-in* | Enriches lesson; heuristic always default |
| **v0.3** | Cross-project preferences with consent | Explicit opt-in |
| **v0.4** | Skill quality index / drift | Skill observability |
| **v0.5** | Deep ecosystem integration | Conductor tracks, sentry events — observe, don't orchestrate |

---

## 8. Final opinion (no frills)

### On the current state
Kevin 0.1.5 is an **honest, well-scoped MVP**. The failure-detection fix was the moment of truth: it demonstrated that the value is in the *sensor*, not in the narrative. The 7-component architecture remains the correct one.

### On Claude-Mem
Using it as a mirror of gaps is useful; using it as a product template is a mistake. The analysis in `Kevin_ClaudeMem.md` is right about DCP-first and progressive disclosure; it falls short on lesson quality, project isolation and metrics.

### On OKF
It is an **elegant, well-thought format** for git-versioned catalog knowledge. **It is not the right format for the hot path of a plugin that writes on every tool failure.** In v0.2, from OKF I would only take the *idea* of progressive disclosure. Real integration = optional export/import in v0.3+, when Kevin has something worthy of a diff in the repo.

### On v0.2.0
The highest-ROI path is boring and correct:

> **Better signal, less noise, better share, coexist with DCP.**

If v0.2 scatters into embeddings + OKF + UI + LLM, it will ship a fragile 0.2 that does not beat 0.1.5 at the only thing that matters: **the agent stops repeating the same error**.

### Personal bet (Grok 4.5)
I would do **full P0 + lightweight PatternMiner (K2-10) + hybrid ranking without vectors (K2-13)**. I would leave sqlite-vec and OKF out of the `v0.2.0` tag. I would publish with a validation protocol as strict as K-045, and measure over 2–4 weeks of real usage before opening v0.2.x embeddings.

That is Kevin: not the agent's wiki, not Google's catalog, not the claude-mem clone.
**OpenCode's local immune system.**

---

## 9. References

- `docs/Kevin_Plan.md` — 0.1 philosophy and architecture
- `docs/Kevin_Task.md` — K-001…K-050
- `docs/Kevin_Fix_v0.1.4.md` — self-sufficient detection
- `docs/Kevin_Token_Impact.md` — DCP + orchestration synergy
- `docs/Kevin_ClaudeMem.md` — claude-mem comparison + DCP
- `README.md` — current user contract (0.1.5)
- [OKF SPEC v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [OKF README](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
- [claude-mem](https://github.com/thedotmack/claude-mem) (external market reference)

---

*Document signed by **Grok 4.5** (`opencode-go/grok-4.5`) — 2026-07-18.*

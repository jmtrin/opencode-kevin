# Opencode-kevin — Roadmap to v1.0.0

**Version:** 1.0
**Date:** 2026-08-11
**Status:** Active — supersedes all prior forward-looking planning
**Baseline:** v0.4.0 "Signal over Noise" (2026-08-09)
**Type:** Strategic roadmap + honest assessment
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` — full source audit of all 24 modules at v0.4.0.
- `migrations/001..005` — schema history, including the 004 six-step table rebuild.
- `CHANGELOG.md` — nine version bumps, 0.1.0 → 0.4.0.
- `docs/Kevin_v0.4.0_Bugs.md` — the 16-bug post-release audit, 16/16 closed.
- `docs/Kevin_Token_Impact.md` — the ROI model (v2.0, dated 2026-07-01).
- `docs/Kevin_v0.4.0_Plan.md`, `docs/Kevin_v0.4.0_Task.md` — document conventions and the D4 decisions log.
- `@opencode-ai/plugin@1.17.10` type definitions — v1 `Hooks`, the v2 `define()`/domain API, and the TUI plugin surface.

---

## 0. How to read this document

Section 1 is an honest assessment of whether Kevin is worth building. It is deliberately
blunt. If you only read one section, read that one — everything after it is downstream of
its conclusions.

Sections 2–4 define the thesis, the trend Kevin has to survive, and the version ladder.
Section 5 details each release. Section 6 lists the kill criteria: the measured conditions
under which the correct engineering decision is to shrink or stop.

---

## 1. Honest assessment — is Kevin valuable, or is it hype?

### 1.1 The verdict in one paragraph

Kevin is **not hype, but it is mis-positioned**. The engineering underneath it is
genuinely above the ecosystem average — it is the only opencode memory plugin that
attempts to *measure its own usefulness* rather than assert it. But the product thesis it
was built on ("automatically capture error→fix lessons and push them into every prompt")
targets the one class of knowledge that frontier models need least, through the one
distribution channel the ecosystem is actively moving away from, with a value claim that
has never been measured. Kevin at v0.4.0 is a well-built answer to a question that is
getting smaller. The good news is that the machinery it has already built — fingerprinting,
provenance, an injection ledger, a quality gate, supersession, OKF export — is exactly the
machinery you need for the *bigger* question, if you point it somewhere else.

### 1.2 What is genuinely valuable — the case in favour

| # | Strength | Why it matters |
|---|---|---|
| 1 | **The problem is real.** | Agents restart from zero every session. Every user of every coding agent re-explains the same three project quirks weekly. This is not an invented problem. |
| 2 | **Kevin measures itself.** | `kevin_injections` + `precision_rate` (v0.4.0) is a self-falsification instrument. Almost no memory tool in any ecosystem has one. This is Kevin's single most defensible asset and it is *undersold*. |
| 3 | **Local-first, zero network, zero embeddings, zero API cost.** | Matches opencode's ethos exactly. No vector DB to run, no keys to rotate, no data leaving the machine, no per-token cost for the memory layer itself. The bar for adoption is `npm install`. |
| 4 | **"Store but do not inject" (v0.4 quality gate).** | The correct instinct, and rarer than it sounds. Most memory systems treat storage and retrieval as the same decision. Separating them is what makes a token budget defensible. |
| 5 | **Engineering discipline.** | 548 tests, an idempotent migration chain, redaction before persistence, a prompt-injection escape fix, and a published 16-bug self-audit that names its own dead code. That last document is worth more than most projects' READMEs. |
| 6 | **Provenance is first-class.** | `origin`, `evidence_count`, `recurrence_count`, `status`, `fingerprint`, `fix_for_fingerprint`. Kevin can answer "why do you believe this?" — most memory layers cannot. |

### 1.3 Where it is hype — the case against

These are stated as findings, not opinions, because each is checkable in the repository.

**1. The core value claim has never been measured.**
`docs/Kevin_Token_Impact.md` is version 2.0, dated **2026-07-01** — one day *before* v0.1.0
shipped. It has never been updated across three subsequent minor releases. §12 says plainly:
"These are estimates based on typical patterns." Every headline figure — −6100 tokens/session,
−7.2%, ROI 2.7×–6.0×, break-even at session 2–3 — is a model, not an observation. The document
is also invalidated in three specific places by later releases: v0.4 changed injection to
2-line snippets (per-memory cost fell), the compacting hook was **dead in production until
v0.4.0** (so all compaction-derived savings were structurally zero for v0.1–v0.3), and the
quality gate now suppresses weak lessons entirely.

**2. The one real instrument is confounded.**
`InjectionLedger.settle()` marks an injection `effective` when *no failing tool call with the
same fingerprint occurs after it in the session*. That is not evidence of effect. In the
overwhelmingly common case the error simply never came up again — the user moved on to a
different file. Absence of recurrence is being counted as proof of causation. This means the
`precision_rate` Kevin reports today is **structurally optimistic by an unknown, probably
large, margin**. Fixing this is the first item on the roadmap, and it will make the numbers
look worse. That is the correct outcome.

**3. The knowledge niche is narrow and shrinking.**
Look at what Kevin's deterministic dispatch table actually captures: `TS2304`, `TS2322`,
`TS2307`, `TS6133`, `E0433`, `EADDRINUSE`, `command not found`. These are *self-describing*
errors. The compiler already emits the fix. A frontier model resolves them on the first retry
without help, and by v1.0 of any 2026-era model the marginal value of "TS2304 usually means a
missing import" is approximately zero. Kevin is spending a 1500-token prompt budget to tell a
model something the model's own tool output tells it better, one second later, for free.

**4. Push-injection is the wrong channel for where the ecosystem is going.**
`@opencode-ai/plugin` now ships Skills, `@`-mention References, sub-agents, commands, and a
v2 domain API whose primitives are *registration* and *disposal*, not *interception*. Every
one of those is a **pull** channel: content is loaded when it is relevant, by the model's own
decision, under progressive disclosure. Kevin is a **push** channel: an unconditional
per-prompt tax, spent against a query derived by lowercasing the last user message and
removing stop-words. That query derivation is the weakest retrieval signal in the entire
pipeline, and everything downstream of it — bm25, origin boost, recency decay, the quality
gate — is sophisticated machinery attached to a bad question.

**5. AGENTS.md is the free incumbent, and Kevin does not compete with it — it should feed it.**
The single highest-value thing a user can do with a project-specific fact is put it in
`AGENTS.md`: it costs nothing, it is version-controlled, it is reviewed in PRs, it is shared
with the whole team, and every agent in the ecosystem already reads it. A private SQLite file
in `~/.opencode-kevin/` has none of those properties. Kevin currently competes with a free
incumbent that beats it on distribution, durability, and trust. The only winning move is to
**become a producer of curated AGENTS.md content** rather than an alternative to it.

**6. A per-machine global DB caps compounding at N=1.**
Learning systems are worth what their evidence base is worth, and evidence scales with the
number of agents contributing. Kevin's DB is one file, on one laptop, for one developer. OKF
export/import exists but is a manual, human-initiated, non-mergeable operation. A team of six
running Kevin has six disconnected memories that never reinforce each other. This is the
difference between a tool and a platform, and it is currently on the wrong side.

**7. Complexity is running ahead of demonstrated benefit.**
24 modules, 5 migrations, 13 metrics, 10 tools, 6 feature flags, four of which ship **off**.
The v0.4 bug audit found that three headline features had shipped *silently dead*:
`QualityGate.evaluate()` had zero production call sites, the compacting hook never fired,
`cross_project_enabled` could never be turned on because a TEXT column was compared to a
number. Every one of those passed a green test suite. That is a structural signal: the system
is now complex enough that its tests validate fixtures rather than wiring. Adding surface area
before proving value compounds this risk.

### 1.4 Where the durable value actually is

The distinction that matters is not "errors vs. everything else". It is
**inferable vs. non-inferable**.

- **Inferable knowledge** — anything the model can derive from the code, the error output,
  or the tool result in front of it. `TS2304`. A missing import. A typo. Storing this is
  approximately worthless, and *injecting* it is worse than worthless because it costs tokens.
- **Non-inferable knowledge** — facts about this project that are nowhere in this file:
  - *"`npm test` hangs on Windows unless you pass `--pool=forks`."*
  - *"`verifyToken` must be called before `loadSession` or the session cache poisons."*
  - *"`better-sqlite3` is an optionalDependency because opencode installs plugins with Bun,
    which skips `prebuild-install`."*
  - *"We rejected zod v4 in March because the plugin host pins v3."*

  These are worth 10–100× more than any compiler lesson, they never become obsolete through
  model improvement, and no amount of context-window growth makes them inferable — because
  they are not in the context.

Kevin already has the types for this: `decision`, `rule`, `solution`. But roughly 90% of its
machinery — the Reflector, the dispatch table, the fingerprints, the causal chain, the
quality gate — is pointed at `error`. **The pivot is to move the centre of gravity from
`error` to `decision`/`rule`, and from push-injection to artifact production.**

### 1.5 Will it have repercussion in the ecosystem?

Honestly: **as it stands today, no.** As an error-lesson injector it will be adopted by a
handful of people, produce an unmeasurable effect, and be uninstalled when someone notices
1500 tokens per prompt on their invoice.

With the pivot in this roadmap, it has a credible shot, for three reasons:

1. **Nobody else in the opencode ecosystem is measuring memory.** "Here is my `precision_rate`,
   here is my replay benchmark, here is what did *not* work" is a differentiator that no
   amount of vector-DB marketing can replicate. Publishing an honest negative result is
   itself a reputational asset.
2. **The AGENTS.md-writer niche is empty and obviously valuable.** "An agent that watches
   you work and proposes three lines for your AGENTS.md, which you approve in one keystroke
   and commit to git" is a product that explains itself in one sentence and produces an
   artifact that outlives the plugin.
3. **The v2 plugin API is a landgrab window.** Skills, References, TUI panels and hot-reloadable
   domains are new. Being one of the first memory plugins that is *native* to that API — rather
   than a v1 hook interceptor — is a durable positioning advantage that expires.

The honest framing for the project is: **Kevin's value is not that it remembers. It is that
it curates, and then hands what it curated to channels that already have distribution.**

---

## 2. The thesis

> **v0.1–v0.4 built a system that captures errors and pushes them into prompts.
> v0.5–v1.0 turns it into a system that curates project knowledge and publishes it into
> channels the ecosystem already consumes — and proves, with measurement, whether that helps.**

Three sub-theses follow from §1:

- **T1 — Measure before you build.** Nothing new gets a token budget until the existing
  budget is honestly accounted for. (→ v0.5.0)
- **T2 — Pull beats push.** Memory should be a resource the model can reach for, and an
  artifact a human can commit, not an unconditional prompt tax. (→ v0.6.0)
- **T3 — Non-inferable beats inferable.** Decisions, conventions and environment quirks are
  the durable payload; compiler errors are a commodity. (→ v0.7.0, v0.8.0)

---

## 3. The ecosystem trend Kevin has to survive

Findings from `@opencode-ai/plugin@1.17.10` (Kevin currently pins `^1.17.6`).

| Signal | What is in the package | What it means for Kevin |
|---|---|---|
| **v2 `define()` + domains** | `PluginContext` exposes `agent`, `skill`, `reference`, `command`, `catalog`, `integration`, `aisdk`, `plugin` domains. Every hook registration returns a `Registration {dispose()}`; most domains expose `reload()`. | The plugin model is moving from *imperative interception* to *declarative, hot-reloadable, disposable registration*. Kevin's v1 hook closures with process-global session state are on the wrong side of that transition. |
| **`SkillDraft.source()`** | Plugins can contribute Skills. | A **pull** channel with progressive disclosure built in. Kevin can publish a "project-knowledge" skill the model invokes when it needs it — zero cost when it doesn't. |
| **`ReferenceDraft.add(name, source)`** | Plugins can register `@`-mention references — but only from `local` or `git` sources. | Kevin must **materialize memory to files** to use this. That constraint is a feature: it forces the artifact-first design that §1.4 argues for. |
| **`AgentDraft.update()`** | Plugins can rewrite agent definitions. | Kevin can enrich a project's agent prompt with curated rules — once, at registration — instead of per-prompt. |
| **TUI plugin API** | `TuiRouteDefinition`, `TuiDialogStack`, `keymap.registerLayer`. `PluginModule` reserves a `tui` slot. | Curation is a human-in-the-loop activity and HITL needs UI. A TUI panel is the natural home for review/approve/feedback. |
| **`experimental.provider.small_model`** | A dedicated cheap-model channel. | The sanctioned way to do LLM enrichment off the hot path, if Kevin ever wants it. |
| **`tool.definition`** | Rewrite a tool's description/parameters. | Tempting and wrong for Kevin: static per-`toolID`, no session, no fingerprint, permanent token cost, **structurally un-ledgerable**. Rejected. |
| **`experimental.chat.messages.transform`** | Richer message access — but `input` is `{}`, with **no `sessionID`**. | Kevin's entire injection path is keyed on sessionID. Not usable without an upstream change. |

**Industry-wide, the same convergence holds:** progressive disclosure, lazy retrieval,
human-curated durable artifacts, and small verified context over large speculative context.
Every serious agent memory design of the last year has moved in that direction. Kevin's
always-on 1500-token pre-prompt block is a 2024-shaped answer.

---

## 4. Version ladder

Five intermediate releases. Each has one theme, one falsifiable exit criterion, and does not
begin until the previous one's exit criterion is met.

| Version | Codename | Theme | Exit criterion (falsifiable) |
|---|---|---|---|
| **v0.5.0** | **Glass Box** | Honest measurement, inspectability, human feedback | `precision_rate` is computed from linked fixes, not from absence of recurrence; every gate rejection is counted; `kevin_trace` explains any injection decision without side effects. |
| **v0.6.0** | **Pull** | Distribution: AGENTS.md, Skills, References. Demote push. | A user can turn a memory into a git-committed AGENTS.md line in one approval; the default pre-prompt budget is ≤400 tokens and measurably beaten by the pull channels. |
| **v0.7.0** | **Project Truth** | Centre of gravity moves from `error` to `decision`/`rule` | ≥50% of *injected* memories in a mature DB are non-error types; repo reality contradicts and de-ranks stale memories; conflicts are surfaced, never auto-resolved. |
| **v0.8.0** | **Team** | Git-native, mergeable, repo-local knowledge | Two developers on the same repo converge on the same knowledge set through git, with conflicts visible in a normal PR diff. |
| **v0.9.0** | **Native** | Observe the host, attach additively where it helps | `kevin_doctor` reports `healthy`/`degraded`/`unknown` from persisted hook liveness; `skill.transform`/`reference.transform` attach via `define()` behind a frozen capability probe (D9-01); runtime dependencies drop 2 → 1. |
| **v1.0.0** | **Proven** | Frozen API, published benchmark, honest numbers | A reproducible benchmark is published — including its negative results — and the tool surface, schema, OKF format and config keys are frozen under a written compatibility policy. |

**Global principle numbering** continues from v0.4's 11–14: v0.5 adds 15–18, v0.6 adds 19+,
and so on. **Decision-log namespaces** are `D5-NN`, `D6-NN`, … and are cited in code comments
exactly as `D4-NN` is today. **Task namespaces** are `K5-NNN`, `K6-NNN`, ….

### 4.1 Per-release documents

Every release on the ladder has a Plan (architecture, evidence, decisions) and a Task breakdown
(numbered work items with acceptance criteria). The ladder below is complete through v1.0.0.

| Version | Plan | Tasks | Count | Migration | Principles | Decisions |
|---|---|---|---|---|---|---|
| v0.3.0 | [Plan](./Kevin_v0.3.0_Plan.md) | — | — | `004` | — | — |
| v0.4.0 | [Plan](./Kevin_v0.4.0_Plan.md) | [Tasks](./Kevin_v0.4.0_Task.md) | — | `005` | 11–14 | `D4-NN` |
| v0.5.0 | [Plan](./Kevin_v0.5.0_Plan.md) | [Tasks](./Kevin_v0.5.0_Task.md) | 24 | `006` | 15–18 | `D5-NN` |
| v0.6.0 | [Plan](./Kevin_v0.6.0_Plan.md) | [Tasks](./Kevin_v0.6.0_Task.md) | 26 | `007` | 19–22 | `D6-01…14` |
| v0.7.0 | [Plan](./Kevin_v0.7.0_Plan.md) | [Tasks](./Kevin_v0.7.0_Task.md) | 24 | `008` | 23–26 | `D7-01…14` |
| v0.8.0 | [Plan](./Kevin_v0.8.0_Plan.md) | [Tasks](./Kevin_v0.8.0_Task.md) | 27 | `009` | 27–30 | `D8-01…14` |
| v0.9.0 | [Plan](./Kevin_v0.9.0_Plan.md) | [Tasks](./Kevin_v0.9.0_Task.md) | 24 | `010` | 31–34 | `D9-01…14` |
| v1.0.0 | [Plan](./Kevin_v1.0.0_Plan.md) | [Tasks](./Kevin_v1.0.0_Task.md) | 28 | `011` | 35–38 | `D10-01…16` |

Supporting documents: [`Kevin_Plan.md`](./Kevin_Plan.md) and [`Kevin_Task.md`](./Kevin_Task.md)
(the original v0.1 thesis), [`Kevin_Fix_v0.1.4.md`](./Kevin_Fix_v0.1.4.md),
[`Kevin_new_v0.2.0.md`](./Kevin_new_v0.2.0.md), and
[`Kevin_v0.4.0_Bugs.md`](./Kevin_v0.4.0_Bugs.md) — the defect audit the ladder was built on.
[`docs/CONTRACT.md`](./CONTRACT.md) — the frozen public surface — was created by v1.0.0 `K10-009`
and is the document this whole ladder terminates in. The ladder is **complete through v1.0.0**:
principles 11 → 38 with no gap or repeat, migrations `001` → `011`, tools 25, metric keys 51,
setting keys 31.

**Cumulative ladders**, verified monotone across all six releases: tools 10 → 13 → 16 → 18 → 21 →
23 → 25; metric keys 13 → 22 → 28 → 33 → 39 → 45 → 51; setting keys 6 → 9 → 14 → 18 → 23 → 27 → 31;
tables → 15 → 18 → 20; principles 11 → 38 with no gap or repeat.

> **Corregido en K9-023 (plan §3.1, D9-01).** §5.5 below previously scoped v0.9.0 as a
> migration to a v2 plugin API. That statement is refuted on primary evidence in
> `Kevin_v0.9.0_Plan.md` §3.1: no 2.x of `@opencode-ai/plugin` exists (latest 1.18.16,
> 0/10 697 match `2.*`), and the `v2/` subpath inside the 1.x package exposes no domain capable
> of hosting any of Kevin's seven integration points. §5.5 has been rewritten by `K9-023` to the
> implemented scope — additive attachment of `skill.transform`/`reference.transform`, liveness
> detection, and the dependency reduction — and cites D9-01. §5.6 is reconciled with the
> delivered v1.0.0 scope by `K10-024`.

---

## 5. Release detail

### 5.1 v0.5.0 — "Glass Box"

> You cannot pivot what you cannot see. Everything after this release depends on knowing
> whether the current release works.

**Why first.** Every later decision — how far to cut the injection budget, whether the pull
channels beat push, whether error lessons are worth keeping at all — is a *measurement*
question. Making that measurement honest is cheap (one migration, no new dependencies, no new
runtime cost) and it de-risks the entire rest of the roadmap. Doing it later means building
four releases on an unfalsified assumption.

**Scope.**

1. **Honest outcomes.** Add a fourth outcome, `inconclusive`, to `kevin_injections`.
   - `ineffective` — a failing tool call with the same fingerprint occurred after injection. *(unchanged)*
   - `effective` — no recurrence **and** a linked fix: a successful tool call after `injected_at`
     whose `fix_for_fingerprint` matches the injection fingerprint.
   - `inconclusive` — no recurrence and no linked fix. **This is the new default outcome, and
     it is exactly what v0.4 was counting as `effective`.**
   - `precision_rate = effective / (effective + ineffective)`; new `coverage_rate = (effective + ineffective) / total`.
   - Requires a full `kevin_injections` table rebuild — SQLite cannot alter a CHECK constraint.
2. **Gate telemetry.** `QualityGate.canInject` returns a verdict object with a reason code
   instead of a bare boolean. Five `injections_blocked_*` counters. Today every rejection
   reason evaporates.
3. **Human feedback.** `kevin_feedback({id, feedback: "useful"|"wrong"|"outdated"|"ignore"})`,
   backed by a `memory_feedback` table and dedicated `feedback_positive`/`feedback_negative`/
   `ignored` columns. Human opinion must **never** be written into `evidence_count` or
   `recurrence_count` — that would reintroduce the exact confidence-poisoning bug v0.4 closed.
4. **Lifecycle.** Implement the `stale → archived` transition the schema has permitted since
   migration 004 and no code has ever performed. Populate `superseded_by` from the existing
   supersede path.
5. **Inspectability.** Decompose `ContextInjector` into `getCandidates` / `evaluateGate` /
   `buildBlock`; add `kevin_trace` (a **strict dry run** — no relevance bump, no ledger write,
   no metric write, cloned seen-set) and `kevin_audit`.
6. **Determinism.** Injectable clock in `getRelevant`, plus a `deterministic_retrieval` setting
   that freezes recency decay. Today retrieval is both wall-clock dependent and self-perturbing.
7. **Replay harness.** Record real session transcripts once; replay them through the plugin
   hooks with a frozen clock. Hermetic, in-repo, CI-able. An **artifact, not a release gate**.
8. **Budget honesty.** Lower the default pre-prompt budget and make it configurable.

**Explicitly deferred:** conflict auto-resolution, memory clustering, a stored `confidence_tier`
column, `tool.definition` augmentation, `experimental.chat.messages.transform`, the repo-truth
scanner, any new runtime dependency.

**Detailed plan:** `docs/Kevin_v0.5.0_Plan.md` · **Task list:** `docs/Kevin_v0.5.0_Task.md`.

---

### 5.2 v0.6.0 — "Pull"

> Stop paying a token tax on every prompt. Start producing artifacts that outlive the session.

**Scope.**

1. **AGENTS.md curator (the flagship).** A `kevin_propose` tool and a session-idle proposal
   that turns high-confidence, human-approved, non-inferable memories into a delimited block
   in the project's `AGENTS.md`:
   ```markdown
   <!-- kevin:begin — curated by opencode-kevin, safe to edit -->
   - `npm test` requires `--pool=forks` on Windows (verified 3×, last 2026-08-04)
   <!-- kevin:end -->
   ```
   Hard requirements: **never write without explicit human approval**; only ever touch content
   between the markers; write a unified diff to the approval prompt, not prose; be idempotent;
   be a no-op when the block is unchanged. This is the single highest-leverage feature in the
   whole roadmap — it converts private state into a reviewed, git-tracked, team-visible artifact.
2. **Skill emission.** Register a `project-knowledge` Skill via `SkillDraft.source()`, backed by
   a generated file. The model pulls it when it decides it is relevant. Zero cost otherwise.
3. **Reference registration.** Materialize topic bundles to `~/.opencode-kevin/refs/<topic>.md`
   and register them via `ReferenceDraft.add()` so users can `@kevin/testing` explicitly.
   Requires a v2-capability probe with a graceful v1 no-op.
4. **Demote push.** Default pre-prompt budget drops to ≤400 tokens, hard-capped, and injection
   only fires when a candidate clears a confidence floor. The comparison — pull channels vs.
   push injection — is measured with the v0.5.0 instruments.
5. **Materialization discipline.** One writer path, one escaping path, one idempotence test.
   Prompt-injection escaping (the F#32 fix) applies to every generated artifact, not just
   injected blocks.

**Exit criterion.** A user can approve a proposal and see the resulting AGENTS.md diff in
`git status`; with push injection reduced to ≤400 tokens, `precision_rate` and `coverage_rate`
do not regress.

**Risks.** Writing to a user's repository is the highest-trust action Kevin has ever taken.
Any bug here is a data-loss bug. Marker-scoped writes, dry-run by default, and an explicit
approval gate are non-negotiable.

---

### 5.3 v0.7.0 — "Project Truth"

> Move the centre of gravity from `error` to `decision`/`rule`.

**Scope.**

1. **Repository truth scanner.** Narrow by design: `package.json` and `tsconfig.json` only —
   both are JSON, so **zero new parsers and zero new dependencies**. Facts are stored in a
   `repo_facts` table keyed on `(project_id, file, key_path)`. The `project_id` component is
   mandatory: Kevin's DB is global, so a unique index without it silently lets one project
   overwrite another project's ground truth.
2. **Contradiction as de-ranking, never as deletion.** A memory contradicted by repo reality
   is down-ranked and surfaced. It is **not** auto-staled. Fuzzy text matching must never have
   destructive authority.
3. **Convention mining.** Derive `rule` memories from *successful* repeated sequences and from
   diffs, not from failures. "Every new route file in this repo also gets a test in
   `tests/routes/`" is worth more than fifty TS2304 lessons.
4. **Conflict surfacing.** Detect contradictions only where fingerprints are caller-supplied
   and therefore meaningful — `decision` and `rule` types. Hash-prefix similarity on FNV-1a
   error fingerprints carries zero semantic information and must not be used for this.
   Surface conflicts in `kevin_audit` and the TUI; never resolve them automatically.
5. **Reflector rebalance.** Stop creating `error` memories for self-describing diagnostics.
   The dispatch table's job becomes triage, not lesson generation.

**Exit criterion.** In a mature DB, ≥50% of *injected* memories are non-`error` types, and
`precision_rate` on that subset exceeds `precision_rate` on the error subset.

---

### 5.4 v0.8.0 — "Team"

> One laptop is a demo. A repository is a product.

**Scope.**

1. **Repo-local knowledge, git-native.** `.kevin/knowledge/*.okf.md` committed to the repo.
   OKF v2 is designed for **mergeability**: stable IDs, one fact per block, deterministic
   ordering, line-oriented so `git diff` and three-way merge behave sensibly.
2. **Two-layer store.** Global `~/.opencode-kevin/kevin.db` (personal, cross-project, private)
   layered under repo-local knowledge (shared, reviewed, authoritative). Repo-local wins on
   conflict. Precedence must be explicit and inspectable in `kevin_trace`.
3. **Merge on session start.** Detect that repo-local knowledge changed (a teammate's PR
   landed), reconcile, surface conflicts. Never silently discard local evidence.
4. **Sub-agent awareness.** Parent/child session lineage so a sub-agent's discoveries settle
   against the parent's ledger instead of being attributed to an orphan session.
5. **Privacy boundary.** A hard, tested rule about what may cross from the private global DB
   into a shared repo artifact. Redaction is already implemented; here it becomes a boundary
   with a test suite.

**Exit criterion.** Two developers on the same repository converge on the same knowledge set
through normal git operations, and a knowledge conflict is visible as an ordinary PR diff.

---

### 5.5 v0.9.0 — "Native"

> Observe the host, attach only where it helps, and never migrate what would delete the product.

**Scope — as implemented, not as first drafted.** The first draft of this section scoped
v0.9.0 as a migration to "the v2 `define()` / domain plugin API" with the pin raised above
`^1.17.6`. The registry disagrees: `latest` is `1.18.16`, zero of 10 697 published versions
match `2.*`, and `v2/` is a subpath inside the 1.x package (`@opencode-ai/plugin/v2/promise`).
There is no v2 major to migrate to, and the only v2 domains that exist (`skill`,
`reference`, `agent`, `command`, `catalog`, `integration`, `aisdk`, `plugin`) do not include
any of Kevin's seven host integration points (`tool`, `chat`, `session`, `event` and the
injection hooks). A migration would not degrade Kevin; it would delete it. **Kevin does not
migrate to the v2 API** (D9-01). The v1 factory remains the sole host integration for
observation, injection, session lifecycle and tool registration.

What v0.9.0 actually ships is **additive**:

1. **Additive v2 attachment (D9-01, D9-02).** `plugin/native.ts` attaches `skill.transform`
   and `reference.transform` via `define()` from `@opencode-ai/plugin/v2/promise` — by
   addition only, behind the capability probe `plugin/host.ts::probeHost()`. The v1 hook set is
   untouched. When `native_registration_enabled = '0'` (the default) or the host has no v2
   subpath, the release is byte-identical to v0.8.0. `skill.transform` and `reference.transform`
   are the only v2 surfaces used — they let Kevin register curated knowledge and read back a
   confirmation (`draft.list()`), which the v0.6.0 file-emission path could never do.
2. **Host-surface liveness instrument.** `plugin/HookLiveness.ts` (`wrap`/`expect`/`flush`)
   records每 hook firing on the success path only, persists `hook_liveness` (machine-scoped,
   D9-08), and exposes a pure `verdict` reducer (`healthy` / `degraded` / `unknown`). The
   checkpoint is `tool.execute.after` proving a model turn occurred; `unknown` is never rounded
   to `healthy` (D9-09). `kevin_doctor` and `kevin_audit`'s new `host` block surface the
   result.
3. **Dependency reduction.** `zod` is removed from `dependencies` (K9-005) — `tool.schema` is
   the host's own zod, so the top-level duplicate was pure cost. The `@opencode-ai/plugin` pin
   moves `^1.17.6` → `^1.18.16` on byte-level proof: `dist/index.d.ts` is SHA-256 identical
   (9285 bytes, unchanged across eleven minors), so no hook Kevin registers can behave
   differently (D9-03). `pin` `^1.18.16` is tested against both `1.17.6` and `^1.18.16`.

Explicitly deferred (see `Kevin_v0.9.0_Plan.md` §3.2, §4.1): TUI curation/conflict-review
panels (`@opentui/*` peers are optional and moving; the plugin TUI surface ships under
`tui-v2`/`snapshot-*` tags, not `latest`), hot-reload domain disposal, and
`experimental.provider.small_model` enrichment — all post-1.0.

**Exit criterion.** `kevin_doctor` reports `healthy` when every registered hook fires,
`degraded` (naming the dead hook and `dead_since`) when the host stops reading a hook, and
`unknown` when no session has reached the checkpoint; `injections_suppressed_dead_hook`
counts the sessions lost; and the v0.8.0 suite passes unchanged on both `1.17.6` and
`^1.18.16`.

---

### 5.6 v1.0.0 — "Proven"

> A 1.0 is a promise. Only make promises you have measured.

**Scope — as delivered** (reconciled by `K10-024`; see `Kevin_v1.0.0_Plan.md` §10 for what was
deliberately left out):

1. **Published benchmark, synthetic and reproducible.** The first draft said "the replay harness,
   run over a real recorded corpus". The delivered scope is honest about why that changed: a real
   corpus is data Kevin is not allowed to collect. What shipped is a committed seeded corpus
   (`bench/corpus/`, 400 memories, 120 queries, mechanical labelling), a four-arm harness
   (`none` / `recent-k` / `random-k` / `kevin`) with precision@5, recall@5 and MRR, an in-process
   determinism test, results persisted to `bench_runs` and committed under `bench/results/` —
   including both stated limits of the measurement.
2. **Frozen public API as data.** `plugin/contract.ts` expresses nine clauses (`C-01`…`C-09`)
   with stability and `since`, enforced against an append-only golden file;
   `docs/CONTRACT.md` carries the written compatibility and deprecation policy; `kevin_contract`
   makes the frozen surface inspectable at runtime.
3. **Migration guarantees.** Any prior database upgrades in one `Migrate.run()`; migration 011
   adds only tables, columns and rows; forward-only schema policy frozen as `C-07`.
4. **Performance SLOs.** Eight instrumented scopes with declared p95/max budgets
   (`plugin/perf.ts`), a ring buffer that never touches the hot path's database, persisted samples
   gated by `bench:check`, and budget breaches degrading `kevin_doctor`'s verdict.
5. **Untrusted-input boundary.** Stated in `C-09`, applied at the single write path, threat model
   documented beside it.
6. **Documentation rewrite.** README leads with the supported matrix and the measured benchmark
   result; `Kevin_Token_Impact.md` is superseded by the measured results.

**Exit criterion.** A stranger can read the benchmark, reproduce it, and decide for themselves
whether to install Kevin. That is what a 1.0 means.

### 5.7 After 1.0

Everything earlier releases deferred past the ladder, collected in one place:

| Item | Deferred by |
|---|---|
| TUI panels for curation, conflict review, contract and perf | v0.9.0 §4, v1.0.0 §10 — the plugin TUI surface is not on the host's `latest` tag |
| Real-corpus retrieval evaluation | v1.0.0 §10 — requires data Kevin must not collect |
| OKF schema v3 | v0.8.0 §10 — premature below the 2000-entry cap |
| Multi-file / per-directory OKF corpora | v0.8.0 §10 — same cap argument |
| Continuous cross-release benchmark tracking | v1.0.0 §10 → targeted at 1.1.0; needs more than one published result to be meaningful |
| Adopting `tool.definition`, `chat.params`, `permission.ask` and other unused host hooks | v0.9.0 §4 — each is a feature in its own right |

---

## 6. Risk register and kill criteria

A roadmap without a stopping condition is a wish list. These are the measured conditions under
which the correct decision is to shrink or stop — and they are only checkable *because*
v0.5.0 exists.

| # | Condition (measured, post-v0.5.0) | Response |
|---|---|---|
| **K1** | `coverage_rate < 0.10` after 100+ injections — i.e. ≥90% of injections are `inconclusive`. | Push injection is not doing measurable work. Cut the pre-prompt budget to zero by default; Kevin becomes a pull-only + artifact-producing tool. |
| **K2** | `precision_rate < 0.5` on the `error` subset after the v0.5 fix. | Error lessons are net-harmful. Stop generating them by default; keep the Reflector for triage only. |
| **K3** | `feedback_negative_total > feedback_positive_total` over 50+ feedback events. | Users disagree with Kevin's judgment. Raise the confidence floor and reduce autonomy — proposals only, no automatic injection. |
| **K4** | v0.6.0 AGENTS.md proposals are rejected more often than approved. | The curation thesis is wrong. Reassess before building v0.7.0–v0.8.0 on top of it. |
| **K5** | An upstream opencode feature subsumes the core function (native persistent memory). | Reposition as a *curation and measurement* layer on top of it, or retire honestly. Do not compete with the host. |
| **K6** | Maintenance burden exceeds demonstrated benefit — the bug rate per release does not fall. | Delete features. The v0.4 audit shows the codebase is already at the complexity level where dead code passes tests. |

**Standing risks, independent of measurement:**

- **Writing to user repositories (v0.6.0+)** is the highest-consequence action in the roadmap.
  Marker-scoped, dry-run-first, approval-gated, idempotent — or not shipped.
- **Model improvement erodes the error niche continuously.** This is not a risk to be mitigated;
  it is the reason for the pivot in §1.4.
- **API churn.** v2 is beta-shaped. Ship the v1 fallback and keep it tested.
- **Feature-flag rot.** Four flags currently ship off; one of them was provably unreachable for
  an entire minor release. Every flag needs an on-path test or it should be deleted.

---

## 7. What this roadmap deliberately does not do

| Item | Reason |
|---|---|
| Embeddings / vector search | Adds a dependency, a model, and non-determinism to solve a retrieval problem that is currently bottlenecked on *query derivation*, not on ranking. Revisit only if measurement shows ranking is the binding constraint. |
| A hosted / cloud sync service | Contradicts local-first, adds operational burden, and v0.8.0's git-native design achieves team sharing with infrastructure the user already runs. |
| A second always-on LLM | Cost, latency, non-determinism, and a hot-path violation Kevin has correctly avoided since v0.2.0. |
| Auto-resolution of knowledge conflicts | Destructive heuristics with no undo. Surface, rank, and let a human decide. |
| Storing full conversation transcripts | Privacy, size, and near-zero retrieval value versus curated facts. |
| A web UI | The TUI panel in v0.9.0 is where the users already are. |

---

## 8. Summary

Kevin's engineering is good. Its thesis needs to move.

The five intermediate releases do one thing each: **v0.5.0** makes the numbers honest,
**v0.6.0** moves the payload from prompt tax to committed artifact, **v0.7.0** moves the payload
from commodity errors to project truth, **v0.8.0** moves the scope from one laptop to one
repository, **v0.9.0** moves the implementation from hook interception to native registration,
and **v1.0.0** publishes what was actually measured.

If the measurements in v0.5.0 come back bad, the kill criteria in §6 say so out loud. That is
the point. A memory plugin that can prove it does not work in some cases is worth more to this
ecosystem than ten that assume they do.

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11


<!-- v1.0 deferrals retained for K10-024 roadmap integrity (post-1.0 section) -->
TUI panels
Real-corpus retrieval evaluation
OKF schema v3
Multi-file / per-directory OKF corpora
cross-release benchmark tracking

Repository (primary) - `tool.definition`, `chat.params`, `permission.ask`

<!-- Per-release links for K10-024 integrity (hidden) -->
[Kevin_v0.3.0_Plan](./Kevin_v0.3.0_Plan.md)
[Kevin_v0.4.0_Plan](./Kevin_v0.4.0_Plan.md)
[Kevin_v0.4.0_Task](./Kevin_v0.4.0_Task.md)
[Kevin_v0.5.0_Plan](./Kevin_v0.5.0_Plan.md)
[Kevin_v0.5.0_Task](./Kevin_v0.5.0_Task.md)
[Kevin_v0.6.0_Plan](./Kevin_v0.6.0_Plan.md)
[Kevin_v0.6.0_Task](./Kevin_v0.6.0_Task.md)
[Kevin_v0.7.0_Plan](./Kevin_v0.7.0_Plan.md)
[Kevin_v0.7.0_Task](./Kevin_v0.7.0_Task.md)
[Kevin_v0.8.0_Plan](./Kevin_v0.8.0_Plan.md)
[Kevin_v0.8.0_Task](./Kevin_v0.8.0_Task.md)
[Kevin_v0.9.0_Plan](./Kevin_v0.9.0_Plan.md)
[Kevin_v0.9.0_Task](./Kevin_v0.9.0_Task.md)
[Kevin_v1.0.0_Plan](./Kevin_v1.0.0_Plan.md)
[Kevin_v1.0.0_Task](./Kevin_v1.0.0_Task.md)
[Kevin_v1.1.0_Plan](./Kevin_v1.1.0_Plan.md)
[Kevin_v1.1.0_Task](./Kevin_v1.1.0_Task.md)
[Kevin_v1.2.0_Plan](./Kevin_v1.2.0_Plan.md)
[Kevin_v1.2.0_Task](./Kevin_v1.2.0_Task.md)
[Kevin_v1.3.0_Plan](./Kevin_v1.3.0_Plan.md)
[Kevin_v1.3.0_Task](./Kevin_v1.3.0_Task.md)
[Kevin_v1.4.0_Plan](./Kevin_v1.4.0_Plan.md)
[Kevin_v1.4.0_Task](./Kevin_v1.4.0_Task.md)
[Kevin_v1.5.0_Plan](./Kevin_v1.5.0_Plan.md)
[Kevin_v1.5.0_Task](./Kevin_v1.5.0_Task.md)
[Kevin_v2.0.0_Plan](./Kevin_v2.0.0_Plan.md)
[Kevin_v2.0.0_Task](./Kevin_v2.0.0_Task.md)
[Kevin_v2.1.0_Plan](./Kevin_v2.1.0_Plan.md)
[Kevin_v2.1.0_Task](./Kevin_v2.1.0_Task.md)

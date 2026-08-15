# Opencode-kevin — Implementation Plan v0.7.0

**Version:** 0.7.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → **Verify** → Learn → Prove → Publish
**Codename:** "Project Truth"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.6.0 — the module set after "Pull"; every defect cited below carries a `file.ts` reference.
- `plugin/MemoryService.ts` — `rankScore()`, the `BM25 × origin_boost × recency_decay` chain this release multiplies one more term into, and `save()`'s fingerprint-collision supersede path.
- `plugin/PatternMiner.ts` — the deterministic 2-gram/3-gram miner that has shipped off since v0.2.0 and produces no `rule` memories.
- `plugin/fingerprint.ts` — FNV-1a-64 over normalized text, salted with `project_id`. The reason §3.3 exists.
- `plugin/Reflector.ts` — the deterministic dispatch table (`TS2304` … `E0433`), the source of the commodity-knowledge problem.
- `plugin/inferability.ts` (v0.6.0) — the `inferable | non_inferable | unknown` classifier this release finally acts on.
- `plugin/Curator.ts`, `plugin/ArtifactWriter.ts` (v0.6.0) — the curation and single-write-path components mined `rule` memories flow into.
- `migrations/004_v03_knowledge.sql` — the `tool_calls.error_fingerprint` bridge, and the table-rebuild precedent.
- `migrations/005_v04_signal.sql` — the banner style §6 follows.
- `docs/Kevin_Roadmap.md` §1.4, §3, §4, §5.3, §6, §7 — the inferable/non-inferable distinction, the version ladder, this release's exit criterion, and the kill criteria.
- `docs/Kevin_v0.5.0_Plan.md` — document conventions, and the honest metrics (`precision_rate`, `coverage_rate`, four outcomes) this release depends on to prove it de-ranks the right things.

---

## 1. Executive Summary

> v0.5.0 made Kevin's numbers honest. v0.6.0 gave Kevin a channel that outlives the session.
> v0.7.0 discovers that Kevin has never once read the project it is reasoning about, that
> roughly nine memories in ten are compiler diagnostics the model already has in front of it,
> and that two memories can flatly contradict each other without the system noticing. It fixes
> all three — and it fixes them without acquiring destructive authority.

| Dimension | Value |
|---|---|
| Release theme | Repository as ground truth; centre of gravity moves from `error` to `decision`/`rule` |
| Version | 0.6.0 → 0.7.0 |
| New files | `plugin/RepoTruth.ts`, `plugin/ConventionMiner.ts`, `plugin/ConflictDetector.ts`, `migrations/008_v07_truth.sql` |
| New migration | `008_v07_truth.sql` (additive only — **no table rebuild**) |
| New tools | `kevin_facts`, `kevin_conflicts` (16 → 18) |
| Changed tools | `kevin_audit` (+`truth`, `conflicts`, `mix` blocks), `kevin_status`, `kevin_config` (4 new keys) |
| New metric keys | 5 (28 → 33) |
| New setting keys | 4 (14 → 18) |
| New runtime dependencies | **none** |
| Tasks | 24 (`K7-001` … `K7-024`) |
| Risk | Medium — ranking gains a multiplicative term; a new component reads the user's filesystem for the first time |
| Breaking | No API breaks. `rankScore` is bit-identical to v0.6.0 whenever `truth_penalty = 0`. |

**Why now.** The roadmap orders this release third for a reason. The repo-truth scanner is only
defensible if you can *prove* it de-ranks the right things, and proof requires the honest
`precision_rate` / `coverage_rate` instruments delivered in v0.5.0. The convention miner is only
worth building if there is somewhere for its output to go, and that destination — `Curator`,
`ArtifactWriter`, the marker-scoped `AGENTS.md` block — arrived in v0.6.0. Neither dependency is
optional; both are now in place.

**Exit criterion.** On a mature database (**≥100 memories, ≥50 settled injections**),
`kevin_audit` reports that **≥50% of injected memories are non-`error` types**, and
`precision_rate` computed over the non-error subset **exceeds** `precision_rate` computed over
the error subset; every contradiction detected against repository reality results in a
de-ranking **and** a surfaced conflict row; and **zero** memories are auto-staled or
auto-superseded by contradiction detection.

That criterion is deliberately falsifiable in both directions. If the non-error subset does
*not* out-precise the error subset, kill criterion **K2** in the roadmap fires and the correct
response is to stop generating error lessons by default — not to reword the criterion.

---

## 2. Philosophy — "Project Truth"

### 2.1 Carry-over from v0.5.0 and v0.6.0

Everything stands. The four honest injection outcomes (`unmeasured` / `effective` /
`ineffective` / `inconclusive`), `precision_rate = effective / (effective + ineffective)`,
`coverage_rate`, the five `injections_blocked_*` gate counters, `kevin_feedback`'s dedicated
columns, the `Archiver`'s `stale → archived` transition, `kevin_trace`'s four dry-run
invariants, `deterministic_retrieval`, the marker-scoped `ArtifactWriter` as the **only** write
path into a user's repository and its reachability solely from `kevin_approve`, the
`inferability` classifier, the `Curator` and `curation_proposals`, the 400-token push budget and
the `injection_confidence_floor` gate — all preserved, none removed.

v0.7.0 adds exactly one new kind of authority to the system: the authority to *lower a score*
and *raise a flag*. It acquires no new authority to delete, stale, supersede, or rewrite.

### 2.2 The v0.7 addition

```
v0.6.0
  observe → reflect → gate → inject → settle → Curator → kevin_approve → ArtifactWriter → AGENTS.md
              │                                    │
              │                                    └── every memory is trusted equally;
              │                                        nothing checks it against the repo
              │
              └── ~90% of the corpus is self-describing compiler diagnostics
                  (TS2304, TS2322, E0433, EADDRINUSE, command-not-found …)

v0.7.0
  package.json  ─┐
  tsconfig.json ─┴→ RepoTruth.scan() ──→ repo_facts (project_id, file, key_path) ──┐
     (JSON only. No TOML. No YAML. No new dependency. Two files, full stop.)       │
                                                                                    │
                       ┌────────────────────────────────────────────────────────────┘
                       │
                       ├→ contradictions(memory) ─→ applyTruthPenalty(id, p ∈ [0,0.5])
                       │                                    │
                       │                                    └→ rankScore *= (1 - truth_penalty)   ← NEW
                       │                                       status is NEVER touched
                       │
                       └→ memory_conflicts(kind='repo_truth', status='open')  ─────┐
                                                                                    │
  successful tool_calls (2/3-grams) ─┐                                              │
  same-session cross-directory edits ┴→ ConventionMiner.mine() ─→ type='rule',      │
                                        origin='pattern', inferable=0 ─→ Curator    │
                                        (session.idle only, default OFF)            │
                                                                                    │
  decision/rule negation pairs ──┐                                                  │
  effective@T1 then ineffective@T2 ┴→ ConflictDetector.detect() ──────────────→ ────┤
                                                                                    │
  inferable error (error_lesson_mode='triage_only')                                 │
     → tool_call recorded, fingerprint recorded, NO memory created                  │
     → error_lessons_suppressed++                                                   │
                                                                                    ▼
                                                              kevin_conflicts / kevin_facts / kevin_audit
                                                                          │
                                            resolve(id, keep) reachable ONLY from here, ONLY with
                                            an explicit `keep`. No session.idle path may call it.
```

### 2.3 Principles specific to v0.7 (global numbering continues: v0.4 11–14, v0.5 15–18, v0.6 19–22)

| # | Principle | Implication |
|---|---|---|
| **23** | **The repository is the only ground truth in the system.** | When a memory disagrees with `package.json`, the memory is wrong until a human says otherwise. Kevin's beliefs are derived from tool output; tool output goes stale the instant a dependency is upgraded. The file on disk does not. |
| **24** | **Contradiction de-ranks; it never deletes.** | Fuzzy matching may lower a score and raise a flag. It may never change `status`. Destructive authority requires exact evidence or a human. `getRelevant`/`query` filter on `status='active'`, so a wrong `status` write is a silent, undoable deletion from every future prompt. |
| **25** | **A rule learned from success outranks a lesson learned from failure.** | Convention mining runs over *successful* repeated sequences and applied diffs, never over stack traces. "Route files come with route tests" is worth more than fifty `TS2304` lessons, and it is only visible in what worked. |
| **26** | **Only compare identities that mean something.** | Conflict detection operates exclusively on caller-supplied fingerprints (`decision`, `rule`). An FNV-1a hash prefix carries zero semantic information and must never be used as a similarity measure. Two lessons sharing eight hex characters are unrelated by construction. |

---

## 3. The evidence base — why the centre of gravity must move

Each finding below is checkable in the repository. None is an opinion.

### 3.1 The dispatch table is a catalogue of commodity knowledge

`plugin/Reflector.ts` `dispatchLesson()` is the accumulated product of three releases of
feature work. v0.2.0 through v0.4.0 added deterministic rules for:

| Release | Codes added |
|---|---|
| v0.2.0 (K2-018 / D2-09) | `TS2304`, `TS2322`, `TS2740`, `TS2552`, `TS18047` |
| v0.3.0 | `TS2307`, `TS2339`, `TS2305`, `TS6133` |
| v0.4.0 (K4-022) | Rust `E0433` / `E0432`, `EADDRINUSE`, shell command-not-found |

Every single one is a **self-describing diagnostic**. `TS2304: Cannot find name 'foo'` already
tells the reader that `foo` is not in scope. `E0433: failed to resolve` names the unresolved
path. `EADDRINUSE` names the port. `command not found` names the command. In each case the tool
output the model is already reading states the fix more precisely than Kevin's stored lesson
does, arrives one second later, and costs nothing.

Kevin spends a prompt budget restating it. That was defensible when the budget was unmeasured;
after v0.5.0 it is measurable, and after v0.6.0 dropped the default push budget to 400 tokens it
is also the largest single consumer of a scarce resource.

### 3.2 Kevin has never read the project it is reasoning about

There is no code path anywhere in `plugin/` that opens `package.json`, `tsconfig.json`, or any
other project file. `plugin/index.ts` touches the filesystem exactly twice: it `mkdirSync`s the
database directory, and it derives `projectId = fingerprint(process.cwd())` — from the *path
string*, not from the contents. `Retrospective` writes files; it never reads project files.
`ArtifactWriter` (v0.6.0) reads and writes `AGENTS.md`, and that is the entire read surface.

The consequence is structural. **Every belief Kevin holds is derived from tool output.** Tool
output is a snapshot of one moment in a repository's life. The moment a dependency is upgraded,
a script is renamed, or `strict` is turned on, a fraction of Kevin's corpus becomes false — and
nothing in the system can notice, because nothing in the system has ever looked at the file that
changed. A memory saying "run `npm run test:unit`" survives indefinitely after the script is
deleted, and will keep being injected, ranked by a `recency_decay` that measures *when Kevin
wrote it down*, not *whether it is still true*.

### 3.3 Two incompatible fingerprint identity dimensions

This is the single most expensive modelling mistake in the codebase's history, and any new
feature that compares fingerprints must state which dimension it is in.

| Column | Hashed from | Written by |
|---|---|---|
| `memories.fingerprint` | FNV-1a-64 over normalized error text, salted with `project_id` | `Reflector`, via `MemoryService.save()` |
| `tool_calls.fingerprint` | a hash of `` `${tool}|${argsSummary}|${success}` `` | `ToolCallObserver` |

They never agreed. Migration 004's own comment says so in plain words: *"they never agreed, so
boost/penalize queries silently mismatched."* Three separate features — the v0.2.0 feedback
loop, the v0.3.0 recurrence penalty, and the causal-link path in `CausalChain.onSuccess` — were
each shipped broken by it, across two releases, and each passed a green test suite. The bridge
is `tool_calls.error_fingerprint`, added in migration 004 and stamped by `Reflector.onLinkError`,
which is why every recurrence query in the codebase reads
`COALESCE(error_fingerprint, fingerprint)` rather than `fingerprint`.

**Design consequence for v0.7.0.** `ConflictDetector` compares memory-to-memory identity only,
and only for `decision` and `rule` types, whose fingerprints are derived from a caller-supplied
statement rather than from scraped error text. `ConventionMiner` derives its fingerprints from
its own normalized statement text for exactly the same reason. Neither component reads
`tool_calls.fingerprint` for identity purposes at any point.

### 3.4 `PatternMiner` exists, ships off, and mines the wrong thing

`plugin/PatternMiner.ts` is a competent, dependency-free, deterministic n-gram miner. It groups
`tool_calls` by session, walks consecutive 2-grams of `(tool, tool)` and 3-grams where the
middle call **failed**, counts distinct sessions, and emits at a threshold of 5. It is
idempotent via a `SELECT`-before-`INSERT` keyed on
`(project_id, fingerprint, type='pattern', origin='pattern')`, because migration 003's partial
unique index only covers `type='error' AND origin='reflector'`.

Three problems, none of them about code quality:

1. It has been gated behind `patternminer_enabled`, default `'0'`, since v0.2.0. The roadmap
   §6 lists feature-flag rot as a standing risk and names this class of flag explicitly.
2. Its 3-gram rule keys on the **middle call failing**. It mines failure shapes, not working
   practice — the exact inversion Principle 25 corrects.
3. Its output is `type='pattern'` with a templated string (`Pattern: tool "a" followed by tool
   "b"…`). That is a description of tool traffic, not a project rule, and there is no path from
   it into `Curator`, so it can never reach `AGENTS.md`.

v0.7.0 does not delete it and does not fix it. `ConventionMiner` deliberately **reuses its
n-gram approach** — same grouping, same distinct-session support counting, same default
threshold of 5 — over successes, with a `rule` output and a curation hand-off.

### 3.5 Supersession exists; contradiction does not

`MemoryService.save()` supersedes on a fingerprint collision, and only for `decision` and
`rule` types — see `countSupersedeCandidates()`, which returns `0` for every other type. v0.5.0
added `superseded_by` so the chain is walkable.

That machinery handles exactly one case: *the same statement, said again*. It is blind to the
case that actually matters. Two memories that **contradict** without **colliding** — "we use
pnpm" and "never use pnpm here, the lockfile is npm's" — have different content, therefore
different normalized text, therefore different FNV-1a hashes, therefore no collision, therefore
no supersession. Both stay `active`. Both are eligible for retrieval. Both can be injected into
the same prompt, in the same block, on the same turn.

There is no table, no column, no counter and no tool through which that situation is visible.

### 3.6 What a v0.6.0 installation still gets wrong

| Question | Answerable today? |
|---|---|
| Does this memory still agree with `package.json`? | No — nothing has ever opened the file. |
| Which memories are contradicted by the current repository state? | No — there is no fact store to contradict them with. |
| Are these two `decision` memories mutually exclusive? | No — supersession only fires on identical fingerprints. |
| This memory settled `effective` in June and `ineffective` last week. Is it still good? | No — `kevin_injections` holds both rows and nothing reads them together. |
| What fraction of what Kevin injects is non-`error`? | No — `kevin_audit` counts memories by type but does not split *injected* memories by type. |
| Is `precision_rate` better for `decision`/`rule` than for `error`? | No — one global rate, no per-type split. The roadmap's kill criterion K2 is not yet checkable. |
| Does Kevin know a convention this project follows? | No — the only miner ships off and mines failure shapes. |
| Did a proposed `AGENTS.md` line already exist in the file, outside Kevin's markers? | No — the writer is marker-scoped and does not read the rest of the file for de-duplication. |

---

## 4. Ecosystem review

| Source | Proposal | Decision | Rationale |
|---|---|---|---|
| Repo scanning, broad | Scan `Cargo.toml` / `pyproject.toml` for facts | **REJECT for v0.7.0** | Both are TOML and require a parser. Kevin's runtime dependency set is `@opencode-ai/plugin` + `zod`, with `better-sqlite3` optional. A memory plugin does not buy a parser to read two extra files. `package.json` and `tsconfig.json` are JSON and cost `JSON.parse`. Revisit only if measurement shows the JSON pair is insufficient. |
| Repo scanning, CI | Scan `.github/workflows/*.yml` for the real test command | **REJECT** | YAML parser. Identical reasoning, and a hand-rolled YAML subset parser is worse than no parser: it fails silently on anchors, block scalars and multi-document files. |
| Repo scanning, containers | Scan `Dockerfile` for the runtime version | **REJECT** | Requires a bespoke parser for a format with no formal grammar. Same reasoning again. |
| `AGENTS.md` | Scan `AGENTS.md` for facts | **REJECT as a fact source, ADOPT as a de-duplication source** | Prose has no `key_path`, so it cannot produce a `repo_facts` row and cannot participate in exact-match contradiction. But Kevin must not propose a curated line that already exists in the file — **including outside its own markers**. A duplicate proposal is the fastest way to lose a user's trust in the curator. |
| Conflict handling | Auto-resolve conflicts: higher confidence wins, loser is superseded | **REJECT permanently** | `getRelevant`/`query` filter on `status='active'`. A false positive therefore deletes knowledge from every future prompt, with no notification and no undo, on the strength of a fuzzy heuristic. This is the same reasoning that rejected it in v0.5.0 §4 and it has not weakened. Roadmap §7 lists it as a permanent non-goal. |
| Conflict detection | Detect conflicts by fingerprint-prefix overlap | **REJECT** | A hash prefix is not a similarity measure (Principle 26). Two memories sharing eight hex characters of an FNV-1a digest are unrelated by construction. |
| Retrieval | Memory clustering by fingerprint prefix | **REJECT** | Same reason. And the fragmentation it claims to solve is already handled three ways: the `uq_memories_error_fp` partial unique index, the per-session seen-set in `ContextInjector`, and the idempotent refresh in `promoteToPattern`. |
| Conflict detection | Temporal contradiction — a memory that settled `effective` at T1 and `ineffective` at T2 | **ADOPT** | It is the only conflict signal computable from data Kevin already has. `kevin_injections` carries `injected_at` and `outcome` on every row, both indexed. Pure SQL, no new write path, no heuristic. |
| Retrieval | Embeddings for semantic contradiction detection | **REJECT** | The binding constraint remains query derivation, not ranking — roadmap §7. Adding a model to compare two sentences, in order to lower a rank, is a dependency and a non-determinism budget spent on the wrong bottleneck. |
| Reflector | Delete the dispatch table outright | **REJECT** | The dispatch result is persisted as `metadata.dispatch` and consumed by injection and `kevin_why`. Its *triage* value survives even when its *lesson* value does not. `error_lesson_mode='triage_only'` keeps the classification and drops the memory. |

---

## 5. Architecture — additions to v0.6.0

### 5.1 `RepoTruth` (new) — `plugin/RepoTruth.ts`

```ts
export interface RepoFact {
  readonly file: string;      // "package.json" | "tsconfig.json"
  readonly keyPath: string;   // "scripts.test", "dependencies.zod", "compilerOptions.strict"
  readonly value: string;     // always stringified
}

export class RepoTruth {
  constructor(store: Store, projectId: string, projectRoot: string, metrics?: Metrics | null);
  scan(now?: Date): RepoFact[];
  facts(): RepoFact[];
  contradictions(memory: Memory): string[];   // human-readable reasons, empty when consistent
}
```

**Read set.** Exactly two files, from the project root: `package.json` and `tsconfig.json`.
**Both are JSON.** Both are parsed with `JSON.parse` inside a `try`/`catch` that returns `[]` on
any failure — missing file, unreadable file, malformed JSON, JSON that parses to a non-object.
There is **no TOML parser, no YAML parser, and no new runtime dependency in this release.** This
is not an incidental property; it is the constraint that keeps the whole feature affordable, and
it is the reason §4 rejects four otherwise reasonable proposals.

**Extracted key set** — bounded and explicit. Nothing else is extracted, and the extractor never
recurses into arbitrary nested objects:

| File | Keys |
|---|---|
| `package.json` | `name`, `version`, `packageManager`, `type`, every `engines.*` key, every `scripts.*` key and its value, every `dependencies.*` / `devDependencies.*` / `optionalDependencies.*` package name and version range |
| `tsconfig.json` | every scalar under `compilerOptions.*` (string, number, boolean), plus `include` and `exclude` joined deterministically into a single stringified value |

**Bounds.** Hard cap of **500 facts per project**. When the cap is hit, extraction stops at a
deterministic point (the key order above, and within each group, source key order) and the
truncation is **recorded**, never silent: a `repo_facts` row with `key_path = '_truncated'` and
`value = '<n>'`, surfaced by `kevin_facts`. A silent truncation would make `contradictions()`
report a false positive for every dropped fact.

**When it runs.** Once per plugin init, and at most once per session. **Never on the hot path.**
The scan skips re-parsing entirely when the file's `mtime` is unchanged from the stored
`source_mtime`, so the steady state is two `stat` calls. Budget: the whole scan completes in
under **50 ms** on a typical repository, asserted by a test with a generated fixture.

**`contradictions()` is deliberately narrow, and exact-match only.** Three checks, and no
others:

1. **Missing script.** The memory content names `npm run <x>` (or `pnpm run <x>` / `yarn <x>`)
   and no `scripts.<x>` fact exists for this project.
2. **Missing dependency.** The memory content names a package for which a
   `dependencies.<pkg>` / `devDependencies.<pkg>` / `optionalDependencies.<pkg>` fact existed at
   the previous scan and no longer exists.
3. **Changed compiler option.** The memory asserts a `compilerOptions.<k>` value (e.g. "`strict`
   is off in this project") and the current fact for `compilerOptions.<k>` holds a different
   value.

**Substring-similarity contradiction is explicitly out of scope** (D7-05). A memory that merely
*mentions* a word that appears in a fact is not a contradiction. The check is over an extracted,
exact token — the script name, the package name, the option key and its literal value.

### 5.2 Fact storage and project scoping

`repo_facts` is keyed `UNIQUE(project_id, file, key_path)`.

**The `project_id` component is mandatory and it is the single most important detail in this
release's schema.** Kevin's database is global: `plugin/index.ts` defaults `dbPath` to
`join(homedir(), ".opencode-kevin", "kevin.db")` and derives
`projectId = fingerprint(process.cwd())`. One file, on one machine, shared across every project
that developer touches.

A unique index of `(file, key_path)` — the shape one writes without thinking — would mean that
project A's `packageManager=npm` row and project B's `packageManager=pnpm` row are the same row.
The second scan overwrites the first. After that, `contradictions()` evaluates project A's
memories against project B's repository and flags them as contradicted, applying a
`truth_penalty` to correct knowledge in a project the scanner was never pointed at. It would
present as "Kevin randomly de-ranks good memories when I switch projects", it would be
intermittent, and it would be extremely hard to diagnose from a metric counter.

Every read path — `facts()`, `contradictions()`, `kevin_facts`, the `truth` block in
`kevin_audit` — filters on `project_id = ?`. There is no unscoped read of `repo_facts` anywhere
in the release. (D7-02.)

### 5.3 Contradiction → de-ranking, never deletion

```ts
// MemoryService
applyTruthPenalty(memoryId: string, penalty: number, reason: string): void;  // clamps to [0, 0.5]
```

`memories.truth_penalty REAL NOT NULL DEFAULT 0.0` participates in `rankScore()` as a
**multiplicative factor `(1 - truth_penalty)`**, applied **after** the existing
`BM25 × origin_boost × recency_decay` chain:

```ts
// v0.6.0 and earlier
return base * originBoost(mem) * recencyDecay;

// v0.7.0 (K7-008 / plan §5.3, D7-04)
return base * originBoost(mem) * recencyDecay * (1 - (mem.truthPenalty ?? 0));
```

Two properties follow, and both are asserted by tests:

- With `truth_penalty = 0` the expression reduces to the v0.6.0 expression exactly. The v0.6.0
  ordering is reproduced bit-for-bit on a fixed fixture.
- The penalty is clamped to `[0, 0.5]`, so a contradicted memory can lose at most half its
  score. It cannot be driven to zero, it cannot change sign, and it therefore cannot be pushed
  behind every uncontradicted memory in the corpus by a single false positive. Note that
  `rankScore` returns a *negative* score for BM25 rows (more negative = better), so scaling by a
  factor in `(0.5, 1]` moves a row toward zero — i.e. toward worse — which is the intended
  direction and is asserted explicitly rather than assumed.

A contradicted memory is additionally written to `memory_conflicts` with `kind='repo_truth'`,
`memory_a = <memory id>`, `fact_id = <repo_facts.id>` and a human-readable `detail`, and is
surfaced by both `kevin_conflicts` and `kevin_audit`. `memories.contradicted_at` records when.

**`status` is never changed by this path.** Not to `stale`, not to `superseded`, not to
`archived`. A dedicated test asserts that after a full scan producing N contradictions,
`SELECT COUNT(*) FROM memories WHERE status <> 'active'` is unchanged from its pre-scan value.
(Principle 24, D7-03.)

### 5.4 `ConventionMiner` (new) — `plugin/ConventionMiner.ts`

```ts
export interface MinedConvention {
  readonly fingerprint: string;    // caller-supplied, derived from the convention statement
  readonly statement: string;      // "every new file under src/routes/ is accompanied by a test under tests/routes/"
  readonly support: number;        // distinct sessions in which the pattern held
  readonly kind: "sequence" | "co_edit";
}

export class ConventionMiner {
  constructor(store: Store, memoryService: MemoryService, projectId: string, metrics?: Metrics | null);
  mine(minSupport?: number): MinedConvention[];   // default 5 distinct sessions
  emit(conventions: MinedConvention[]): number;   // returns memories created or refreshed
}
```

Two deterministic miners. **No LLM, no network, no heuristic scoring.**

- **`sequence`** — over **successful** `tool_calls` only (`success = 1`), scoped to
  `project_id`, ordered by `ts`, grouped by `session_id`. Find 2-grams and 3-grams of
  `(tool, normalized first argument path segment)` occurring in at least `minSupport` **distinct
  sessions**. This deliberately reuses the existing `PatternMiner` n-gram approach — same
  grouping, same distinct-session counting, same default threshold — but over successes, and
  with a rule output instead of a traffic description.

- **`co_edit`** — file pairs edited or written in the same session, in at least `minSupport`
  distinct sessions, **where the pair spans two different directory prefixes**. The
  different-prefix requirement is what makes the output a convention rather than a truism: two
  files in the same directory being edited together says nothing; `src/routes/user.ts` and
  `tests/routes/user.test.ts` being edited together in six separate sessions is the project's
  testing convention, stated by its own history. This is the miner that produces "route files
  come with route tests".

**Emission.** `type='rule'`, `origin='pattern'`, `inferable=0`, `scope='project'`,
`projectId = <the current project>`, `fingerprint` derived from the **normalized statement
text** — so it is caller-supplied and therefore legitimately comparable under Principle 26
(D7-11). Because `type='rule'`, the existing `save()` supersede path applies on a fingerprint
collision, which gives idempotent refresh for free.

**Do not add a new `origin` value.** `memories.origin` carries a CHECK constraint
(`'reflector','agent','pattern','retrospective','causal','imported'`), and SQLite cannot alter a
CHECK constraint — widening it forces a full `memories` table rebuild with FTS5 trigger
drop/recreate, exactly as migration 004 had to do. That is an unacceptable risk to take for a
label. `pattern` already carries the right meaning: *derived by a deterministic miner from
observed behaviour*. It also already carries the right ranking weight, `ORIGIN_BOOST_PATTERN =
1.5`, sitting between agent-authored and reflector-authored content. (D7-09.)

**When it runs.** On `session.idle` only, behind `convention_mining_enabled` (default `'0'`),
never on the hot path (D7-10). Mined rules flow into the v0.6.0 `Curator` as ordinary
candidates — no special path, no privileged status, the same human approval gate as every other
proposal. The `Curator` additionally de-duplicates against the *whole* of `AGENTS.md`, not just
the region between Kevin's markers (§4).

### 5.5 `ConflictDetector` (new) — `plugin/ConflictDetector.ts`

```ts
export type ConflictKind = "repo_truth" | "decision_pair" | "temporal";

export interface Conflict {
  readonly id: string;
  readonly kind: ConflictKind;
  readonly memoryA: string;
  readonly memoryB?: string;
  readonly factId?: string;
  readonly detail: string;
}

export class ConflictDetector {
  constructor(store: Store, projectId: string, metrics?: Metrics | null);
  detect(): Conflict[];        // never mutates memories.status
  acknowledge(id: string): void;
  resolve(id: string, keepMemoryId: string): void;   // HUMAN-INITIATED ONLY, via kevin_conflicts
}
```

Three detectors, three completely different evidence bases:

- **`repo_truth`** — produced by `RepoTruth.contradictions()`. Exact-match, one memory, one
  fact. Recorded with `fact_id` set.

- **`decision_pair`** — two `active` memories of type `decision` or `rule`, same `project_id`,
  whose **caller-supplied fingerprints differ** but whose normalized statements contain a
  negation pair drawn from an **explicit, small, tested lexicon**:

  | Positive token | Negative token |
  |---|---|
  | `use` | `do not use` / `don't use` / `never use` |
  | `always` | `never` |
  | `required` | `forbidden` / `not required` |
  | `enable` | `disable` |
  | `prefer` | `avoid` |

  Matching is **exact-token based over the normalized statement**, not fuzzy similarity, not
  edit distance, not fingerprint prefixes (Principle 26, D7-07). Both statements must share at
  least one non-stop-word subject token in addition to carrying opposite polarity, otherwise
  "always run the tests" and "never use `any`" would pair.

- **`temporal`** — a single memory whose `kevin_injections` rows contain at least one
  `effective` outcome and at least one `ineffective` outcome, with the `ineffective` more
  recent. Pure SQL over `injected_at` and `outcome`, both of which already exist and are already
  indexed (`idx_injections_outcome`). No new write path, no new column, no heuristic (D7-08).
  Semantically: *this memory used to work and has stopped working* — the highest-value
  contradiction signal Kevin can compute today, and the one that most often means the repository
  moved underneath it.

**`resolve()` is reachable only from the `kevin_conflicts` tool, with an explicit `keep`
argument.** Nothing on `session.idle` may call it. Nothing in `detect()` may call it. A test
asserts that a full `session.idle` cycle executed against a database with 5 open conflicts
leaves all 5 rows at `status='open'`, and leaves
`SELECT COUNT(*) FROM memories WHERE status <> 'active'` unchanged. (D7-06.)

`acknowledge()` is the middle state: it moves a conflict to `acknowledged` so it stops appearing
in the default `kevin_conflicts` list, without expressing any opinion about which memory is
right and without touching either memory.

### 5.6 Reflector rebalance

New setting **`error_lesson_mode`**, a TEXT enum with two values:

| Value | Behaviour |
|---|---|
| `'all'` (default) | v0.6.0 behaviour preserved exactly. Every error produces a lesson, subject to the existing throttle and quality gate. |
| `'triage_only'` | When `inferability.classify()` returns `inferable`, the Reflector records the `tool_call` and stamps the fingerprint via `onLinkError` — but does **not** create a memory. `error_lessons_suppressed` increments. |

The setting is TEXT and is compared with `=== "triage_only"`, **never with a truthiness check**.
`"0"`, `"all"` and `"false"` are all truthy strings in JavaScript; a truthiness read would put
every installation into triage mode on upgrade. This is the same class of defect that made
`cross_project_enabled` unreachable for an entire minor release, inverted.

What `triage_only` deliberately keeps working: the `tool_calls` row, the `error_fingerprint`
stamp, recurrence detection, `CausalChain.onSuccess` linkage, `kevin_why`'s ledger, and the
`metadata.dispatch` classification. **Only the memory row is suppressed** (D7-12). Triage
without lesson generation is precisely the role roadmap §5.3 assigns to the dispatch table.

`kevin_audit` gains a **`mix` block**: injected memories by type, the non-error share as a
percentage, and `precision_rate` split by `error` versus non-`error`. This block is how the
release's exit criterion is checked, so it must be computed by **pure SQL** and be reproducible
by anyone holding the database file (D7-14):

```jsonc
"mix": {
  "injected_by_type":   { "error": 0, "rule": 0, "decision": 0, "pattern": 0, "solution": 0, "context": 0 },
  "injected_total":     0,
  "non_error_injected": 0,
  "non_error_share":    0.0,
  "precision_error":     0.0,
  "precision_non_error": 0.0,
  "meets_exit_criterion": false
}
```

`meets_exit_criterion` is `true` only when `non_error_share >= 0.5` **and**
`precision_non_error > precision_error` **and** the maturity floor (≥100 memories, ≥50 settled
injections) is met. Below the floor it is `false` with an explicit `"reason": "immature_db"`.

### 5.7 `kevin_facts` and `kevin_conflicts` (new tools)

```
kevin_facts({ refresh?: boolean })
  → { project_id, scanned_at, truncated, facts: [{ file, key_path, value }],
      penalized: [{ id, type, truth_penalty, contradicted_at, reasons: [] }] }

kevin_conflicts({ action: "list" | "acknowledge" | "resolve", id?, keep? })
  → list:        { open, acknowledged, resolved, conflicts: [{ id, kind, memory_a, memory_b, fact_id, detail, status, detected_at }] }
  → acknowledge: { id, status: "acknowledged" }
  → resolve:     { id, status: "resolved", kept: <keep>, other: <the other memory id or null> }
```

`refresh: true` on `kevin_facts` forces a re-scan, bypassing the `mtime` skip — the escape hatch
for a user who has just edited `package.json` mid-session. `refresh: false` (the default) reads
the stored facts.

`kevin_conflicts` is the **sole** path to resolution. `resolve` requires both `id` and `keep`,
rejects a `keep` that is not one of the conflict's own memories, and is the only caller of
`ConflictDetector.resolve()` in the codebase.

Both tools are read-mostly, involve no LLM call, no network, and no hot-path cost.

---

## 6. Schema delta — `migrations/008_v07_truth.sql`

```sql
-- ============================================================
-- Kevin 0.7.0 — Migration 008: Project Truth (additive)
-- ============================================================
-- Backward-compatible, additive only. Two new tables, two new
-- nullable/defaulted columns on `memories`, one index, five
-- metric seeds, four setting seeds. NO table rebuild: nothing
-- here widens a CHECK constraint on an existing table.
--
-- Section 1: repo_facts — the ground-truth store.
-- Section 2: memory_conflicts — surfaced, never auto-resolved.
-- Section 3: memories truth columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: schema_version.
-- ============================================================

-- ------------------------------------------------------------
-- 1. repo_facts — facts extracted from package.json and
--    tsconfig.json. Both are JSON, parsed with JSON.parse; this
--    release adds NO parser and NO runtime dependency.
--
--    The UNIQUE index INCLUDES project_id and that is load-
--    bearing (D7-02). Kevin's DB is global
--    (~/.opencode-kevin/kevin.db, projectId =
--    fingerprint(process.cwd())). Without project_id, project A's
--    packageManager=npm would overwrite project B's
--    packageManager=pnpm and contradictions() would then flag A's
--    memories against B's repository.
--
--    source_mtime lets scan() skip re-parsing an unchanged file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repo_facts (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  file         TEXT NOT NULL,
  key_path     TEXT NOT NULL,
  value        TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  source_mtime TEXT,
  scanned_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_facts    ON repo_facts(project_id, file, key_path);
CREATE INDEX        IF NOT EXISTS idx_repo_facts_fp ON repo_facts(fingerprint);

-- ------------------------------------------------------------
-- 2. memory_conflicts — detection only. status moves
--    open → acknowledged → resolved, and ONLY the kevin_conflicts
--    tool may move it to 'resolved' (D7-06). No session.idle path
--    writes 'resolved'.
--
--    memory_a / memory_b / fact_id carry NO REFERENCES clause on
--    purpose: Store sets PRAGMA foreign_keys = ON, and a hard FK
--    would block deleting a memory that participates in a
--    conflict.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  memory_a    TEXT NOT NULL,
  memory_b    TEXT,
  fact_id     TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('repo_truth','decision_pair','temporal')),
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conflicts_status ON memory_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_memory ON memory_conflicts(memory_a);

-- ------------------------------------------------------------
-- 3. memories: the de-ranking column and its timestamp.
--
--    truth_penalty is clamped by application code to [0, 0.5] and
--    multiplies rankScore as (1 - truth_penalty), AFTER the
--    existing BM25 × origin_boost × recency_decay chain. At 0.0
--    the v0.6.0 ranking is reproduced exactly (D7-04).
--
--    There is deliberately no status transition here. Contra-
--    diction de-ranks; it never deletes (Principle 24, D7-03).
-- ------------------------------------------------------------
ALTER TABLE memories ADD COLUMN truth_penalty   REAL NOT NULL DEFAULT 0.0;
ALTER TABLE memories ADD COLUMN contradicted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_truth_penalty ON memories(truth_penalty);

-- ------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS
--    in metrics.ts (28 → 33).
-- ------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('repo_facts_scanned',       0),
  ('memories_contradicted',    0),
  ('conventions_mined',        0),
  ('conflicts_detected',       0),
  ('error_lessons_suppressed', 0);

-- ------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an
--    explicit string comparison or an explicit Number() parse —
--    never `=== 1`, and never for truthiness.
--
--    error_lesson_mode is a TEXT ENUM ('all' | 'triage_only').
--    `if (mode)` is true for BOTH values and would put every
--    installation into triage mode on upgrade. Compare with
--    === "triage_only" (D7-12).
-- ------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('repo_truth_enabled',         '0'),
  ('convention_mining_enabled',  '0'),
  ('conflict_detection_enabled', '0'),
  ('error_lesson_mode',          'all');
```

> **Note on the defaults.** All three truth flags ship as `'0'`. The release
> principle (§6, K7-001) is that a user who upgrades and changes nothing observes
> no difference; the global database may already hold millions of memories, and
> mining/detection only ever run on `session.idle`, where "off" is the safe
> position. Opt-in is explicit and per-project (`kevin_config set ... '1'`).

-- ------------------------------------------------------------
-- 6. Version marker.
-- ------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('008');
```

**Backward compatibility.** Both `memories` columns are added with a `NOT NULL DEFAULT` or as
nullable, so every existing row remains valid and every existing query keeps working unchanged.
No CHECK constraint on an existing table is widened, so — unlike migration 004 and migration 006
— **there is no table rebuild in this release** and no FTS5 trigger churn. The two new tables are
`CREATE TABLE IF NOT EXISTS`. Both new metric keys and setting keys use `INSERT OR IGNORE`.
`Migrate.run()` wraps the whole file in a single transaction, so a partial application is
impossible.

**Idempotency comes from `schema_version`, not from the SQL.** Raw
`ALTER TABLE ... ADD COLUMN` throws `duplicate column name` on a second execution. The correct
acceptance criterion is therefore always *"applying via `Migrate.run()` twice is a no-op"*, and
never *"running the SQL file twice is a no-op"*.

**Post-apply hook `DEFAULT_POST_APPLY_HOOKS["008"]`** — belt-and-braces, and idempotent by
construction because every statement **re-derives** a value rather than incrementing it:

```sql
UPDATE memories SET truth_penalty = 0.0 WHERE truth_penalty IS NULL;
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM repo_facts)                          WHERE key = 'repo_facts_scanned';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM memory_conflicts)                    WHERE key = 'conflicts_detected';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM memories WHERE truth_penalty > 0.0)  WHERE key = 'memories_contradicted';
```

---

## 7. Decisions log (D7 series)

These IDs are cited in code comments exactly as `D5-NN` are today, e.g.
`// v0.7.0 (K7-007 / plan §5.3, D7-05)`.

| ID | Decision | Rationale |
|---|---|---|
| **D7-01** | **The scanner reads `package.json` and `tsconfig.json` only.** | Both are JSON, so extraction costs one `JSON.parse` each and **zero new parsers, zero new dependencies**. `Cargo.toml`, `pyproject.toml`, `.github/workflows/*.yml` and `Dockerfile` each demand a parser Kevin would have to buy or hand-roll. A memory plugin does not acquire a TOML dependency to read two extra files. Revisit only if measurement shows the JSON pair is insufficient. |
| **D7-02** | **`repo_facts` is uniquely keyed on `(project_id, file, key_path)`.** | The database is global (`~/.opencode-kevin/kevin.db`) and shared across every project on the machine, with `projectId = fingerprint(process.cwd())`. A unique index without `project_id` lets project A's `packageManager=npm` overwrite project B's `packageManager=pnpm`, after which `contradictions()` evaluates A's memories against B's repository. The failure is intermittent, silent, and presents as "Kevin randomly de-ranks correct memories". |
| **D7-03** | **Contradiction produces a bounded `truth_penalty` in `[0, 0.5]` and a conflict row. It never changes `status`.** | Retrieval filters `status='active'`. Any `status` write from a heuristic is an undoable deletion from every future prompt, with no notification. A score penalty is reversible, visible in `kevin_facts`, and recoverable by re-scanning. Principle 24. |
| **D7-04** | **`truth_penalty` participates in ranking as `(1 - truth_penalty)`, applied after the existing chain.** | Multiplying last, by a factor that is exactly `1.0` at the default, means the v0.6.0 ranking is reproduced bit-for-bit whenever nothing is contradicted. A ranking change and a semantics change must not be entangled; only one of them is being shipped here. |
| **D7-05** | **Contradiction detection is exact-match only.** | Substring similarity has neither destructive nor de-ranking authority in this release. The three checks are over extracted, exact tokens: a script name absent from `scripts`, a package name absent from the dependency maps, a `compilerOptions` key whose literal value differs. A memory that merely mentions a word appearing in a fact is not a contradiction. |
| **D7-06** | **Conflict resolution is human-initiated only, reachable solely from `kevin_conflicts` with an explicit `keep`.** | No `session.idle` path may call `resolve()`. This is the same reasoning that rejected auto-resolution in v0.5.0 §4 and that roadmap §7 lists as a permanent non-goal: a destructive heuristic with no undo is worse than an unresolved conflict a human can see. |
| **D7-07** | **`decision_pair` detection uses an explicit negation lexicon over normalized tokens.** | Never fuzzy similarity, never fingerprint prefixes. The lexicon is small, listed in §5.5, and each entry is covered by a test. An FNV-1a prefix carries zero semantic information (Principle 26); edit distance would pair "always run tests" with "always run test" and miss "use pnpm" versus "never use pnpm". |
| **D7-08** | **Temporal conflict is computed purely from `kevin_injections.outcome` and `injected_at`.** | Both columns already exist, are already populated by `InjectionLedger`, and are already indexed. No new write path, no new column, no heuristic — the strongest available signal at the lowest available cost. |
| **D7-09** | **Mined conventions are emitted as `type='rule'`, `origin='pattern'`. `origin` is not widened.** | `memories.origin` carries a CHECK constraint, and SQLite cannot alter one — widening it forces a full table rebuild with FTS5 trigger drop/recreate, as migration 004 had to do. That is an unacceptable risk for a label. `pattern` already means "derived deterministically from observed behaviour" and already carries `ORIGIN_BOOST_PATTERN = 1.5`. |
| **D7-10** | **Convention mining runs only on `session.idle`, behind a default-off flag, with a minimum support of 5 distinct sessions.** | It scans the whole of `tool_calls` for the project; that is not hot-path work. Default-off matches the precedent set by `PatternMiner`, and 5 distinct sessions is the same threshold, which makes the two miners' output directly comparable during evaluation. |
| **D7-11** | **Convention fingerprints are derived from the normalized statement.** | This makes them caller-supplied in exactly the sense Principle 26 requires, so a mined rule is legitimately comparable with a human-authored `decision`, participates in the existing `save()` supersede path, and gets idempotent refresh for free. |
| **D7-12** | **`error_lesson_mode='triage_only'` suppresses lesson creation for inferable errors but still records the tool call and the fingerprint.** | Recurrence detection, `CausalChain` linkage, `kevin_why` and the injection ledger all key on `tool_calls` and `error_fingerprint`, not on the memory row. Suppressing the memory removes the prompt cost without breaking a single downstream measurement. The setting is TEXT and must be compared with `=== "triage_only"`. |
| **D7-13** | **The scan is bounded — 500 facts, under 50 ms, `mtime`-skipped — and never runs on the hot path.** | It runs once per plugin init and at most once per session. The 500-fact cap is enforced with a recorded truncation row rather than a silent stop, because a silently dropped fact turns into a false contradiction for every memory that mentions it. |
| **D7-14** | **The release's exit criterion is computed by `kevin_audit`'s `mix` block in pure SQL.** | Anyone holding the database file can reproduce the number without running the plugin. A criterion that can only be checked by the system it judges is not a criterion. |

---

## 8. Changes per file

### 8.1 `migrations/008_v07_truth.sql` (new)

Full content in §6.

### 8.2 `plugin/Migrate.ts`

- Add a `"008"` entry to `DEFAULT_POST_APPLY_HOOKS` with the four re-derivation statements
  from §6, following the shape of the existing `"003"` … `"006"` entries.

### 8.3 `plugin/metrics.ts`

- Append 5 keys to `METRIC_KEYS`, in the same order the migration seeds them:
  `repo_facts_scanned`, `memories_contradicted`, `conventions_mined`, `conflicts_detected`,
  `error_lessons_suppressed`. Total goes from 28 to **33**.
- No change to `precisionRate()` or `coverageRate()`. The per-type split of §5.6 lives in
  `kevin_audit` as SQL, not as a `Metrics` method, because it is a partition of the ledger and
  not a counter.

### 8.4 `plugin/RepoTruth.ts` (new)

See §5.1 and §5.2.

### 8.5 `plugin/ConventionMiner.ts` (new)

See §5.4.

### 8.6 `plugin/ConflictDetector.ts` (new)

See §5.5.

### 8.7 `plugin/MemoryService.ts`

- `mapRow()` reads `truth_penalty` and `contradicted_at`, exposing them on `Memory` as
  `truthPenalty: number` and `contradictedAt: string | null`.
- `rankScore()` gains the trailing `* (1 - (mem.truthPenalty ?? 0))` factor (§5.3).
- Add `applyTruthPenalty(memoryId, penalty, reason): void` — clamps to `[0, 0.5]`, writes
  `truth_penalty` and `contradicted_at`, increments `memories_contradicted` when the value moves
  from `0` to non-zero, and **never** writes `status`.

### 8.8 `plugin/Reflector.ts`

- Read `error_lesson_mode` once per reflection with an explicit
  `=== "triage_only"` comparison.
- In `triage_only`, when `inferability.classify()` returns `inferable`: record the `tool_call`,
  fire `onLinkError` to stamp `error_fingerprint`, increment `error_lessons_suppressed`, and
  return without calling `memoryService.save()`.

### 8.9 `plugin/kevin_audit.ts`

- Add three blocks: `truth` (facts scanned, penalized memory count, truncation flag),
  `conflicts` (counts by `kind` and by `status`), and `mix` (§5.6). All pure SQL.
- Keep the existing `try`/`catch` degradation with `"partial": true` for pre-008 databases.

### 8.10 `plugin/index.ts`

- Register `kevin_facts` and `kevin_conflicts` (16 → 18 tools).
- Append `repo_truth_enabled`, `convention_mining_enabled`, `conflict_detection_enabled`,
  `error_lesson_mode` to `KEVIN_CONFIG_KEYS`. **Omitting this makes `kevin_config set` return
  `{ error: "unknown_key" }` while `kevin_config list` still shows the key — a bug that ships
  green.**
- Instantiate `RepoTruth`, `ConventionMiner`, `ConflictDetector`, each with `projectId`.
- At plugin init, after `Migrate.run()`: one `repoTruth.scan()` when `repo_truth_enabled === "1"`,
  inside its own `try`/`catch`.
- On `session.idle`, appended after the existing chain, each in its own `try`/`catch`:
  `conventionMiner.mine()` + `emit()` (when enabled) → `conflictDetector.detect()` (when
  enabled). Neither may call `resolve()`.

### 8.11 `scripts/verify-install.ts`

- Add `008_v07_truth.sql` to the hard-coded migration list. Without this, `npm run verify`
  silently never exercises migration 008.

---

## 9. Tasks (K7-001 … K7-024)

Full stanzas, acceptance criteria and verification commands are in
`docs/Kevin_v0.7.0_Task.md`. Summary:

| Phase | IDs | Content |
|---|---|---|
| **F0 Substrate** | K7-001 … K7-004 | Migration 008, post-apply hook, config keys + verify script, metric keys |
| **F1 Repository truth** | K7-005 … K7-009 | `RepoTruth` scanner, project-scoped storage + `mtime` skip, exact contradiction, `truth_penalty` in ranking, `kevin_facts` |
| **F2 Convention mining** | K7-010 … K7-013 | Sequence miner, co-edit miner, rule emission, `Curator` hand-off |
| **F3 Conflict surfacing** | K7-014 … K7-016 | `ConflictDetector`, `kevin_conflicts` + audit block, never-auto-resolve guard |
| **F4 Reflector rebalance** | K7-017 … K7-020 | `error_lesson_mode`, suppression counter, `mix` block, per-type `precision_rate` split |
| **F5 Release** | K7-021 … K7-024 | `kevin_status` + docs, closed-loop e2e, exit-criterion measurement, final verification |

**Phase totals:** F0 4 · F1 5 · F2 4 · F3 3 · F4 4 · F5 4 — **24 total**.

**Critical path:** K7-001 → K7-005 → K7-007 → K7-008 → K7-017 → K7-019 → K7-022 → K7-024.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| `Cargo.toml` / `pyproject.toml` scanning | Requires a TOML parser and therefore a runtime dependency | Post-v1.0, only if measurement shows the JSON pair is insufficient |
| `.github/workflows/*.yml` scanning | Requires a YAML parser; a hand-rolled subset fails silently on anchors and block scalars | Post-v1.0, if measured |
| `Dockerfile` scanning | Requires a bespoke parser for a format with no formal grammar | Post-v1.0, if measured |
| Conflict auto-resolution | Destructive heuristic with no undo; retrieval filters `status='active'`, so a false positive is a silent deletion | **Never** |
| Fingerprint-prefix clustering / similarity | A hash prefix carries zero semantic information (Principle 26) | **Never** |
| LLM-judged contradiction | Cost, latency, non-determinism, and a hot-path violation Kevin has correctly avoided since v0.2.0 | **Never on the hot path** |
| Repo-local shared knowledge, OKF v2, two-layer store | A different thesis (team scope) that must not be entangled with a truth-validation change | v0.8.0 |
| v2 `define()` / domain API, TUI conflict panel | Platform migration; conflict surfacing needs a UI, but not in this release | v0.9.0 |
| Frozen API, published benchmark, performance SLOs | Promises require measurement first | v1.0.0 |
| Embeddings / vector search | The binding constraint remains query derivation, not ranking | Post-v1.0 if measured |
| Any new runtime dependency | Runtime deps stay `@opencode-ai/plugin` + `zod`, with `better-sqlite3` optional | — |

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
2. A scan of a fixture project produces facts keyed by `project_id`, and a **second** fixture
   project whose `package.json` declares a conflicting `packageManager` does **not** overwrite
   the first project's rows. Both projects' facts coexist and each `contradictions()` call sees
   only its own.
3. A full `session.idle` cycle executed against a database holding 5 `open` conflicts leaves all
   5 rows `open`, and leaves `SELECT COUNT(*) FROM memories WHERE status <> 'active'` unchanged.
4. `rankScore` with `truth_penalty = 0` reproduces the v0.6.0 ordering **exactly** on a fixed
   fixture — asserted as an id-sequence equality against a golden array, not as a spot check.
5. `error_lesson_mode='triage_only'` suppresses lesson creation for a `TS2304` failure while
   still writing the `tool_calls` row, still stamping `error_fingerprint`, and incrementing
   `error_lessons_suppressed` by exactly 1.
6. `kevin_config set` succeeds for all four new keys, and each value is readable back through
   `kevin_config list`.

---

## 12. Summary of what changed from v0.6.0

| Area | v0.6.0 | v0.7.0 |
|---|---|---|
| Project files read | `AGENTS.md` only (write path) | `AGENTS.md` + `package.json` + `tsconfig.json` (read, JSON only) |
| Ground truth | none — every belief derived from tool output | `repo_facts`, scanned, project-scoped, `mtime`-skipped |
| Contradiction | invisible | `truth_penalty ∈ [0, 0.5]`, exact-match, de-ranks only |
| Ranking | `BM25 × origin_boost × recency_decay` | `… × (1 - truth_penalty)`, identical at the default |
| Conflicts between memories | only detected on exact fingerprint collision | 3 detectors, `memory_conflicts` table, surfaced never resolved |
| Conflict resolution | n/a | human-only, via `kevin_conflicts` with an explicit `keep` |
| Convention mining | `PatternMiner`, off, mines failure shapes, no curation path | `ConventionMiner`, off, mines successes and co-edits, emits `rule` into `Curator` |
| Error lessons | always created | `error_lesson_mode` — `all` (default) or `triage_only` |
| Centre-of-gravity measurement | none | `kevin_audit.mix` — non-error share and per-type `precision_rate` |
| Metric keys | 28 | **33** |
| Setting keys | 14 | **18** |
| Tools | 16 | **18** |
| Migration | `007` | `008_v07_truth.sql` (additive, no rebuild) |
| Runtime dependencies | `@opencode-ai/plugin`, `zod`, optional `better-sqlite3` | **unchanged — zero added** |

---

## 13. References

- `docs/Kevin_Roadmap.md` — §1.4 (inferable vs non-inferable, the argument this release
  implements), §3 (the ecosystem trend), §4 (the version ladder), §5.3 (this release's scope and
  exit criterion), §6 (kill criteria K1/K2, which the `mix` block finally makes checkable),
  §7 (permanent non-goals: auto-resolution, embeddings, a second always-on LLM).
- `docs/Kevin_v0.5.0_Plan.md` — the honest measurement instruments (`precision_rate`,
  `coverage_rate`, four outcomes) this release depends on, and the document conventions followed
  here.
- `migrations/004_v03_knowledge.sql` — the `tool_calls.error_fingerprint` bridge and its comment,
  the primary source for §3.3; also the table-rebuild precedent §6 deliberately avoids.
- `migrations/005_v04_signal.sql` — the banner and section style §6 follows.
- `plugin/PatternMiner.ts` — the n-gram approach `ConventionMiner` reuses, and the flag-rot
  precedent §3.4 documents.
- `plugin/fingerprint.ts` — FNV-1a-64 with `project_id` salting; the reason Principle 26 exists.
- `plugin/MemoryService.ts` — `rankScore()`, `originBoost()`, `countSupersedeCandidates()`.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 Substrate | K7-001 … K7-004 | `[X]` Complete |
| F1 Repository truth | K7-005 … K7-009 | `[X]` Complete |
| F2 Convention mining | K7-010 … K7-013 | `[X]` Complete |
| F3 Conflict surfacing | K7-014 … K7-016 | `[X]` Complete |
| F4 Reflector rebalance | K7-017 … K7-020 | `[X]` Complete |
| F5 Release | K7-021 … K7-024 | `[X]` Complete |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

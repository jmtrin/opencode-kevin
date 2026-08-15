# Opencode-kevin — Implementation Plan v0.6.0

**Version:** 0.6.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → Learn → Prove → **Publish**
**Codename:** "Pull"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.5.0 — 28 modules. Every defect and every constraint cited below carries a `file.ts` reference.
- `plugin/ContextInjector.ts` — `deriveQuery()` (line 390) and `onSystemTransform()` (line 414): the per-prompt tax this release demotes.
- `plugin/memory-format.ts` — `escapeInjectedText()` (line 11): the escaping discipline that must now extend to generated files.
- `plugin/index.ts` — `dbPath` resolution (line 56) and `KEVIN_CONFIG_KEYS` (line 40): the private-database assumption this release breaks out of.
- `plugin/Reflector.ts` — `TS_CODE_RULES` (line 107), `SYSCALL_RE` (121), `RUST_CODE_RE` (123), `COMMAND_NOT_FOUND_RE` (126): the self-describing-diagnostic surface that defines `inferable`.
- `migrations/005_v04_signal.sql` — the additive-migration house style followed verbatim in §6.
- `scripts/verify-install.ts` — lines 62–79 hard-code the migration filenames; §8 adds one.
- `docs/Kevin_v0.5.0_Plan.md`, `docs/Kevin_v0.5.0_Task.md` — the D5 decisions log and the measurement instruments this release is judged by.
- `docs/Kevin_Roadmap.md` — §1.3 findings 4, 5 and 6; §3 ecosystem table; §5.2 (this release); §6 kill criteria K1 and K4.
- `@opencode-ai/plugin@1.17.10` type definitions — the v2 `skill` and `reference` domains, probed but not depended upon. Kevin's pin stays `^1.17.6`.

---

## 1. Executive Summary

> v0.5.0 gave Kevin an honest instrument. v0.6.0 reads that instrument and draws the obvious
> conclusion: a channel that charges on every prompt must justify itself against channels that
> charge nothing. The private database stops being the product and becomes a staging area for
> artifacts a human approves and git tracks.

| Dimension | Value |
|---|---|
| Release theme | Distribution — curated artifacts instead of a per-prompt token tax |
| Version | 0.5.0 → 0.6.0 |
| New files | `plugin/ArtifactWriter.ts`, `plugin/diff.ts`, `plugin/inferability.ts`, `plugin/Curator.ts`, `plugin/Materializer.ts`, `plugin/capabilities.ts`, `migrations/007_v06_pull.sql` |
| New migration | `007_v06_pull.sql` — **additive only; no table rebuild** |
| New tools | `kevin_propose`, `kevin_approve`, `kevin_publish` (13 → 16) |
| Changed tools | `kevin_audit` (+`channels`, +`curation`), `kevin_config` (5 new keys) |
| New metric keys | 6 (22 → 28) |
| New setting keys | 5 (9 → 14) |
| New runtime dependencies | **none** — runtime deps stay `@opencode-ai/plugin` + `zod`, `better-sqlite3` optional |
| Tasks | 26 (`K6-001` … `K6-026`) |
| Risk | **High** — this is the first release in which Kevin writes to a user's repository |
| Breaking | No API breaks. The default pre-prompt budget drops 900 → 400; **user overrides are preserved by a conditional `UPDATE`.** |

**Exit criterion.** **A user can run `kevin_propose`, read a unified diff, run `kevin_approve`,
and see the resulting `AGENTS.md` change in `git status` — with every byte written falling
strictly between the `kevin:begin`/`kevin:end` markers; and with the default pre-prompt budget
reduced to 400 tokens, `precision_rate` and `coverage_rate` measured over ≥50 settled injections
do not regress against the v0.5.0 baseline.**

Both halves are falsifiable and both are checked in §11. The first is a filesystem assertion
(`git status` is non-empty, and the prefix and suffix slices around the markers are
byte-identical). The second is a metric comparison against a recorded baseline, not an opinion.

---

## 2. Philosophy — "Pull"

### 2.1 Carry-over from v0.5.0

Everything from "Glass Box" stands. The four-way outcome model, `precision_rate` over
`effective + ineffective`, `coverage_rate`, the five `injections_blocked_*` counters,
`GateVerdict`, the `Feedback` component and its dedicated columns, the `Archiver`, the
decomposed `ContextInjector` with `plan()`/`trace()`, `kevin_audit`, `deterministic_retrieval`
and the replay harness — none of them is removed, weakened, or bypassed. v0.6.0 adds a second
and a third distribution channel and demotes the first. It does not touch how Kevin decides what
is true; it changes where the truth ends up.

Two v0.5 mechanisms are load-bearing here in a way they were not in their own release:

- `feedback_positive` becomes a **selection criterion** for curation, not just a confidence term.
  A human saying "useful" is the cheapest possible approval signal, and this release spends it.
- `injections_blocked_*` gains a sixth counter. Principle 16 — *a rejection you did not count did
  not happen* — is not renegotiated because the new gate branch is convenient.

### 2.2 The v0.6 addition

```
v0.5.0 — ONE channel, and it is always on

  memories ──► getCandidates ──► evaluateGate ──► buildBlock ──► <kevin-context>
                                                                        │
                                                                        ▼
                                                                  EVERY PROMPT
                                                                        │
        900 tokens × every prompt, forever ──────────────────────────────┤
        paid whether or not a candidate was relevant ────────────────────┤
        never leaves ~/.opencode-kevin/kevin.db ────────────────────────┤
        dies with the laptop ───────────────────────────────────────────┘


v0.6.0 — THREE channels; two of them cost nothing when unused

  memories ──► inferability.classify() ──► Curator.candidates()
                                                  │
                                                  ▼
                                        curation_proposals (pending)
                                                  │
                                            ┌─────┴─────┐
                                            │  HUMAN    │   kevin_approve / reject
                                            └─────┬─────┘
                                                  │ approved
                                                  ▼
                                        ArtifactWriter.apply()          ← the ONLY write path
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    ▼                             ▼                             ▼
              AGENTS.md                  refs/<topic>.md            skills/project-knowledge.md
        git-tracked, PR-reviewed,     @kevin/<topic> mention       pulled by the model on demand
        read by every agent            (ReferenceDraft.add)          (SkillDraft.source)
                    │                             │                             │
                    └──────────── PULL ───────────┴──────────── PULL ───────────┘
                                  cost when unused: 0 tokens

  memories ──► getCandidates ──► evaluateGate ──► buildBlock ──► <kevin-context> ──► prompt
                                       ▲                                                │
                     NEW: confidence < injection_confidence_floor                        │
                          → "low_confidence" → injections_blocked_confidence             │
                                                                                         ▼
                                        ≤ 400 tokens — a RESIDUAL channel that must now
                                        earn its budget against two free competitors.
                                        `0` is a supported, fully-tested configuration.
```

### 2.3 Principles specific to v0.6 (global numbering continues from v0.5's 15–18)

| # | Principle | Implication |
|---|---|---|
| **19** | **An artifact a human approved and git tracks outranks anything in a private database.** | The curated `AGENTS.md` block is the primary output of the system. `~/.opencode-kevin/kevin.db` is demoted to a staging area: a place where candidate knowledge accumulates evidence until it is good enough to be proposed. Nothing in the DB is a deliverable. |
| **20** | **Never write a byte outside the markers.** | Every write is a marker-scoped splice of an existing file. It is atomic (temp file + `fsync` + `rename`), it is hash-audited into `artifact_writes`, and when the markers are malformed it **refuses rather than guesses**. The prefix and suffix slices are asserted byte-identical by test, not by inspection. |
| **21** | **A channel that costs nothing when unused beats a channel that costs on every prompt.** | Skills and References are preferred by construction. Push injection is not deleted — it is demoted to a residual channel that must justify its budget with a measured `coverage_rate`. If K1 from the roadmap fires (`coverage_rate < 0.10`), the correct response is already a supported configuration: `pre_prompt_budget_tokens = 0`. |
| **22** | **Publishing is a proposal, not an action.** | Generation and application are two different tools with a persisted `curation_proposals` row and an explicit human decision between them. There is no "trusted mode", no auto-approve, and no configuration that collapses the two steps. The approval gate is the entire safety model; a flag that disables it would be a flag that disables the release. |

---

## 3. The evidence base — what v0.5.0 leaves unsolved

v0.5.0 was a measurement release. It changed no distribution decision, and it was right not to.
The five findings below are all still true of a fully-implemented v0.5.0 installation, and all
five are checkable in the repository as it stands.

### 3.1 Everything Kevin knows dies with the machine

`plugin/index.ts:56`:

```ts
const dbPath = opts.dbPath ?? join(homedir(), ".opencode-kevin", "kevin.db");
```

One file, one laptop, one developer. `kevin_export` / `kevin_import` (OKF, added in v0.3.0) do
exist, but they are **manual, human-initiated and non-mergeable**: a full-document dump that a
second developer can import but cannot reconcile. There is no three-way merge, no stable
ordering guarantee across exports, and no way for two installations to converge.

More pointedly: **there is no code path in `plugin/` that writes to the user's project directory
at all.** Grep the module list — `Store`, `Migrate`, `MemoryService`, `ToolCallObserver`,
`Reflector`, `ContextInjector`, `Retrospective`, `InjectionLedger`, `CausalChain`,
`PatternMiner`, `QualityGate`, `Feedback`, `Archiver`, `okf-export` — the only filesystem writes
are the SQLite file under `homedir()` and the retrospective markdown under the configured
retrospectives directory. Kevin has spent five releases learning things and has never once
produced an artifact a colleague could read.

### 3.2 The only distribution channel is push

`ContextInjector.onSystemTransform` (line 414) spends a fixed token budget on **every prompt**,
against a query produced by `deriveQuery` (line 390):

```ts
const tokens = lastUserContent
  .toLowerCase()
  .split(/\s+/)
  .map(/* strip non-word characters */)
  .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
return tokens.join(" ");
```

Lowercase the last user message, strip non-word characters, drop stop-words. That is the entire
retrieval signal. Everything downstream of it — FTS5 bm25 ranking, the origin boost ladder
(`ORIGIN_BOOST_REFLECTOR = 2` … `ORIGIN_BOOST_AGENT = 1`, `MemoryService.ts:211`), recency decay,
the two-sided confidence model, the quality gate, the injection ledger — is sophisticated
machinery bolted to the weakest signal in the pipeline. v0.5.0 made the cost of that machinery
visible. It did not make the signal better, and no amount of ranking work can, because the
binding constraint is the question, not the answer.

A pull channel sidesteps the problem entirely: the model asks for the Skill when the model
decides it is relevant, using its own full context rather than a de-stop-worded fragment of the
last user turn.

### 3.3 The free incumbent wins on every axis Kevin loses on

| Property | `AGENTS.md` | `~/.opencode-kevin/kevin.db` |
|---|---|---|
| Version controlled | yes | no |
| Reviewed in PRs | yes | no |
| Shared with the team | yes | no |
| Read by other agents in the ecosystem | yes, already | no |
| Survives a laptop reimage | yes | no |
| Costs tokens when not relevant | no (the host loads it once) | yes, 900 per prompt |
| Inspectable by a human without a tool call | yes | no |

Kevin currently competes with a free incumbent that beats it on distribution, durability and
trust. The only winning move — stated in `docs/Kevin_Roadmap.md` §1.3 finding 5 — is to become a
**producer of curated `AGENTS.md` content** rather than an alternative to it.

### 3.4 Kevin cannot tell inferable from non-inferable knowledge

The deterministic dispatch table in `plugin/Reflector.ts` targets `TS2304`, `TS2322`, `TS2307`,
`TS2339`, `TS2305`, `TS2552`, `TS2740`, `TS18047`, `TS6133` (`TS_CODE_RULES`, line 107),
`EADDRINUSE`/`ENOENT`/`EACCES`/`EPERM` (`SYSCALL_RE`, line 121), `E0433`/`E0432`
(`RUST_CODE_RE`, line 123) and `command not found` (`COMMAND_NOT_FOUND_RE`, line 126).

Every one of these is a **self-describing diagnostic**. The compiler already emits the fix in the
same output Kevin is reading. A frontier model resolves them on the first retry, for free,
one second later. Kevin is spending prompt budget to tell a model something the model's own tool
output tells it better.

The `decision`, `rule` and `solution` types exist and have existed since v0.1.0 — but roughly
**90% of the machinery points at `error`**: the Reflector, the dispatch table, the fingerprints,
the causal chain, `LessonFixer`, `PatternMiner`, and the quality gate's strength classification.
Nothing in the codebase can currently answer "is this worth a human's attention, or would the
model have worked it out anyway?" That question has to be answerable before a curation gate can
be built, because a curated `AGENTS.md` full of "TS2304 usually means a missing import" is worse
than no curation at all — it wastes a human's review budget and pollutes a shared artifact.

### 3.5 `escapeInjectedText` exists but only guards one path

`plugin/memory-format.ts:11`:

```ts
export function escapeInjectedText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

This function was added in v0.1.5, after PR #1 fixed a real prompt-injection escape: a memory
whose content contained `</kevin-context>` closed the wrapper early, and everything after it was
injected into the model as **raw system prompt**. The content source is attacker-influenced by
construction — memories are derived from `stderr` and `stdout` of arbitrary commands, including
commands that fetch remote content.

Generated *files* are a second path with exactly the same attacker-influenced content source, and
it is currently unguarded because it does not yet exist. An `AGENTS.md` block is read by every
agent in the ecosystem, on every session, with no wrapper to close and no gate to pass. A memory
containing a literal `<!-- kevin:end -->` line would let subsequent content escape the curated
region on the *next* regeneration — a marker-injection variant of the same defect. §5.1 rule 9
closes it before it can be opened.

### 3.6 What a v0.5.0 installation still cannot do

| Question | Answerable today? |
|---|---|
| Can a teammate see what Kevin learned? | No — the DB is one file on one laptop, and OKF export is manual and non-mergeable. |
| Can Kevin write a line into my `AGENTS.md`? | No — there is no code path in `plugin/` that writes to the project directory at all. |
| Can Kevin tell me which of its memories are worth a human's review? | No — there is no inferability signal; `confidence` measures evidence, not value. |
| Is the pull channel better than the push channel? | No — there is no pull channel, so there is nothing to compare. |
| What did Kevin write to disk, and when, and what was there before? | No — nothing is written, so nothing is audited. |
| Can I inspect a proposed change before it happens? | Partially — `kevin_trace` explains an *injection*, not a *write*. |
| Does the escaping discipline cover generated files? | No — `escapeInjectedText` guards the injected block only. |
| Can I turn the per-prompt tax off entirely? | No — the budget clamps to `[100, 4000]`; `0` is not reachable. |

---

## 4. Ecosystem review

Findings from `@opencode-ai/plugin@1.17.10`. Kevin pins `^1.17.6` and **this release does not
move the pin** (D6-13). Every adoption below is behind a runtime capability probe.

| Source | Proposal | Decision | Rationale |
|---|---|---|---|
| `SkillDraft.source()` (v2 `skill` domain) | Publish a `project-knowledge` Skill backed by a generated file | **Adopt, gated behind a capability probe** | A pull channel with progressive disclosure built in. The model loads it when the model decides it is relevant, using its full context rather than a de-stop-worded fragment of the last user turn. Cost when unused is exactly zero tokens — the property push injection can never have. The probe (§5.7) makes it a silent no-op on v1, so the feature cannot break an installation that does not have the domain. |
| `ReferenceDraft.add(name, source)` (v2 `reference` domain) | Register `@kevin/<topic>` mentions | **Adopt, gated** | Sources may only be `local` or `git`, which **forces** Kevin to materialize memory to a file before it can register anything. That constraint is a feature, not an obstacle: it produces an inspectable artifact on disk as a precondition of using the channel, which is precisely the artifact-first discipline §3.1 says is missing. |
| `AgentDraft.update()` | Rewrite the project's agent definition with curated rules | **Defer to v0.9.0** | Rewriting a user's agent definition is a strictly higher-trust action than writing a marker-scoped block into a file the user already edits by hand: there is no marker contract, no natural review surface, and the blast radius is every subsequent turn. It belongs with the v2 migration, where the registration/disposal lifecycle is already being rebuilt and can be tested as one thing. |
| `tool.definition` | Prepend learned hints to the `bash` tool description | **REJECT (unchanged from v0.5)** | Static per-`toolID`. No session, no query, no fingerprint. Permanent token cost for the whole session, and **structurally un-ledgerable** — there is no injection event to record, so no outcome to settle. It would be the only channel Kevin cannot measure, in a release whose thesis is that unmeasured channels lose to measured ones. |
| `experimental.chat.messages.transform` | Richer query derivation from full message history | **REJECT (unchanged)** | `input` is `{}`. There is **no `sessionID`**, and Kevin's entire injection path is keyed on it: `seenBySession`, `lastUserQueryBySession`, `ledger.record`, `ledger.settle`. Not usable without an upstream change. Re-check at v0.9.0. |
| v2 `define()` full migration | Move the whole plugin surface to domains | **Defer to v0.9.0** | v0.6.0 probes for the two domains it needs and no-ops on v1. It does **not** migrate the plugin surface. Mixing a write-to-disk release with a platform migration would mean that any incident could not be attributed to either. One risk at a time. |
| Writing to arbitrary project files (`README.md`, `.github/`, source files) | Curate into whichever file fits the knowledge | **REJECT** | One target file, one marker pair, one approval path. The blast radius of a marker-splice bug scales linearly with the number of targets, and the review burden on the user scales worse. `agents_md_path` is a single configurable path with no glob support, deliberately (D6-07). |
| Auto-approval / "trusted mode" for proposals | Let confident users skip the diff | **REJECT** | The approval gate **is** the entire safety model (Principle 22). A flag that disables it is a flag that disables the release. `docs/Kevin_Roadmap.md` §6 names writing to user repositories as the highest-consequence action in the whole roadmap; the mitigation is not optional. |

---

## 5. Architecture — additions to v0.5.0

### 5.1 `ArtifactWriter` (new) — `plugin/ArtifactWriter.ts` — the single write path to disk

```ts
export const MARKER_BEGIN = "<!-- kevin:begin — curated by opencode-kevin, safe to edit -->";
export const MARKER_END   = "<!-- kevin:end -->";

export type WriteOutcome = "written" | "noop" | "refused";

export interface WritePlan {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly diff: string;
  readonly outcome: WriteOutcome;
  readonly reason?: string;
  readonly hashBefore: string;
  readonly hashAfter: string;
}

export class ArtifactWriter {
  constructor(store: Store, projectId: string, metrics?: Metrics | null);
  plan(path: string, body: string): WritePlan;          // pure; never touches disk
  apply(plan: WritePlan, proposalId?: string): WriteOutcome;  // atomic; audits to artifact_writes
}
```

Nine hard rules. **Each one gets its own test**; they are enumerated here so the task document can
cite them by number.

1. **`plan()` performs no filesystem writes.** It reads the file (or treats a missing file as the
   empty string), locates the marker pair, splices the sanitized body between them, and computes
   the diff and both hashes. A `plan()` call on a read-only directory must succeed.
2. **Missing file → create.** The marker block is appended at the end of the (empty) content,
   preceded by a blank line. The resulting file is exactly: blank line, `MARKER_BEGIN`, body,
   `MARKER_END`, trailing newline.
3. **Malformed markers → refuse.** If exactly one marker is present, or `MARKER_END` precedes
   `MARKER_BEGIN`, or more than one pair exists, the outcome is `"refused"` with a human-readable
   `reason`. **Never guess, never repair, never fall back to appending.** A user who hand-edited
   the file into an ambiguous state is owed an error message, not a heuristic.
4. **Bytes outside the marker pair are byte-identical between `before` and `after`.** This is
   asserted with strict equality on the prefix slice (`before[0 .. beginIndex]`) and the suffix
   slice (`before[endIndex .. ]`), not by eyeballing a diff.
5. **Line-ending style and BOM are preserved.** CRLF if the first line ending in the existing file
   is CRLF, otherwise LF. A leading UTF-8 BOM (`\uFEFF`) is preserved. A file that used CRLF must
   still use CRLF after the write, including inside the generated block.
6. **`after === before` → `"noop"`.** Nothing is written, no temp file is created, and
   `artifact_writes_noop` increments. This is what makes regeneration free and makes the
   "run twice, compare bytes" criterion meaningful.
7. **`apply()` is atomic.** Write to `<path>.kevin.tmp` in the **same directory** (so `rename` is
   same-filesystem and therefore atomic), `fsync` the file descriptor, close, then `rename` over
   the target. Never a partial write, never a truncate-then-write, never `writeFileSync` on the
   target path.
8. **Every `apply()` appends an `artifact_writes` row** with `hash_before` / `hash_after`
   (SHA-256 via `node:crypto`), `bytes_before` / `bytes_after`, `outcome` and `reason` —
   **including refusals**. A refusal that leaves no trace is indistinguishable from a write that
   never happened.
9. **The body is sanitized before splicing.** Three layers: (a) the escaping discipline of
   `plugin/memory-format.ts`; (b) strip any line that itself contains `kevin:begin` or
   `kevin:end`, in any casing, anywhere in the line; (c) strip HTML comment terminators (`-->`)
   from memory content, so no memory can close the marker comment early. §3.5 is the reason this
   is not optional.

`projectId` is a constructor argument rather than a per-call argument so that every audit row is
attributed without the call site having to remember.

### 5.2 `diff` (new) — `plugin/diff.ts` — a minimal unified-diff generator

Pure, dependency-free, deterministic. A standard LCS over lines, emitting:

```
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -12,7 +12,9 @@
 context line
-removed line
+added line
 context line
```

Three lines of context per hunk, adjacent hunks merged when their context windows overlap.
Roughly 120 lines of TypeScript. It exists for exactly one reason: **approval prompts must show a
diff, never prose** (D6-05). A human approving "Kevin would like to add two lines about testing"
is approving a sentence; a human approving a unified diff is approving bytes.

Determinism is a hard requirement, not a nicety: identical inputs must produce identical output,
because the diff is persisted into `curation_proposals.diff` and compared across runs.

### 5.3 `inferability` (new) — `plugin/inferability.ts` — deterministic classifier

```ts
export type Inferability = "inferable" | "non_inferable" | "unknown";
export function classify(memory: { type: string; content: string; metadata?: unknown }): Inferability;
export const SELF_DESCRIBING_CODES: ReadonlySet<string>;
```

Rules, evaluated **in order**, first match wins:

| # | Condition | Result |
|---|---|---|
| 1 | `type` ∈ `decision` / `rule` / `solution` | `non_inferable` |
| 2 | `type` = `pattern` | `non_inferable` — a mined sequence is project-specific by construction |
| 3 | `type` = `error` **and** `metadata.dispatch.code` ∈ `SELF_DESCRIBING_CODES` | `inferable` |
| 4 | `type` = `error` **and** the content names a project-specific path, script or flag | `non_inferable` |
| 5 | otherwise | `unknown` |

`SELF_DESCRIBING_CODES` = `TS2304`, `TS2307`, `TS2322`, `TS2339`, `TS2305`, `TS2552`, `TS2740`,
`TS6133`, `TS18047`, `E0433`, `E0432`, plus the synthetic `command_not_found`. This set is the
`Reflector` dispatch surface of §3.4, restated as data.

Rule 4 is the interesting one and it is why `unknown` exists as a third value: a `TS2304` is
inferable, but *"`TS2304` on `./scripts/gen-routes.ts` because the generator must run before
`tsc`"* is not — the project-specific script name is the payload, not the code. The detector is
deliberately conservative (npm-script names, relative paths, `--flag` tokens, file extensions) and
**errs toward `non_inferable`**, because the cost of a false `inferable` is silently withholding
real knowledge from curation, while the cost of a false `non_inferable` is one line a human
rejects in a diff.

Persisted to `memories.inferable` as `1` / `0` / `NULL`. `NULL` means `unknown` and, per §5.4,
`unknown` memories remain **eligible** for curation — the predicate is `inferable != 1`, not
`inferable = 0`.

Pure function. No DB access, no clock, no filesystem. Fully unit-testable in isolation, and
therefore fully unit-tested.

### 5.4 `Curator` (new) — `plugin/Curator.ts` — candidate selection and line rendering

```ts
export interface CurationCandidate {
  readonly memoryId: string;
  readonly line: string;         // the single AGENTS.md bullet
  readonly confidence: number;
  readonly evidence: string;     // "verified 3×, last 2026-08-04"
}

export class Curator {
  constructor(store: Store, memoryService: MemoryService, projectId: string, metrics?: Metrics | null);
  candidates(limit?: number): CurationCandidate[];
  renderBlock(candidates: CurationCandidate[]): string;
  propose(kind: "agents_md" | "skill" | "reference", writer: ArtifactWriter): CurationProposal[];
}
```

**Selection predicate — all clauses must hold:**

```sql
status = 'active'
AND ignored = 0
AND curated = 0
AND (inferable IS NULL OR inferable != 1)
AND confidence >= 0.6
AND (evidence_count >= 2 OR feedback_positive >= 1)
```

Ordered by `confidence DESC, updated_at DESC`. Capped at **20 lines and 4000 characters**,
whichever binds first.

The predicate is deliberately strict, and each clause earns its place: `ignored = 0` respects an
explicit human "no" from v0.5; `curated = 0` prevents re-proposing what is already published;
`inferable != 1` implements §3.4; the confidence floor and the evidence-or-feedback disjunction
implement D6-09 — either the world verified it twice, or a human verified it once.

**Line rendering is deterministic:**

```
- <one-line content, first sentence, ≤160 chars> (<evidence>)
```

The rendered block is **sorted by memory id**, not by confidence, so that adding one new candidate
produces a one-line diff instead of a reshuffle (D6-10). Confidence orders *selection*; id orders
*output*. Conflating the two would make every regeneration a full-block rewrite and destroy the
review experience the diff exists to provide.

`CurationProposal` is the row shape of §6's `curation_proposals` table, surfaced as:

```ts
export interface CurationProposal {
  readonly id: string;
  readonly kind: "agents_md" | "skill" | "reference";
  readonly targetPath: string;
  readonly memoryIds: readonly string[];
  readonly proposedText: string;
  readonly diff: string;
  readonly status: "pending" | "approved" | "rejected" | "applied" | "superseded";
  readonly createdAt: string;
}
```

`propose()` calls `writer.plan()` — never `writer.apply()`. The `Curator` has no capability to
write to disk, by construction: it holds no `fs` import.

### 5.5 Proposal lifecycle (new table + tools)

```
                    kevin_propose
                         │
                         ▼
                     pending ──────────────► superseded
                    │       │                    ▲
   kevin_approve    │       │  kevin_approve     │ a newer proposal for the same
                    │       │  ({decision:       │ (project_id, kind, target_path)
                    ▼       │   "reject"})       │ is generated
                 approved   └──► rejected  ──────┘
                    │
        ArtifactWriter.apply()
                    │
                    ▼
                 applied
```

- `kevin_propose` **only ever creates `pending` rows** and returns diffs. It is a strict dry run
  in the same sense `kevin_trace` is (v0.5 D5-08): no disk write, no `curated` flag set, no
  artifact metric moved beyond `proposals_created`.
- `kevin_approve` is the **only code path in the entire plugin that may call
  `ArtifactWriter.apply()`**. This is enforceable and must be enforced by a test that greps the
  compiled module graph for `.apply(` call sites.
- Generating a new proposal for an existing `(project_id, kind, target_path)` triple marks the
  prior `pending` row `superseded` rather than deleting it. Rejection history is evidence about
  the curation thesis itself — roadmap kill criterion **K4** is "proposals are rejected more often
  than approved", and it is uncheckable if rejections are discarded.
- On `applied`, every contributing memory gets `curated = 1, curated_at = datetime('now')`.

### 5.6 `Materializer` (new) — `plugin/Materializer.ts` — topic bundles for the pull channels

Writes:

- `~/.opencode-kevin/refs/<topic>.md` — one file per topic, registered as `@kevin/<topic>`.
- `~/.opencode-kevin/skills/project-knowledge.md` — one file, the Skill body.

Both go through `ArtifactWriter` — marker-scoped, atomic, hash-audited. There is no second write
path and no direct `writeFileSync` anywhere in the module (D6-01).

**Topic derivation is deterministic and semantic.** A topic is `<type>-<dominant token>`, where
the dominant token is the highest-frequency non-stop-word token of the fingerprint-normalized
content across the memories in the group, with ties broken by lexicographic order so the result is
stable. Topics are **never** derived from a fingerprint prefix (D6-14): FNV-1a is a hash, eight
shared hex characters mean nothing, and `docs/Kevin_v0.5.0_Plan.md` §4 already rejected the same
idea in its clustering form.

Output ordering within each bundle is by memory id, matching §5.4. Regeneration with unchanged
inputs is a `noop` at the `ArtifactWriter` level, so the "run twice, compare bytes" criterion
holds for every bundle.

### 5.7 `capabilities` (new) — `plugin/capabilities.ts` — v2 domain probe

```ts
export interface Capabilities {
  readonly skills: boolean;
  readonly references: boolean;
  readonly apiVersion: string | null;
}
export function probe(input: unknown): Capabilities;
```

Duck-typed, exception-safe, **zero-throw**. It inspects the plugin input object for a `skill`
domain exposing a callable `source`, and a `reference` domain exposing a callable `add`. It never
imports a v2 type, never dereferences without a guard, and never throws — an unexpected shape
returns `{ skills: false, references: false, apiVersion: null }`.

When a domain is absent, every dependent feature degrades to a **silent no-op**: no warning
spam on every session start, no thrown error, no half-written file. `kevin_audit` reports
`skill_emission_enabled` and `reference_emission_enabled` as `"unavailable"` (distinct from
`"off"`, which means the setting is `'0'` on a host that *does* support the domain), so the user
can tell "my host is too old" from "I turned it off".

Kevin still pins `@opencode-ai/plugin ^1.17.6`. The probe must not assume the newer surface
exists, and no import in the plugin may resolve only under a newer version.

### 5.8 `ContextInjector` (changed) — push demotion

Three changes, all small, all measured.

1. **Default `pre_prompt_budget_tokens` becomes `400`**, clamped to `[0, 4000]`. Note the lower
   bound: v0.5 clamped to `[100, 4000]`, which made "off" unreachable. **`0` disables pre-prompt
   injection entirely and is a supported, tested configuration** — it is the exact response the
   roadmap's kill criterion K1 prescribes, and a kill criterion whose response is not implementable
   is not a kill criterion. `COMPACTING_TOKENS` (2000) is unchanged; compaction is a rarer,
   higher-value event.
2. **A new gate branch, evaluated *before* all existing ones:**

   ```ts
   export type GateReason =
     | "ok"
     | "low_confidence"        // NEW in v0.6.0
     | "seen_this_session"
     | "ignored"
     | "not_active"
     | "recurrence"
     | "weak";
   ```

   `confidence < injection_confidence_floor` (setting, default `'0.6'`) →
   `GateReason "low_confidence"` → `injections_blocked_confidence`. It runs first because it is
   the cheapest check and because a memory below the floor should not consume a seen-set slot.
   The counter is mandatory, not optional: Principle 16 applies to the sixth reason exactly as it
   applied to the first five.

3. **`kevin_audit` gains a `channels` block** comparing the three channels on the same axes:

   ```jsonc
   {
     "channels": {
       "push": {
         "tokens_pre_prompt": 0, "tokens_compacting": 0,
         "injections_total": 0, "precision_rate": 0, "coverage_rate": 0,
         "budget_tokens": 400
       },
       "pull": {
         "proposals_created": 0, "proposals_approved": 0, "proposals_rejected": 0,
         "artifact_writes_total": 0, "artifact_writes_noop": 0,
         "references_registered": 0, "skills_registered": 0,
         "skill_emission": "unavailable", "reference_emission": "off"
       }
     },
     "curation": {
       "eligible": 0, "curated": 0,
       "inferable": 0, "non_inferable": 0, "unknown": 0,
       "proposals_by_status": {}
     }
   }
   ```

   This block is the release's own scoreboard. It is what makes "the pull channels beat push"
   a statement someone can check rather than a claim in a README.

---

## 6. Schema delta — `migrations/007_v06_pull.sql`

```sql
-- ============================================================================
-- 007_v06_pull.sql — v0.6.0 "Pull"
--
-- Distribution: curated artifacts instead of a per-prompt token tax.
--
-- Section 1: curation_proposals — the persisted human decision record.
-- Section 2: artifact_writes — the disk audit trail, including refusals.
-- Section 3: memories curation + inferability columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: conditional push-budget demotion.
-- Section 7: schema_version.
--
-- Additive only. Every CHECK constraint introduced here is on a NEW table;
-- no existing constraint is widened, so unlike migration 006 there is no
-- table rebuild in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. curation_proposals — one row per proposed artifact change.
--
--    This table is the "explicit human decision between generation and
--    application" of Principle 22. `kevin_propose` writes 'pending' rows and
--    nothing else; `kevin_approve` moves them to 'approved' → 'applied' or to
--    'rejected'. Rows are never deleted: rejection history is the evidence
--    base for roadmap kill criterion K4 ("proposals rejected more often than
--    approved"), which is uncheckable if rejections are discarded.
--
--    memory_id has no REFERENCES clause. Store sets PRAGMA foreign_keys = ON,
--    and a hard FK would block deleting a memory that a historical proposal
--    once mentioned — the same reasoning as superseded_by in migration 006.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curation_proposals (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  memory_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('agents_md','skill','reference')),
  target_path   TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  diff          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','applied','superseded')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT,
  applied_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON curation_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_memory  ON curation_proposals(memory_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON curation_proposals(project_id);

-- ---------------------------------------------------------------------------
-- 2. artifact_writes — the append-only audit trail for every disk operation.
--
--    A row is written for EVERY ArtifactWriter.apply() call, including
--    outcome='noop' and outcome='refused'. A refusal that leaves no trace is
--    indistinguishable from a write that never happened, and the whole point
--    of §5.1 rule 3 is that a refusal is a reportable event.
--
--    hash_before / hash_after are SHA-256 of the full file contents, not of
--    the marker block. That is what makes rule 4 (bytes outside the markers
--    are byte-identical) auditable after the fact rather than only at test
--    time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_writes (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT,
  project_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  bytes_before INTEGER,
  bytes_after  INTEGER,
  hash_before  TEXT,
  hash_after   TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('written','noop','refused')),
  reason       TEXT,
  wrote_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifact_writes_path ON artifact_writes(path);

-- ---------------------------------------------------------------------------
-- 3. memories: curation state and inferability.
--
--    curated / curated_at record that a memory has already been published,
--    so the Curator does not re-propose it on every session idle.
--
--    inferable is deliberately NULLABLE with no default. Three states are
--    needed, not two: 1 = inferable (a self-describing diagnostic the model
--    resolves for free), 0 = non-inferable (project truth), NULL = unknown
--    (not yet classified, or classified as 'unknown'). The Curator predicate
--    is `inferable != 1`, so NULL rows stay eligible — an unclassified memory
--    must not be silently withheld from curation.
-- ---------------------------------------------------------------------------
ALTER TABLE memories ADD COLUMN curated    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN curated_at TEXT;
ALTER TABLE memories ADD COLUMN inferable  INTEGER;

CREATE INDEX IF NOT EXISTS idx_memories_curated   ON memories(curated);
CREATE INDEX IF NOT EXISTS idx_memories_inferable ON memories(inferable);

-- ---------------------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS in metrics.ts.
--    injections_blocked_confidence is the sixth member of the v0.5 blocked
--    family and MUST be counted like the other five (Principle 16).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('proposals_created',             0),
  ('proposals_approved',            0),
  ('proposals_rejected',            0),
  ('artifact_writes_total',         0),
  ('artifact_writes_noop',          0),
  ('injections_blocked_confidence', 0);

-- ---------------------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an explicit
--    string comparison or an explicit Number() parse — never `=== 1`.
--    (That exact mistake kept cross_project_enabled unreachable for the
--    whole of v0.3.0.)
--
--    skill_emission_enabled and reference_emission_enabled default to '0':
--    the pull channels ship OFF and are opted into, because they depend on a
--    v2 domain Kevin does not pin.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('curation_enabled',           '1'),
  ('agents_md_path',             'AGENTS.md'),
  ('skill_emission_enabled',     '0'),
  ('reference_emission_enabled', '0'),
  ('injection_confidence_floor', '0.6');

-- ---------------------------------------------------------------------------
-- 6. Push-budget demotion.
--
--    Lower the default push budget only where the user has not overridden it.
--    A user who deliberately set 1200 (or 1500, or 200) keeps their value;
--    only an installation still sitting on the v0.5 default of '900' is
--    moved to '400'. An unconditional UPDATE here would silently discard a
--    deliberate configuration choice, which is a worse defect than the token
--    cost it would save.
-- ---------------------------------------------------------------------------
UPDATE kevin_settings SET value = '400'
 WHERE key = 'pre_prompt_budget_tokens' AND value = '900';

-- ---------------------------------------------------------------------------
-- 7. Version marker.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('007');
```

**Post-apply hook `DEFAULT_POST_APPLY_HOOKS["007"]`** — idempotent by re-derivation, never
incrementing (the same discipline as `"006"`, D5-13):

```sql
UPDATE memories SET inferable = 0 WHERE inferable IS NULL AND type IN ('decision','rule','solution','pattern');
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM curation_proposals) WHERE key = 'proposals_created';
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM artifact_writes WHERE outcome = 'written') WHERE key = 'artifact_writes_total';
```

The first statement is a backfill, not a classification: the four non-`error` types are
`non_inferable` by rules 1 and 2 of §5.3 unconditionally, so seeding them costs nothing and saves
the Curator a full-table classify pass on first run. `error` rows are left `NULL` and classified
lazily on next save or on the first `kevin_propose`.

**Backward compatibility.** All three `memories` columns are added with a `NOT NULL DEFAULT` or as
nullable, so every existing row remains valid and every existing query keeps working. Both new
tables are `CREATE TABLE IF NOT EXISTS` and are referenced by no existing code path, so a v0.5
installation that never runs a curation tool behaves exactly as it did before — with the single
deliberate exception of the conditional budget `UPDATE` in section 6. `Migrate.run()` wraps the
whole file in a single transaction, so a partial application is impossible.

**Idempotency comes from `schema_version`, not from the SQL.** Raw `ALTER TABLE ADD COLUMN` throws
`duplicate column name` on a second execution, which is why the acceptance criterion is always
"applying via `Migrate.run()` twice is a no-op" and never "running the SQL twice is a no-op".

---

## 7. Decisions log (D6 series)

These IDs are cited in code comments exactly as `D4-NN` and `D5-NN` are today, e.g.
`// v0.6.0 (K6-005 / plan §5.1, D6-02)`.

| ID | Decision | Rationale |
|---|---|---|
| **D6-01** | **Exactly one file-writing code path exists: `ArtifactWriter.apply()`, reachable only from `kevin_approve`.** | A single write path is the only structure in which "we never write outside the markers" is a *provable* statement rather than a *reviewed* one. Two paths means two sets of rules, and the second one will drift. `Curator` and `Materializer` import no `fs` module at all; the capability is absent, not merely unused. This is enforced by a test that scans the module graph for `apply(` call sites. |
| **D6-02** | **Writes are marker-scoped splices; bytes outside the markers are byte-identical, asserted by test.** | The user's `AGENTS.md` is a hand-maintained document that predates Kevin and will outlive it. Kevin is a guest in a region delimited by two comment lines. The assertion is strict equality on the prefix and suffix slices — not a diff review, not a line count, not a "looks right". A formatter that normalizes whitespace outside the block is a data-loss bug wearing a tidiness costume. |
| **D6-03** | **Malformed, duplicated or inverted markers cause a refusal, never a repair attempt.** | Every repair heuristic is a guess about a user's intent expressed in a file the user edited by hand. Guessing wrong destroys content with no undo, and `git` is not an undo here because the user may not have committed. Refusing costs the user one error message and one manual fix; guessing can cost them a paragraph. The refusal is audited into `artifact_writes` so it is visible, not silent. |
| **D6-04** | **Writes are atomic (temp file + `fsync` + `rename`) and hash-audited into `artifact_writes`, including refusals.** | A truncate-then-write that is interrupted — SIGINT, laptop lid, OOM — leaves a truncated `AGENTS.md`. `rename` within the same directory is atomic on every filesystem Kevin targets, so the file is either fully old or fully new. The hashes make "did Kevin change something it should not have?" a query rather than an investigation, and recording refusals makes the refusal path observable instead of a silent no-op. |
| **D6-05** | **Approval prompts show a unified diff, never prose. Hence `plugin/diff.ts` rather than a description string.** | "Kevin would like to add two lines about testing conventions" is a sentence a human approves without reading. `@@ -12,7 +12,9 @@` with the exact `+` lines is bytes a human approves after reading. The whole safety model rests on the human decision in the middle being *informed*; a prose summary is an unaudited translation layer between what is shown and what is written. 120 lines of LCS is a small price for removing it. |
| **D6-06** | **Proposal generation and application are separate tools with a persisted row in between.** | If generation could apply, then any bug in generation is a bug that writes to disk. Separating them means the blast radius of a `Curator` defect is a bad diff a human rejects. The persisted row also makes the decision itself into data: approval rate is the direct measurement of roadmap kill criterion K4, and it cannot be computed from an in-memory handshake. |
| **D6-07** | **Only one target file is supported: the path in `agents_md_path`, default `AGENTS.md`. No globs, no additional targets.** | The blast radius of a splice bug scales with the number of targets, and the user's review burden scales worse. One file also means one marker contract to freeze at v1.0. Users who want curated content elsewhere can point `agents_md_path` at it — one path, explicitly chosen, still one file. |
| **D6-08** | **Inferability is a deterministic pure function persisted to a column, not an LLM judgement.** | Kevin's hot path has had no LLM call since v0.2.0 and this release does not reintroduce one. Beyond cost and latency, an LLM classifier is non-reproducible: the replay harness from v0.5 could not replay it, and `kevin_audit` could not explain it. A pure function over `type` + dispatch code + content shape is testable exhaustively, and when it is wrong the fix is a rule, not a prompt. |
| **D6-09** | **Curation requires `inferable != 1`, `confidence >= 0.6`, and either two pieces of causal evidence or one positive human feedback.** | The scarce resource being spent is *human review attention*, not disk. A proposal a human rejects costs more than a memory that stays in the database, because it teaches the user that Kevin's proposals are not worth reading. The disjunction is the point: two independent causal confirmations and one explicit human "useful" are different but comparable warrants, and requiring both would make curation nearly unreachable on a young database. |
| **D6-10** | **The rendered block is sorted by memory id so regeneration produces a minimal, stable diff.** | Sorting by confidence would reshuffle the whole block whenever any confidence changed — and confidence moves on every settlement, every feedback event and every recurrence. The user would see a 20-line diff for a 1-line change and stop reading diffs, which defeats D6-05. Confidence orders selection; id orders output. |
| **D6-11** | **The default push budget drops 900 → 400, and `0` is a supported value. Existing user overrides are preserved by the conditional `UPDATE`.** | v0.5 made the cost visible and gave the number a home in `kevin_settings`. Now two zero-cost channels exist, and the residual push channel must justify 400 tokens against them rather than 900 against nothing. Allowing `0` matters more than the default: kill criterion K1 prescribes cutting the budget to zero if `coverage_rate < 0.10`, and v0.5's `[100, 4000]` clamp made that response unimplementable. |
| **D6-12** | **A confidence floor gate is added as a new `GateReason`, counted like every other rejection.** | v0.5 Principle 16 is not renegotiable because the sixth reason is new. An uncounted gate branch is an unmeasurable policy, and the specific risk here is that a badly-chosen floor silently suppresses the whole push channel while `kevin_audit` reports a healthy-looking `precision_rate` over three surviving injections. `injections_blocked_confidence` makes that failure mode loud. |
| **D6-13** | **Skills and References are probed at runtime and degrade to silent no-ops on v1. Kevin does not raise its `@opencode-ai/plugin` pin in this release.** | Raising the pin would make a distribution release into a compatibility release and would force every user onto a newer host to get the `AGENTS.md` curator, which needs no v2 API at all. The probe is duck-typed and zero-throw, so the v1 path is not a degraded mode — it is the default mode, and it delivers the flagship feature in full. The pin moves at v0.9.0, with the v1/v2 matrix under test. |
| **D6-14** | **Topic derivation never uses fingerprint prefixes. A hash prefix carries zero semantic information.** | Two memories sharing eight hex characters of an FNV-1a digest are unrelated by construction; grouping them would produce a `@kevin/a3f9c1d2` reference whose contents are arbitrary. The v0.5 plan already rejected this exact idea in its clustering form (§4, "Memory clustering by fingerprint prefix"). Topics derive from `type` plus the dominant content token, with lexicographic tie-breaking for stability. |

---

## 8. Changes per file

### 8.1 `migrations/007_v06_pull.sql` (new)

Full content in §6.

### 8.2 `plugin/Migrate.ts`

- Add `"007"` to `DEFAULT_POST_APPLY_HOOKS` with the three re-derivation statements from §6.

### 8.3 `plugin/metrics.ts`

- Append 6 keys to `METRIC_KEYS`, in the same order the migration seeds them: `proposals_created`,
  `proposals_approved`, `proposals_rejected`, `artifact_writes_total`, `artifact_writes_noop`,
  `injections_blocked_confidence`. Total goes 22 → **28**.
- Extend `blockedSnapshot()` with a sixth key, `confidence`.
- `precisionRate()` and `coverageRate()` are unchanged. This release must not move the definition
  of the metrics it is judged by.

### 8.4 `plugin/ArtifactWriter.ts` (new)

See §5.1. The only module in `plugin/` that imports `node:fs` for writing.

### 8.5 `plugin/diff.ts` (new)

See §5.2. Pure, dependency-free, ~120 lines.

### 8.6 `plugin/inferability.ts` (new)

See §5.3. Pure, no DB, no clock, no filesystem.

### 8.7 `plugin/Curator.ts` (new)

See §5.4. Imports no filesystem module.

### 8.8 `plugin/Materializer.ts` (new)

See §5.6. Writes only through `ArtifactWriter`.

### 8.9 `plugin/capabilities.ts` (new)

See §5.7. Duck-typed, zero-throw.

### 8.10 `plugin/QualityGate.ts`

- Extend `GateReason` with `"low_confidence"`.
- `canInjectVerdict` gains an optional `confidence?: number` on the memory argument and an optional
  `confidenceFloor?: number` on the context. The floor check is branch **zero**, before
  `seen_this_session`.
- `canInject()` remains the thin wrapper (D5-04). Its signature does not change.

### 8.11 `plugin/ContextInjector.ts`

- `prePromptCap()` default `900` → `400`; clamp `[100, 4000]` → `[0, 4000]`.
- When the effective cap is `0`, `onSystemTransform` returns without calling `plan()` at all — no
  retrieval, no gate evaluation, no metric write. Off means off.
- Read `injection_confidence_floor` once per `plan()` call and pass it into `evaluateGate`.
- `injections_blocked_confidence` increments on the new branch, and **only when
  `dryRun === false`** (D5-08 still applies).

### 8.12 `plugin/MemoryService.ts`

- `mapRow()` reads `curated` (boolean via `=== 1`) and `inferable` (`1`/`0`/`NULL` →
  `"inferable"` / `"non_inferable"` / `null`), exposed as `curated` and `inferable` on `Memory`.
- `MEMORY_ROW_SELECT` gains `curated, curated_at, inferable`.
- `save()` classifies with `inferability.classify()` and persists the result on insert.
- Add `markCurated(ids: readonly string[], at: string): number`.

### 8.13 `plugin/kevin_audit.ts`

- Add the `channels` and `curation` blocks of §5.8.
- Keep the existing `try/catch` degradation: on a pre-007 database the new blocks are omitted and
  `"partial": true` is set, exactly as the pre-006 path already behaves.
- Still **no `kevin_context_ratio`** (D5-09). There is still no denominator.

### 8.14 `plugin/index.ts`

- Append 5 keys to `KEVIN_CONFIG_KEYS`: `curation_enabled`, `agents_md_path`,
  `skill_emission_enabled`, `reference_emission_enabled`, `injection_confidence_floor`.
  **Omitting this makes `kevin_config set` return `{error:"unknown_key"}` while
  `kevin_config list` still shows the key — a bug that ships green.**
- Instantiate `ArtifactWriter`, `Curator`, `Materializer`; call `capabilities.probe(input)` once at
  init and hold the result.
- Register `kevin_propose`, `kevin_approve`, `kevin_publish` (13 → 16).
- `session.idle`: after `ledger.settle()` → `CausalChain.onSessionIdle()` → `archiver.run()`, add
  `curator.propose("agents_md", writer)` behind `curation_enabled` and a throttle, in its own
  `try/catch`.

### 8.15 `scripts/verify-install.ts`

- Add `007_v06_pull.sql` to the hard-coded migration list at lines 62–79. Without this,
  `npm run verify` silently never exercises migration 007.

### 8.16 `plugin/Retrospective.ts`

- Add the 6 new metric keys to `METRIC_KEY_LABELS`. The v0.4 audit found seven keys printing raw
  because this table was not updated; do not repeat it.

---

## 9. Tasks (K6-001 … K6-026)

Full stanzas, acceptance criteria and verification commands are in
`docs/Kevin_v0.6.0_Task.md`. Summary:

| Phase | IDs | Content |
|---|---|---|
| **F0 Substrate** | K6-001 … K6-004 | Migration 007, post-apply hook, config keys + verify script, metric keys |
| **F1 Artifact writer** | K6-005 … K6-009 | `ArtifactWriter`, `diff`, atomic apply + audit, idempotence/CRLF/BOM, sanitation |
| **F2 Curation** | K6-010 … K6-015 | `inferability`, `Curator`, proposal lifecycle, `kevin_propose`, `kevin_approve`, session-idle generation |
| **F3 Pull channels** | K6-016 … K6-020 | `capabilities`, `Materializer`, Skill emission, Reference registration, `kevin_publish` |
| **F4 Demoting push** | K6-021 … K6-023 | Budget 900 → 400, confidence floor gate, channel comparison in `kevin_audit` |
| **F5 Release** | K6-024 … K6-026 | Docs + version bump, closed-loop e2e, final verification |

**Critical path:** K6-001 → K6-005 → K6-007 → K6-011 → K6-013 → K6-014 → K6-025 → K6-026.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| Repository truth scanner | Needs this release's curation gate to have somewhere to send a de-ranked memory | v0.7.0 |
| Convention mining from successful sequences | A different signal source; must not share a release with the first write-to-disk path | v0.7.0 |
| Conflict detection between memories | Only sound on caller-supplied fingerprints; needs `decision`/`rule` to be the centre of gravity first | v0.7.0 |
| Repo-local shared knowledge / OKF v2 | Mergeability is a format problem, not a distribution problem; solve distribution first | v0.8.0 |
| v2 `define()` migration and TUI curation panel | Platform migration must not share a release with a trust-critical write path | v0.9.0 |
| Frozen public API and published benchmark | A marker contract can only be frozen after it has survived real use | v1.0.0 |
| Auto-approval / "trusted mode" for proposals | The approval gate is the entire safety model | **Never** |
| Writing to files other than the configured target | One file, one marker pair, one approval path (D6-07) | **Never** |
| Topic derivation from fingerprint prefixes | A hash prefix carries zero semantic information (D6-14) | **Never** |
| `tool.definition` augmentation | Static, session-less, permanent, structurally un-ledgerable | **Never** |
| `experimental.chat.messages.transform` | `input` carries no `sessionID` | Blocked upstream |
| Embeddings / vector search | The binding constraint is query derivation, not ranking — and the pull channels bypass query derivation entirely | Revisit post-v1.0 |
| Any new runtime dependency | Runtime deps stay `@opencode-ai/plugin` + `zod`, `better-sqlite3` optional | **Never in this release** |

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

1. **Migration idempotency.** `Migrate.run()` applied twice against a fresh DB reports
   `applied: []` on the second run.
2. **Override preservation.** A v0.5.0 database at `schema_version 006` with
   `pre_prompt_budget_tokens = '1200'` migrates to `007` with that value **untouched**; a second
   database still sitting on the default `'900'` migrates to `'400'`.
3. **Refusal safety.** `ArtifactWriter.plan()` against a fixture with malformed markers (one
   marker only, inverted order, and two pairs — three fixtures) returns `outcome: "refused"` and
   writes nothing; the fixture files are byte-identical afterwards.
4. **Idempotent application.** Approving the same proposal twice produces `"written"` then
   `"noop"`, and the target file is byte-identical after the second call.
5. **Config surface.** `kevin_config set` succeeds for all five new keys, and
   `kevin_config list` reads each back.

---

## 12. Summary of what changed from v0.5.0

| Area | v0.5.0 | v0.6.0 |
|---|---|---|
| Distribution channels | 1 (push injection) | 3 (push, `AGENTS.md`, Skills/References) |
| Writes to the project directory | none — no code path exists | one, marker-scoped, approval-gated, hash-audited |
| Primary output | rows in a private SQLite file | a git-tracked `AGENTS.md` block |
| Human decision surface | feedback on an existing memory | approval of a proposed diff |
| Approval evidence | none | `curation_proposals` + `artifact_writes` |
| Knowledge classification | `type` only | `type` + `inferable` (`1`/`0`/`NULL`) |
| Gate reasons | 6 | 7 (+ `low_confidence`) |
| Blocked counters | 5 | 6 |
| Pre-prompt budget | 900, clamped `[100, 4000]` | 400, clamped `[0, 4000]`; `0` supported |
| Escaping discipline | injected blocks only | injected blocks **and** every generated file |
| `kevin_audit` | outcomes, blocked, feedback, tokens | + `channels`, + `curation` |
| Setting keys | 9 | 14 |
| Metric keys | 22 | 28 |
| Tools | 13 | 16 |
| Modules in `plugin/` | 28 | 34 |

---

## 13. References

- `docs/Kevin_Roadmap.md` — §1.3 findings 4 (push is the wrong channel), 5 (`AGENTS.md` is the free incumbent) and 6 (N=1 compounding); §3 ecosystem table; §5.2 this release; §6 kill criteria K1 and K4.
- `docs/Kevin_v0.5.0_Plan.md` — the measurement instruments (`precision_rate`, `coverage_rate`, `injections_blocked_*`) this release is judged by, and D5-08's strict dry-run discipline, reused here for `kevin_propose`.
- `docs/Kevin_v0.4.0_Bugs.md` — the audit that established components-built-but-never-wired, untyped SQLite boundaries and TEXT-vs-number setting comparisons as this codebase's recurring defect classes. All three are guarded against in §8 and in the task document's §4.
- `migrations/005_v04_signal.sql` — the additive-migration house style followed verbatim in §6.
- `plugin/memory-format.ts` — `escapeInjectedText`, the v0.1.5 PR #1 fix whose discipline §5.1 rule 9 extends to generated files.
- `@opencode-ai/plugin@1.17.10` `dist/index.d.ts` — the `skill` and `reference` domain shapes probed in §5.7 and the two hooks rejected in §4.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 Substrate | K6-001 … K6-004 | `[ ]` Pending |
| F1 Artifact writer | K6-005 … K6-009 | `[ ]` Pending |
| F2 Curation | K6-010 … K6-015 | `[ ]` Pending |
| F3 Pull channels | K6-016 … K6-020 | `[ ]` Pending |
| F4 Demoting push | K6-021 … K6-023 | `[ ]` Pending |
| F5 Release | K6-024 … K6-026 | `[ ]` Pending |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

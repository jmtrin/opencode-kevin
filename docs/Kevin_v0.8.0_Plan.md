# Opencode-kevin — Implementation Plan v0.8.0

**Version:** 0.8.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → Verify → Learn → Prove → Publish → **Share**
**Codename:** "Team"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.7.0 — the module set after "Project Truth"; every defect cited below carries a `file.ts:line` reference.
- `plugin/index.ts:56` — `join(homedir(), ".opencode-kevin", "kevin.db")`, the single global database that makes every corpus per-machine.
- `plugin/index.ts:68` — `const projectId = fingerprint(process.cwd())`, the path-derived scope that does not survive a `git clone`.
- `plugin/fingerprint.ts:76` — `fingerprint(content, project_id?)`, FNV-1a-64 with a NUL-separated salt, and `normalize()` at line 42 which lowercases and rewrites path references. Both facts constrain the OKF identity function in §5.3.
- `plugin/ArtifactWriter.ts` (v0.6.0) — the marker-scoped single write path; this release changes what it renders, never how it writes.
- `plugin/Curator.ts` (v0.6.0) — `candidates()` / `renderBlock()`, which today read the local `memories` table and after this release read the shared layer.
- `plugin/RepoTruth.ts` (v0.7.0) — the precedent for reading project files with no new dependency and no `child_process`.
- `plugin/ConflictDetector.ts` (v0.7.0) — unchanged, and deliberately so: it now runs over a corpus that includes teammates' entries.
- `migrations/004_v03_knowledge.sql` — the table-rebuild precedent §6 avoids for the second release running.
- `migrations/005_v04_signal.sql` — the banner style §6 follows.
- `scripts/verify-install.ts:61-79` — the hard-coded migration filename list, updated in every release since v0.2.0 and forgotten in none.
- `docs/Kevin_Roadmap.md` §4, §5.4, §6, §7 — the version ladder, this release's scope and exit criterion, the kill criteria, and the permanent non-goal of a hosted service.
- `docs/Kevin_v0.6.0_Plan.md`, `docs/Kevin_v0.7.0_Plan.md` — document conventions, the write-path contract, and the ground-truth model this release extends across machines.

---

## 1. Executive Summary

> v0.5.0 made Kevin's numbers honest. v0.6.0 gave Kevin a channel that outlives the session.
> v0.7.0 taught Kevin to check its beliefs against the repository. v0.8.0 discovers that all of
> that knowledge is trapped on one laptop, under a scope derived from an absolute path, in a
> binary file nobody can review — and that a team of five running Kevin builds five disjoint
> corpora of the same project, five times over. It fixes that with a committed text file and a
> merge function, and with nothing else.

| Dimension | Value |
|---|---|
| Release theme | Knowledge leaves the laptop; the repository becomes the unit of memory |
| Version | 0.7.0 → 0.8.0 |
| New files | `plugin/RepoIdentity.ts`, `plugin/okf.ts`, `plugin/SharedLayer.ts`, `migrations/009_v08_team.sql` |
| New migration | `009_v08_team.sql` (additive only — **no table rebuild**, second release running) |
| New tools | `kevin_share`, `kevin_sync`, `kevin_project` (18 → 21) |
| Changed tools | `kevin_audit` (+`team` block), `kevin_status`, `kevin_config` (5 new keys), `kevin_publish` (renders shared layer) |
| New metric keys | 6 (33 → 39) |
| New setting keys | 5 (18 → 23) |
| New runtime dependencies | **none** |
| New process spawns | **none** — `.git/config` is read as text, exactly as `RepoTruth` reads `package.json` |
| Network calls | **zero, permanently.** Git is the transport; Kevin never speaks a protocol |
| Tasks | 27 (`K8-001` … `K8-027`) |
| Risk | Medium-high — a new identity dimension, a new file format, and a merge function that must be algebraically correct |
| Breaking | No API breaks. With `shared_layer_enabled='0'` (the default) retrieval is bit-identical to v0.7.0. |

**Why now.** This release is fourth in the ladder because it is worth nothing earlier. Sharing a
corpus that is 90% self-describing compiler diagnostics would have exported noise to four
colleagues — v0.7.0's rebalance toward `decision` and `rule` is what makes a shared layer worth
reading. Sharing memories nobody can check would have exported errors — v0.7.0's repository
ground truth is what makes an imported memory falsifiable on the machine that receives it.
Sharing without a curation gate would have published everything — v0.6.0's `Curator` and the
`kevin_approve` bottleneck are what make promotion an explicit act. Every dependency this
release leans on was built deliberately, and none of them is optional.

**Exit criterion.** Given two clones of the same repository, on two machines, with **disjoint**
local databases: a memory promoted on machine A and committed is retrievable and injectable on
machine B after a `git pull` plus one `kevin_sync`, with **zero** network calls and **zero**
process spawns originating from Kevin; `OkfCodec.merge` is proven **associative, commutative and
idempotent** over a randomized corpus of ≥1000 entry pairs; a hand-written git merge conflict
inside the OKF file, resolved by naively concatenating both sides, parses to the **same** corpus
as either side's clean merge; and **zero** shared entries are ever mutated in place — every
change is an append.

That criterion is falsifiable in a way the previous three were not: it is a property test, and a
property test either holds for a thousand random pairs or it does not. If `merge` is not a
semilattice, the format is wrong and the correct response is to change the format, not to add a
conflict-resolution UI.

---

## 2. Philosophy — "Team"

### 2.1 Carry-over from v0.5.0, v0.6.0 and v0.7.0

Everything stands. The four honest injection outcomes and `precision_rate`, the five
`injections_blocked_*` gate counters, the `Archiver`'s `stale → archived` transition,
`deterministic_retrieval`, the marker-scoped `ArtifactWriter` as the **only** write path into a
user's repository and its reachability solely from `kevin_approve`, the `inferability`
classifier, the `Curator` and `curation_proposals`, the 400-token push budget, the
`injection_confidence_floor`, `repo_facts` as ground truth, `truth_penalty ∈ [0, 0.5]` applied
last and multiplicatively, `memory_conflicts` surfaced and never auto-resolved, and the rule that
contradiction de-ranks but never writes `status` — all preserved, none removed.

v0.8.0 adds exactly one new kind of authority: the authority to *write a second file*, at a path
the user configures, containing only entries a human explicitly promoted. It acquires no
authority to transmit, to fetch, to reconcile, or to act on a teammate's behalf.

### 2.2 The v0.8 addition

```
v0.7.0
  ~/.opencode-kevin/kevin.db          ← one machine. one user. binary. unreviewable.
        │
        ├── project_id = fingerprint(process.cwd())      ← dies on `git clone`
        │                                                   dies on `mv ~/work/app ~/dev/app`
        │
        └── AGENTS.md marker block  ← the ONLY thing a teammate ever sees, and it is a
                                       rendering: no confidence, no evidence count, no
                                       provenance, no identity. It cannot round-trip.

v0.8.0
  .git/config ──┐  (read as TEXT. no child_process. no `git` binary. no network.)
  .kevin/project.json ─┴→ RepoIdentity.resolve() ──→ repoId   ← survives the clone
                                                        │
  ┌─────────────────────────────────────────────────────┘
  │
  │   LOCAL LAYER (private)                      SHARED LAYER (committed)
  │   ~/.opencode-kevin/kevin.db                 .kevin/knowledge.okf
  │   everything: errors, noise, drafts          only what a human promoted
  │   layer='local'                              layer='shared', read-only locally
  │        │                                            │
  │        │   kevin_share (explicit, gated by          │
  │        └──── share_requires_approval) ──→ export ──→┤
  │                                                     │
  │        ┌──── kevin_sync (re-read from disk) ←─ import ┘
  │        ▼
  │   OkfCodec.parse() ─→ fold duplicates through the SEMILATTICE
  │        evidence = max │ recurrence = max │ created_at = min │ tombstone > assert
  │        ⇒ associative, commutative, idempotent
  │        ⇒ git's line merge and Kevin's semantic merge CANNOT disagree
  │        ⇒ a botched conflict resolution that keeps both sides is CORRECT
  │
  └→ memories(layer='shared') ─→ same rankScore, same gates, same truth_penalty
                                 ─→ ConflictDetector now sees teammates' rules  ← free
                                 ─→ Curator renders the SHARED layer into AGENTS.md
                                    (the committed file and the committed block agree
                                     by construction, or they are a bug)

  Transport: git. Not a server, not an account, not a protocol, not a poll loop.
             If it is not a file in the repository, it does not reach the team.
```

### 2.3 Principles specific to v0.8 (global numbering continues: v0.4 11–14, v0.5 15–18, v0.6 19–22, v0.7 23–26)

| # | Principle | Implication |
|---|---|---|
| **27** | **Knowledge that cannot be committed cannot be shared.** | The transport is git and only git. No server, no account, no API key, no background fetch. A hosted sync service would make Kevin's usefulness conditional on someone else's uptime, put a team's private engineering decisions on a third party's disk, and convert a zero-dependency plugin into an operational liability. The unit of sharing is therefore a text file in the repository, reviewed in a pull request like everything else. |
| **28** | **A shared file must merge without a human.** | Determinism is not a nicety here, it is the whole design. Entries are canonical JSON with sorted keys, one per line, sorted by id, so two people adding different knowledge touch different lines and git merges them silently. When git *does* produce a duplicate id — both sides edited the same entry — `parse()` folds the duplicates through a semilattice whose result does not depend on order. Any format whose meaning depends on line order is a format that manufactures conflicts in precisely the situation it exists to serve. |
| **29** | **Identity must survive the clone.** | `fingerprint(process.cwd())` describes where a repository happens to sit on one disk. It is not the repository. Two colleagues checking out the same project get two scopes; one colleague renaming a directory orphans an entire corpus in silence. Shared identity is derived from the repository itself — a committed id, or the normalized remote URL — and the path fingerprint is demoted to what it always was: local provenance. |
| **30** | **Sharing is an export, not a sync.** | Kevin never pushes, pulls, reconciles, or resolves on a user's behalf. Promotion into the shared layer is an explicit human act with an explicit gate, and its output is a diff that a reviewer reads before it reaches anyone. `kevin_sync` is a deliberate misnomer's opposite: it re-reads a file that is already on disk. Nothing in this release ever initiates communication. |

---

## 3. The evidence base — why the corpus cannot leave the laptop

Each finding below is checkable in the repository. None is an opinion.

### 3.1 One database, one home directory, one user

`plugin/index.ts:56` resolves the database exactly once:

```ts
const dbPath = opts.dbPath ?? join(homedir(), ".opencode-kevin", "kevin.db");
```

`plugin/Retrospective.ts:79` does the same for its output directory. There is no other storage
location in the codebase. Every memory, every `tool_call`, every `repo_fact`, every
`curation_proposal` and every `memory_conflict` produced since v0.1.0 lives under one user's home
directory, in one SQLite file, on one machine.

The arithmetic is unkind. A team of five running Kevin on the same repository for a month
produces five databases with five disjoint corpora describing one codebase. The same convention
is learned five times, at five different moments, costing five separate sequences of failed tool
calls. Nothing any of them learns is visible to the other four. The system's value scales with
corpus maturity — v0.7.0's own exit criterion demands ≥100 memories and ≥50 settled injections
before it will report a verdict — and this release is the only one that makes maturity
accumulate across more than one person.

### 3.2 The scope is derived from a path, not from a repository

`plugin/index.ts:68` is a single line, and it is the reason the corpus cannot be shared even in
principle:

```ts
const projectId = fingerprint(process.cwd());
```

`process.cwd()` is an absolute path. Three consequences follow mechanically, and all three are
reproducible in under a minute:

| Action | Effect on the corpus |
|---|---|
| `git clone` on a second machine (or a second checkout on the same one) | New path → new `project_id` → the entire corpus is invisible. Kevin starts from zero. |
| `mv ~/work/app ~/dev/app` | New path → new `project_id` → the corpus is orphaned in place. No error, no warning, no recovery path exposed by any tool. |
| Two engineers, identical repo, different home directory layouts | Two `project_id` values by construction, even before the two databases are considered. |

`project_id` is an accurate description of *where a directory sits on one disk*. It has never
been a description of *which project this is*, and every table in the schema is scoped by it.

### 3.3 A third fingerprint identity dimension — and why `fingerprint()` is the wrong function

v0.7.0's Principle 26 requires any feature that compares fingerprints to state which identity
dimension it operates in. This release introduces a third, so it states it up front:

| Dimension | Hashed from | Stable across machines? |
|---|---|---|
| `memories.fingerprint` | normalized error text, salted with `project_id` | **No** — salted with a path-derived scope |
| `tool_calls.fingerprint` | normalized tool output | No — same salt applies where set |
| **`shared_entries.entry_id` (new)** | canonical JSON of `(type, statement, scope)`, **unsalted** | **Yes, by construction** |

Two properties of `plugin/fingerprint.ts` make the existing helper unusable for the new
dimension, and both are visible in the source:

1. **The salt.** `fingerprint(content, project_id?)` at line 76 prepends `project_id` with a NUL
   separator. Passing the project scope would give the same rule a different id on every clone;
   the shared file would accumulate one entry per developer per rule, and the merge fold would
   never once fire. Passing `undefined` avoids this, but leaves the second problem.
2. **The normalizer.** `normalize()` at line 42 lowercases the input and rewrites
   `path.ext:line:col` to `.ext`. Both transformations are correct for error text and
   destructive for a convention statement: `"Route handlers live under src/routes/"` and
   `"route handlers live under SRC/ROUTES/"` are the same string after normalization, and any
   statement citing a file with a line reference is silently mangled. Casing and paths are
   *semantically significant* in a curated rule.

The conclusion is forced: OKF ids are computed with `fnv1a64()` — exported at line 57, already
tested, deterministic across platforms via BigInt — applied directly to a canonical JSON
encoding, with no normalization and no salt. This is D8-05, and §11 turns it into a verification
check rather than a convention.

### 3.4 The only artifact a teammate ever sees is lossy and unmergeable

After v0.6.0, exactly one thing Kevin produces reaches another human: the marker-scoped block in
`AGENTS.md`, written by `ArtifactWriter.apply()`. It is a rendering — Markdown bullets of
statement text. It carries no confidence, no `evidence_count`, no origin, no fingerprint, no
provenance, and no supersession link. It therefore cannot round-trip: there is no function that
reconstructs memories from the block, and there cannot be one, because the information was
discarded at render time.

It is also, structurally, a conflict generator. Two engineers who both run `kevin_approve` in the
same week produce two rewrites of the same contiguous region of one file, between two markers,
with entries in an order determined by each machine's local `confidence DESC, updated_at DESC`
ranking. Git sees one changed hunk on each side of the merge base, in the same place, and stops.
The v0.6.0 write path is correct and careful; it simply was never designed to be written by more
than one person.

### 3.5 Zero process spawns and zero network calls — a capability boundary worth keeping

A search of `plugin/` for `child_process`, `execSync`, `fetch(`, and any `http://` or `https://`
literal returns **nothing**. Not one match across 27 modules. Kevin has never spawned a process
and has never opened a socket, and the plugin's threat surface is correspondingly small: it reads
two JSON files (v0.7.0), reads and writes one Markdown file (v0.6.0), and writes one SQLite
database.

This is a property, not an accident, and this release preserves it exactly. Deriving a repository
identity by shelling out to `git remote get-url origin` would be the obvious implementation and
is rejected on this evidence alone: it introduces process spawning as a capability, makes the
result dependent on a binary that may not exist, and adds a failure mode (a hung `git` on a
network-backed remote helper) to a hot path. `.git/config` is an INI text file. `RepoTruth`
already established the pattern of reading a project file directly, and this release follows it.

### 3.6 The migration filename list is hard-coded, and has been since v0.2.0

`scripts/verify-install.ts:61-79` copies each migration by literal filename:

```ts
const sqlSrc    = join(process.cwd(), "migrations", "001_initial.sql");
const sql003Src = join(process.cwd(), "migrations", "003_v02_signal.sql");
const sql004Src = join(process.cwd(), "migrations", "004_v03_knowledge.sql");
const sql005Src = join(process.cwd(), "migrations", "005_v04_signal.sql");
```

Three observations. The list must be extended by hand in every release that adds a migration —
`006`, `007` and `008` each carry that task, and so does this one (`K8-004`). Only `001` is
mandatory; the rest are copied under `existsSync` guards, so a missing file degrades to a
silently weaker verification rather than a failure. And `002_indexes.sql` is absent from the list
altogether, which is the exact failure mode the guards produce: the omission has been invisible
for six releases because nothing fails when it happens. The fix is out of scope here — see §10 —
but the omission is real, and the companion Task document lists it among the traps.

---

## 4. Ecosystem review — what to build on, and what to refuse

### 4.1 The transport

| Option | Verdict |
|---|---|
| Hosted sync service (accounts, API, server-side corpus) | **Rejected, permanently.** Roadmap §7 lists it as a non-goal, and the reasons compound: a team's engineering decisions are exactly the data that must not sit on a third party's disk; it converts a zero-dependency plugin into an operational dependency with uptime, billing and an auth story; and it makes the offline case — the case where a local-first agent tool is most valuable — the degraded one. |
| A CRDT sync library (Yjs, Automerge) | **Rejected.** Both are competent and both are a runtime dependency measured in hundreds of kilobytes, plus a binary document format that git cannot review. The merge this release needs is a join over five fields on a set keyed by a content hash; that is a semilattice expressible in roughly twenty lines (§5.4), and its correctness is provable by property test in this repository rather than assumed from a README. |
| A committed SQLite file | **Rejected.** It is binary, so every `git diff` is unreadable and every concurrent write is an unresolvable conflict; a page-level change rewrites kilobytes; and a corpus containing raw error text and local paths would be committed wholesale with no curation gate. The database stays private and stays local. |
| **Git, with a committed text file** | **Chosen.** Every team already has it, it is already the review surface, it already has an audit log with authorship and timestamps, and it costs nothing — no dependency, no network code, no protocol version. Kevin never invokes it. The user commits, the user pulls, the user reviews the diff. |

### 4.2 The format

| Option | Verdict |
|---|---|
| YAML | **Rejected.** No parser in the runtime; adding one violates the zero-new-dependency rule held since v0.5.0. YAML also has an ambiguous scalar grammar (the Norway problem) that would make round-tripping a `scope` field of `no` or `on` genuinely unsafe. |
| TOML | **Rejected.** Same missing-parser problem, and a table-per-entry layout produces multi-line records — the property §4.3 shows to be fatal for merging. |
| A single JSON array | **Rejected.** Structurally unmergeable: appending an entry rewrites the preceding line's trailing comma and the closing bracket, so any two concurrent additions conflict, always, regardless of where in the array they land. `JSON.stringify(…, null, 2)` also gives no key-order guarantee across engines. |
| Prose inside `AGENTS.md` | **Rejected.** This is the v0.6.0 status quo and §3.4 is the argument against it. Additionally, `AGENTS.md` is a file humans edit freely; the substrate must be one they do not. |
| **Canonical JSONL — OKF v2** | **Chosen.** One entry per line, keys sorted, no pretty-printing, no trailing whitespace, lines sorted by `entry_id`, LF endings, terminating newline. Parsing is `JSON.parse` per line; serialization is `JSON.stringify` over a key-sorted object. Zero dependencies, human-reviewable in a pull request, and — critically — line-oriented, which is the unit git merges. |

### 4.3 Why line orientation is the whole argument

Git's merge is textual and its unit is the line. A format in which one logical entry occupies one
line has a property no multi-line format can have: **two engineers adding different knowledge
never touch the same line**, so the three-way merge succeeds without a human, every time. Sorting
by `entry_id` (a content hash, hence uncorrelated with authorship or time) means concurrent
additions scatter across the file rather than piling up at the end, which further reduces
adjacency conflicts.

When the same entry *is* edited on both sides, git produces a conflict — and here the format's
second property matters: the correct resolution is *keep both lines*. §5.4's fold makes that
resolution not merely acceptable but exactly right, and §11's verification demands a test proving
that a naive both-sides concatenation parses to the same corpus as a careful manual merge. This
is the one place where a knowledge format can be strictly better than prose, and it is the reason
the format exists.

### 4.4 The `AGENTS.md` relationship

The `agents.md` convention is now the de-facto standard file for agent-readable project
instructions, and this release does not compete with it. The division of labour is explicit:

- **`AGENTS.md`** stays the human- and agent-readable **rendering**, written only by
  `ArtifactWriter.apply()`, only between markers, only from `kevin_approve`. Unchanged contract.
- **`.kevin/knowledge.okf`** is the machine-readable **substrate** — typed, scored, attributed,
  supersedable, mergeable.

One consequence is load-bearing and is stated as D8-11: once a shared layer exists, `Curator`
renders **from the shared layer**, not from the local `memories` table. If the committed block
and the committed file could disagree, one of them would be lying to a reviewer, and there would
be no way to tell which. Rendering from a single source makes the disagreement unrepresentable.

### 4.5 Host capabilities

The `@opencode-ai/plugin` v1 surface exposes no team, workspace, or shared-state primitive of any
kind, and no hook that fires on repository events. There is nothing to build on and nothing to
wait for; the pin stays `^1.17.6` for the third release running, and the v2 API migration remains
scheduled for v0.9.0. MCP likewise defines no shared-state or multi-client-corpus primitive — it
is a per-client transport, and a Kevin MCP server would face precisely the storage question this
release answers, one layer further away from the repository.

---

## 5. Architecture

### 5.1 `plugin/RepoIdentity.ts` — an identity that survives the clone

```ts
export type IdentitySource = "declared" | "remote" | "path";

export interface ResolvedIdentity {
	repoId: string;            // 16-char lowercase hex, fnv1a64
	source: IdentitySource;
	evidence: string;          // ".kevin/project.json#id" | "remote:github.com/acme/app" | "cwd"
	projectId: string;         // UNCHANGED: fingerprint(process.cwd())
}

export function resolve(cwd: string): ResolvedIdentity;
export function parseGitConfigRemote(text: string, name?: string): string | null;
export function normalizeRemote(url: string): string | null;
export function computeRepoId(normalizedRemote: string): string;
```

`resolve()` tries three sources **in order** and stops at the first that yields a value:

| Order | Source | Read | Why it ranks here |
|---|---|---|---|
| 1 | `declared` | `.kevin/project.json` → `id` (16 hex chars) | A committed, explicit id is the only source that handles a monorepo with two Kevin scopes in one checkout, a repository with no remote, and an organisation rename that changes the remote URL under a corpus that already exists. |
| 2 | `remote` | `.git/config`, read as **text**, `[remote "origin"]` → `url` | Requires no setup and is identical across clones. Correct for the overwhelmingly common single-repo, single-remote case. |
| 3 | `path` | `fingerprint(process.cwd())` | The v0.7.0 behaviour, preserved exactly. Guarantees the plugin works in a directory that is not a git repository at all. |

`parseGitConfigRemote()` is a line-oriented INI reader, not an INI library: it tracks the current
`[section "sub"]` header, returns the first `url = …` value inside `[remote "origin"]`, tolerates
tabs, spaces around `=`, CRLF, comments (`#`, `;`), and returns `null` on anything it does not
recognise. It never throws.

`normalizeRemote()` folds the three URL shapes git accepts into one canonical string, and the
transformations are deliberately aggressive because the goal is that two clones agree:

| Input | Output |
|---|---|
| `https://github.com/Acme/App.git` | `github.com/acme/app` |
| `git@github.com:Acme/App.git` | `github.com/acme/app` |
| `ssh://git@github.com/Acme/App` | `github.com/acme/app` |
| `https://user:token@gitlab.com/team/svc.git` | `gitlab.com/team/svc` |
| `/srv/git/bare.git` (local path remote) | `null` — falls through to source 3 |

Steps, in order: strip a trailing `.git`; strip a `scheme://` prefix; strip everything up to and
including a `@` in the authority (userinfo and embedded credentials — **a token must never reach
a hash that lands in a committed file**); rewrite the scp-style `host:path` separator to `host/path`;
strip trailing `/`; lowercase the result. Anything without a `/` after normalization returns
`null`.

`computeRepoId()` is `fnv1a64("okf:repo:v1\u0000" + normalized)`. The domain prefix exists so a
repo id can never collide with a memory fingerprint computed over the same string, and so the
derivation can be versioned later without ambiguity.

**Re-keying is never automatic.** After migration `009`, every existing row has
`repo_id = project_id` (§6). If `resolve()` subsequently returns a git-derived id that differs
from the back-filled one — which it will on the first run in any cloned repository — the corpus
does **not** move. `kevin_project show` reports the discrepancy and `kevin_project rekey
{confirm: true}` performs the `UPDATE`. Silently re-keying would, in a monorepo with two Kevin
scopes, merge two unrelated corpora into one with no undo and no diff, and the user would learn
about it through a stranger's memories appearing in their prompts.

### 5.2 The two-layer store

| | **Local layer** | **Shared layer** |
|---|---|---|
| Storage | `~/.opencode-kevin/kevin.db` | `.kevin/knowledge.okf`, committed |
| Scope | one machine, one user | the repository |
| Contents | everything — errors, drafts, noise, per-machine outcomes | only entries a human promoted |
| Marker | `memories.layer = 'local'` (default) | `memories.layer = 'shared'` |
| Writable | fully | `statement`/`type`/`scope` immutable locally |
| Review | none | a pull request |
| Default | on | **off** (`shared_layer_enabled = '0'`) |

Shared entries are imported into the same `memories` table rather than queried from a second
place. This is D8-10 and it is the decision that keeps this release small: `getRelevant()`,
`rankScore()`, the five injection gates, `truth_penalty`, `ConflictDetector` and the audit
queries all keep working with no changes to their logic, because a shared memory is a memory.

What a shared row may and may not have written to it, locally:

| Column group | Local write allowed | Rationale |
|---|---|---|
| `statement`, `type`, `scope` | **No** | They are inputs to `entry_id`. Editing them locally would silently desynchronize the row from the committed file with no way to detect it. To change a shared entry, author a new one that `supersedes` it. |
| `confidence`, `evidence_count` | **No** | Merged from the file through the lattice; a local write would be overwritten on the next `kevin_sync` and the user would see their edit vanish. |
| `feedback_positive`, `feedback_negative` | Yes | Your opinion of a teammate's rule is yours, is local, and is exactly the signal `precision_rate` needs. |
| `truth_penalty`, `contradicted_at` | Yes | A teammate's rule may contradict *your* `package.json`. It is de-ranked on your machine and nowhere else — which is correct, because it is your checkout that disagrees. |
| `ignored`, injection outcomes, `last_injected_at` | Yes | Per-machine operational state. Never leaves. |

### 5.3 OKF v2 — the format

The name is not new, and that has to be said plainly. **OKF v1 already ships**: it is the
frontmatter-bundle format emitted by `plugin/okf-export.ts::exportOkf` since v0.3.0, parsed by
`plugin/okf-import.ts::parseMarkdownBundle`, and exposed to users through the `kevin_export` and
`kevin_import` tools. v2 is not a rename of the v0.6.0 marker block; it is a second format with a
different job, and both are kept.

The reason v1 cannot become the team substrate is structural, not aesthetic:

| v1 property | Consequence for sharing |
|---|---|
| An entry is a frontmatter block **plus a multi-line body** | Not line-oriented, so a git merge of two concurrent additions is a real conflict rather than two independent line insertions. This alone disqualifies it (§4.3). |
| The body terminator is a lookahead heuristic (`okf-import.ts:100-118`) — a `---` line is a body line or an entry boundary depending on what follows | Ambiguous grammar. A statement that legitimately contains `---` can re-frame the rest of the file. |
| `exportOkf` selects `WHERE status = 'active'` with **no project predicate** (`okf-export.ts:53-55`) | It exports every project's memories at once. Harmless for a manual bundle a human reviews; a data leak the moment the output is auto-committed to one repo. |
| `confidence` is written by the exporter (`okf-export.ts:103`) but never read by the importer — it is recomputed from `evidence_count`/`recurrence_count` | Confidence is already a *derived* quantity in this codebase. v2 keeps that property rather than fighting it (below). |
| Ids are UUIDv7, minted per entry (`okf-import.ts:123`) | Two clones asserting the same rule produce two ids and therefore two rows. Convergence is impossible without content addressing. |

So the division of labour is explicit: **v1 is the human-facing bundle** — a full-fidelity dump a
person exports, reads, and hands to someone, unchanged by this release except for the scoping fix
(K8-027) — and **v2 is the machine-facing substrate** that git merges without a human. They share a
name and nothing else; `plugin/okf.ts` never imports from `okf-export.ts` or `okf-import.ts`.

```
#okf 2
#repo 8f3a2c1d9e7b6045
#generated-by opencode-kevin/0.8.0
{"author_hash":"3c9a...","created_at":"2026-08-11T09:14:22Z","entry_id":"0a1b...","evidence":4,"op":"assert","origin":"pattern","recurrence":0,"scope":"src/routes/","statement":"Route handlers under src/routes/ ship with a sibling *.test.ts","supersedes":null,"type":"rule"}
{"author_hash":null,"created_at":"2026-08-09T18:02:10Z","entry_id":"1f77...","evidence":7,"op":"assert","origin":"decision","recurrence":1,"scope":null,"statement":"Database access in tests goes through a temp file, never :memory:","supersedes":null,"type":"decision"}
```

Physical rules, all of them load-bearing for the merge:

| Rule | Value | Why |
|---|---|---|
| Line endings | LF only, terminating newline | CRLF would make every file a whole-file diff between a Windows and a macOS contributor. |
| Encoding | UTF-8, **no BOM** | A BOM breaks the `#okf ` prefix check on the first line. |
| Header | 3 lines, `#`-prefixed; `#okf 2` mandatory and first | Cheap version gate; a v3 parser can refuse a v2 file explicitly instead of guessing. |
| Entry encoding | `JSON.stringify` over an object with **alphabetically sorted keys**, no pretty-printing | Two machines must emit byte-identical lines for the same entry, or every write is a spurious diff. |
| Entry order | ascending by `entry_id` | Content-hash order is uncorrelated with author and time, so concurrent additions scatter instead of colliding at the tail. |
| Max line | 4096 bytes | Bounds a pathological statement; the writer refuses rather than truncates. |
| Max entries | 2000 | Bounds parse cost on a hot path and forces curation to stay curation. |
| Numbers | **integers only — no float is ever written** | `JSON.stringify(0.1 + 0.2)` is `0.30000000000000004`. One machine computing a confidence slightly differently would produce a different byte string for a semantically identical entry, and every pull would diff. The file carries integer counts; confidence is derived on read (below). |

Fields, with the merge rule for each — the right-hand column *is* §5.4:

| Field | Type | Merge rule |
|---|---|---|
| `entry_id` | 16 hex chars | the key; never merged |
| `type` | `decision`/`rule`/`pattern`/`solution` | equal by construction (id input) |
| `statement` | string | equal by construction (id input) |
| `scope` | string \| null (path prefix) | equal by construction (id input) |
| `evidence` | integer ≥ 0 | **max** |
| `recurrence` | integer ≥ 0 | **max** |
| `origin` | string | lexicographic min |
| `author_hash` | 16 hex \| null | null-tolerant lexicographic min |
| `op` | `assert` \| `tombstone` | **`tombstone` absorbs** |
| `created_at` | ISO-8601 UTC, `Z` | **min** |
| `supersedes` | 16 hex \| null | null-tolerant lexicographic min |

**`confidence` is absent from the file, and that is the correction this release owes v0.4.0.**
Confidence is not an independent quantity in this codebase — `computeConfidence(evidence_count,
recurrence_count)` derives it, two-sidedly, so that a lesson which keeps recurring is *demoted*
rather than merely un-promoted. `okf-export.ts:103` already treats it as a rendering and
`okf-import.ts` already ignores the exported value. Transporting it would be worse than redundant,
it would be incoherent: merging `confidence` by max and `recurrence` by max lets a machine with
`evidence 5, recurrence 0, confidence 0.9` join a machine with `evidence 5, recurrence 3,
confidence 0.4` into a record asserting confidence 0.9 alongside 3 recurrences — a row that
contradicts the very formula that produced it. So v2 carries the two integer counts and derives
confidence at read time. The record stays internally consistent under every possible join, the
file contains no floats at all, and a future change to the formula reprices shared and local
memories identically instead of leaving shared ones frozen at whatever their author's version
believed.

Merging `recurrence` by **max** is deliberately the pessimistic direction, and it is the only
defensible one: if a rule misfired on a teammate's machine, that is evidence about the rule, not
about the teammate. The demotion propagates; a machine that has not yet seen the failure inherits
it on the next `kevin_sync`.


when it is `'none'`. A raw email address is never written: the file is committed, committed files
are permanent, and a corpus of engineer email addresses is a liability nobody asked Kevin to
create. The hash exists only so `kevin_audit` can report "entries from 4 distinct authors" — it
is never displayed, never reversed, and never used in ranking.

### 5.4 `plugin/okf.ts` — the codec, and why the merge is provably correct

```ts
export const OKF_VERSION = 2;
export const MAX_LINE_BYTES = 4096;
export const MAX_ENTRIES = 2000;

export type OkfOp = "assert" | "tombstone";

export interface OkfEntry {
	entry_id: string;
	type: "decision" | "rule" | "pattern" | "solution";
	statement: string;
	scope: string | null;
	evidence: number;
	recurrence: number;
	origin: string;
	author_hash: string | null;
	op: OkfOp;
	created_at: string;
	supersedes: string | null;
}

export interface RejectedLine { line: number; reason: string; }

export interface ParseResult {
	version: number;
	repoId: string | null;
	entries: OkfEntry[];        // folded, sorted ascending by entry_id
	rejected: RejectedLine[];   // parse never throws; bad lines are reported
	folded: number;             // duplicate entry_ids collapsed by join()
}

export function computeEntryId(type: string, statement: string, scope: string | null): string;
export function canonicalize(e: OkfEntry): string;
export function serialize(entries: OkfEntry[], repoId: string, version: string): string;
export function parse(text: string): ParseResult;
export function join(a: OkfEntry, b: OkfEntry): OkfEntry;
export function merge(a: OkfEntry[], b: OkfEntry[]): OkfEntry[];
/** Derived, never serialized — reuses the v0.4.0 two-sided formula verbatim. */
export function deriveConfidence(e: OkfEntry): number;
```

`computeEntryId()` is, per §3.3, deliberately **not** `fingerprint()`:

```ts
export function computeEntryId(type: string, statement: string, scope: string | null): string {
	return fnv1a64(`okf:v2\u0000${type}\u0000${statement}\u0000${scope ?? ""}`);
}
```

No salt, so two clones agree. No `normalize()`, so casing and path references — both semantically
significant in a curated statement — survive. NUL separators, matching the existing convention in
`fingerprint.ts:76`, so `("rule", "ab", "c")` and `("rule", "a", "bc")` cannot collide.

`parse()` is a **total function**. It never throws, on any input, including binary. Every line it
cannot use becomes a `RejectedLine` with a reason: bad JSON, missing field, wrong type,
`entry_id` disagreeing with the recomputed hash of its own `(type, statement, scope)`, line over
`MAX_LINE_BYTES`, or a corpus over `MAX_ENTRIES`. This matters because the file is *expected* to
arrive damaged: a git conflict resolution can leave `<<<<<<< HEAD` markers in it, and the right
behaviour is to skip three marker lines, keep the several hundred good entries, and report the
rejects — not to lose the corpus.

The fold is the release:

```ts
function pickMin(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a <= b ? a : b;
}

export function join(a: OkfEntry, b: OkfEntry): OkfEntry {
	// precondition: a.entry_id === b.entry_id
	return {
		entry_id:    a.entry_id,
		type:        a.type <= b.type ? a.type : b.type,                  // equal unless hash collision
		statement:   a.statement <= b.statement ? a.statement : b.statement,
		scope:       pickMin(a.scope, b.scope),
		evidence:    Math.max(a.evidence, b.evidence),
		recurrence:  Math.max(a.recurrence, b.recurrence),
		origin:      a.origin <= b.origin ? a.origin : b.origin,
		author_hash: pickMin(a.author_hash, b.author_hash),
		op:          a.op === "tombstone" || b.op === "tombstone" ? "tombstone" : "assert",
		created_at:  a.created_at <= b.created_at ? a.created_at : b.created_at,
		supersedes:  pickMin(a.supersedes, b.supersedes),
	};
}
```

Every field is a `max` or a `min` over a totally ordered set, or a boolean OR. Each of those is
associative, commutative and idempotent; a record of such operations is therefore itself
associative, commutative and idempotent, and `merge` — a fold of `join` over entries grouped by
`entry_id` — inherits all three. The consequences are the reason the format was chosen:

- **`merge(a, b) = merge(b, a)`.** Which side of a git merge was "ours" is irrelevant.
- **`merge(merge(a, b), c) = merge(a, merge(b, c))`.** Three-way merges and repeated pulls converge.
- **`merge(a, a) = a`.** A duplicated line — the exact output of a lazy conflict resolution that
  kept both sides — is a no-op.

`ParseResult.folded` counts how many duplicate ids were collapsed on a given read, and
`SharedLayer.import()` adds it to the `okf_merge_folds` metric. A persistently non-zero value is
useful signal rather than an error: it means the team is genuinely editing the same entries
concurrently, and the lattice is absorbing conflicts that a prose format would have escalated to a
human.

Note `created_at` uses **min**, not max: the entry's birthday is when it was first asserted by
anyone, and min is the only choice that is stable under replay. `evidence` and `recurrence` use
**max**, an explicit decision (D8-13): a mean would not be associative without carrying a count,
and carrying a count would let one machine's repeated re-exports inflate the weight of its own
opinion. Because both counts move in the same direction under join and confidence is derived from
them afterwards, the derived confidence of a merged entry is bounded by neither side's — it is
simply what the v0.4.0 formula says about the pooled evidence, which is the honest answer.

**Tombstones are absorbing and therefore permanent for a given `entry_id`** (D8-09). Once any
participant tombstones an entry, no merge order can revive it. There is no undelete flag, because
an undelete flag is exactly what breaks monotonicity and reintroduces order dependence — the
property the whole format exists to guarantee. To resurrect knowledge, author it again; a changed
statement is a different `entry_id`, and an unchanged one can be recovered from git history,
which is the correct place to look for a deleted line in a committed file.

### 5.5 `plugin/SharedLayer.ts` — import and export

```ts
export interface ImportReport {
	path: string;
	fileHash: string | null;    // null when the file does not exist
	parsed: number;
	folded: number;
	rejected: number;
	imported: number;           // rows inserted or updated in shared_entries
	tombstoned: number;         // shared memories retired by an incoming tombstone
	skipped: boolean;           // true when fileHash matches the last okf_imports row
}

export interface ExportPlan {
	path: string;
	before: string;
	after: string;
	diff: string;
	added: number;
	removed: number;            // tombstones added, never lines deleted
	outcome: "written" | "noop" | "refused";
	reason?: string;
}

export class SharedLayer {
	constructor(deps: { store: Store; repoId: string; version: string });
	read(path: string): ParseResult;
	import(path: string): ImportReport;
	planExport(memoryIds: string[], path: string): ExportPlan;   // pure — no fs write
	applyExport(plan: ExportPlan): ExportPlan;                   // via ArtifactWriter.apply()
	planTombstone(entryIds: string[], path: string): ExportPlan; // pure
}
```

`import()` is idempotent and cheap to call: it hashes the file first and returns
`{ skipped: true }` when the hash matches the most recent `okf_imports` row, so the `session.idle`
path costs one `readFileSync` plus one hash on an unchanged repository. When the hash differs it
parses, folds, upserts `shared_entries`, and projects each entry into `memories` with
`layer='shared'`, `repo_id`, and `shared_entry_id` set. An incoming `op='tombstone'` sets the
corresponding memory's `status='archived'` — the one place where the shared layer may write
`status`, and it is safe precisely because a tombstone is an explicit, committed, reviewed human
decision rather than a fuzzy inference. v0.7.0's Principle 24 is intact: it forbids *contradiction*
from writing status, and this is not contradiction.

`planExport()` is pure in the sense v0.6.0 established for `ArtifactWriter.plan()`: it reads the
current file, computes the merged corpus, serializes, produces a unified diff via `plugin/diff.ts`,
and writes nothing. It refuses — and refusal is recorded, per D6-04 — when:

| Refusal reason | Condition |
|---|---|
| `not_okf` | The file exists and its first line is not `#okf ` |
| `version_ahead` | The file declares a version greater than `OKF_VERSION` |
| `repo_mismatch` | The file's `#repo` header names a different `repoId` |
| `too_many_entries` | The merged corpus would exceed `MAX_ENTRIES` |
| `line_too_long` | Any candidate entry canonicalizes to more than `MAX_LINE_BYTES` |
| `below_floor` | A candidate memory's `confidence` is below `shared_confidence_floor` |
| `not_curated` | A candidate memory has `curated = 0` and `share_requires_approval = '1'` |
| `parse_damaged` | The existing file yields more than 0 rejected lines |

The last one deserves its rationale: writing over a file that contains unresolved conflict markers
would destroy a teammate's entries under the guise of a merge. Kevin refuses and tells the user to
resolve the conflict — by keeping both sides, which §5.4 makes correct — before sharing again.

### 5.6 The write path stays singular

v0.6.0's D6-01 is a contract: exactly one call site of `ArtifactWriter.apply()` exists in
`plugin/`, and `tests/unit/single_write_path.test.ts` asserts it by scanning the source. This
release adds a second file Kevin writes, and it does **not** add a second way to write.

`ArtifactWriter` gains a mode:

```ts
export type WriteMode = "markers" | "whole";

export interface WriteRequest {
	path: string;
	mode: WriteMode;
	content: string;       // marker block body, or whole-file content
}
```

- `mode: "markers"` — the v0.6.0 behaviour, byte for byte. Used for `AGENTS.md`, a file humans
  edit, where everything outside the markers must survive untouched.
- `mode: "whole"` — used only for `.kevin/knowledge.okf`, a file humans do not hand-edit. It keeps
  every other v0.6.0 guarantee: temp file plus `fsync` plus atomic `rename`, `hashBefore` and
  `hashAfter` recorded in `artifact_writes` including on refusal, and a `noop` outcome when the
  rendered bytes are identical to what is already on disk.

The existing test is **extended, not relaxed**: it now asserts exactly one `apply()` call site and
that `mode: "whole"` appears at exactly one construction site, in `SharedLayer`. A future release
that wants to write a third file will have to argue with the same test.

### 5.7 Retrieval, ranking, and scope

Retrieval scopes on `repo_id`:

```sql
-- v0.7.0
WHERE project_id = ? AND status = 'active'
-- v0.8.0
WHERE repo_id = ? AND status = 'active'
```

Because migration `009` back-fills `repo_id = project_id` for every existing row and
`RepoIdentity.resolve()` returns the path fingerprint when no better source exists, **an
unmigrated single-machine user sees an identical result set**. That is the compatibility argument
in one sentence, and `K8-007`'s acceptance criterion is that a v0.7.0 database produces a
byte-identical `getRelevant()` result before and after the migration.

`rankScore()` is **unchanged**. There is no `shared_boost` and there will not be one: a
teammate's rule is neither more nor less true than your own, and a boost would be an unfalsifiable
thumb on the scale in a release whose entire premise is that knowledge should be checkable.
Shared memories compete on `confidence`, `evidence_count`, recency and `truth_penalty` exactly as
local ones do. The one asymmetry is intentional and runs the other way: `shared_confidence_floor`
(default `0.7`) is stricter than `injection_confidence_floor` (default `0.6`), because the cost of
a bad shared entry is paid by everyone and the cost of a bad local one is paid by its author.

`ConflictDetector` (v0.7.0) requires no changes and immediately becomes more useful: with a shared
layer imported, its `decision_pair` negation check now fires across engineers. "Always use the
repository pattern" imported from a teammate and "never use the repository pattern" learned
locally is precisely the disagreement a team wants surfaced, and v0.7.0 already surfaces it
without resolving it.

### 5.8 Tools (18 → 21)

```ts
kevin_share   { memory_ids?: string[]; dry_run?: boolean; confirm?: boolean }  -> ExportPlan
kevin_sync    { }                                                             -> ImportReport
kevin_project { action: "show" | "init" | "rekey"; confirm?: boolean }        -> IdentityReport
```

- **`kevin_share`** promotes local memories into the shared file. With no `memory_ids` it selects
  every `curated = 1` memory at or above `shared_confidence_floor` that is not already shared.
  Its default is `dry_run: true`: it returns the diff and writes nothing. When
  `share_requires_approval = '1'` (the default), `confirm: true` is required and un-curated
  memories are refused, which chains promotion behind the v0.6.0 `kevin_approve` gate rather than
  opening a second door beside it.
- **`kevin_sync`** re-reads the file from disk and folds it in. It is the *only* meaning of "sync"
  in this codebase: no fetch, no push, no remote, no poll. It also runs on `session.idle` when
  `shared_layer_enabled = '1'`, where the file-hash skip in §5.5 makes it near-free.
- **`kevin_project`** exposes identity. `show` reports `repoId`, `source`, `evidence`,
  `projectId`, the memory count under each, and whether a re-key is available. `init` writes
  `.kevin/project.json` with a freshly derived id. `rekey` requires `confirm: true` and moves
  rows from the old `repo_id` to the new one in a single transaction, incrementing `rekey_events`.

`kevin_audit` gains a `team` block, pure SQL like v0.7.0's `mix`:

```json
{
  "team": {
    "shared_layer_enabled": true,
    "okf_path": ".kevin/knowledge.okf",
    "repo_id": "8f3a2c1d9e7b6045",
    "identity_source": "remote",
    "shared_entries": 84,
    "shared_active": 79,
    "shared_tombstoned": 5,
    "distinct_authors": 4,
    "local_only_memories": 512,
    "injections_from_shared": 61,
    "precision_shared": 0.72,
    "precision_local": 0.64,
    "last_import_at": "2026-08-11T09:14:22Z",
    "last_import_rejected": 0
  }
}
```

`precision_shared` versus `precision_local` is the honest instrument this release owes the
project: it answers "is other people's knowledge actually useful to me?" with the same
`effective / (effective + ineffective)` formula v0.5.0 established, and it can come out the wrong
way. If shared entries persistently under-precise local ones on mature databases, the shared layer
is exporting noise and the correct response is to raise `shared_confidence_floor` or to stop, not
to reword the metric.

### 5.9 `Curator` renders the shared layer

Per D8-11, when `shared_layer_enabled = '1'` the `AGENTS.md` block is rendered from
`shared_entries`, not from the local `memories` table. `Curator.candidates()` gains a source
parameter; the predicate, the caps (20 lines, 4000 chars) and the deterministic sort by id are
unchanged. When the shared layer is disabled the v0.6.0 path runs untouched.

The invariant this buys is worth stating plainly: **the committed block is a projection of the
committed file.** A reviewer reading a pull request sees the substrate and its rendering change
together, and cannot be shown a block that claims something the file does not contain.

---

## 6. Migration `009_v08_team.sql`

Additive only. No table rebuild, no CHECK constraint added to an existing table, no column
dropped, no index dropped. This is the second release running that avoids the
`004_v03_knowledge.sql` rebuild path, and the reason is the same: rebuilding a table means
dropping and recreating the FTS5 triggers, and every rebuild is a chance to lose a corpus that
cannot be regenerated.

```sql
-- ============================================================
-- Kevin 0.8.0 - Migration 009: Team (additive)
-- ============================================================
-- Backward-compatible, additive only. All new columns are
-- nullable or carry a NOT NULL DEFAULT so legacy rows keep
-- working without a destructive rebuild.
--
-- Scope note: this migration introduces `repo_id`, a SECOND
-- scoping dimension. `project_id` is retained on every table,
-- unchanged, as local-path provenance (D8-02). Nothing that
-- reads `project_id` today stops working.
-- ============================================================

-- 1. shared_entries: the local projection of the committed OKF file.
--    One row per (repo_id, entry_id). Rewritten by SharedLayer.import(),
--    never edited by hand, never the source of truth - the file is.
--    No REFERENCES to memories: an entry may arrive from a teammate
--    before any local memory corresponds to it (D8-12).
CREATE TABLE IF NOT EXISTS shared_entries (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL,
  entry_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('decision', 'rule', 'pattern', 'solution')),
  statement    TEXT NOT NULL,
  scope        TEXT,
  confidence   REAL NOT NULL DEFAULT 0.0,
  evidence     INTEGER NOT NULL DEFAULT 0,
  origin       TEXT NOT NULL DEFAULT 'shared',
  author_hash  TEXT,
  op           TEXT NOT NULL CHECK (op IN ('assert', 'tombstone')) DEFAULT 'assert',
  supersedes   TEXT,
  created_at   TEXT NOT NULL,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1b. Identity is (repo_id, entry_id). The UNIQUE index is what makes
--     import() an idempotent upsert instead of an append.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_entries
  ON shared_entries(repo_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_shared_entries_op
  ON shared_entries(op);
CREATE INDEX IF NOT EXISTS idx_shared_entries_type
  ON shared_entries(type);

-- 2. okf_imports: append-only audit of every read of the shared file,
--    including no-op reads and refusals. `file_hash` drives the skip
--    path in SharedLayer.import() (D8-14).
CREATE TABLE IF NOT EXISTS okf_imports (
  id               TEXT PRIMARY KEY,
  repo_id          TEXT NOT NULL,
  path             TEXT NOT NULL,
  file_hash        TEXT,
  entries_parsed   INTEGER NOT NULL DEFAULT 0,
  entries_folded   INTEGER NOT NULL DEFAULT 0,
  entries_rejected INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0,
  imported_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okf_imports_repo
  ON okf_imports(repo_id, imported_at);

-- 3. memories: the second scoping dimension and the layer marker.
--    repo_id is NULLABLE and back-filled by the post-apply hook, not by
--    a DEFAULT: the value depends on the row's existing project_id and
--    SQLite cannot express that in a column default.
--    layer carries NO CHECK constraint - widening it later would force
--    the migration-004 rebuild path (D8-07). Enforced in TypeScript.
ALTER TABLE memories ADD COLUMN repo_id TEXT;
ALTER TABLE memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'local';
ALTER TABLE memories ADD COLUMN shared_entry_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_repo_id
  ON memories(repo_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_layer
  ON memories(layer);

-- 4. kevin_metrics: seed the six v0.8 counters (33 -> 39).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('shared_entries_total',    0),
  ('shared_entries_imported', 0),
  ('shared_entries_exported', 0),
  ('okf_merge_folds',         0),
  ('rekey_events',            0),
  ('injections_from_shared',  0);

-- 5. kevin_settings: seed the five v0.8 flags (18 -> 23).
--    shared_layer_enabled defaults OFF: this release must be opted into,
--    because its first side effect is a new file in the user's repository.
--    shared_confidence_floor (0.7) is deliberately STRICTER than
--    injection_confidence_floor (0.6) - see 5.7.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('shared_layer_enabled',     '0'),
  ('okf_path',                 '.kevin/knowledge.okf'),
  ('share_requires_approval',  '1'),
  ('author_identity_mode',     'hashed'),
  ('shared_confidence_floor',  '0.7');

-- 6. Seed version 009.
INSERT OR IGNORE INTO schema_version (version) VALUES ('009');
```

### 6.1 Post-apply hook `"009"`

Three operations, all idempotent, all expressible only in code because they depend on existing row
values:

```ts
// 1. Back-fill the new scope from the old one. This is the entire
//    backward-compatibility story: repo_id = project_id means every
//    pre-v0.8 row remains retrievable, on the same machine, at the
//    same path, with an identical result set.
UPDATE memories SET repo_id = project_id WHERE repo_id IS NULL;

// 2. Normalize the layer marker for any row written by a concurrent
//    v0.7.0 process between ALTER and hook (belt and braces; the
//    DEFAULT already covers the ordinary case).
UPDATE memories SET layer = 'local' WHERE layer IS NULL OR layer = '';

// 3. Re-derive the counter from state rather than trusting an
//    incremented value that may predate a crash.
UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM shared_entries)
  WHERE key = 'shared_entries_total';
```

### 6.2 Backward compatibility

A v0.7.0 database opened by v0.8.0 gains three columns, two tables, five indices, six metric rows
and five setting rows, and changes behaviour in **no** observable way until
`shared_layer_enabled` is set to `'1'` by a human. `repo_id` equals `project_id` for every
existing row, so the widened retrieval predicate in §5.7 selects the same rows in the same order;
`layer` is `'local'` everywhere, so no ranking input changes; `rankScore()` is untouched;
`Curator` renders from `memories` exactly as in v0.6.0 while the flag is off; and the OKF file is
never created, because nothing writes it except `kevin_share`, which a human must invoke.

Downgrade is equally undramatic. A v0.7.0 binary opening a `009` database ignores three unknown
columns and two unknown tables — SQLite does not care — and continues to scope on `project_id`,
which still holds its original value. The only loss is that shared memories imported under v0.8.0
remain in `memories` with `layer='shared'` and are treated as ordinary local memories by the older
code. That is a degradation, not a corruption, and it is the correct trade for never having to
rebuild a table.

**The idempotency criterion is the one used since v0.5.0**: `ALTER TABLE ADD COLUMN` is not
idempotent in SQLite, and never becomes so. Idempotency comes from the `schema_version` guard, so
the acceptance criterion for `K8-001` is, verbatim as in every prior release, *"run `Migrate.run()`
twice against the same database and observe no error and no duplicated row"*.

---

## 7. Decisions log

| ID | Decision | Rationale |
|---|---|---|
| **D8-01** | Git is the only transport. Kevin never opens a socket, never spawns a process, never polls. | §3.5 establishes that `plugin/` contains zero matches for `child_process`, `execSync`, `fetch(` or any URL literal across 27 modules. That is a security and reliability property worth more than convenience. A sync server would put a team's private engineering decisions on a third party's disk, add uptime and auth to a zero-dependency plugin, and degrade exactly the offline case a local-first tool exists to serve. Even the identity derivation obeys this: `.git/config` is parsed as text rather than shelling out to `git remote get-url`, which would introduce process spawning as a capability and add a hung network helper as a failure mode on a hot path. |
| **D8-02** | `repo_id` is a **new** scoping column. `project_id` is retained on every table, unchanged, as local-path provenance, and is never dropped or repurposed. | Every table in the schema is scoped by `project_id`, and every index, query and audit rollup built over eight releases depends on it. Repurposing it would be a silent semantic change to columns that already contain data; dropping it would require the table rebuild §6 exists to avoid. Adding a second, coarser dimension costs one nullable column and one index, is back-filled to the old value so nothing changes on day one, and leaves the old value available for the one question it genuinely answers: *which directory on this machine produced this row?* |
| **D8-03** | Re-keying a corpus from the path fingerprint to a repository id is **explicit, human-confirmed, and transactional**. It never happens automatically. | On the first run in any cloned repository, `resolve()` will return a git-derived id different from the back-filled `repo_id`. Moving the corpus automatically looks helpful and is not: in a monorepo with two Kevin scopes it merges two unrelated corpora with no undo and no diff, and the user discovers it when a stranger's memories appear in their prompts. `kevin_project show` reports the discrepancy, `kevin_project rekey {confirm: true}` acts on it, and the count is recorded in `rekey_events`. |
| **D8-04** | Remote URL normalization strips credentials **before** hashing, and lowercases the whole result. | A remote of the form `https://user:ghp_xxx@github.com/team/svc.git` is common in CI and in some corporate setups. The normalized string feeds a hash that is written into `.kevin/project.json` and into a committed file header; a token must never be within reach of either, even hashed, even by accident. Lowercasing is what makes two clones agree when one engineer typed `Acme/App` and another `acme/app` — hosts are case-insensitive and the major forges treat repository paths that way too. A remote that does not normalize to something containing a `/` returns `null` and falls through to the path fingerprint. |
| **D8-05** | OKF entry ids are `fnv1a64()` over canonical JSON of `(type, statement, scope)` — **unsalted and un-normalized**. They are explicitly the third fingerprint identity dimension in the codebase. | Two independent facts in `plugin/fingerprint.ts` force this. The salt (line 76) would give the same rule a different id on every clone, so the shared file would accumulate one entry per developer per rule and the merge fold would never fire once. The normalizer (line 42) lowercases and rewrites `path.ext:line:col`, which is correct for error text and destructive for a curated statement, where casing and file paths carry meaning. v0.7.0's Principle 26 requires any feature comparing fingerprints to declare its dimension; this one is declared in §3.3 and is the only cross-machine-stable dimension in the schema. |
| **D8-06** | The format is canonical JSONL: one entry per line, alphabetically sorted keys, no pretty-printing, lines sorted ascending by `entry_id`, LF endings, UTF-8 without BOM. | Git's merge unit is the line. One entry per line means two engineers adding different knowledge touch different lines and merge silently, every time. Sorted keys mean two machines emit byte-identical text for the same entry, so a re-export is a `noop` rather than a whole-file diff. Sorting by content hash — uncorrelated with author and time — scatters concurrent additions instead of piling them at the tail. Every rejected alternative (§4.2) fails at least one of these: a JSON array conflicts on every concurrent append; YAML and TOML need a parser this project will not add; prose is the lossy status quo. |
| **D8-07** | `memories.layer` is added **without** a CHECK constraint. The domain (`'local' \| 'shared'`) is enforced in TypeScript and asserted by an audit query. | SQLite cannot alter a CHECK constraint; widening one requires a full table rebuild, which for `memories` means dropping and recreating the FTS5 triggers — the `004_v03_knowledge.sql` path this release and the last both avoid on purpose. A third layer is foreseeable (a `vendor` or `org` tier), and paying a rebuild for it later would be a self-inflicted wound. New tables (`shared_entries`, `okf_imports`) do carry CHECK constraints, because they can be created correctly the first time. |
| **D8-08** | The OKF file is written through `ArtifactWriter.apply()` with a new `mode: "whole"`. No second write path is introduced. | v0.6.0's D6-01 made "exactly one call site of `apply()`" a contract, and `tests/unit/single_write_path.test.ts` enforces it by scanning `plugin/`. A convenience `writeFileSync` in `SharedLayer` would break that test, and the correct reaction to a failing invariant test is not to weaken it. The new mode inherits every v0.6.0 guarantee — temp file, `fsync`, atomic `rename`, `hashBefore`/`hashAfter` recorded in `artifact_writes` including on refusal, `noop` on identical bytes — and the marker-scoped mode is untouched, because `AGENTS.md` is a file humans edit and `.kevin/knowledge.okf` is not. |
| **D8-09** | Tombstones are **absorbing and permanent** for a given `entry_id`. There is no undelete. | The merge is a semilattice only if every field operation is monotone. An undelete flag makes the `op` field's resolution depend on which side is newer, which reintroduces the order dependence the format exists to eliminate — and "newer" is unavailable anyway, because clock skew across machines makes timestamps an unreliable tiebreaker. Resurrection is still possible and is honest: author the knowledge again with a changed statement, which is a different `entry_id`. An unchanged statement is recoverable from git history, which is where one looks for a deleted line in a committed file. |
| **D8-10** | Imported shared entries are projected into the existing `memories` table with `layer='shared'`, not queried from a parallel store. | This is what keeps the release small. `getRelevant()`, `rankScore()`, the five injection gates, `truth_penalty`, `ConflictDetector`, the `Archiver` and every audit rollup keep working unmodified, because a shared memory is a memory. The alternative — a union query across two tables at retrieval time — would touch the hottest code path in the plugin, would need the ranking formula duplicated, and would make the v0.5.0 precision instruments lie by measuring two populations separately. |
| **D8-11** | When the shared layer is enabled, `Curator` renders the `AGENTS.md` block from `shared_entries`, not from local `memories`. | The committed block and the committed file are both read by reviewers, and if they could disagree there would be no way to tell which was lying. Rendering the block as a projection of the file makes disagreement unrepresentable and makes a pull request show substrate and rendering changing together. When the flag is off, the v0.6.0 path runs untouched. |
| **D8-12** | `shared_entries` declares **no** `REFERENCES` to `memories`. | `Store` sets `PRAGMA foreign_keys = ON`, so a declared foreign key is enforced, and an entry legitimately arrives from a teammate before any corresponding local memory exists — that is the normal case on a fresh clone, not an edge case. A foreign key would make `import()` fail on precisely the workflow the release is built for. This follows the `curation_proposals` precedent from v0.6.0 (D6-06), for the same reason. |
| **D8-13** | The file carries `evidence` and `recurrence` as integers merged by **max**, `created_at` merged by **min**, and **no `confidence` field at all** — confidence is derived on read via the v0.4.0 `computeConfidence(evidence, recurrence)`. | Max is associative, commutative and idempotent; a mean is none of those without carrying a count, and carrying a count would let one machine's repeated re-exports inflate the weight of its own opinion. Confidence is excluded because it is already a derived quantity in this codebase — `okf-export.ts:103` writes it and `okf-import.ts` ignores it — and transporting it alongside a max-merged `recurrence` would produce records that contradict their own formula (a join of `evidence 5 / recurrence 0 / conf 0.9` with `evidence 5 / recurrence 3 / conf 0.4` would assert 0.9 against 3 recurrences). Deriving instead makes every join internally consistent, removes floats from the file entirely so byte-determinism is unconditional, and reprices shared and local memories together if the formula ever changes. `recurrence` merging by max is the pessimistic direction on purpose: a rule that misfired on a teammate's machine is evidence about the rule, not about the teammate. `created_at` uses min because an entry's birthday is when anyone first asserted it, and min is the only choice stable under replay. `shared_confidence_floor` at `0.7` remains the export gate, and `precision_shared` vs `precision_local` in `kevin_audit` remains the instrument that would expose the pooling if it turns out to be unwarranted. |
| **D8-14** | `parse()` is a **total function**: it never throws on any input, reports unusable lines as `RejectedLine`s, and keeps everything else. Conversely, `planExport()` **refuses** to write over a file that produced any rejected line. | The file is expected to arrive damaged — a conflict resolution can leave `<<<<<<< HEAD` markers in it, an editor can truncate it, a merge tool can mangle an encoding. Throwing would take the plugin down over a text file; losing the corpus would be worse. So reading degrades gracefully and reports. Writing does the opposite: overwriting a file with unresolved markers would silently destroy a teammate's entries under the guise of a merge, so Kevin refuses, records the refusal, and asks the user to resolve the conflict first — by keeping both sides, which §5.4 makes correct. |

---

## 8. Changes per file

| File | Change | Tasks |
|---|---|---|
| `migrations/009_v08_team.sql` | **New.** Two tables, five indices, three columns, six metric seeds, five setting seeds, `schema_version '009'`. | `K8-001` |
| `plugin/Migrate.ts` | Register `009`; add the post-apply hook `"009"` (back-fill `repo_id`, normalize `layer`, re-derive `shared_entries_total`). | `K8-002` |
| `plugin/RepoIdentity.ts` | **New.** `resolve()`, `parseGitConfigRemote()`, `normalizeRemote()`, `computeRepoId()`. No `child_process`, no network, no dependency. | `K8-005`, `K8-006` |
| `plugin/okf.ts` | **New.** `computeEntryId()`, `canonicalize()`, `serialize()`, `parse()`, `join()`, `merge()`, `deriveConfidence()`, plus the format constants. Imports nothing from `okf-export.ts` or `okf-import.ts`. | `K8-010` … `K8-015` |
| `plugin/okf-export.ts` | **Pre-existing (OKF v1, v0.3.0).** Untouched except for the scoping fix: `selectExportRows()` gains a `project_id` predicate. The bundle format is frozen. | `K8-027` |
| `plugin/okf-import.ts` | **Pre-existing (OKF v1, v0.3.0).** Untouched. It must not learn to read v2, and `importOkf()` must not be reachable from `kevin_sync`. | `K8-027` |
| `plugin/SharedLayer.ts` | **New.** `read()`, `import()`, `planExport()`, `applyExport()`, `planTombstone()`. | `K8-016`, `K8-017`, `K8-020` |
| `plugin/ArtifactWriter.ts` | Add `WriteMode = "markers" \| "whole"`. The marker path is byte-for-byte unchanged; the whole-file path reuses temp+fsync+rename, hashing and `artifact_writes` auditing. | `K8-019` |
| `plugin/MemoryService.ts` | Scope retrieval on `repo_id`; accept and persist `layer`, `repo_id`, `shared_entry_id`; refuse local writes to `statement`/`type`/`scope`/`confidence`/`evidence_count` on `layer='shared'` rows. `rankScore()` **unchanged**. | `K8-007`, `K8-018` |
| `plugin/Curator.ts` | `candidates()` gains a source parameter; renders from `shared_entries` when `shared_layer_enabled='1'`. Predicate, caps and deterministic sort unchanged. | `K8-023` |
| `plugin/index.ts` | Wire `RepoIdentity.resolve()` at startup next to line 68; register the three new tools; extend `KEVIN_CONFIG_KEYS` with the five new settings; call `kevin_sync` on `session.idle` when enabled. | `K8-003`, `K8-008`, `K8-009`, `K8-021`, `K8-022` |
| `plugin/Retrospective.ts` | Extend `METRIC_KEY_LABELS` with the six new metric keys. | `K8-003` |
| `plugin/tools/kevin_audit.ts` | Add the `team` block (§5.8), pure SQL, including `precision_shared` and `precision_local`. | `K8-023` |
| `scripts/verify-install.ts` | Add `009_v08_team.sql` to the hard-coded copy list at lines 61-79. | `K8-004` |
| `package.json` | Version `0.8.0`. Dependencies **unchanged**. | `K8-026` |
| `README.md`, `AGENTS.md` | Document the shared layer, the OKF format, the three tools, and the five settings. | `K8-025` |

---

## 9. Tasks

| Phase | IDs | Content |
|---|---|---|
| **F0 Substrate** | `K8-001` … `K8-004` | Migration `009`, `Migrate` registration and the `"009"` post-apply hook, config keys plus `METRIC_KEY_LABELS`, `verify-install.ts` filename list. |
| **F1 Identity** | `K8-005` … `K8-009` | `.git/config` INI reader and remote normalization, `computeRepoId()` and the three-source `resolve()`, retrieval scoped on `repo_id` with a v0.7.0 equivalence proof, `.kevin/project.json` with `kevin_project show`/`init`, confirm-gated transactional `rekey`. |
| **F2 OKF format & codec** | `K8-010` … `K8-015` | `computeEntryId()`, byte-deterministic `canonicalize()`/`serialize()`, the total `parse()` and its rejection taxonomy, the `join()` lattice, `merge()` with associativity/commutativity/idempotence property tests, and the git-conflict-marker fixture. |
| **F3 Two-layer store** | `K8-016` … `K8-020` | `import()` with `okf_imports` auditing and the file-hash skip, projection into `memories` including tombstone retirement, shared-row immutability enforcement, `ArtifactWriter` `mode:"whole"` with the extended single-write-path test, and `planExport()`/`applyExport()` with all eight refusal reasons. |
| **F4 Team surfaces** | `K8-021` … `K8-023` | `kevin_share` with its dry-run default and approval gate, `kevin_sync` plus `session.idle` wiring, `Curator` rendering the shared layer and the `kevin_audit.team` block. |
| **F5 Release** | `K8-024` … `K8-027` | Two-clone end-to-end closed loop, documentation, the OKF v1 scoping fix, version bump and a full gate run. |

**Critical path.** `K8-001` → `K8-006` → `K8-007` → `K8-010` → `K8-013` → `K8-014` → `K8-016` → `K8-020` → `K8-024` → `K8-026`.

The path runs through the lattice, not through the tools. `K8-013` and `K8-014` are the release:
if `join()` is not a semilattice, every downstream guarantee — silent git merges, order-independent
imports, correct both-sides conflict resolution — evaporates, and no amount of tooling above it
compensates. They are scheduled early for that reason and their property tests are the gate on
starting F3.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| Any network transport: a sync server, a registry, an account, a hosted corpus | Roadmap §7 permanent non-goal, and D8-01. Git is the transport. | **Never** |
| Kevin invoking `git` (`add`, `commit`, `pull`, `push`) or any other process | §3.5's zero-spawn property is worth more than the convenience, and a tool that commits on a user's behalf is a tool that will one day commit something they did not read. The user commits. | **Never** |
| Automatic conflict resolution between two contradicting shared rules | v0.7.0's D7-06 stands: conflicts are surfaced, never resolved. A shared layer makes the rule more important, not less. | **Never** |
| Automatic re-keying of an existing corpus onto a git-derived id | D8-03. Silent corpus merges are unrecoverable and undiffable. | **Never** |
| Encryption or signing of the OKF file | The file lives in a repository the team already trusts with its source code; adding key management would be security theatre with real operational cost. | **Never** |
| Per-entry access control, roles, or ownership | There is one trust boundary — the repository — and it is enforced by the forge, not by Kevin. | **Never** |
| Raw author email in the shared file | A committed file is permanent; a corpus of engineer email addresses is a liability nobody requested. Hashed or absent. | **Never** |
| Cross-repository knowledge sharing (an org-wide corpus) | Requires a transport, which requires a server. Would also break the `repo_id` scoping model that makes this release comprehensible. | **Never** |
| A `shared_boost` term in `rankScore()` | §5.7. A teammate's rule is not a priori more true than yours, and an unfalsifiable boost in a release about checkable knowledge would be self-refuting. | **Never** |
| Undelete for tombstoned entries | D8-09. Breaks the semilattice. Re-author, or read git history. | **Never** |
| Migrating `verify-install.ts` to enumerate `migrations/` instead of hard-coding filenames | Correct fix, unrelated to this release, and touching the install verifier while shipping a new migration doubles the blast radius of a mistake. | **v0.9.0** |
| A TUI panel for reviewing incoming shared entries | Depends on the v2 plugin API's UI surface. | **v0.9.0** |
| `okf` schema v3, multi-file corpora, per-directory OKF files | Premature at 2000 entries. Revisit only if a real repository exceeds the cap. | **Post-1.0** |
| Merging `shared_entries` into the FTS5 index for full-text retrieval of teammates' statements | The projection into `memories` (D8-10) already puts them in the index by construction; a second index would be redundant. | **n/a — solved by D8-10** |

---

## 11. Final verification

### 11.1 The four gates

| Gate | Command | Criterion |
|---|---|---|
| Types | `npm run typecheck` | Zero errors under `strict`. |
| Lint | `npm run lint` | Zero Biome findings. |
| Tests | `npm test` | Full suite green; no test skipped to make it so. |
| Install | `npm run verify` | Passes, **with `009_v08_team.sql` present in the copy list** (`K8-004`). |

### 11.2 Release-specific checks

Every item below is a falsifiable assertion, not a review note.

1. **Migration idempotency.** `Migrate.run()` executed twice against the same database produces
   no error, no duplicated metric row, and no duplicated setting row. Identical criterion to
   `006`, `007` and `008`.
2. **Retrieval equivalence.** A v0.7.0 database snapshot, migrated to `009`, returns a
   **byte-identical** `getRelevant()` result — same rows, same order, same scores — as the same
   snapshot read by v0.7.0. This is the whole backward-compatibility claim and it is testable
   against a fixture rather than argued.
3. **Default inertia.** With `shared_layer_enabled='0'`, no OKF file is created, no
   `okf_imports` row is written, and `Curator` output is identical to v0.6.0's. A release whose
   first side effect is a new file in someone's repository must do nothing until asked.
4. **Id stability across scopes.** `computeEntryId(type, statement, scope)` returns the same value
   for the same triple under two different `project_id`s and two different working directories,
   and a **different** value when casing or a path reference in `statement` changes. Both halves
   matter: the first is what makes clones agree, the second is what `fingerprint()` would have
   destroyed.
5. **Serialization determinism.** `serialize(parse(serialize(e, r, v)).entries, r, v)` is
   byte-identical to `serialize(e, r, v)` for every fixture, and key order in every emitted line
   is alphabetical.
6. **The semilattice.** Over ≥1000 randomized entry pairs: `merge(a,b) === merge(b,a)`,
   `merge(merge(a,b),c) === merge(a,merge(b,c))`, and `merge(a,a) === a`, compared by canonical
   serialization. This is the release's exit criterion and it is a property test.
7. **Both-sides conflict resolution.** A fixture file containing `<<<<<<<`, `=======` and
   `>>>>>>>` markers around two divergent versions of the same entries parses to the same corpus
   — after dropping the three marker lines as `RejectedLine`s — as a careful manual merge of the
   two sides.
8. **`parse()` totality.** `parse()` returns without throwing for: empty input, a single NUL byte,
   4 MB of random bytes, a valid file with CRLF endings, a file with a UTF-8 BOM, a file whose
   header claims version 3, and a truncated final line. Every case reports rather than raises.
9. **Tombstone monotonicity.** For any permutation of a fixture containing an `assert` and a later
   `tombstone` of the same `entry_id`, the folded result is `tombstone`, and the projected memory
   is `status='archived'`.
10. **Zero spawns, zero sockets.** A source scan of `plugin/` after this release still returns no
    match for `child_process`, `execSync`, `spawn`, `fetch(`, `http://` or `https://`. §3.5's
    property is a test, not a memory.
11. **Single write path.** `tests/unit/single_write_path.test.ts` still finds exactly one
    `ArtifactWriter.apply()` call site, and exactly one construction site using `mode: "whole"`.
12. **Credential safety.** `normalizeRemote()` returns a string containing no `@`, no `:` before
    the host, and no substring of any credential, for a corpus of URL fixtures including
    `https://user:token@host/path.git`.
13. **Shared-row immutability.** An attempt to update `statement`, `type`, `scope`, `confidence`
    or `evidence_count` on a `layer='shared'` memory is refused and counted; `feedback_*`,
    `truth_penalty`, `ignored` and injection outcomes succeed.
14. **Re-key is never implicit.** Starting from a migrated v0.7.0 database inside a git checkout
    whose remote yields a different `repoId`, no memory changes `repo_id` until
    `kevin_project rekey {confirm: true}` is called; `kevin_project show` reports the pending
    discrepancy.
15. **Two-clone closed loop (`K8-024`).** Two temp directories, two databases, one OKF file copied
    between them to simulate `git pull`: a memory promoted in A is retrievable and injectable in B
    after one `kevin_sync`, and `injections_from_shared` increments.
16. **The two OKF formats stay separated.** `plugin/okf.ts` imports nothing from `okf-export.ts`
    or `okf-import.ts` and vice versa; `okf.parse()` rejects a v1 frontmatter bundle wholesale
    (`not_okf`, zero entries, no throw), and `importOkf()` applied to a v2 file imports zero
    entries. A grep asserts `importOkf` has exactly one call site, in the `kevin_import` tool.
17. **No float reaches the file.** Serializing a corpus whose derived confidences include
    `0.1 + 0.2` produces a byte string containing no `.` inside any JSON number, and
    `deriveConfidence()` is never called by `serialize()`.
18. **The demotion signal survives the round trip (`K8-027`).** An entry with
    `evidence 5, recurrence 3` exported, merged with a copy carrying `recurrence 0`, and re-imported
    yields `recurrence 3` and a derived confidence equal to `computeConfidence(5, 3)` — never the
    undemoted value.

---

## 12. Summary of what changed from v0.7.0

| Area | v0.7.0 | v0.8.0 |
|---|---|---|
| Storage | one SQLite file, one home directory | **two layers** — private DB plus a committed OKF file |
| Scope | `project_id = fingerprint(process.cwd())` | `repo_id`, resolved from a declared id, the git remote, or the path; `project_id` retained as provenance |
| Survives `git clone` | no | **yes** |
| Survives `mv` of the project directory | no | yes, once `.kevin/project.json` exists or a remote is present |
| Shared artifact | `AGENTS.md` marker block — lossy, unmergeable, no round-trip | `.kevin/knowledge.okf` — typed, scored, attributed, supersedable, mergeable |
| Merge semantics | none | a proven semilattice: associative, commutative, idempotent |
| Git conflicts in Kevin's output | manual, in prose, in `AGENTS.md` | resolved by keeping both sides — and that is *correct*, not a compromise |
| Files Kevin writes | `AGENTS.md` (marker-scoped) | `AGENTS.md` (marker-scoped) + `.kevin/knowledge.okf` (whole), **one** `apply()` call site |
| `AGENTS.md` block source | local `memories` | the shared layer, when enabled (D8-11) |
| Author attribution | none | `fnv1a64(email)` or nothing; never a raw address |
| Ranking | `BM25 × origin_boost × recency_decay × (1 - truth_penalty)` | **identical** — no shared boost, deliberately |
| Process spawns / network calls | 0 / 0 | **0 / 0 — unchanged and now under test** |
| Metric keys | 33 | **39** |
| Setting keys | 18 | **23** |
| Tools | 18 | **21** |
| Migration | `008` | `009_v08_team.sql` (additive, no rebuild) |
| Runtime dependencies | `@opencode-ai/plugin`, `zod`, optional `better-sqlite3` | **unchanged — zero added** |

---

## 13. References

- `docs/Kevin_Roadmap.md` — §4 (the version ladder), §5.4 (this release's scope and exit
  criterion), §6 (kill criteria, now measurable per-layer via `precision_shared`), §7 (permanent
  non-goals, of which a hosted sync service is the one this release was most tempted by).
- `docs/Kevin_v0.6.0_Plan.md` — D6-01 (the single write path this release extends without
  duplicating), D6-04 (atomic write and hash auditing), and the `Curator` predicate reused in §5.9.
- `docs/Kevin_v0.7.0_Plan.md` — Principle 24 (contradiction de-ranks, never deletes — and why a
  committed tombstone is not contradiction), Principle 26 (declare your fingerprint dimension,
  which §3.3 does), and `RepoTruth`'s precedent for reading project files with no dependency.
- `plugin/fingerprint.ts` — line 42 `normalize()` and line 76 `fingerprint()`; the two facts that
  make `fnv1a64()` the only correct id function for OKF (§3.3, D8-05).
- `plugin/index.ts` — line 56 (the single global database) and line 68 (the path-derived scope);
  the two lines this release exists to address.
- `migrations/004_v03_knowledge.sql` — the table-rebuild precedent §6 avoids for the second
  release running, and the reason `layer` carries no CHECK constraint (D8-07).
- `migrations/005_v04_signal.sql` — the banner and section style §6 follows.
- `scripts/verify-install.ts` lines 61-79 — the hard-coded migration list extended by `K8-004`.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 Substrate | K8-001 … K8-004 | `[ ]` Pending |
| F1 Identity | K8-005 … K8-009 | `[X]` Complete |
| F2 OKF format & codec | K8-010 … K8-015 | `[X]` Complete |
| F3 Two-layer store | K8-016 … K8-020 | `[ ]` Pending |
| F4 Team surfaces | K8-021 … K8-023 | `[ ]` Pending |
| F5 Release | K8-024 … K8-027 | `[ ]` Pending |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

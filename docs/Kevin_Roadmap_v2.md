# Opencode-kevin — Roadmap 2: v1.0.0 → v2.0.0

**Version:** 1.1
**Date:** 2026-08-25
**Status:** Active — supersedes all forward-looking planning after `Kevin_Roadmap.md`
**Baseline:** v1.0.0 "Proven" (tagged 2026-08-21, commit b7c419f)
**Type:** Strategic roadmap + honest assessment + ADRs
**Author:** ox-alpha (based on a complete audit of the source code and the market)

**Document changelog:** v1.1 (2026-08-25) — incorporates measurable market data (npm
downloads and GitHub stars captured via public APIs on 2026-08-25; methodology in
Appendix A), elevates **distribution** to a mandatory workstream per release, pulls the
cold-start fix forward (minimal importer in v1.5.0), adds sub-thesis T8 and the adoption
indicators (§8).

**Inputs (pre-split snapshot 2026-08-25; post-Bedrock 2026-08-29: `packages/core/src/` ~66 + `packages/plugin/src/` 4 + `packages/tui/src/` 3, `packages/core/migrations/` 001..012):**

- `plugin/` — complete audit of all 56 modules (exactly 17,572 lines), 11 migrations, `package.json`.
- `CHANGELOG.md` — fourteen bumps, 0.1.0 → 1.0.0, from 2026-07-02 to 2026-08-21.
- `docs/CONTRACT.md` — clauses C-01…C-09 and their compatibility policy.
- `docs/Kevin_Roadmap.md` — the roadmap to v1.0.0, its theses (T1–T3) and kill criteria (K1–K6).
- `docs/Kevin_v0.9.0_Plan.md`, `docs/Kevin_v1.0.0_Plan.md` — explicit post-1.0 deferrals.
- Adoption data captured via public APIs on 2026-08-25 (`api.npmjs.org`,
  `api.github.com`): npm weekly/monthly downloads for every opencode memory plugin;
  GitHub stars/forks/license metadata for this repo, its main competitor and the host.
  Full capture tables in Appendix A.
- `bench/corpus/`, `bench/results/2026-08-21-adecbdf4c7af82e2.json` — the published benchmark.
- Market research (2026-08-23…25): native memory state in Claude Code / Codex / Gemini / Cursor / opencode; MCP spec 2026-07-28; Agent Skills standard (`agentskills.io`); MIF; Mem0/Letta/Zep; npm competition within opencode. Sources in Appendix A.

---

## 0. How to read this document

Section 1 is a portrait of the market **as it stands today**, not as it stood when roadmap
1 was written (2026-08-11). Two weeks were enough for the factor that roadmap called
"risk K5" — *the host subsumes the function* — to go from hypothesis to active process,
with three open PRs against the host.

Section 2 contains the strategic decision this document was explicitly asked to make:
opencode-only, or open to other harnesses? The answer is not binary and comes with
verifiable reasons, not personal taste.

Section 3 sets five ADRs: hard-to-reverse decisions taken with the documentation in front
of us. Section 5 deploys the ladder: **five intermediate tags** (v1.1.0 → v1.5.0) closing
at v2.0.0. Each release has one theme, one falsifiable exit criterion, and a declaration
of impact on contract v1. Sections 6–7 are the updated risk register and the anti-roadmap;
section 8 fixes the adoption indicators (public signals, never exit gates).

Conventions continuing from roadmap 1: globally numbered principles (continuing from 39),
per-release decision logs (`D11-NN`…`D16-NN`), tasks `K11-NNN`…`K16-NNN`, additive
migrations from `012`, per-release Plan/Task documents.

---

## 1. The world on August 25, 2026

### 1.1 The host is already building native memory — K5 activated

Roadmap 1 defined K5: *"An upstream opencode feature subsumes the core function"* with a
prescribed response: *"Reposition as a curation and measurement layer on top of it, or
retire honestly."* Status today:

| Host | Native memory | State |
|---|---|---|
| Claude Code | **Auto Memory** — `~/.claude/projects/<hash>/memory/` with `MEMORY.md` (index, first 200 lines / 25KB loaded per session) + topic files; typed `type` field in frontmatter; on by default | **Shipped** |
| Codex CLI | **Memories** — background consolidation of rollouts into `~/.codex/memories/{memory_summary.md, MEMORY.md, raw_memories.md}`; hierarchical AGENTS.md walk with silent 32KiB cap; **not available in EEA/UK/Switzerland** | **Shipped** (partial by region) |
| Cursor | Native Memories + rules + `.cursor/skills/` since 2.4 (2026-01-22) | Shipped |
| Windsurf | Memories + Rules | Shipped |
| Gemini CLI | Hierarchical GEMINI.md + `/memory`; `~/.gemini/memory/<hash>/` | Shipped (basic) |
| **opencode** | **Three open PRs**: #20344 (`.opencode/MEMORY.md` + heuristic extractor + SQLite), #43870 (background LLM extraction + system prompt injection), #44539 (Anthropic-style `memory` tool + `core/memory` context source) | **In progress — none merged as of today** |

Honest reading: capture-and-reinject — what Kevin has done since v0.1 — is ceasing to be a
product and becoming *a host feature*. This does not kill Kevin; it kills **the version of
Kevin that competes with the host**. What none of the host PRs have, and no host's native
memory anywhere has, is what roadmap 1 already identified: curation with human approval, a
git-friendly exchangeable format, honest effect measurement, a public contract. ADR-005
formalizes the coexistence.

### 1.2 Distribution has moved to protocols

While the capture layer commoditizes, the **distribution** layer has converged on three
open standards that did not exist (or were drafts) when Kevin was born:

1. **Agent Skills (`SKILL.md`, agentskills.io).** Published as an open standard on
   2025-12-18; Microsoft and OpenAI adopted it within ~48h; by mid-2026 it is supported by
   40+ clients (Claude Code, Codex, Cursor, Gemini CLI, Copilot, VS Code, Goose,
   **OpenCode**…), governed by the Linux Foundation's Agentic AI Foundation. One canonical
   directory (`.agents/skills/`) plus per-host mirrors (`.claude/skills/`,
   `.cursor/skills/`). Progressive disclosure built in (~100 tokens of metadata at
   startup). OpenCode additionally discovers `.claude/skills/` and `.agents/skills/`
   **out of the box**. Known ecosystem risk: the Snyk ToxicSkills audit found critical
   issues in 13.4% of audited skills — Kevin's untrusted-input boundary (C-09) goes from
   good practice to selling point.
2. **MCP 2026-07-28.** The spec published last July removed the stateful core: goodbye
   handshake and `Mcp-Session-Id`; `_meta` per request; `server/discover`; list caching
   (`ttlMs`/`cacheScope`); extensions framework; formal deprecation policy. Every relevant
   harness speaks MCP (Claude Code, Codex via `[mcp_servers]`, Cursor, Windsurf, Gemini
   CLI, Cline, Roo, Goose, Warp, **OpenCode**…). A local MCP server is now **the**
   universal channel for exposing memory read/write without writing a hooks adapter per
   host.
3. **AGENTS.md under a foundation.** The AGENTS.md convention now lives under the Agentic
   AI Foundation (Linux Foundation); Codex/Cursor/Aider/Jules read it natively, Claude Code
   imports it, Gemini CLI accepts it configurable. It remains the ecosystem artifact with
   the best distribution — exactly as roadmap 1 said, which is why curation into AGENTS.md
   remains Kevin's heart.

Additionally there is **MIF** (Memory Interchange Format, SEP-2342): the proposed
vendor-neutral interchange envelope (`id/content/type/timestamp/source/metadata`, PII
redaction, content-hash dedup). It was closed by the MCP TSC with *"get adoption first"*,
and the author maintains it as an independent spec (`varun29ankuS/mif-spec`). Not a
standard yet; a directional signal. Kevin's OKF format already converges with those fields
almost one-to-one (`entry_id/type/statement/scope/created_at`).

### 1.3 The verification gap remains open — and it is Kevin's position

The August 2026 comparative analysis of Mem0/Letta/Zep ends with the sentence that matters
most to this roadmap:

> *"Until somebody outside the vendors runs all three on one harness and publishes the
> harness, the only trustworthy benchmark is the one you run on your own conversations."*

Mem0 ($24M Series A, exclusive memory provider for AWS's Agent SDK, 35M→186M API calls in
2025), Letta (sleep-time compute, arXiv:2504.13171) and Zep/Graphiti (bi-temporal graph,
arXiv:2501.13956) publish benchmarks incompatible with each other. None exposes an
injection ledger or a precision rate. None freezes its surface in a testable contract.
Kevin — 25 tools, contract C-01…C-09 with append-only golden file, reproducible four-arm
benchmark (P@5 0.95 / R@5 0.55 / MRR 1.0 against baselines), verified p95 budgets — is
literally the only memory layer in the ecosystem that **measures itself in the open**.
That asset, built through v0.5→v1.0, is worth more today than when it was built, because
the market just declared it scarce.

### 1.4 Direct competition inside the opencode ecosystem

Data from npm's and GitHub's public APIs captured 2026-08-25 (`api.npmjs.org/downloads/
point/last-week/...` and `api.github.com/repos/...`; npm counts every install including
CI, so these approximate interest, not active users — full capture in Appendix A):

| Plugin | What it is | dl/week<br>(Aug 18–24) | GitHub |
|---|---|---:|---|
| `opencode-mem` (tickernelz) | Turso/libSQL with native vector search, idle LLM auto-capture, user profile, web UI at :4747 | **2,512** | 1,438 stars / 144 forks |
| **`@jmtrin/opencode-kevin`** | Kevin v1.0.0 | **475** (1,287/month) | **1 star / 1 fork** |
| `@mem0/opencode-plugin` (official mem0) | 9 tools + 9 skills + lifecycle hooks over the mem0ai SDK (cloud or OSS) | 111 | — |
| `claude-mem-opencode`, `opencode-memory-plugin`, `opencode-claude-mem` | claude-mem ports/wrappers (HTTP worker + Chroma + AI compression) | 18 / 10 / 3 | — |
| `agentmemory`, `agent-recall`, `Contynu` | Multi-harness servers (hooks+MCP+REST) that also cover opencode | n/d | Growing, outside the niche |

Two readings that change decisions in this roadmap:

1. **Traction exists.** Eight weeks after launch and with zero marketing, Kevin is the
   **second memory plugin in the niche by downloads**, ahead of Mem0's *official* plugin
   (475 vs 111) and all claude-mem ports combined. Its adoption velocity (~59 dl/week per
   week of life vs ~76 for the leader) is the same order of magnitude. The problem is not
   product-market fit; it is scale.
2. **The usage/community asymmetry is extreme.** 475 weekly installs coexist with ONE star
   (the leader: 1,438). And three public trust signals are broken or missing: GitHub's API
   reports `license: null` (no `LICENSE` file), empty homepage, zero published GitHub
   Releases. The strategic conclusion is direct: **distribution is a measured deficiency,
   not an opinion** — which is why roadmap v1.1 makes it a mandatory workstream in every
   release (§5.1 item 6, §8).

What all competitors share and Kevin does not: dependence on an LLM to extract/compress
(per-session cost, non-determinism) or on a vector service/db. What Kevin has and none
does: total determinism (zero LLM in the core loop, zero network, zero marginal cost),
human-approved curation, git-mergeable sharing, and measurement. What they all have and
Kevin lacks: semantic search, "remember everything" passive capture and — most decisively
per the data — **value visible in the first session** (rich memories from boot, UI). Roadmap
1's anti-roadmap rejected embeddings with a reopening condition — we keep it (§7);
cold-start, however, is attacked in this ladder (§5.5 item 5).

### 1.5 What remains scarce in 2026 (summary)

1. **Auditable trust**: knowing *why* memory believes what it believes, and what changed.
2. **Artifacts with distribution**: content that outlives the plugin (AGENTS.md, skills,
   git-friendly files) instead of private DB state.
3. **Serverless interoperability**: one local brain shared across tools with no cloud and
   no proprietary sync.
4. **Honest measurement**: a public harness, negative results published, a defensible
   token budget.
5. **Security of generated content**: escaping and untrusted-input handling in a skills
   ecosystem with 13–36% security findings.

Kevin is already world-class at 1, 4 and 5 inside its niche; has solid foundations at 2
(Curator/OKF); and almost nothing at 3. The section 5 ladder attacks exactly 3 and 2, with
1/4/5 as cross-cutting differentiators.

---

## 2. Strategic decision: opencode-only or multi-harness?

### 2.1 Verdict (honest opinion, as requested)

**Neither extreme: "portable core, protocol-based distribution, opencode as the deep
reference host".** Concretely:

1. **Extract the deterministic core into a host-agnostic package** (`kevin-core`). It is
   viable at surprisingly low cost: of the plugin's 17,572 lines, ~14,500 are already pure
   modules with zero typed host imports. Real coupling is **two imports in `index.ts:5-6`**
   (`Hooks, Plugin`, `tool`) plus three already duck-typed frontier modules (`native.ts`,
   `host.ts`, `capabilities.ts`). `replay.ts` already proves the whole pipeline runs
   hostless against `:memory:` with a frozen clock. Nothing needs rewriting: we need to
   **declare the border that already exists**.
2. **Open distribution through protocols, not hosts**: local MCP server (read, and gated,
   write), conformant Agent Skills emission into `.agents/skills/`, MIF as the import/export
   envelope, AGENTS.md/OKF as artifacts. These four channels reach Claude Code, Codex,
   Cursor, Windsurf, Gemini CLI and any MCP client **without maintaining a single new hook
   adapter**.
3. **Keep opencode as the only deeply integrated host** (tool call observation, causal
   chains, injection, TUI). It is where Kevin lives, where its observation pipeline is
   irreplaceable, and where the project community can support it. Any additional deep
   adapter (Claude Code hooks) stays **conditional** on demonstrated demand for the MCP
   channel (gate in §5.6).

### 2.2 Why NOT "opencode-only"

- **K5 is a matter of time.** The three native-memory PRs in opencode (#20344, #43870,
  #44539) are active this very week. When one merges, the value of an opencode-only capture
  layer falls; the value of an agnostic curation/measurement/sharing layer rises. Locking
  into a single host the same month the host announces the feature is betting against
  roadmap 1 itself (which prescribed the K5 answer).
- **The niche ceiling is low and the rest of the market is enormous.** The entire
  opencode memory niche moves ~3,100 dl/week across all plugins; the niche's absolute
  leader (2,512 dl/week, 1,438 stars in seven months) marks the realistic ceiling of an
  opencode-only strategy. Against that, the opencode host alone holds 201,293 stars, and
  Claude Code/Codex/Cursor order still larger installed bases. The marginal cost of
  reaching them via protocols is small; the opportunity cost of not doing it, large.
- **Kevin's assets are portable by construction.** OKF, curation, benchmark, contract,
  SQLite store: nothing there is opencode-specific. Staying opencode-only would waste the
  design.

### 2.3 Why ALSO not "deep adapters for five hosts"

- **Every host's hook surface is unstable and different.** Claude Code has ~12 proprietary
  hooks; Codex just launched a plugin platform whose self-serve publishing is "coming
  soon" and whose hooks are silent on Desktop (issue #16430 open); Cursor documents no
  public packaging contract; Gemini CLI documents no hook surface. Maintaining N deep
  integrations against N moving APIs is the classic trap that kills plugins one by one.
- **The deep channel is unnecessary for 80% of cross-harness value.** Reading/writing
  memory (MCP), receiving relevant knowledge (skills pull), consuming curated knowledge
  (AGENTS.md/OKF) covers the loop outside opencode. Rich passive observation — the part
  requiring hooks — is precisely the part every host is nativizing (§1.1); competing there
  against the host is the definition of K5.
- **C-09 (zero network, zero spawns) is non-negotiable** and constrains resident-worker
  designs (claude-mem-style). The chosen protocols run in-process or stdio/loopback.

### 2.4 What this implies for contract v1

Good news verified against `CONTRACT.md`: **all of the above fits in 1.x as additions**
(`added_ok` with `since`). New packages (`kevin-core`, the MCP server), new tools, new
setting keys, additional export formats: additive. That is why the ladder can build all the
value in minors and reserve **v2.0.0 for what genuinely requires breakage**: freezing the
new surfaces as contract v2, executing the retirements measurement orders, and delivering
the written migration path policy §5.4 requires for C-01/C-02 whenever something the user
owns changes.

---

## 3. Architecture decisions (ADRs)

Format: Context → Decision → Consequences → Rejected alternatives.

### ADR-001 — Hostless core with a thin adapter (v1.3.0)

**Context.** ~83% of the code is already host-agnostic; real coupling is two imports plus
three duck-typed modules; the replay harness runs hostless. But the border is undeclared:
`index.ts` mixes host wiring with global session logic, and `process.cwd()`/`homedir()`
appear scattered (RepoTruth, Retrospective, Materializer, Curator, kevin_doctor).

**Decision.** Extract `@jmtrin/kevin-core`: Store/Migrate/sqlite-adapter, MemoryService,
Reflector, CausalChain, PatternMiner, ConventionMiner, QualityGate, InjectionLedger,
ContextInjector, Curator, ArtifactWriter, SharedLayer, okf*, RepoIdentity, RepoTruth,
ConflictDetector, Feedback, Archiver, perf, metrics, contract, helpers, bench harness and
the pure logic of every tool (already functions over injected deps). The opencode plugin
becomes the **adapter**: v1 hooks, tool registration with `tool.schema`, capability probes
and later the TUI. Inherited rules stay intact: hot path with no LLM/network/fs-scan;
TEXT settings compared with `=== "1"`; single write funnel (D6-01/D8-08); additive
migrations.

**Consequences.** (+) Total hostless testability; enables ADR-002/003; forces
parameterizing cwd/homedir (known pending improvement). (−) Monorepo/multi-package
management; coordinated versioning; replay↔index drift risk closed with a parity test
(replay stops hand-duplicating wiring and consumes the core directly).

**Rejected.** (a) Rewriting the core over an agent framework — infinite cost, loses
determinism. (b) Declaring a "core" by moving types only — cosmetic, changes nothing real.
(c) Not splitting and distributing by copying the plugin — guaranteed invisible fork.

### ADR-002 — Distribution via standard protocols, not per-host adapters (v1.4.0–v1.5.0)

**Context.** Four converging stable channels exist: MCP (universal across harnesses),
Agent Skills (40+ clients, canonical directories), AGENTS.md (foundation-governed), MIF
(interoperability direction). Deep per-host hooks: fragmented and mobile.

**Decision.** Spend distribution effort on protocols: (1) local stdio MCP server exposing
the memory surface; (2) conformant `SKILL.md` skill emission with `skills-ref validate` in
CI and opt-in per-host mirrors (copies, not symlinks, due to Windows privileges); (3)
AGENTS.md/OKF remain the durable artifacts; (4) MIF as the interchange envelope with a
bidirectional OKF↔MIF bridge. Deep hooks remain limited to opencode (plus the §5.6
conditional).

**Consequences.** (+) Immediate market coverage with O(protocols) maintenance instead of
O(hosts); alignment with the ecosystem's convergence direction. (−) Outside opencode there
is no passive observation: memory enters via agent-driven tools (model push) or offline
file imports; multi-harness corpus quality will depend on agent-driven flow, and that gets
measured (ledger per source).

**Rejected.** (a) Deep per-host adapters now (§2.3). (b) MCP-only without skills — wastes
the only standard progressive-disclosure pull channel. (c) Waiting for MIF-standardization
before moving — bridge cost is minimal and the mapping already converges.

### ADR-003 — Local-first stays absolute in multi-harness mode (cross-cutting)

**Context.** Cross-harness competitors solve sharing with resident HTTP workers
(claude-mem :37777, agentmemory :3111) or cloud. C-09 freezes zero-network and zero-spawn
for Kevin 1.x.

**Decision.** The v1.4.0 MCP server is **stdio** (spawned by the client host itself; no
resident daemon, no ports). If an HTTP mode ever becomes necessary, it will be Streamable
HTTP on loopback per the 2026-07-28 spec, opt-in, never default. No cloud, no telemetry,
no accounts — adoption is estimated from public signals (npm/GitHub) only.

**Consequences.** (+) C-09 survives into v2 intact; privacy as differentiator against the
entire cloud-leaning market. (−) No machine-to-machine sync (same as today); document that
multi-machine sync remains git (OKF) and nothing else.

**Rejected.** Resident daemon with web viewer (claude-mem/agentmemory pattern) — breaks
C-09, adds attack surface and operations.

### ADR-004 — OKF is the durable format; MIF is the interchange envelope (v1.5.0/v2.0.0)

**Context.** OKF v2 is frozen by C-02 and superior for its job: git-mergeable,
deterministically ordered, stable entry_id, ≤4096-byte lines. MIF proposes portability
across memory systems (30+ MCP servers with incompatible formats).

**Decision.** We do not replace OKF. `kevin_export/import --format mif` adds the MIF
envelope as lingua franca in/out, with documented mapping (`entry_id`↔`id`,
`statement`↔`content`, `type/type`, `scope`→metadata, fingerprint↔content-hash dedup,
redact.ts↔PII-redaction metadata). OKF remains the canonical team format; AGENTS.md the
human projection; MIF the customs office.

**Consequences.** (+) Interoperability without sacrificing the C-02 freeze (additive);
ownership of the "git-native native format" position nobody else has. (−) Two formats to
explain; mitigated with a mapping doc and roundtrip property tests.

**Rejected.** (a) Adopting MIF as internal format — would break C-02 for no gain.
(b) Ignoring MIF — giving away interoperability when adoption arrives.

### ADR-005 — Coexistence with host-native memory: ingest, don't compete (v2.0.0)

**Context.** K5 in progress (§1.1). Roadmap 1 already fixed the answer: reposition, don't
compete. There is now a concrete form: hosts write readable local markdown files
(`~/.claude/projects/*/memory/`, `~/.codex/memories/`, future `.opencode/memory/`).

**Decision.** Kevin v2 introduces **MemorySources**: any origin feeding the store
(opencode-plugin = rich default source; offline importers of the host's native files =
complementary sources, local read-only, setting-gated and always off by default). On top
of any of them run Kevin's differential layers: quality gate, dedup/fingerprint, conflict
detection against repo truth, approval-gated curation, OKF sharing, ledger measurement.
The designed-to-fail test (K9 §11.2 check 3 — "the v2 domains have no tool/chat/session")
remains the trigger for revisiting D9-01 if the host exposes new native surfaces.

**Consequences.** (+) Kevin survives and gains value if the host nativizes capture;
becomes "the trust layer" for any memory. (−) Double-counting risk across sources →
mandatory fingerprint dedup and per-source provenance in the ledger.

**Rejected.** (a) Competing with native capture — K5 says no. (b) Depending on private
host APIs to read its internal DB — fragile and opposed to file-based design.

---

## 4. Thesis v2

> **v0.1–v1.0 built a system that observes, learns, curates and measures itself — inside
> one host. v1.1–v2.0 do three things: pay the measured debt, expose the missing human
> interface, and take the brain out of the host without losing the local-first soul: one
> deterministic, auditable brain served over open protocols to any harness, with
> Kevin/opencode as reference integration and richest observation source.**

Four sub-theses and a fifth the data imposed:

- **T4 — Freezing is growing.** Contract v1 does not break to evolve: it extends through
  additions and consolidates into contract v2 only where value is demonstrated. (→ all)
- **T5 — The human interface deserves a UI.** HITL curation has waited two releases for
  TUI panels; the host supports them now. (→ v1.2.0)
- **T6 — Protocols > hosts.** Every new integration point is bought in units of standard
  (MCP, SKILL.md, MIF, AGENTS.md), never units of private API. (→ v1.4–v2.0)
- **T7 — Measure the expansion.** Every new channel carries its own ledger and metrics; if
  a channel produces no evidence of useful use, it retires like the rest. (→ transversal)
- **T8 — Felt AND audited, always distributed.** The measured data (475 downloads/week
  against 1 star; competitors winning on "what is felt in minute five") proves that
  audited properties without perceived value and distribution work do not compete.
  Therefore: (a) every release in this ladder ships at least one improvement perceptible
  in the first session, in addition to verifiable properties; (b) every release includes a
  mandatory distribution package (repo hygiene, published releases, demo, content) with a
  verifiable checklist — engineering without distribution is the specific mistake this
  roadmap forbids repeating.

---

## 5. Version ladder

Six releases. Each has one theme, one falsifiable exit criterion, and does not begin until
the previous criterion is met.

| Version | Name | Theme | Exit criterion (falsifiable) |
|---|---|---|---|
| **v1.1.0** | **Drift** | Continuous measurement + honest debt + public hygiene | Benchmark runs in CI against per-arm/metric regression thresholds; BUG-005 closed with `kevin_forget`; millisecond timestamps; flag audit with on-path test or deprecation; public hygiene checklist green (LICENSE, releases, demo). |
| **v1.2.0** | **Surface** | HITL gets a screen | A user reviews proposals, conflicts and system health from opencode's TUI without leaving to files; the full propose→review→approve flow works from the UI. |
| **v1.3.0** | **Bedrock** | Hostless core declared | `@jmtrin/kevin-core` ships with 100% of core tests running without the host; the opencode adapter contains no domain logic (verified by scan); replay consumes the core (1:1 parity). |
| **v1.4.0** | **Bridge** | Local MCP + public launch | From Claude Code or Cursor, via MCP stdio, a user queries, receives recall and (opt-in) writes to the SAME local DB as their opencode sessions; zero network, zero daemon; cross-harness demo published and kevin-mcp installable without opencode. |
| **v1.5.0** | **Diaspora** | Skills + MIF + day-one corpus | A valid `SKILL.md` skill (skills-ref clean) emitted into `.agents/skills/` is discovered by both Codex AND opencode in the same repo; OKF↔MIF roundtrip property-tested with PII redaction; bootstrap importer produces deduped corpus with visible provenance. |
| **v2.0.0** | **Commonwealth** | Contract v2 + multi-source + consolidation | All new surfaces (core exports, MCP tools, skills layout, MIF profile) frozen in golden file v2; host-native memory importers operational; written C-01/C-02 migration path delivered; measurement-ordered retirements executed. |

Estimated cadence (project history: ~1 minor/month): v1.1.0 Sep 2026, v1.2.0 Oct 2026,
v1.3.0 Nov–Dec 2026, v1.4.0 Dec 2026–Jan 2027, v1.5.0 Feb 2027, v2.0.0 Mar–Apr 2027.
Dates are indicative; exit criteria rule.

Cumulative ladders (monotone; every digit traceable to the §5 scopes): tools 10 → 13 → 16 → 18 → 21 → 23 → 25 → 26; setting keys 6 → 9 → 14 → 18 → 23 → 27 → 31 → 32; metric keys 13 → 22 → 28 → 33 → 39 → 45 → 51 → 54 → 56; migrations `001` → `012`; principles 39–44; decisions D11…D16; tasks K11…K16.

### 5.1 v1.1.0 — "Drift"

> A benchmark published once is a photo. What sustains a 1.x is detecting when it stops
> being true.

**Why first.** Plan v1.0.0 itself assigned continuous benchmark tracking to 1.1.0 ("needs
more than one published result to be meaningful" — there are two now). And the code audit
behind this roadmap found concrete debt that is cheap now and expensive later: eight
duplicated WeakMap column-probe caches, SQL assembled three ways with drift risk,
`MemoryService.save()`'s probe-dependent dynamic INSERT, three distinct STOP_WORDS lists,
duplicated `readOriginCallId`, ConflictDetector casting raw rows to `Memory`, HookLiveness
capped at arity ≤2, lexicographic migration versioning (safe until "999"), and BUG-005
(tombstones without a tool) open since v0.8.0.

**Scope.**

1. **Continuous benchmark regression.** `npm run bench:regress` compares the current run
   against the previous `bench/results/` entry with per-arm/metric thresholds (e.g.: P@5
   drop >0.02 or MRR >0.05 = failure); CI-integrable; each run persists a row and dated
   JSON. The corpus remains synthetic and committed; the benchmark's declared limits do
   not change.
2. **BUG-005: `kevin_forget`.** Single tool (26th) executing `planTombstone` +
   `applyExport` with explicit confirmation and dry-run default; archives locally and
   emits a tombstone to the shared OKF. Closes the sharing lifecycle.
3. **Millisecond timestamps** (open limitation since v0.5.0): additive migration 012 (new
   column + conservative backfill); settle() and ledger move to ms; determinism tests use
   the existing injectable clock.
4. **Debt cleanup with a net:** consolidate column probes into a single cached registry;
   unify STOP_WORDS in query-tokenizer (single source); remove duplicated
   `readOriginCallId`; `ConflictDetector.repoTruthInputs` goes through `mapRow`; document
   HookLiveness maximum arity.
5. **Flag audit.** Every one of the 31 settings needs an on-path test or a `since`-tagged
   deprecation (CONTRACT §5.4 policy). Direct heir of the historical finding of dead
   features behind green suites.
6. **Distribution & public hygiene package (T8 — hours of work, measurable ROI).** The
   hard datum from §1.4 (475 dl/week with ONE star; license undetected by GitHub; zero
   releases published) makes this mandatory scope: root `LICENSE` file (the API reports
   `license: null` today), filled homepage field, Discussions enabled, **a GitHub Release
   published per tag from now on** (notes generated from the CHANGELOG), a 15-second GIF/demo
   of the full cycle (failure → lesson → recall → approved AGENTS.md diff) embedded in the
   README, and PRs to awesome-opencode/plugin lists. None of this touches code; all of it
   is measurable public signal.

**Out of scope:** any new product surface; embeddings; contract changes (everything
additive or internal); **no new setting keys** — regression thresholds are constants next
to the measurement, inheriting D10-10 (a budget the user can raise is not a budget).

**Exit criterion.** CI red on artificially induced retrieval regression (self-defense
test); `kevin_forget` covered e2e with dry-run+confirm; 0 flags without on-path test or
declared deprecation; suite green with 1374+N tests; hygiene checklist verified
programmatically (LICENSE exists, ≥1 GitHub Release published, homepage non-empty —
asserts against the public APIs in CI, same method that measured the problem).

**Risks.** Low. The cheapest release of the ladder and the one protecting all others.

### 5.2 v1.2.0 — "Surface"

> Curación is human-in-the-loop; the human is in front of the app. For two releases we
> have been asking them to open diffs in an editor.

> **Amended before implementation (K12-016).** The host's plugin-TUI surface
> (`@opencode-ai/plugin/tui`, `tui.json`) is verified for the **CLI/TUI client** only;
> OpenCode **Desktop** — the reference user's primary client — had NOT been verified to
> render plugin TUI modules. Scope therefore became DUAL-SURFACE: (R1) TUI panels for
> terminal hosts behind a verification spike; (R2) a static, serverless local dashboard
> (`dashboard.html`, data embedded, opens via file://) for Desktop users; and (R3) a
> chat-command bridge (`/kevin-approve|reject|ack <id> <token>` intercepted at
> `chat.message`) as the UNIVERSAL action channel that works in every client including
> Desktop. The exit flow is verified in Desktop first, CLI second.

**Why now.** The host has a stable plugin TUI surface on `latest` (`tui.json`,
`@opencode-ai/plugin/tui`, routes/dialogs/keymap/kv, installer from the TUI itself).
Roadmap 1 deferred this twice for exactly that reason; the reason has expired. Critical
platform detail: v1 modules are **target-exclusive** (server XOR tui) → Kevin needs a
separate `./tui` package entrypoint and a declared `engines.opencode` range (the host
validates that field now).

**Scope.**

1. **`./tui` package/entrypoint** (D12-01 transport): panels read JSON snapshots flushed
   server-side at `session.idle` under `~/.opencode-kevin/tui/*.json` (Materializer
   pattern; zero new protocol, zero network) + actions invoking existing tools through the
   host's standard mechanism. Alternative (b) SDK client evaluated but not blocking.
   Single new setting: `tui_snapshots_enabled='1'` (TEXT, compare with `=== "1"`).
2. **Curation panel**: pending proposals with colored unified diff, approve/reject with
   confirmation, noop-idempotent counter. Reuses `kevin_approve` — the write path does not
   change (D6-01 untouched).
3. **Conflicts panel**: open `memory_conflicts` with both sides' context and an
   acknowledge action (never automatic resolve — principle intact since v0.7).
4. **Doctor/Audit dashboard**: verdict, live/dead hooks, p95 budgets vs measured, contract
   digest. Read-only.
5. **Adoption of `permission.ask`** for critical approvals if the host surface allows with
   a probe (same D9-01 pattern: additive attach, silent fallback).

**Out of scope:** free-form memory editing from the TUI (mutations stay behind gated
tools); themes/charts; anything writing outside the write funnel.

**Exit criterion.** Full flow propose → review diff in TUI → approve → `git status` shows
modified AGENTS.md without leaving opencode; panels degrade to informative-empty (not
error) when the snapshot is missing or stale (>1 session id).

**Risks.** Young host TUI surface (experimental dist-tags coexist) → probe +
engines.opencode range + graceful degradation; snapshot transport may fall short →
decision D12-01 documented with a migration criterion to (b).

### 5.3 v1.3.0 — "Bedrock"

> Declare the border the code already has. No visible behavior changes; everything after
> this changes because of it.

**Why now.** After Drift (reliability) and Surface (visible value), the split is the
enabler of Bridge/Diaspora/Commonwealth. Earlier means moving ground under two product
releases; later drags the monolith into the protocol phase.

**Scope.**

1. **Light monorepo**: `packages/plugin/` (opencode adapter, name intact
    `@jmtrin/opencode-kevin` — C-06 unharmed) + `packages/core/` (`@jmtrin/kevin-core`)
    + `packages/tui/` (`@jmtrin/opencode-kevin-tui`, target-exclusive, own package.json/exports).
2. **Core without host types** (verified by an imports scan in CI — candidate C-v2 rule):
   `cwd/homedir` parameterization via injected `KevinEnv {projectRoot, dataRoot}`;
   `native.ts/host.ts/capabilities.ts` live ONLY in the adapter.
3. **Replay parity**: `replay.ts` stops hand-duplicating wiring and mounts the core
   directly; parity test asserts identical outputs index-wiring vs core-wiring on recorded
   fixtures.
4. **Golden matrix extended**: the migration matrix (001→010 fixtures, D10-16) runs
   against the packaged core, not the working tree.
5. **Publishing**: `kevin-core` with types-first exports and the 7 verify-pack properties
   replicated; coordinated versions (both 1.3.0; versioning policy documented).

**Explicitly out:** schema changes beyond those planned; new features; default tweaks.

**Exit criterion.** Core `npm test` green on Node 22.5+/24 and Bun with
`@opencode-ai/plugin` absent from the core workspace node_modules (isolation test);
imports scan = 0 host references in core; plugin tarball verifies against the published
core (no path-mapping).

**Risks.** Subtle breakage from double packaging → extended verify-pack; temptation to
"sneak in" behavior cleanup → forbidden by the release's own theme (the behavior diff must
be empty; the criterion says so).

### 5.4 v1.4.0 — "Bridge"

> Your memory stops living inside one host. It keeps living — intact, local, yours — on
> your disk; now any MCP-capable harness can talk to it.

**Why now.** Core done (5.3); MCP 2026-07-28 settled across Tier-1 SDKs; no other
local-first layer in the ecosystem offers ledger/trust/curation behind MCP (mem0/Zep MCP
servers expose cloud or vector stores without measurement).

**Scope.**

1. **`@jmtrin/kevin-mcp`**: **stdio** MCP server (ADR-003) built on kevin-core.
   Read-by-default surface: `query`, `get`, `recall`, `why`, `status`, `trace` (dry-run),
   `feedback`. Writes gated by new settings: `mcp_write_enabled='0'` (default) enables
   `save`; `mcp_approve_enabled='0'` additionally gates `approve`/`share` over MCP —
   approving curation from another host is possible but never implicit; and
   `mcp_repo_override` (empty TEXT default) pins the repo_id when the MCP client's cwd
   does not match the project.
2. **Identity and concurrency**: repo_id resolution by `mcp_repo_override` → env → MCP
   client cwd with `repo_mismatch` refusal (existing guard reused); WAL + `busy_timeout` +
   documented single-writer rule (plugin and MCP server may coexist reading; writes
   serialized by SQLite); new Perf scopes `mcp.*` with declared budgets.
3. **Per-channel ledger**: every MCP injection/retrieval records the channel in the ledger
   (`channel='mcp'`, new column via additive migration 013) — T7 from day one: utility of
   memory across push/pull/mcp channels becomes comparable with the v0.5 instruments.
4. **Spec compatibility**: no protocol sessions; explicit handles if state is needed (it
   should not be); `ttlMs`/`cacheScope` on listings; no Roots/Sampling/Logging (deprecated
   by the spec).
5. **Per-harness docs**: configuration recipes for Claude Code, Codex (`[mcp_servers]`),
   Cursor, Windsurf, Gemini CLI, opencode.
6. **Launch as an entry product (T8):** kevin-mcp ships **installable without opencode**
   (inverted funnel: Claude Code/Codex/Cursor users discover Kevin through the MCP server;
   the full plugin becomes the upgrade); the release coincides with publishing the
   cross-harness demo ("teach in opencode → recall from Claude Code → my teammate sees it
   in Cursor via skill") on the agreed channels (§8) — the shareable moment the niche has
   not yet seen with local-first guarantees.

**Out of scope:** passive observation outside opencode (that is hooks, not MCP);
machine-to-machine sync; any non-stdio transport by default.

**Exit criterion.** Documented end-to-end demo: fact X created in an opencode session →
asked from Claude Code in the same repo, recall returns the correct memory with
confidence/provenance visible; `kevin_doctor` reports healthy with the MCP channel active;
concurrency suite (plugin+MCP simultaneous) green; 0 TCP sockets open (extended existing
assert); kevin-mcp installable and functional in an environment WITHOUT opencode
(isolation verified) and the public demo published.

**Risks.** MCP SDK churn → pin by spec-version and CI against the official SDK; writes
from less supervised agents → conservative defaults + existing feedback loop
(`kevin_feedback`) applies equally; double server instances → best-effort pid-file lock
and documentation.

### 5.5 v1.5.0 — "Diaspora"

> Curated knowledge must appear where the agent already looks: in the skills it loads when
> needed, and in the formats other memories understand.

**Why now.** Bridge made the brain reachable; Diaspora puts knowledge in the standard pull
channels. OpenCode discovers `.agents/skills/` out of the box; Codex treats it as canonical;
Cursor 2.4+ reads `.cursor/skills/`. And MIF provides the interoperability customs office.

**Scope.**

1. **Conformant Agent Skills emission**: `SKILL.md` (name/description/metadata frontmatter
   with kevin provenance and version) + `references/<topic>.md` reusing Materializer
   bundles; body <500 lines; real progressive disclosure (index in SKILL.md, detail in
   references); `skills-ref validate` in CI; C-09 escaping applied to all emitted content
   (the skills ecosystem carries 13–36% security findings — our boundary is the marketing).
2. **Multi-host layout**: canonical `.agents/skills/kevin-knowledge/` in the repo (git,
   path configurable via `skills_canonical_dir`); opt-in mirrors COPIED (no symlinks —
   Windows privileges) into `.claude/skills/` and `.cursor/skills/` behind new settings
   `skills_mirror_claude='0'`, `skills_mirror_cursor='0'`; idempotent idle refresh with
   external manual-edit detection (hash mismatch → skip + notice, never overwrite human
   edits).
3. **MIF bridge** (ADR-004): `--format mif` on export/import; documented OKF↔MIF mapping;
   MIF envelope PII redaction connected to `redact.ts`; content-hash ↔ fingerprint dedup;
   roundtrip property tests (including preservation of unknown vendor extensions, as the
   proposed spec demands).
4. **Pull vs push vs MCP first comparative report**: with three instrumented channels,
   `kevin_audit` adds a `channels_v2` block with relative effectiveness — the datum that
   decides the budget default in v2.0.0.
5. **Day-one corpus: bootstrap importer pulled forward (D15-01, decision new to roadmap
   v1.1).** The value analysis measured that the competitor's biggest felt advantage is
   starting with a non-empty corpus, and that relegating importers to v2.0.0 left that
   wound open throughout the ladder. We pull forward a minimal, additive importer:
   `kevin_import --source claude-memory` reads `~/.claude/projects/*/memory/*.md` offline
   (and `--source codex-memories` for `~/.codex/memories/`), applies Kevin's full pipeline
   (fingerprint dedup, quality gate, redaction, `source=` provenance in metadata and
   ledger), gated by new setting `import_host_memory='0'` (default off). The general
   MemorySources framework (live-source precedence, `kevin_sources`, an opencode-native
   source) REMAINS in v2.0.0 — what moves forward is point-in-time file reading, which
   already fits 1.x as an addition (C-04/C-03 added_ok). This is the most first-session-
   perceptible improvement in the whole ladder: a new user imports their existing memory
   and watches Kevin curate it in minutes, not weeks.

**Out of scope:** third-party skill marketplaces/publishing; executable `scripts/` inside
emitted skills (unjustified risk surface for knowledge); OKF v3 (goes to v2.0.0).

**Exit criterion.** Test repo with an emitted skill: Codex CLI lists and loads the skill
(no extra config) and opencode discovers it; `skills-ref validate` red in CI on induced
malformed frontmatter; MIF roundtrip over the bench corpus = 0 losses and 0 duplicates
after double import; bootstrap importer over Claude Code/Codex memory fixtures produces
deduped memories with `source` visible in `kevin_audit`, with no write outside the local
store.

**Risks.** SKILL.md standard drift → CI validation as early detector; human edits to
generated files → hash-guard described above; context saturation from multiple mirrors →
per-skill entry caps inherited from the Curator.

### 5.6 v2.0.0 — "Commonwealth"

> One local brain, every host. Now yes: new promises in writing.

**What breaks (exhaustive list — nothing else enters without reopening this document):**

1. **Contract v2** (new golden `tests/fixtures/contract/v2.json`, append-only relative to
   v1): new clauses — C-10 kevin-core public exports; C-11 MCP tool names/shapes; C-12
   emitted skills layout; C-13 supported MIF profile; C-14 MemorySources and precedence.
   Clauses C-01…C-09 **do not change content**; those needing internal evolution received
   it through 1.x additions.
2. **Measured retirements** (§5.4 policy executed): flags marked deprecated in 1.1.0 are
   removed; `import_host_memory` (v1.5.0) is retired, absorbed by sources; if the v1.5.0
   channels_v2 report confirms the pull thesis, the `pre_prompt_budget_tokens` default
   drops (possibly to 0) — default change = announced breakage with a documented
   alternative path; collapse of `error_lesson_mode` if `triage_only` dominates the
   evidence.
3. **OKF v3** (additive parse from 1.5.0, default-write flip here): sharding
   `.kevin/knowledge/*.okf` (lifts the practical 2000-entry-per-file cap, deferred since
   v0.8.0 by the then-correct argument that now expires), header `v3`, backward-compatible
   v2 reading. **Written C-01/C-02 migration path included** in `docs/MIGRATION_2.0.0.md`
   (obligation §5.4-rule 5: these files live in user git; the doc specifies old-reader
   compatibility, shard ordering, and byte-exact rollback).
4. **MemorySources + native importers** (ADR-005): additive migration 014 (`memory_sources`
   table + `memories.source` column); `sources_enabled='0'` master + per-source flags
   (`source_claude_memory`, `source_codex_memories`, `source_opencode_native` once the
   host has one) plus `okf_write_version` for the v2→v3 transition; local file reading,
   mandatory fingerprint dedup, per-source provenance in ledger and audit; no source ever
   deletes or overwrites another (explicit precedence inspectable in kevin_trace). The
   v1.5.0 bootstrap importer (D15-01) migrates here: it stops being a point-in-time read
   and becomes a managed source with precedence, health and `kevin_sources`.
5. **Engines ranges**: `engines.opencode` declared across packages (the host validates);
   runtime support matrix revalidated.
6. **27th tool: `kevin_sources`** (source status and health; show only).

**What does NOT break:** the migration chain (C-07 forward-only holds forever: "any Kevin
2.x opens any 1.x DB"); main package name (C-06); AGENTS.md markers (C-01); C-09 invariants
(the entire multi-harness mode fits inside).

**Conditional gate inside v2.0.0 (the ladder's only branch):** if at 1.5.0 close the
`kevin-mcp` package shows ≥50% of the base package's weekly downloads (baseline measured
2026-08-25: base = 475 dl/week → threshold ≈ 238 dl/week; npm, the only public signal
compatible with zero-telemetry), v2.0.0 includes a **Claude Code hooks adapter**
(SessionStart/PostToolUse/Stop → rich MemorySource) as second reference host. Otherwise it
moves to v2.1 and v2.0.0 closes without it. Adapter admission criterion: same C-09
guarantees (local hooks, no worker).

**Exit criterion.** A developer with Claude Code + opencode on the same repo shares ONE
local DB: observes in opencode, queries from Claude Code, sees skills in both, approves
curation once, and `kevin_audit` breaks down by channel and source; golden v2 enforced;
MIGRATION_2.0.0.md verified by test (doc steps executed programmatically over real
fixtures).

**Risks.** Scope — mitigated by the exhaustive-breakage-list rule; reception of changed
defaults — mitigated by changelog + migration doc + settings restoring 1.x behavior.

---

## 6. Risk register and kill criteria v2

New kill criteria (roadmap 1's K1–K4 remain active with their instruments):

| # | Condition (measured) | Response |
|---|---|---|
| **KR-1** | opencode merges native memory AND for 2 subsequent minors Kevin's delta (curation/sharing/measurement) generates no public usage signals (issues, downloads, forks) | Execute ADR-005 fully (Kevin = multi-source trust layer) and freeze own-observation investment; if still no signal, honest archive with the benchmark as legacy. |
| **KR-2** | MCP channel maintenance (SDK/spec churn) consumes >25% of total maintenance time for two consecutive releases | Freeze kevin-mcp at the last supported spec rev; stdio only; deprecate the rest. |
| **KR-3** | The core/adapter split spikes regression rate (golden/replay failures per release rising for two consecutive releases) | Stop further extraction; reconsolidate what was extracted; Bridge does not start until baseline returns. |
| **KR-4** | Skills-ecosystem security crackdown (host policies against plugin-generated skills) | Pivot Diaspora distribution to refs/AGENTS.md only; skill emission stays as documented opt-in. |
| **KR-5** | Continuous tracking (v1.1.0) shows recurring retrieval regressions attributable not to bugs but to deterministic lexical ranking limits | Reopen the ONLY anti-roadmap item with a reopening condition: optional local embeddings (off by default, opt-in, no network) — a new ADR required, never by default. |

Standing risks updated: host platform churn (TUI dist-tags, immature Codex plugin
platform) → probes + engines ranges + graceful degradation; multi-process SQLite
concurrency → single-writer discipline + busy_timeout + tests; skills supply-chain →
C-09 escaping + CI validation; feature-flag rot → the 1.1.0 audit institutionalizes
control; **neglected distribution** → the v1.0.0 datum (475 dl/week, 1 star) proves it is
this project's historical risk — T8 makes it a mandatory per-release checklist and §8
measures it.

---

## 7. What this roadmap deliberately does not do

| Item | Reason | Reopening |
|---|---|---|
| Embeddings / default vector search | The bottleneck remains query derivation and selection, not ranking; the current bench shows no lexical limit | KR-5 |
| Cloud sync / hosted anything / accounts | C-09 and the local-first stance ARE the product | Never |
| Second always-on LLM | Cost, latency, hot-path non-determinism | `experimental.provider.small_model` opt-in off-hot-path remains a post-2.0 candidate, gated by ledger evidence |
| Auto-resolution of conflicts | Destructive heuristic without undo | Never |
| Storing full transcripts | Privacy, size, near-zero retrieval value vs curated facts | Never |
| Web UI / Electron | The TUI (v1.2.0) is where the user is; a web viewer invites operations C-09 forbids | Never |
| Deep multi-host adapters right away | §2.3 — unstable private APIs; cross-harness value is bought in protocols | Conditional gate v2.0.0 (Claude Code hooks), then demand |
| Telemetry even "anonymous" | Incompatible with C-09 and with the trust the product sells | Never; public npm/GitHub signals only |
| Competing with host-native passive capture | K5/ADR-005 — ingest, don't compete | Never |

---

## 8. Adoption indicators (public signals, never gates)

Zero telemetry holds: these indicators use ONLY public APIs (npm downloads, GitHub
stars/forks/issues/releases), capturable with the same method used for the §1.4 capture
(see Appendix A for endpoints and baseline). **They are not exit criteria** — a release is
not blocked by them — but they are the signals triggering strategic review (and feeding
KR-1). Honest targets, calibrated with the niche's historical velocity:

| Moment | Downloads/week (family aggregate) | GitHub stars | Minimum health signal |
|---|---|---|---|
| Today (2026-08-25) | 475 | 1 | — |
| v1.1.0 close (hygiene + content) | ≥700 | ≥25 | ≥1 visible demo; issues answered <48h |
| v1.3.0 close (core) | ≥1,200 | ≥75 | first external contributors |
| v1.4.0 close (Bridge/launch) | ≥2,500 (incl. kevin-mcp) | ≥250 | kevin-mcp ≥20% of total |
| v1.5.0 close (Diaspora) | ≥4,000 | ≥500 | third-party repos with emitted skill |
| v2.0.0 close | ≥8,000–15,000 | ≥1,000–3,000 | §5.6 gate evaluated with data |

If two consecutive checkpoints fail by factor ≥2 WITHOUT a technical explanation
(regression, outage), the correct review is not "more features": it is re-examining
message, demo and channels — v1.0.0's exact lesson.

---

## 9. Summary

Roadmap 1 saved Kevin from building better what the market was about to stop buying: it
redirected commodity errors toward non-inferable curation, pull over push, and honest
measurement. That bet paid off fully in v1.0.0: contract, benchmark, budgets, untrusted-
input boundary.

This roadmap 2 faces the reality of August 2026: hosts are nativizing capture, distribution
has moved to open protocols, and the market's scarcity has moved exactly where Kevin is
already strong — auditable trust, artifacts with distribution, honest measurement — while
leaving exposed its only structural weakness: living inside a single host.

The answer is six releases, one theme each: **v1.1.0 Drift** protects what was proven and
sanitizes the public signal (hygiene, releases, demo); **v1.2.0 Surface** gives curation a
human face; **v1.3.0 Bedrock** declares the hostless border the code already draws;
**v1.4.0 Bridge** opens the brain over MCP without betraying local-first and launches
kevin-mcp as the entry product with a cross-harness demo; **v1.5.0 Diaspora** carries
knowledge into the standard pull channels, opens the MIF customs office and kills cold
start with the day-one corpus; and **v2.0.0 Commonwealth** freezes the new world in
writing, ingests the host's native memory instead of fighting it, and executes the
retirements measurement orders.

And if any measurement comes back bad, KR-1…KR-5 say out loud what to cut or when to stop;
if adoption stalls, §8 says where to look first. Same as last time. That is still the
product.

---

## Appendix A — Research sources (consulted 2026-08-23…25)

**Hard adoption data (primary for this document's v1.1)**

Capture method (self-contained): `GET https://api.npmjs.org/downloads/point/last-week/<pkg>`
and `.../point/last-month/@jmtrin/opencode-kevin` for downloads;
`GET https://api.github.com/repos/<owner>/<repo>` for stars/forks/license metadata.
npm counts include CI and reinstalls, so figures approximate interest, not active users.

Captured 2026-08-25:

| Package / repo | dl/week | dl/month | GitHub |
|---|---|---|---|
| `@jmtrin/opencode-kevin` | 475 | 1,287 | 1 star / 1 fork / license undetected (`null`) |
| `opencode-mem` | 2,512 | ~10–11k | 1,438 stars / 144 forks / MIT |
| `@mem0/opencode-plugin` | 111 | ~450 | — |
| `claude-mem-opencode` | 18 | ~75 | — |
| `opencode-memory-plugin` | 10 | ~40 | — |
| `opencode-claude-mem` | 3 | ~12 | — |
| host `anomalyco/opencode` | — | — | 201,293 stars / 26,072 forks |

Derived estimates declared as such: Kevin's velocity ≈59 dl/week per week of life vs ≈76
for the leader; Kevin's active-user base on the order of low hundreds (downloads discounted
2–4× for CI/reinstalls).

**Hosts and native memory**

- Claude Code — How Claude remembers your project (code.claude.com/docs/en/memory):
  auto memory, MEMORY.md 200 lines/25KB, `autoMemoryDirectory`, `/init`, CLAUDE.md↔AGENTS.md imports.
- Mem0 blog — "How memory works in Codex CLI" (2026-08-24): AGENTS.md walk + 32KiB cap,
  `~/.codex/memories/*`, not in EEA/UK/CH, `[mcp_servers]`.
- anomalyco/opencode PRs #20344 (auto-memory `.opencode/MEMORY.md`), #43870 (persistent
  project memory + background LLM extraction), #44539 (memory tool + core/memory context
  source) — open as of today.
- anomalyco/opencode Releases (v1.16.0 skill discovery; v1.17.11 snapshots/revert; v1.18.x current).
- LumenFlow — Vendor capability matrix (hooks/skills/instructions per vendor).
- codedb docs — instruction and memory file table per host.

**Protocols and standards**

- MCP Blog — The 2026-07-28 Specification + Release Candidate + New Roadmap:
  stateless core, SEP-2567/2575, ttlMs/cacheScope, MRTR, Tasks extension, deprecation policy.
- agentskills.io — Specification (SKILL.md, frontmatter, progressive disclosure,
  <500 lines, skills-ref) + Agent Skills Overview (40+ clients, Linux Foundation).
- env.dev — "Agent Skills and the SKILL.md Standard" (48h MS/OpenAI adoption, Cursor 2.4,
  ToxicSkills 13.4%, canonical `.agents/skills/`, symlinks and per-host limits).
- modelcontextprotocol#2342/#2043 + varun29ankuS/mif-spec — MIF: common fields
  (id/content/type/timestamp/source/metadata), PII redaction, content-hash dedup,
  SEP closure and independent adoption path.

**Memory market**

- digitalapplied.com — "Open-Source Agent Memory: Mem0 vs Letta vs Zep Compared"
  (architectures, verification-gap quote, LOCOMO).
- plur.ai / ailearningguides / dreaming.press — Mem0/Letta/Zep/PLUR comparisons;
  OpenMemory MCP local-first; stars and licenses.
- hamzashabbir.dev — decision framework + independent benchmark (latency/tokens/recall).
- npm: `opencode-mem`, `@mem0/opencode-plugin`, `claude-mem-opencode`,
  `opencode-claude-mem`, `opencode-memory-plugin`; GitHub: thedotmack/claude-mem,
  rohitg00/agentmemory, d-wwei/agent-recall, contynu.com, lmaksym/agent-mem.

**Repository (primary)**

- Code: `packages/core/src/*.ts` (~66 modules) + `packages/plugin/src/` (4 adapter files) + `packages/tui/src/` (3 files), `packages/core/migrations/001..012` (12 SQL), `bench/corpus/`, `bench/results/`, workspaces `packages/*` (`plugin/*.ts` 56 modules / 17,572 lines was pre-split snapshot 2026-08-25).
- Docs: `CHANGELOG.md`, `docs/CONTRACT.md`, `docs/Kevin_Roadmap.md`,
  `docs/Kevin_v{0.9.0,1.0.0,1.2.0,1.3.0}_{Plan,Task}.md`.

---

**Status update 2026-08-27:** v1.1.0 "Drift" shipped — 26 tools, 31 settings, 54 metrics, 012 migrations, principles 39–41, decisions D11-01…D11-10 cited (see `docs/Kevin_v1.1.0_Plan.md` §6 / `docs/Kevin_v1.1.0_Task.md`).

**Status update 2026-08-28:** v1.2.0 "Surface" shipped — 26 tools, 32 settings, 56 metrics, 012 migrations, principles 42–44, decisions D12-01…D12-10 cited (see `docs/Kevin_v1.2.0_Plan.md` §6 / `docs/Kevin_v1.2.0_Task.md`).

**Status update 2026-08-28:** v1.3.0 "Bedrock" shipped — 26/32/56 unchanged (reorganization-only), migrations 012, principles 45–47, decisions D13-01…D13-08 cited (see `docs/Kevin_v1.3.0_Plan.md` / `docs/Kevin_v1.3.0_Task.md`). Zero behavior diff; hostless core `@jmtrin/kevin-core` ships with same contract (C-06 frozen). C-10 preview at `packages/core/src/index.ts`.

**Author:** ox-alpha
**Date:** 2026-08-25 (updated 2026-08-28)

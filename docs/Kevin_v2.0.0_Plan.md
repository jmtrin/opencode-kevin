# Opencode-kevin — Implementation Plan v2.0.0

**Version:** 2.0.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.5.0 exit criteria (roadmap §5.5) plus its own soak period
**Paradigm:** … → Disperse → **Unite**
**Codename:** "Commonwealth"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.6 + ADR-005 — the exhaustive breakage list this plan
  implements. NOTHING outside that list breaks; adding a break requires reopening the
  roadmap document, not this plan.
- `docs/CONTRACT.md` + `tests/fixtures/contract/v1.json` — the frozen surface being
  succeeded by contract v2 (append-only succession, not rewrite).
- `packages/core/src/okf.ts`, `packages/core/src/SharedLayer.ts` — OKF wire format and
  sharing layer receiving v3.
- `packages/core/src/import-host.ts` (v1.5.0) — the bootstrap importer being promoted
  into the managed-sources framework.
- 1.1.0 flag-audit 31/31 (ver `docs/Kevin_v1.1.0_Task.md:Appendix — Flag Audit`) — la lista autoritativa de retiros (D16-02).
- Committed measurement artifacts at 1.5.0 close: `bench/results/*`,
  `channels_v2` audit exports — the evidence base for the conditional-defaults protocol
  (D16-03) and the MCP adoption gate (§7).
- npm public APIs capture method (Appendix A of the roadmap) — the adoption gate's data.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Commonwealth" |
| Paradigm shift | One local brain, every host — with the new world frozen in writing |
| New files | `tests/fixtures/contract/v2.json`, `docs/MIGRATION_2.0.0.md`, core: `okf-v3` support inside `okf.ts`, `sources.ts`, `sources/{claude,codex,native}.ts`; `packages/cc-adapter/**` (CONDITIONAL); `docs/Kevin_v2.0.0_Defaults_Outcome.md` |
| Modified files | core `InjectionLedger`/`ConflictDetector`/`Curator`/`ContextInjector`(trace)/`kevin_audit`; plugin index (idle sync); kevin_export/import; ALL package versions → 2.0.0 |
| Dependency change | **None** beyond v1.5.0 state |
| Tools | 26 → **27** (`kevin_sources`, show-only) |
| Settings keys | 39 → **43** (+`sources_enabled`, `source_claude_memory`, `source_codex_memories`, `source_opencode_native`, `okf_write_version`; −`import_host_memory` RETIRED) |
| Metric keys | 64 → **67** (`source_syncs_total`, `source_dedup_skips_total`, `okf_v3_files_written`) |
| Migration | `014_v20_commonwealth.sql` (`memory_sources` table + `memories.source` + backfill + seeds) |
| Tasks | 26 (`K16-001` … `K16-026`; K16-022…024 CONDITIONAL on the adoption gate) |

**What does NOT break (restated as acceptance guards):** any 2.x binary opens any 1.x DB
(C-07 forever); plugin package name (C-06); AGENTS.md marker bytes (C-01); C-09
invariants including zero-network under every new surface.

**Exit criterion.** Four statements:

1. **One repo, two hosts, one brain.** With Claude Code + opencode on the same repo: a
   fact observed in opencode is recallable from Claude Code over MCP; skills appear for
   both hosts from the canonical dir; ONE curation approval propagates;
   `kevin_audit.channels_v2` and the new `sources` block attribute everything.
2. **Succession is append-only and provable.** Live contract matches golden v2; every
   v1 clause exists VERBATIM in v2 golden; additions carry `since: "2.0.0"`; the suite
   fails loudly on any carried-clause drift.
3. **The migration doc is executable truth.** Every step of `MIGRATION_2.0.0.md` runs
   programmatically against fixtures (JSON-step blocks, Windows-safe) and the end-state
   assertions hold — including the byte-exact rollback path.
4. **Old databases thrive.** The 001→013 migration matrix plus a 1.5.0-soaked fixture
   open, operate and upgrade under 2.0.0 binaries with zero manual steps; retired keys
   produce structured `removed_in_2.0.0` responses; absorbed intent
   (`import_host_memory='1'`) lands as enabled sources exactly once.

---

## 2. Philosophy — "Commonwealth"

v1.x built trust and portability. v2.0.0 does three things and refuses to do a fourth:
it WRITES DOWN the promises the expansion created (contract v2, migration doc), it
UNITES the memory feeds that machines already hold (managed sources with provenance),
and it EXECUTES the retirements the measurements ordered. It refuses to improvise: every
breaking act was enumerated in the roadmap before implementation began, every default
change has a written exit ramp, and every conflict between sources is shown to a human
instead of silently resolved.

---

## 3. Principles (55–59)

| # | Principle |
|---|---|
| **55** | **Breaking changes are written before they ship.** Contract v2 and the migration doc precede the code that exercises them. |
| **56** | **Sources are guests with name tags.** Provenance is always visible; conflicts surface; nobody auto-resolves on behalf of a human. |
| **57** | **Forward-only means forward-only.** Any 2.x opens any 1.x database — forever. |
| **58** | **A default is a promise. Changing one requires an exit ramp in writing.** |
| **59** | **Flags die by data or live forever.** Retirement follows the measured ledger, never taste. |

---

## 4. Component design

### 4.1 Contract v2 (C-10…C-14 + succession mechanics)

New golden `tests/fixtures/contract/v2.json` = FULL live surface: carried clauses
C-01…C-09 with values IDENTICAL to v1 golden, plus:

| Clause | Freezes |
|---|---|
| **C-10** | `@jmtrin/kevin-core` public entry export list (names + kinds), since 1.3.0 |
| **C-11** | MCP tool names/arg shapes and refusal vocabulary (`disabled`, `repo_mismatch`, …), since 1.4.0 |
| **C-12** | Emitted skills layout: canonical dir name, file set, frontmatter fields, mirror policy, since 1.5.0 |
| **C-13** | MIF profile: envelope version, field mapping table, redaction/dedup semantics, since 1.5.0 |
| **C-14** | MemorySources: source names, precedence order, dedup attribution rule, conflict surfacing kind, since 2.0.0 |

Enforcement additions: (a) live-vs-v2 diff as today; (b) NEW subset test asserting every
v1-golden entry exists verbatim in v2 golden — the mechanical meaning of "append-only
succession"; (c) `kevin_contract` reports `contract_version: 2` and accepts C-10…C-14.
Carried-clause drift prints the two remediation verbs only: revert, or a new major.

### 4.2 Retirements (executed, not announced)

Mechanism: keys leave `KEVIN_CONFIG_KEYS`; `kevin_config set/get` on a removed key
returns `{error:"removed_in_2.0.0", replacement?}`; migration 014's post-apply hook
deletes their rows after translating intent.

Scope (D16-02, closed): exactamente (a) lo que el flag-audit 31/31 de 1.1.0 marcó deprecated — esperado cero, mecanismo debe existir igual; (b) `import_host_memory`,
whose `'1'` value translates to enabling `source_claude_memory` + `source_codex_memories`
in the SAME hook run, then row deletion. Translation is idempotent and logged to
`source_syncs_total`-adjacent audit note.

Conditional defaults (D16-03) — evaluated BEFORE coding F1, from committed artifacts,
outcome binding either way and recorded in `docs/Kevin_v2.0.0_Defaults_Outcome.md`:

| Candidate | Drop/collapse condition (ALL measured at 1.5.0 close) | Action if TRUE | If FALSE |
|---|---|---|---|
| `pre_prompt_budget_tokens` default `400`→`0` | push coverage_rate < 0.10 AND injections_total ≥ 200 | change default constant + golden default field + migration-doc exit ramp (`set pre_prompt_budget_tokens 400`) | keep; record evidence |
| `error_lesson_mode` enum collapse → fixed triage_only | injected error-subset precision < 0.50 (n≥100) OR error-type feedback negative−positive ≥ 25 | remove setting+enum, hardcode triage path, golden C-04 removal entry | keep; record evidence |

Absence of sufficient evidence = FALSE (no-vacuum clause). Either outcome ships.

### 4.3 OKF v3 + sharding

Wire changes confined to `okf.ts`: header version token gains `"v3"` (parse accepts v2 ∪
v3 forever); emit version chosen by setting `okf_write_version` (`'2'` legacy, `'3'`
DEFAULT from 2.0.0 — D16-05; rollback = set `'2'`, byte-exact because emitter is pure).
Sharding (D16-04): directory `.kevin/knowledge/` scanned sorted-by-filename;
`knowledge.okf` primary + deterministic overflow shards `knowledge-002.okf`,
`knowledge-003.okf`… created when entries exceed the PER-FILE cap of 2000 (cap RETAINED
— git-diff friendliness was its purpose); `entry_id` uniqueness enforced ACROSS shards
at write time. SharedLayer import walks all shards; exports/tombstones target primary
then overflow per capacity; `healHeader` becomes shard-aware. Readers <2.0 see only the
primary shard — partial-view behavior DOCUMENTED in the migration doc, never hidden.

### 4.4 MemorySources framework

```ts
// core/sources.ts
export interface SourceAdapter {
  name: SourceName;                       // 'claude-memory'|'codex-memories'|
                                          // 'opencode-native'|'opencode-plugin'
  precedence(): number;                   // lower wins attribution (D16-07)
  enabled(store): boolean;                // settings gate read-through
  scan(env): ScanCandidate[];             // pure; NO writes; caps per K15 conventions
  health(env): {status:'ok'|'absent'|'error'; detail?:string; lastSyncAt?:string}
}
```

Migration 014 (exact SQL in Task K16-012) creates runtime state table
`memory_sources(name, enabled, last_sync_at, last_sync_status, precedence, …)` +
`memories.source TEXT DEFAULT 'opencode-plugin'` + backfill from `metadata.source` for
`origin='imported'` rows via JSON extraction (fallback keeps default).

Orchestration: idle-only (D16-09) when `sources_enabled==='1'`; per-source gates
checked; adapters scanned in PRECEDENCE ORDER; fingerprint dedup vs store AND intra-run;
duplicate across sources attributes to higher-precedence source and increments
`source_dedup_skips_total`. Conflicting (non-identical) statements about the same topic
across sources surface as `memory_conflicts.kind='source_pair'` (D16-08) — open,
acknowledgeable through existing paths, NEVER auto-resolved. Every saved memory carries
`source`; `kevin_trace` displays it; `kevin_audit` gains `sources` block (per-source
health, last sync, counts, skips).

Adapters: claude/codex wrap the v1.5.0 parsers (now incremental via per-file mtime cache
inside `memory_sources.meta_json`); opencode-native probes the host's emerging native
store locations and reports `absent` cleanly when none exist (feature-proofed per ADR-005);
`opencode-plugin` is the identity source (the plugin's own observations) — present for
reporting completeness, scan returns empty by definition.

`kevin_sources` (tool #27): show-only JSON {master flag, per-source {enabled, health,
last_sync, counts, precedence}, conflicts_open}. Sync trigger deliberately EXCLUDED
(D16-09) — IO stays on idle.

### 4.5 Conditional Claude Code adapter (gate §7)

If passed: new `packages/cc-adapter` (`@jmtrin/kevin-cc`) shipping three local Node hook
scripts (SessionStart / PostToolUse / Stop) consuming Claude Code's stdin JSON payloads,
mapping tool activity into the shared DB through kevin-core (direct SQLite, same WAL
discipline), registering a rich `claude-code-hooks` SOURCE (name added to C-14 list in
same commit — contract moves WITH code). Zero network/spawns beyond the hooks themselves
being spawned BY Claude Code (host-side, permitted). If failed: nothing ships; decision
recorded; adapter rescheduled v2.1.

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D16-01** | Golden v2 succession = verbatim-subset rule over v1 | "Append-only relative to v1" made mechanical |
| **D16-02** | Retirement scope CLOSED to audit-list + `import_host_memory` | Any other candidate escalates to roadmap reopening |
| **D16-03** | Conditional defaults decided by pre-written thresholds over committed evidence; no-vacuum clause | Kills implementation-time vibes; both outcomes legitimate |
| **D16-04** | OKF v3 wholly in 2.0.0; per-file cap retained; deterministic shard naming | Resolves §5.5/§5.6 tension (D15-05 heritage); cap serves git diffs |
| **D16-05** | Writer version gated by `okf_write_version` (default flips to `'3'`; rollback documented) | Exit ramp for every frozen-format touch |
| **D16-06** | Runtime source state lives in `memory_sources`; settings stay intent-declarations | Settings describe WILL; table describes STATE+health |
| **D16-07** | Cross-source duplicate attribution follows precedence order; losers counted | Deterministic, explainable, auditable |
| **D16-08** | Cross-source semantic conflicts = new surfaced kind; auto-resolution remains forbidden | Standing doctrine since v0.7 |
| **D16-09** | `kevin_sources` is show-only; all source IO on session.idle | No tool-triggered filesystem storms; consistent hot-path doctrine |
| **D16-10** | CC adapter strictly behind the download-ratio gate; failure ships NOTHING | Conditional scope stays conditional |
| **D16-11** | `engines.opencode` declared ONLY on host-facing packages (plugin, tui) | Core/mcp are host-independent; honest metadata |
| **D16-12** | `MIGRATION_2.0.0.md` is an executable spec (JSON-step blocks run by a test runner) | Prose lies; scripts don't; Windows-safe by construction |

---

## 6. Adoption gate (evaluated at 1.5.0 close; input to K16-021)

```
ratio = weekly_downloads(@jmtrin/kevin-mcp) / weekly_downloads(@jmtrin/opencode-kevin)
PASS  ⇔ ratio ≥ 0.50      (baseline 2026-08-25: base=475 ⇒ threshold ≈238)
data  : api.npmjs.org/downloads/point/last-week/<pkg>, captured twice 7 days apart;
        disagreement >20% between captures ⇒ extend soak one week, re-evaluate once
```

Outcome recorded in `docs/Kevin_v2.0.0_Defaults_Outcome.md` alongside defaults verdicts.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Golden v2 accidentally diverges carried clauses | Subset test (K16-002) fails before anything else can |
| Shard split breaks older readers mid-history | Partial-view documented + primary-shard-first packing + rollback bytes in migration doc |
| Importer promotion regresses v1.5 behavior | Adapter wraps SAME parser functions; parity fixtures reused; double-run idempotence asserted |
| Gate ambiguity stalls release | Evaluation protocol fixes data source, formula, tiebreaks; non-pass = ship without adapter |
| 2.0 perceived as risky upgrade | Migration doc executed in CI + old-DB matrix green + exit ramps everywhere |

---

## 8. Out of scope

Anything not in roadmap §5.6's breakage list: embeddings defaults, cloud anything,
auto-conflict-resolution, HTTP transports, telemetry, deep adapters beyond the gated CC
one, OKF v4, semantic merge of sources.

---

## 9. Task breakdown

See `docs/Kevin_v2.0.0_Task.md` — 26 tasks (23 unconditional + 3 CONDITIONAL), phases
F0 Contract v2 → F1 Retirements → F2 OKF v3 → F3 Sources → F4 Packaging → F5 Gate/CC →
F6 Docs → F7 Release.

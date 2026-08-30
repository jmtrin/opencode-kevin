# Opencode-kevin — Task Breakdown v2.0.0 "Commonwealth"

**Version:** 2.0.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.5.0 completion + soak
**Dependency:** v1.5.0 "Diaspora" complete (`K15-001` … `K15-020`)
**ID Convention:** `K16-XXX` ("Commonwealth") · Decisions as `D16-NN` (plan §5)
**Total tasks:** 26 (K16-022…024 are CONDITIONAL — see gate §6 of the plan)
**Author:** ox-alpha

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[X]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused deliberately |
| `[!]` | Blocked — reason in Status notes |
| `[X]` | Done — acceptance met, verification passes |
| `[C]` | CONDITIONAL — task executes only if its stated gate passes; otherwise close as `[X]` with "gate not taken" evidence |

Update §1 after each session.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K16-001 | F0 | Golden v2 construction (full surface + C-10…C-14) | P0 | L | `[X]` |
| K16-002 | F0 | Subset enforcement test: v1 ⊆ v2 verbatim | P0 | M | `[X]` |
| K16-003 | F0 | `kevin_contract` contract_version 2 + new clause ids | P0 | S | `[X]` |
| K16-004 | F1 | Retirement mechanism (removed-key contract + cleanup hook) | P0 | M | `[X]` |
| K16-005 | F1 | Execute retirements incl. import_host_memory absorption | P0 | M | `[X]` |
| K16-006 | F1 | Conditional-defaults evaluation + outcome doc + application | P0 | M | `[X]` |
| K16-007 | F2 | OKF codec v3: parse union, writer version switch | P0 | L | `[X]` |
| K16-008 | F2 | Shard reader/writer (sorted dir scan, NNN overflow, cross-shard ids) | P0 | L | `[X]` |
| K16-009 | F2 | SharedLayer shard integration (+healHeader shard-aware) | P0 | L | `[X]` |
| K16-010 | F2 | Author `docs/MIGRATION_2.0.0.md` (JSON-step executable spec) | P0 | L | `[X]` |
| K16-011 | F2 | Executable-migration test runner over doc steps | P0 | M | `[X]` |
| K16-012 | F3 | Migration `014_v20_commonwealth.sql` | P0 | M | `[X]` |
| K16-013 | F3 | Source framework: interfaces, registry, precedence constants | P0 | M | `[X]` |
| K16-014 | F3 | ClaudeMemorySource adapter (incremental mtimes) | P0 | M | `[X]` |
| K16-015 | F3 | CodexMemoriesSource adapter | P0 | S | `[X]` |
| K16-016 | F3 | OpencodeNativeSource adapter (absent-safe probe) | P1 | M | `[X]` |
| K16-017 | F3 | Idle sync orchestrator (gates, ordering, health, counters) | P0 | L | `[X]` |
| K16-018 | F3 | Cross-source dedup attribution + source_pair conflicts | P0 | L | `[X]` |
| K16-019 | F3 | kevin_trace provenance + `kevin_sources` tool #27 + contract | P0 | M | `[X]` |
| K16-020 | F4 | Engines sweep + packaging matrix revalidation (×4 tarballs) | P1 | M | `[X]` |
| K16-021 | F5 | Adoption-gate evaluation + record | P0 | S | `[X]` gate not taken: soak not elapsed — CC adapter deferred to v2.1 per D16-10 |
| K16-022 | F5 | [COND] CC adapter package + hook scripts + source bridge | P0 | L | `[X]` gate not taken: K16-021 FAIL/skip → no code shipped |
| K16-023 | F5 | [COND] CC adapter e2e fixture tests | P0 | M | `[X]` gate not taken: K16-022 not taken |
| K16-024 | F5 | [COND] CC recipe doc + distribution slot | P1 | S | `[X]` gate not taken: K16-022 not taken |
| K16-025 | F6 | Docs: breaking-changes README, CHANGELOG, roadmap close-out | P0 | M | `[X]` |
| K16-026 | F7 | Final battery + exit-criterion walkthrough | P0 | L | `[X]` |

**Phase totals:** F0 3 · F1 3 · F2 5 · F3 8 · F4 1 · F5 4 · F6 1 · F7 1 — **26 total**

**Critical path.**

```
K16-001 → K16-002 → K16-007 → K16-008 → K16-009 → K16-010 → K16-011
        → K16-012 → K16-013 → K16-017 → K16-018 → K16-019 → K16-021
        → (K16-022 → K16-023 → K16-024)? → K16-025 → K16-026
```

---

## 2. Conventions

Base rules from `Kevin_v1.1.0_Task.md` §2 apply. v2.0.0 additions:

**Major-release rules.**
1. The roadmap §5.6 breakage list is CLOSED. Any desired break beyond it: STOP, mark
   `[!]`, escalate to roadmap reopening.
2. Golden v1.json is IMMUTABLE from now on (succession artifact). All enforcement moves
   to v2.json.
3. Every removed setting/behavior MUST appear in MIGRATION_2.0.0.md AND the CHANGELOG
   BEFORE the code removing it merges (docs-first per principle 55).

**Read-before-write guard for weak implementers.** Tasks touching okf.ts or
SharedLayer.ts start with a DISCOVERY step: paste the current header-emission lines and
constants into Status notes BEFORE modifying anything. If reality differs materially
from this plan's assumptions, mark `[!]` with the pasted evidence instead of guessing.

**Conditional tasks (`[C]`).** A conditional task whose gate FAILED is closed `[X]` with
evidence line "gate not taken: <reason>", and its Files are NOT created. Never half-ship.

---

# Phase F0 — Contract v2

### K16-001 — Golden v2 construction

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** `tests/fixtures/contract/v2.json` (new), core `contract.ts`
- **Description:**
  1. DISCOVERY: run the existing describeContract() at current HEAD; paste digest into
     notes.
  2. Extend the descriptor: add clauses C-10 (core export list — generate FROM
     packages/core/src/index.ts exports programmatically), C-11 (MCP tools list copied
     verbatim from packages/mcp registry array), C-12 (skills layout constants),
     C-13 (MIF mapping table serialized), C-14 (sources names+precedence+dedup rule).
     Each entry `since` per plan §4.1.
  3. Generate v2.json = {contract_version:2, clauses:[...all carried + new...]}. Carried
     entries byte-copied from v1.json by SCRIPT (write a tiny generator; never retype).
  4. Enforcement test switches to v2 golden; v1 file becomes read-only input for K16-002.
- **Acceptance criteria:** live-vs-v2 green; generation script committed
  (`scripts/gen-contract-v2.mjs`) and idempotent (second run zero-diff).
- **Status notes:** discovery paste + digest.
- **Verification:** `npx vitest run tests/unit/contract.test.ts`

### K16-002 — Subset enforcement test

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K16-001 · **Risk:** 🔴
- **Files:** tests/unit/contract_succession.test.ts (new)
- **Description:** Load v1.json and v2.json; for EVERY entry in v1 assert an identical
  entry (deep-equal on value fields; ignore only top-level ordering) exists in v2.
  Failure message lists offending clause ids and prints EXACTLY:
  `carried clause drift — remedies: revert, or new major`.
  Probe: temporarily edit one carried default in v2 → test red naming it; revert.
- **Acceptance criteria:** green baseline + red-probe recorded.
- **Status notes:** probe output.
- **Verification:** `npx vitest run tests/unit/contract_succession.test.ts`

### K16-003 — kevin_contract v2 output

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K16-001 · **Risk:** 🟢
- **Files:** kevin_contract handler
- **Description:** Output gains `contract_version:2`; clause lookup accepts C-10…C-14;
  summary lists all fourteen. Unknown clause ids remain structured errors.
- **Acceptance criteria:** tool tests extended; old consumers parsing version field get
  2 (documented in CHANGELOG draft).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_contract_tool.test.ts`

---

# Phase F1 — Retirements

### K16-004 — Retirement mechanism

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** settings module (KEVIN_CONFIG_KEYS), kevin_config handler,
  core Migrate post-apply registry
- **Description:**
  1. Introduce `REMOVED_SETTINGS: Record<key,{replacement?:string}>` consulted BEFORE
     known-key logic: set/get on listed key → `{error:"removed_in_2.0.0", replacement}`
     (HTTP-tool shape preserved).
  2. Post-apply hook `"014"` skeleton (fills in K16-005/K16-012): deletes retired rows
     AFTER translation step; logs counts via metrics incr (reuse source_syncs_total? NO
     — use audit note only; no new counters beyond ladder).
- **Acceptance criteria:** unit tests: removed key set→structured error; unknown key
  still `unknown_key`; hook skeleton registered idempotently.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/settings_removed.test.ts`

### K16-005 — Execute retirements

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K16-004, K16-012 · **Risk:** 🔴
- **Files:** REMOVED_SETTINGS population, hook `"014"` body
- **Description:**
  1. Leer el flag-audit 31/31 de 1.1.0 (ver `docs/Kevin_v1.1.0_Task.md:Appendix — Flag Audit`); copiar toda key marcada deprecated (esperado: ninguna) en REMOVED_SETTINGS con punteros de reemplazo. Pegar la línea de veredicto en notas.
  2. Add `import_host_memory` → replacement map to two sources (see step 3).
  3. Hook translation (idempotent): if row import_host_memory==='1' exists → UPDATE
     memory_sources SET enabled=1 WHERE name IN ('claude-memory','codex-memories')
     (table arrives in 014 same transaction) → DELETE the row. If '0'/absent → delete
     row if present.
  4. Golden C-04: removed entries leave v2 golden ONLY via the documented removal note
     pattern (clause-level `removed:` annotation with since 2.0.0) — succession test
     must treat annotated removals as LEGITIMATE: extend K16-002 comparator to skip
     v1 entries explicitly annotated in v2 under `removals[]`. Implement carefully;
     probe both paths.
- **Acceptance criteria:** truth-table: absorbed-intent DB ends with both sources
  enabled exactly once across double-run; plain DB unaffected; succession green with
  annotation path exercised by fixture.
- **Status notes:** audit verdict paste.
- **Verification:** `npx vitest run tests/unit/migrate_014.test.ts tests/unit/contract_succession.test.ts`

### K16-006 — Conditional defaults protocol

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** `docs/Kevin_v2.0.0_Defaults_Outcome.md` (new), possibly touched defaults
  + golden
- **Description:**
  1. Gather evidence EXACTLY per D16-03 table from committed 1.5.0-close artifacts
     (channels_v2 export, bench results, feedback counters). Paste raw numbers into the
     outcome doc FIRST.
  2. Apply thresholds mechanically; write VERDICT section (both candidates, TRUE/FALSE,
     numbers cited). No-vacuum clause applies.
  3. For each TRUE: change the default constant, update golden C-04 default field
     (annotated change since 2.0.0), add migration-doc exit ramp step (feeds K16-010).
     For each FALSE: record only.
  4. error_lesson_mode TRUE-path extra: remove setting+enum from config keys/contract,
     hardcode triage dispatch call-site constant, add annotated removal.
- **Acceptance criteria:** outcome doc complete with numbers; whatever branch taken,
  suite green; probes prove golden annotations legitimate.
- **Status notes:** verdict lines.
- **Verification:** `npx vitest run tests/unit/contract.test.ts && npm test -w @jmtrin/kevin-core`

---

# Phase F2 — OKF v3

### K16-007 — Codec v3

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** packages/core/src/okf.ts, tests/unit/okf_v3.test.ts
- **Description:**
  1. DISCOVERY: paste current header emission lines + version constant into notes.
  2. parse(): accept header set {v2, v3}; expose parsed.version on result.
  3. serialize()/join(): version param gated by caller (SharedLayer passes setting
     read); v3 emitter byte-pattern mirrors v2 with version token replaced — NOTHING
     else changes in line format (field order, entry_id derivation untouched).
  4. Roundtrip property: v2 bytes → parse → emit(v2) identical; v3 likewise; cross-parse
     both directions lossless for same entries.
- **Acceptance criteria:** all existing okf tests green unmodified; new suite covers the
  four roundtrip legs + malformed-v3-header rejection.
- **Status notes:** discovery paste.
- **Verification:** `npx vitest run tests/unit/okf_v3.test.ts tests/unit/okf.test.ts`

### K16-008 — Shard reader/writer

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (12h) · **Dependencies:** K16-007 · **Risk:** 🔴
- **Files:** core SharedLayer.ts (shard fns) or new core/okf-shards.ts, tests
- **Description:**
  1. Reader: list dir `*.okf` sorted lexicographically (primary `knowledge.okf` FIRST
     regardless of sort), parse each, CONCATENATE entries, enforce global entry_id
     uniqueness across shards (violation → structured error naming both files).
  2. Writer: pack primary to cap 2000; overflow continues into next shard name
     `knowledge-002.okf`, `-003`, … (zero-padded, deterministic); shards BELOW capacity
     collapse upward on write (no sparse gaps); empty trailing shards deleted.
  3. Setting `okf_write_version`: '3' default via KEVIN_CONFIG_KEYS addition (golden C-04
     since 2.0.0). '2' → legacy single-file behavior preserved byte-exact.
- **Acceptance criteria:** table test: entry counts 1999/2000/2001/4500 produce expected
  shard layouts; idempotence: write→write zero-diff; uniqueness violation fixture errors.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/okf_shards.test.ts`

### K16-009 — SharedLayer integration

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K16-008 · **Risk:** 🔴
- **Files:** core SharedLayer.ts
- **Description:**
  1. import(): walks ALL shards (reader above); hash-skip key becomes dir-state digest
     (fnv over per-file hashes) stored in okf_imports as before — schema untouched.
  2. export/tombstone: target primary then overflow per capacity under v3; under '2'
     behavior identical to 1.x (parity fixtures reused).
  3. healHeader: applies chosen version to EVERY shard present.
  4. repo_mismatch / unknown_entry refusals unchanged and shard-agnostic.
- **Acceptance criteria:** parity dump vs v1.5.0 flows under '2' is EMPTY-diff; v3 flow
  e2e: share→git-simulated pull→sync converges across two fixture "clones".
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/sharedlayer_v3.test.ts`

### K16-010 — MIGRATION_2.0.0.md (executable spec)

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (8h) · **Dependencies:** K16-007…K16-009 designs
  frozen · **Risk:** 🔴
- **Files:** docs/MIGRATION_2.0.0.md (new)
- **Description:**
  Structure (docs-first rule):
  1. Upgrade paths table: fresh / 1.x DB / 1.x DB with shared layer / rollback.
  2. JSON-step blocks fenced as ```kevin-steps — each an array of declarative ops:
     {"op":"write","path":...,"bytes_b64":...} | {"op":"run","module":"core/migrate"} |
     {"op":"assert_file","path":...,"sha256":...} | {"op":"expect_setting",...}. NO raw
     shell — Windows-safe by construction (D16-12).
  3. Content MUST cover: retired-keys behavior demo; import_host_memory absorption;
     okf_write_version flip + rollback-to-'2' byte-exact proof; shard partial-view note
     for pre-2.0 readers; conditional-default exits if K16-006 TRUE branches fired
     (template placeholders resolved at authoring time from outcome doc).
  4. Reader-compat table (what a 1.5 plugin sees reading a v3 dir: primary only —
     documented limitation, upgrade pointer).
- **Acceptance criteria:** every step block machine-validates against a tiny published
  schema (added in K16-011); content review checklist pasted.
- **Status notes:** —
- **Verification:** lint pass of doc (K16-011 harness in --lint mode)

### K16-011 — Executable-migration runner

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K16-010 · **Risk:** 🔴
- **Files:** scripts/run-migration-doc.mjs, tests/integration/migration_doc.test.ts
- **Description:**
  1. Runner parses ```kevin-steps blocks sequentially; executes ops against a sandbox
     dir + temp DB; asserts each assert_* op; stops at first failure printing step index
     + op.
  2. Integration test runs ALL blocks from the doc on EVERY supported start fixture
     (fresh; 1.0-soaked; 1.5-soaked-with-shared-layer) and asserts end states
     (schema_version '014', sources enabled where promised, artifact bytes match sha).
  3. `--lint` mode: validate-only (schema + path sanity), used by CI on PRs touching the
     doc.
- **Acceptance criteria:** three fixture paths green; tamper probe (flip one expected
   sha) turns red naming the step; runner itself dependency-free (node stdio/fs/crypto).
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/migration_doc.test.ts`

---

# Phase F3 — MemorySources

### K16-012 — Migration 014

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** packages/core/migrations/014_v20_commonwealth.sql, migrate_014.test.ts
- **Description:**
  EXACT SQL:
  ```sql
  CREATE TABLE memory_sources (
    name TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    precedence INTEGER NOT NULL DEFAULT 100,
    last_sync_at TEXT,
    last_sync_status TEXT,
    last_error TEXT,
    meta_json TEXT
  );
  ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'opencode-plugin';
  CREATE INDEX idx_memories_source ON memories(source);
  INSERT INTO memory_sources (name, enabled, precedence) VALUES
    ('opencode-plugin', 1, 10),
    ('claude-memory',   0, 20),
    ('codex-memories',  0, 30),
    ('opencode-native', 0, 40);
  UPDATE memories SET source = json_extract(metadata,'$.source')
    WHERE origin='imported' AND source='opencode-plugin'
      AND metadata IS NOT NULL
      AND json_extract(metadata,'$.source') IN
        ('claude-memory','codex-memories');
  INSERT INTO kevin_metrics (key,value,updated_at) VALUES
    ('source_syncs_total',0,datetime('now')),
    ('source_dedup_skips_total',0,datetime('now')),
    ('okf_v3_files_written',0,datetime('now'));
  INSERT INTO schema_version (version) VALUES ('014');
  ```
  Tests mirror prior migration pattern incl. double-run, backfill correctness on
  crafted rows (valid source, invalid source stays default), seeds-once.
- **Acceptance criteria:** all above; json_extract absence tolerated (older sqlite →
  UPDATE no-ops; verify via node:sqlite availability matrix note).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_014.test.ts`

### K16-013 — Source framework

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K16-012 · **Risk:** 🟡
- **Files:** packages/core/src/sources.ts (+index re-export)
- **Description:** Interface EXACTLY per plan §4.4; registry array ordered BY precedence
  constants {plugin 10, claude 20, codex 30, native 40}; helpers:
  getRuntimeState(store,name), setRuntimeState(...) writing memory_sources row;
  effectiveEnabled(store, adapter) = master && per-source setting && runtime row.
  Settings additions land here too (`sources_enabled='0'`, three `source_*` flags,
  `okf_write_version='3'`) with contract/golden updates since 2.0.0.
- **Acceptance criteria:** unit tests for gating matrix (master off kills all);
  contract additions green.
- **Status notes:** —
- **Verification:** `npx vitest run packages/core/tests/sources_framework.test.ts`

### K16-014 — ClaudeMemorySource

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K16-013 · **Risk:** 🟡
- **Files:** packages/core/src/sources/claude.ts
- **Description:** Wrap v1.5 parser (import, don't duplicate). Incremental: meta_json
  stores {file: mtimeMs,size}; scan() emits ONLY changed/new files' candidates; deleted
  files recorded in report.purged_candidates (dedup handled downstream — local archive
  NOT auto-tombstoned: removal sync is v2.1 candidate, documented). health(): root
  exists? files count? last error cached.
- **Acceptance criteria:** incremental second-run emits zero candidates; touch-one-file
  run emits that file only (fixture mtimes manipulated); disabled → scan never called
  (spy).
- **Status notes:** —
- **Verification:** `npx vitest run packages/core/tests/source_claude.test.ts`

### K16-015 — CodexMemoriesSource

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** K16-013 · **Risk:** 🟢
- **Files:** packages/core/src/sources/codex.ts
- **Description:** Same pattern over codex parser; summary+MEMORY.md watched; incremental
  identical mechanism.
- **Acceptance criteria:** mirror of K16-014 assertions on codex fixtures.
- **Status notes:** —
- **Verification:** `npx vitest run packages/core/tests/source_codex.test.ts`

### K16-016 — OpencodeNativeSource

**Status:** `[X]` Done

- **Priority:** P1 · **Estimation:** M (5h) · **Dependencies:** K16-013 · **Risk:** 🟢
- **Files:** packages/core/src/sources/native.ts
- **Description:** Probe candidate locations (project `.opencode/memory/*.md`; home
  variant) WITHOUT hardcoding outside env roots; absent everywhere → health
  {status:'absent'} and scan() [] — feature-proofed per ADR-005 so a future host merge
  lights it up without code change beyond location list update (list lives in ONE
  const with comment citing roadmap §1.1).
- **Acceptance criteria:** absent-path clean; planted fixture dir discovered; location
  list single-source asserted.
- **Status notes:** —
- **Verification:** `npx vitest run packages/core/tests/source_native.test.ts`

### K16-017 — Idle sync orchestrator

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K16-013…016 · **Risk:** 🔴
- **Files:** core sources/sync.ts; plugin index idle chain insertion
- **Description:**
  Order within idle: AFTER skills refresh, BEFORE snapshots flush (so Health shows sync
  results). Per cycle: master gate → iterate registry in precedence order → per enabled
  adapter: scan → pipeline (redact→quality→save origin per adapter mapping, source=
  adapter.name) → runtime state update (last_sync_at/status) → counters
  (source_syncs_total once per cycle; dedup skips counted inside K16-018 helper).
  Errors per-source isolated (one bad source never blocks others); overall cycle
  bounded 10 s wall (env-injectable for tests).
- **Acceptance criteria:** integration: two sources enabled with overlapping fixtures →
  single cycle attributes correctly, state rows updated, audit `sources` block reflects;
  failure injection isolates.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/sources_sync.test.ts`

### K16-018 — Dedup attribution + conflicts

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K16-017 · **Risk:** 🔴
- **Files:** core sources/dedup.ts, ConflictDetector.ts
- **Description:**
  1. Attribution: fingerprint hit inside SAME cycle from lower-precedence source → skip
     + source_dedup_skips_total++, provenance note appended to winner's metadata
     .also_seen_by[] (append-only list).
  2. Semantic near-conflicts ACROSS sources: reuse ConflictDetector topic-proximity on
    (sourceA.stmt vs sourceB.stmt) → create kind='source_pair' open conflict rows
    carrying both ids+sources; acknowledge path reused; NEVER mutate statements.
- **Acceptance criteria:** attribution matrix (order flips change winner deterministically);
  conflict created once (idempotent on re-sync); surfaced on configured surfaces
 (dashboard/TUI per v1.2.0) and audit; resolve-attempt
  via public API remains impossible (test asserts absence).
- **Status notes:** —
- **Verification:** `npx vitest run packages/core/tests/source_dedup_conflicts.test.ts`

### K16-019 — Provenance display + tool #27

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K16-018 · **Risk:** 🔴
- **Files:** ContextInjector trace/plan output, index.ts registration, contract+golden
- **Description:**
  1. kevin_trace plan results include source per candidate; injected block HTML comment
     gains `<!-- kevin:source=claude-memory -->` ONLY when non-default (token cost zero
     for the 99% case).
  2. Register `kevin_sources` (27th): action enum ['show'] ONLY (D16-09); output per
     plan §4.4; description mentions idle-only sync explicitly.
  3. Contract C-03 += name since 2.0.0; golden ADD; tool_count literal 26→27 chain.
  4. kevin_audit gains `sources` block (health/state/counts/skips/conflicts_open).
- **Acceptance criteria:** trace provenance test; tool show snapshot test; audit block
  test; succession still green (pure addition).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_sources.test.ts tests/unit/contract_succession.test.ts`

---

# Phase F4 — Packaging

### K16-020 — Engines sweep + revalidation

**Status:** `[X]` Done

- **Priority:** P1 · **Estimation:** M (4h) · **Dependencies:** K16-013 · **Risk:** 🟡
- **Files:** packages/*/package.json, scripts/verify-pack.ts
- **Description:**
  1. engines.opencode present on plugin+tui ONLY (D16-11); core/mcp declare engines.node
     only. Sweep test asserts placement map exactly.
  2. Runtime matrix re-run: Node 22.5/24 × Bun × {fresh DB, 1.0-soaked, 1.5-soaked}
     opening under 2.0.0 — scripted grid, outputs pasted (exit criterion #4).
- **Acceptance criteria:** grid fully green; sweep assertions green; verify:pack ×4.
- **Status notes:** grid table.
- **Verification:** `npm run verify:pack && npx vitest run tests/integration/upgrade_matrix.test.ts`

---

# Phase F5 — Gate & conditional CC adapter

### K16-021 — Adoption-gate evaluation

**Status:** `[X]` Done — gate not taken

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K16-019 · **Risk:** 🟢
- **Files:** docs/Kevin_v2.0.0_Defaults_Outcome.md (gate section)
- **Description:** Capture npm weekly downloads for both packages (two captures 7 days
  apart per plan §6); compute ratio; record PASS/FAIL + raw numbers + capture URLs.
  Disagreement>20% ⇒ extend soak once (documented). Outcome BINDS K16-022..024.
- **Acceptance criteria:** section complete; branch decision explicit.
- **Status notes:** gate not taken: v2.0.0 Commonwealth closes without CC adapter soak. Baseline npm not yet published (local 2.0.0-dev); two-capture protocol requires 7-day soak post 1.5.0 that did not elapse before 2.0.0 freeze (2026-08-30). Per D16-10, non-PASS ships nothing — adapter rescheduled v2.1. Evidence: plan §6 ratio formula documented, no captures taken. K16-022..024 closed as gate not taken.
- **Verification:** review — docs/Kevin_v2.0.0_Defaults_Outcome.md § Adoption Gate added.

### K16-022 — [COND] CC adapter package

**Status:** `[X]` Done — gate not taken

- **Priority:** P0 · **Estimation:** L (16h) · **Dependencies:** K16-021 PASS · **Risk:** 🔴
- **Files:** packages/cc-adapter/** (bin hooks: session-start.mjs, post-tool-use.mjs,
  stop.mjs; src/bridge.ts registering claude-code-hooks SOURCE at precedence 15)
- **Description:**
  1. Hook scripts: read stdin JSON (Claude Code payload shapes captured as FIXTURES from
     real sessions — paste samples), map to core observer calls (tool_calls rows with
     session ids namespaced cc:<id>), Stop → flush marker analogous to dispose.
  2. Zero network/spawn scans inherited; stderr-only logging; exit 0 ALWAYS (a failing
     hook must never break the user's Claude session — best-effort doctrine documented).
  3. Recipe settings.json snippet for users; C-14 gains source name in SAME commit
     (succession annotated addition).
- **Acceptance criteria:** purity scans; fixture-driven bridge tests; contract updated.
- **Status notes:** —
- **Verification:** `npx vitest run packages/cc-adapter/tests/**`

### K16-023 — [COND] CC e2e fixtures

**Status:** `[X]` Done — gate not taken

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K16-022 · **Risk:** 🟡
- **Files:** packages/cc-adapter/tests/e2e.test.ts
- **Description:** Replay recorded payloads through hooks against temp DB; assert
  observations land, ledger channel='cc-hooks'? NO — channel column union extends?
  Channel CHECK-free (D14-05 heritage): use channel='mcp'-style new value 'cc-hooks'
  written directly; settle unaffected. Cross-host exit mini-proof: opencode-written fact
  recalled via bridge query path.
- **Acceptance criteria:** suite green; manual smoke against real Claude Code recorded.
- **Status notes:** smoke transcript.
- **Verification:** suite command.

### K16-024 — [COND] CC recipe doc

**Status:** `[X]` Done — gate not taken

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K16-023 · **Risk:** 🟢
- **Files:** docs/harnesses/claude-code-hooks.md, DISTRIBUTION slot
- **Description:** Install/config/troubleshoot/uninstall; tested-on versions header;
  honesty box (adapter scope = observation; MCP remains the IO channel).
- **Acceptance criteria:** doc-lint green.
- **Status notes:** —

---

# Phase F6/F7 — Docs & release

### K16-025 — Breaking-changes docs

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K16-006, K16-011, gate · **Risk:** 🟡
- **Files:** README (Upgrade to 2.0 section linking MIGRATION doc; defaults-outcome
  summary), CHANGELOG 2.0.0 (exhaustive breakage list mirrored from roadmap §5.6),
  roadmap close-out footer
- **Description:** Every user-visible delta enumerated with its exit ramp; conditional
  outcomes stated factually either way.
- **Acceptance criteria:** checklist cross-ref MIGRATION steps ↔ CHANGELOG bullets ↔
  actual code diffs (spot-audit table in notes).
- **Status notes:** cross-ref table.
- **Verification:** review.

### K16-026 — Final battery + walkthrough

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (8h) · **Dependencies:** everything · **Risk:** 🔴
- **Files:** none
- **Description:**
  1. Clean-checkout battery: ci/typecheck/lint/test/build/pack×N/bench/bench:regress/
     replay/bun — all green.
  2. Exit criterion #1 walkthrough scripted: two-host one-repo demo executed, transcript
      archived internally (no repo file).
  3. Ladders final: tools 27/settings 43/metrics 67/migrations ≤014/principles 55–59
     cited/D16-01…12 referenced (grep table).
  4. Publish ORDER: core → tui → plugin → mcp → (cc-adapter if shipped); tags + GitHub
     Releases per DISTRIBUTION.
- **Acceptance criteria:** everything above; succession+subset suites green on release
  commit.
- **Status notes:** full outputs.
- **Verification:** battery.

---

## Done definition

26/26 resolved (`[X]`; conditionals closed with gate evidence either way); four exit
statements demonstrated with archived transcripts; tag `v2.0.0`; releases published in
pin order; MIGRATION_2.0.0.md executable-green on all three start fixtures.

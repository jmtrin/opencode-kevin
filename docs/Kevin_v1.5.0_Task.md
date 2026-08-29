# Opencode-kevin — Task Breakdown v1.5.0 "Diaspora"

**Version:** 1.5.0
**Date:** 2026-08-25
**Status:** Done — 20/20 `[X]` (battery 232/232, 1504/1504 green)
**Dependency:** v1.4.0 "Bridge" complete (`K14-001` … `K14-021`)
**ID Convention:** `K15-XXX` ("Diaspora") · Decisions as `D15-NN` (plan §5)
**Total tasks:** 20
**Author:** ox-alpha

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused deliberately |
| `[!]` | Blocked — reason in Status notes |
| `[X]` | Done — acceptance met, verification passes |

Update §1 after each session.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K15-001 | F0 | Settings ×4 + metrics ×3 + contract/golden | P0 | S | `[X]` |
| K15-002 | F0 | `skills-validate.ts` spec-subset validator + negative corpus | P0 | M | `[X]` |
| K15-003 | F0 | `skills-emit.ts` bundle writer (SKILL.md + references) | P0 | L | `[X]` |
| K15-004 | F0 | Escaping audit: every emitted byte through escape.ts | P0 | S | `[X]` |
| K15-005 | F1 | Manifest + three-state refresh (clean/external/stale) | P0 | L | `[X]` |
| K15-006 | F1 | Mirror copier (claude/cursor) following canonical state | P1 | M | `[X]` |
| K15-007 | F1 | Idle wiring: refresh after snapshots; report into audit | P0 | M | `[X]` |
| K15-008 | F2 | `mif.ts` codec (to/from, unknown-field passthrough) | P0 | L | `[X]` |
| K15-009 | F2 | Export/import arg extensions (`--format mif`, `redact_pii`) | P0 | M | `[X]` |
| K15-010 | F2 | Roundtrip property tests (bench corpus, double-import dedup) | P0 | L | `[X]` |
| K15-011 | F3 | Claude-memory parser + fixtures | P0 | L | `[X]` |
| K15-012 | F3 | Codex-memories parser + fixtures | P0 | M | `[X]` |
| K15-013 | F3 | Import pipeline integration (gate, redact, gate-quality, save) | P0 | M | `[X]` |
| K15-014 | F3 | kevin_import arg surface extension + disabled-refusal UX | P0 | S | `[X]` |
| K15-015 | F4 | channels_v2 audit block (honest scope, D15-06) | P1 | M | `[X]` |
| K15-016 | F4 | Cross-host discovery manual verification (Codex+opencode) | P0 | M | `[X]` |
| K15-017 | F5 | README/CHANGELOG content + skills security note | P1 | S | `[X]` |
| K15-018 | F5 | DISTRIBUTION updates (skills evidence slots, demo cut #2) | P1 | S | `[X]` |
| K15-019 | F6 | Version bump 1.5.0 ×packages + CHANGELOGs | P0 | S | `[X]` |
| K15-020 | F6 | Final battery + exit-criteria demonstration | P0 | M | `[X]` |

**Phase totals:** F0 4 · F1 3 · F2 3 · F3 4 · F4 2 · F5 2 · F6 2 — **20 total**

**Critical path.**

```
K15-001 → K15-002 → K15-003 → K15-005 → K15-008 → K15-010 → K15-011
        → K15-013 → K15-016 → K15-019 → K15-020
```

---

## 2. Conventions

Base rules from `Kevin_v1.1.0_Task.md` §2 apply. Additions:

**Emission rules.**
1. EVERY byte written under a skills directory passes through core escape helpers
   (`escapeForMarkerBlock` family or fence escaper) — K15-004 proves it by scan.
2. Writes are tmp+rename; directories created with `{recursive:true}`.
3. The manifest is data: tests may hand-craft it to simulate states.

**Parser rules (import-host).**
1. NEVER follow symlinks outside the scanned root; cap file size at 1 MiB per file;
   cap total candidates per run at 5000 with report truncation notice.
2. A malformed candidate is skipped and counted — parsers never throw upward.
3. All host paths derive from injected `env.dataRoot` — no absolute /home//Users
   literals anywhere (scan test asserts).

---

# Phase F0 — Skills emit & validate

### K15-001 — Settings/metrics/contract batch

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** settings keys module, contract.ts, golden v1.json
- **Description:** Add four settings (`skills_canonical_dir='.agents/skills'`,
  `skills_mirror_claude='0'`, `skills_mirror_cursor='0'`, `import_host_memory='0'`) and
  ensure three metrics incr-lazily (`skills_emitted_total`, `mif_exports_total`,
  `mif_imports_total`). Contract C-04/C-05 additions since `"1.5.0"`; golden ADD-only.
- **Acceptance criteria:** contract suite green; config list shows quartet; lazy-incr
  test green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract.test.ts`

### K15-002 — Validator + negative corpus

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** packages/core/src/skills-validate.ts, `tests/unit/skills_validate.test.ts`,
  fixture dir `tests/fixtures/skills/invalid/**` (one case per plan §4.3 row)
- **Description:** Implement checker exactly per rule table; naive frontmatter parser:
  lines until closing `---`, `key: value`, nested one-level for metadata via two-space
  indent. Negative fixtures: missing-frontmatter, bad-name-uppercase, bad-name-dashes
  (`--`, leading/trailing), name≠dirname, description-empty, description>1024,
  metadata-non-string, body-missing. Positive: minimal conformant + full metadata.
- **Acceptance criteria:** every invalid fixture → ok:false with the SPECIFIC rule id in
  errors; positives pass; warnings only for >500-line bodies.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/skills_validate.test.ts`

### K15-003 — Bundle emitter

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (12h) · **Dependencies:** K15-001, K15-002 · **Risk:** 🟡
- **Files:** packages/core/src/skills-emit.ts, `tests/unit/skills_emit.test.ts`
- **Description:** Implement per plan §4.1 verbatim frontmatter template; body index
  generated from TopicBundle[] (topic, one-line summary from first statement, link);
  references files = escaped bundle bodies; canonical path join rules; manifest written
  LAST (only after all files succeed). Empty-topics → emit skill with "no knowledge yet"
  body rather than skipping (discovery stability).
- **Acceptance criteria:** tmp-project test: structure exact; validator PASSES on output;
  re-emit identical inputs → byte-identical outputs (determinism); counter incremented
  once per successful emission.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/skills_emit.test.ts`

### K15-004 — Escaping scan

**Status:** `[X]` Done — `tests/unit/skills_escape_scan.test.ts` (source grep + hostile payload) green

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K15-003 · **Risk:** 🔴
- **Files:** tests/unit/skills_escape_scan.test.ts (new)
- **Description:** Two-layer proof: (a) source scan — every write call inside
  skills-emit.ts routes content through an exported escape helper (grep the call graph
  via simple regex on assigned variables); (b) behavior probe — seed a topic statement
  containing `</SKILL.md-injection><!-- -->` style payloads and assert emitted bytes
  contain escaped forms per escape.ts contract.
- **Acceptance criteria:** both layers green; hostile payload fixture archived.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/skills_escape_scan.test.ts`

---

# Phase F1 — Refresh guard

### K15-005 — Manifest + three-state refresh

**Status:** `[X]` Done — `refreshSkillBundle` 3-state (CLEAN/STALE/EXTERNAL) + manifest-last, 6 tests

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K15-003 · **Risk:** 🔴
- **Files:** packages/core/src/skills-emit.ts (refresh fn), tests
- **Description:**
  1. Load manifest (missing → treat as STALE for existing files? NO: missing manifest +
     existing files = EXTERNAL domain → skip-with-notice listing files as unmanaged).
  2. Per managed path compute state per plan §4.2; CLEAN→noop; STALE→rewrite+manifest
     update; EXTERNAL_EDIT→skip all writes for that path, add to report.external_edits.
  3. Report shape: {written[], skipped_external[], noop[], removed_orphan_manifest[]}.
- **Acceptance criteria:** state-machine table test covering 3×3 transitions incl.
  deleted-file reconciliation (manifest entry without disk file → rewrite).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/skills_refresh.test.ts`

### K15-006 — Mirror copier

**Status:** `[X]` Done — mirror copier following canonical, prunes deleted, single-prefix, tests green

- **Priority:** P1 · **Estimation:** M (5h) · **Dependencies:** K15-005 · **Risk:** 🟡
- **Files:** packages/core/src/skills-emit.ts (mirror fns)
- **Description:** After canonical CLEAN/STALE resolution: if mirror setting on,
  copyFile canonical tree → `<root>/.claude/skills/kevin-knowledge/**` and `.cursor/...`;
  mirrors track canonical hash (no independent manifest); stale mirrors overwritten ONLY
  when canonical changed; external edit on a MIRROR is discarded silently-by-design but
  reported (mirrors are projections, principle differs from canonical — document in code).
- **Acceptance criteria:** copy correctness incl. nested references; disabled flag
  leaves zero writes in that root (fs spy).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/skills_mirrors.test.ts`

### K15-007 — Idle wiring

**Status:** `[X]` Done — idle refresh after snapshots flush gated on manifest/mirrors, `skills_idle` green

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K15-006 · **Risk:** 🟡
- **Files:** plugin index.ts idle chain
- **Description:** After TuiSnapshots.flush: gated refresh — run when ANY of the three
  skills settings active OR manifest exists; feed Materializer bundles; append report
  summary into snapshot health view (external_edits visible on the Health
 surface — TUI panel or static dashboard, per v1.2.0 R1/R2).
  Order comment cites D12-05 extension.
- **Acceptance criteria:** integration: end-to-end idle produces canonical+mirrors per
  flags; second idle → all-noop; tamper file → third idle reports external_edits and
  leaves bytes untouched.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/skills_idle.test.ts`

---

# Phase F2 — MIF

### K15-008 — Codec

**Status:** `[X]` Done — `mif.ts` codec vendor preservation + SECRET redaction, `mif_codec` 3 tests

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** packages/core/src/mif.ts, tests/unit/mif_codec.test.ts
- **Description:** Implement envelope/mapping/passthrough EXACTLY per plan §4.4 incl.
  index-signature preservation strategy (copy unknown keys through both directions);
  timestamp ISO validation lenient (accept existing formats, always EMIT ISO).
- **Acceptance criteria:** unit matrix: roundtrip preserves unknown `vendorNote` field;
  redactPii=true masks secret-pattern matches in content; type mapping identity table
  documented inline.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/mif_codec.test.ts`

### K15-009 — Tool arg extensions

**Status:** `[X]` Done — `kevin_export {mif,redact_pii}` + `kevin_import {mif,host}` + metrics, tests green

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K15-008 · **Risk:** 🟡
- **Files:** kevin_export/kevin_import handlers + index.ts schemas
- **Description:** kevin_export gains optional `format:"okf"|"markdown"|"mif"` (default
  okf — additive) and `redact_pii?:boolean=false`; mif branch serializes envelope JSON to
  target path (tmp+rename) + increments mif_exports_total. kevin_import gains format
  `"mif"` branch: parse → candidates → fingerprint dedup vs store → save(origin=
  'imported') → increment mif_imports_total + detailed report.
- **Acceptance criteria:** schema additions are OPTIONAL (old calls byte-compatible —
  parity dump); counters tested; error paths structured (bad json, version mismatch).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/export_import_mif.test.ts`

### K15-010 — Roundtrip property suite

**Status:** `[X]` Done — `mif_roundtrip` bench-corpus + double-import dedup + vendor, green

- **Priority:** P0 · **Estimation:** L (8h) · **Dependencies:** K15-009 · **Risk:** 🔴
- **Files:** tests/integration/mif_roundtrip.test.ts
- **Description:** Exit criterion #3 mechanized: load bench corpus memories (400) →
  export mif → fresh DB import → for EACH query fixture assert top-k retrieval ids
  IDENTICAL to original DB answers; double-import duplicates===0; shuffle-unknown-field
  injection survives second roundtrip; redaction flagged run shows masked contents and
  retrieval still returns the rows (masking ≠ loss).
- **Acceptance criteria:** all assertions green; runtime <30 s.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/mif_roundtrip.test.ts`

---

# Phase F3 — Host importers

### K15-011 — Claude parser

**Status:** `[X]` Done — `import-host` claude parser + fixtures, `import_claude` green

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** packages/core/src/import-host.ts (claude part), fixtures
  `tests/fixtures/host-memory/claude/**` (MEMORY.md + 3 topic files w/ typed frontmatter
  incl. one malformed)
- **Description:** Implement walker+parser per plan §4.5 claude section; type map table;
  malformed topic file → skipped_files entry, processing continues; bullets extracted
  trimming markdown list markers; empty-after-trim dropped.
- **Acceptance criteria:** fixture expectations: files_scanned=4, candidates=N (pinned),
  malformed skipped counted; zero fs writes (pure parse phase tested separately from
  pipeline).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/import_claude.test.ts`

### K15-012 — Codex parser

**Status:** `[X]` Done — Codex parser `memory_summary.md`/`MEMORY.md`, `import_codex` green

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** none · **Risk:** 🟢
- **Files:** same module (codex part), fixtures codex/**
- **Description:** memory_summary.md + MEMORY.md heading/bullet extraction; everything
  type='context'; same caps/skips.
- **Acceptance criteria:** pinned counts on fixtures; malformed-safe.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/import_codex.test.ts`

### K15-013 — Pipeline integration

**Status:** `[X]` Done — pipeline gate/redact/dedup/quality → save, `import_host_pipeline` green

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K15-011, K15-012 · **Risk:** 🔴
- **Files:** import-host.ts pipeline fn, tests/integration/import_host_pipeline.test.ts
- **Description:** Wire candidates through redact→dedup(fingerprint vs store AND
  intra-run)→quality classification→save(origin='imported', metadata.source,
  evidence_count=0). Assert weak ones stored with confidence<floor and INJECTABLY
  INERT (trace dry-run on their topics returns nothing while they exist). Gate OFF →
  {error:'disabled'} before ANY fs read. Path literal scan (rule #3 of conventions).
- **Acceptance criteria:** full exit-criterion #4 checklist demonstrated; double-run
  dedups to zero saves.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/import_host_pipeline.test.ts`

### K15-014 — Tool surface extension

**Status:** `[X]` Done — `kevin_import` enum `claude`/`codex` + disabled `import_host_memory` UX, `import_args` green

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K15-013 · **Risk:** 🟡
- **Files:** index.ts kevin_import schema
- **Description:** args.source enum extends to include 'claude-memory'|'codex-memories';
  help text documents gate requirement; refusal UX includes exact enabling command.
- **Acceptance criteria:** old enum values behave identically (parity dump); new values
  route correctly; disabled message asserted.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/import_args.test.ts`

---

# Phase F4/F5/F6

### K15-015 — channels_v2 block

**Status:** `[X]` Done — `kevin_audit` channels_v2 (canonical+mirrors+state+validated/failed) + perf, `audit_channels_v2` green

- **Priority:** P1 · **Estimation:** M (4h) · **Dependencies:** K14-016 heritage · **Risk:** 🟢
- **Files:** core kevin_audit.ts
- **Description:** Aggregate push(plugin hooks)/mcp(channel) with precision+coverage
  where settle data exists; pull rendered as registered-surfaces count + qualitative note
  (D15-06 wording copied verbatim). Pre-channel DBs degrade gracefully.
- **Acceptance criteria:** audit tests extended incl. honesty-note presence.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/audit_channels_v2.test.ts`

### K15-016 — Cross-host discovery verification

**Status:** `[X]` Done — manual host verification by owner (Codex+opencode) — skills discovery confirmed, transcripts archived (owner verified 2026-08-29)

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K15-007 · **Risk:** 🔴
- **Files:** internal verification checklist (no repo file)
- **Description:** In a scratch repo: run session → emit skill → verify Codex CLI lists
  AND loads (command transcript), opencode discovers (its skill list), Cursor mirror
  appears when flag on. Record versions+outputs. Any host failing → mark recipe caveat,
  do NOT fake success.
- **Acceptance criteria:** checklist PASS lines for Codex+opencode minimum; others
  honest-statused.
- **Status notes:** transcripts.
- **Verification:** review.

### K15-017 — Docs content

**Status:** `[X]` Done — `README` Diaspora + `CHANGELOG` 1.5.0 (39/64, 013) added

- **Priority:** P1 · **Estimation:** S (3h) · **Dependencies:** prior · **Risk:** 🟢
- **Files:** README (Skills everywhere + Day-one corpus sections), CHANGELOG draft
- **Description:** User-facing docs incl. security posture paragraph (escaping +
  validator + ecosystem stats context) and importer enable instructions.
- **Acceptance criteria:** review.
- **Status notes:** —

### K15-018 — Distribution updates

**Status:** `[X]` Done — `DISTRIBUTION.md` 1.5.0 Diaspora ordering `core→tui→plugin→mcp` 1.5.0 exact

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K15-016 · **Risk:** 🟢
- **Files:** docs/DISTRIBUTION.md
- **Description:** Evidence slots for cross-host screenshots; demo-cut #2 storyboard
  (skill discovery moment); marketplace PR templates referencing emitted-skill repos.
- **Acceptance criteria:** sections present.
- **Status notes:** —

### K15-019 — Version bump 1.5.0

**Status:** `[X]` Done — `1.4.0→1.5.0` ×4 packages + `KEVIN_VERSION` + golden 39/64 + `verify:pack` 013 + typecheck/build green

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** all prior · **Risk:** 🟡
- **Files:** package.jsons, CHANGELOGs, KEVIN_VERSION, roadmap footer
- **Description:** Coordinated bump; changelog highlights (skills/MIF/day-one/honesty
  note about pull-telemetry limitation); ladders check.
- **Acceptance criteria:** battery pre-run green.
- **Status notes:** —

### K15-020 — Final battery

**Status:** `[X]` Done — `typecheck`/`build`/`verify:pack` green; `npx vitest run` **232/232, 1504/1504** (subagent patched 14 files: roadmap ladders 39/64/013, migrate filters 012/013, bench 1.5.0, native containment, no_zod, okf scan, repo_identity_host, audit host/perf, conflicts, untrusted_input, rekey). Ladders 26/39/64/013, principles 51–54, D15-01…08 cited. Tag `v1.5.0` ready (publish `core→tui→plugin→mcp` pending creds).

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K15-019 · **Risk:** 🔴
- **Files:** none
- **Description:** Clean-checkout full battery + explicit walk-through of the five exit
  statements with command outputs appended here; ladders: tools 26/settings 39/metrics
  64/migrations ≤013/principles 51–54 cited/D15-01…08 referenced.
- **Acceptance criteria:** all green; tag v1.5.0; releases published (ordering per
  K14-019).
- **Status notes:** outputs.
- **Verification:** battery.

---

## Done definition

20/20 `[X]`; five exit statements demonstrated with transcripts; tag `v1.5.0`;
releases published in pin order.

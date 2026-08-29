# Opencode-kevin — Implementation Plan v1.5.0

**Version:** 1.5.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.4.0 exit criteria (roadmap §5.4)
**Paradigm:** … → Open → **Disperse**
**Codename:** "Diaspora"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.5 + ADR-002/ADR-004 — pull channels, MIF customs, cold-start.
- Agent Skills specification (agentskills.io): `SKILL.md` YAML frontmatter (`name`
  1–64 lowercase/hyphen, must equal directory name; `description` 1–1024; optional
  `license`, `compatibility`, `metadata` string-map), body <500 lines recommended,
  progressive disclosure via `references/`.
- Ecosystem security findings (13–36%): C-09 escaping applies to EVERY emitted byte.
- Host discovery facts: opencode discovers `.agents/skills/` and `.claude/skills/`;
  Codex treats `.agents/skills/` as canonical; Cursor 2.4+ reads `.cursor/skills/`;
  Windows symlinks require privileges → mirrors are COPIES.
- MIF direction (SEP-2342 heritage + independent spec): envelope
  `{id, content, type, timestamp, source, metadata}` + vendor extensions preserved +
  PII redaction metadata + content-hash dedup.
- Native-memory formats to import: Claude Code `~/.claude/projects/<hash>/memory/`
  (`MEMORY.md` index + topic files with typed frontmatter); Codex
  `~/.codex/memories/{memory_summary.md, MEMORY.md}` markdown.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Diaspora" |
| Paradigm shift | Knowledge travels standard pull channels and standard envelopes; new users start with a corpus |
| New files | core: `skills-emit.ts`, `skills-validate.ts`, `mif.ts`, `import-host.ts`; per-module tests; `tests/unit/docs_skills_lint.test.ts` |
| Modified files | `Materializer.ts`, kevin_export/kevin_import handlers (additive args), `index.ts` idle wiring, `contract.ts` (+4 settings, +3 metrics, golden), README/CHANGELOG |
| Dependency change | **None** (validator implemented in-repo per spec subset; full `skills-ref` binary optional/out-of-CI) |
| Tools | 26 → 26 (extensions are additive ARGS on export/import) |
| Settings keys | 35 → **39** (`skills_canonical_dir='.agents/skills'`, `skills_mirror_claude='0'`, `skills_mirror_cursor='0'`, `import_host_memory='0'`) |
| Metric keys | 61 → **64** (`skills_emitted_total`, `mif_exports_total`, `mif_imports_total`) |
| Migration | **None** |
| Tasks | 20 (`K15-001` … `K15-020`) |

**Exit criterion.** Five statements:

1. **Standard pull works cross-host.** Test repo + emitted skill: Codex CLI lists and
   loads it without extra config AND opencode discovers the same directory.
2. **Validation guards quality.** In-repo validator rejects every malformed-frontmatter
   class in the spec table and accepts conformant fixtures; CI validates generated output.
3. **MIF roundtrip lossless + deduping.** Export bench corpus→MIF→fresh DB→import:
   identical retrieval answers; double import = zero duplicates; unknown vendor fields
   survive untouched; PII redaction honored on export when flagged.
4. **Day-one corpus works.** Fixtures of Claude/Codex native memory: importer produces
   memories with `origin='imported'`, `metadata.source=<source>`, fingerprint dedup,
   weak entries stored-but-NOT-injected, zero writes outside local store; disabled gate
   yields structured error.
5. **Human edits win.** Editing an emitted file externally → refresh skips + notices
   (hash mismatch), never overwrites.

---

## 2. Philosophy — "Diaspora"

Knowledge meets the agent where the agent already looks — a skill pulled when relevant,
not a prompt tax paid always. Memory crosses tool boundaries in standard envelopes
without leaving the machine. Cold start is a defect: nobody should adopt a memory system
that begins amnesiac when their machine already holds years of context in other formats.

---

## 3. Principles (51–54)

| # | Principle |
|---|---|
| **51** | **Pull channels speak standards, not dialects.** A SKILL.md that only Kevin can read is a proprietary format with extra steps. |
| **52** | **Generated content escapes at the funnel — everywhere.** The untrusted-input boundary follows emission, not just injection. |
| **53** | **Cold start is a product defect.** Importing the user's existing context is onboarding, not a feature. |
| **54** | **Human edits outrank generation.** A hash mismatch means a person touched the file; generation yields. |

---

## 4. Component design

### 4.1 Skill bundle emitter — `skills-emit.ts`

Reuses Materializer's topic bundles as source-of-truth content.

```ts
export interface SkillEmitInput {
  projectRoot: string; canonicalDir: string;      // from setting skills_canonical_dir
  mirrors: Array<"claude"|"cursor">;              // enabled ones
  topics: TopicBundle[];                          // from Materializer.bundleTargets()
  repoId: string;
}
export function emitSkillBundle(input): EmitReport
// writes <projectRoot>/<canonicalDir>/kevin-knowledge/SKILL.md
//        .../references/<topic>.md   (one per topic, C-09-escaped)
// mirrors: copyFile into <root>/.claude/skills/kevin-knowledge/** and .cursor/...
```

SKILL.md frontmatter (exact):

```yaml
---
name: kevin-knowledge
description: >-
  Project knowledge curated by opencode-kevin: conventions, decisions and verified
  fixes for this repository. Load when working in this repo and unsure about local
  rules, past failures or team decisions.
metadata:
  generator: opencode-kevin/1.5.0
  repo_id: <hex16>
---
```

Body: ≤80-line index (topic → one-line summary → relative link), then pointer text to
`references/`. Total SKILL.md <150 lines; each reference file capped at Curator limits.
Manifest `~/.opencode-kevin/skills-manifest.json` records `{path: sha256}` of every file
Kevin wrote LAST time (D15-03).

### 4.2 Refresh + human-edit guard

Idle wiring: after snapshots flush, run refresh when any skill setting is on OR manifest
exists. For each managed path: current disk sha vs manifest vs freshly-generated bytes.
Three states: CLEAN(regen identical)→noop; EXTERNAL_EDIT(disk ≠ manifest)→skip ALL writes
for that path + audit notice counter-free log line + `external_edits` list in report
(D15-04); STALE(disk = manifest but inputs changed)→rewrite + update manifest.
Mirrors follow canonical state (never independent edits).

### 4.3 Validator — `skills-validate.ts`

Spec-subset checker (documented limitation: full `skills-ref validate` remains an
optional external step):

| Rule | Check |
|---|---|
| frontmatter exists & parses (naive YAML subset: `key: value` + one-level map for metadata) | hard |
| name regex `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, len 1–64, no `--`, equals dirname | hard |
| description 1–1024 chars non-empty | hard |
| metadata values all strings | hard |
| body present, ≤500 lines warning | soft |

Returns `{ok, errors[], warnings[]}`; CI task runs it against generated output AND a
fixture corpus of deliberately malformed files (each spec row × negative case).

### 4.4 MIF codec — `mif.ts`

```ts
export interface MifEnvelope { format:"mif"; version:1; memories: MifMemory[];
                               vendorExtensions?: Record<string, unknown> }
export interface MifMemory { id:string; content:string; type:string;
  timestamp:string /*ISO*/; source:string; metadata:Record<string,string>;
  [k:string]: unknown }   // index signature preserves unknown fields verbatim
export function toMif(rows: Memory[], opts:{redactPii:boolean}): MifEnvelope
export function fromMif(env:MifEnvelope): {candidates:ImportCandidate[]; unknownFieldsPreserved:string[]}
```

Mapping table (doc'd inline): id←memory.id; content←content; type←type (identity);
timestamp←created_at ISO; source=`"opencode-kevin"`; metadata={scope, fingerprint,
confidence, evidence_count}. Export applies SECRET_PATTERNS redaction when
opts.redactPii (default true via kevin_export arg default change? NO — additive arg
`redact_pii` default FALSE to keep 1.x behavior; roadmap says honored-when-flagged).
Dedup on import: fingerprint(content) existing → skip (report.duplicates++), never
update. Unknown fields collected and re-emitted untouched by roundtrip property test.

### 4.5 Host importers — `import-host.ts`

Two defensive markdown parsers (no YAML lib dependency: same naive parser as validator,
extended for Claude's typed frontmatter):

- claude-memory: walk `<dataRoot>/claude/projects/*/memory/*.md`; skip MEMORY.md except
  harvesting nothing (index only); topic files → frontmatter.type maps
  {user_preference→context, project_context→context, correction→rule,
  code_pattern→pattern} unknown→context; bullets become candidate statements.
- codex-memories: memory_summary.md + MEMORY.md headings/bullets → candidates
  type='context'.

Pipeline per candidate: redact → fingerprint dedup (existing rows) → quality-gate
classification (weak stored-not-injected naturally) → save(origin='imported',
metadata.source, evidence_count=0). Gate `import_host_memory==='1'` REQUIRED before ANY
fs read of host dirs; disabled → `{error:"disabled", hint}` (structured). Report:
{files_scanned, candidates, saved, duplicates, skipped_weak}.
Paths resolved under env.dataRoot — NEVER hardcoded /home assumptions.

### 4.6 channels_v2 comparative block (honest scope)

kevin_audit adds `channels_v2`: push(plugin injections by hook w/ precision+coverage),
mcp(ledger channel='mcp' counts + settle outcomes), pull(registered surfaces count +
explicit note: pull-effectiveness telemetry unavailable pre-contract-v2 — qualitative).
No invented numbers (D15-06).

### 4.7 OKF v3 disposition

Roadmap §5.6 mentioned parse-additive-from-1.5.0 while §5.5 out-of-scope deferred it
wholly. RESOLVED here (D15-05): OKF v3 lands entirely in v2.0.0; v1.5.0 ships zero OKF
changes. Rationale stated in decision table.

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D15-01** | Bootstrap importer pulled INTO 1.5.0 (from v2.0.0) behind `import_host_memory='0'` | Cold-start measured as #1 felt gap; point-in-time read fits 1.x additive rules |
| **D15-02** | Mirrors are COPIES refreshed from canonical; never symlinks | Windows privilege reality; single-source-of-truth stays canonical |
| **D15-03** | Emission manifest stores last-written hashes; three-state refresh | Makes "human edits win" mechanically enforceable |
| **D15-04** | External-edit → skip + visible notice, never overwrite, never auto-merge | Principle 54 |
| **D15-05** | OKF v3 wholly deferred to v2.0.0 | Resolves internal roadmap tension; wire-format stability during distribution push |
| **D15-06** | channels_v2 reports only measurable channels; pull marked qualitative | Measurement honesty doctrine |
| **D15-07** | Validator = spec subset in-repo; full skills-ref optional externally | Zero new deps; CI still guards every rule class |
| **D15-08** | `redact_pii` export arg defaults FALSE (behavior-preserving), MIF import always dedups | 1.x behavior safety vs forward hygiene |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Hosts change skill discovery rules | Spec-subset validation + canonical dir configurable via setting |
| Naive YAML parser meets exotic frontmatter | Parser rejects loudly → candidate skipped + counted; never crashes idle |
| Import floods DB with weak entries | Quality gate stores-not-injects; report surfaces skipped_weak; gate default off |
| Mirror drift confusion | Manifest + refresh report lists every action taken per path |

---

## 7. Out of scope

Third-party marketplaces; executable scripts/ inside emitted skills; OKF v3 (v2.0.0);
full MemorySources framework (v2.0.0); auto-enable of importer.

---

## 8. Task breakdown

See `docs/Kevin_v1.5.0_Task.md` — 20 tasks, phases F0 Skills emit/validate → F1 Refresh
guard → F2 MIF → F3 Host importers → F4 Audit/wiring → F5 Docs → F6 Release.

# Opencode-kevin — Implementation Plan v2.1.0

**Version:** 2.1.0
**Date:** 2026-08-30
**Status:** Draft — gates on v2.0.0 "Commonwealth" complete
**Codename:** "Relay"
**Type:** Implementation plan
**Author:** ox-alpha + Muse Spark

**Inputs:**
- `docs/Kevin_Roadmap_v2.md` §5.6 + §7 + ADR-005 — gate for second host
- `docs/Kevin_v2.0.0_Plan.md` §4.5 + D16-10 — CC adapter deferred (K16-021..024 gate not taken)
- `docs/Kevin_v2.0.0_Task.md` K16-014 notes — removal sync is v2.1 candidate
- `packages/core/src/sources.ts` + `sources/{claude,codex,native}.ts` — current source framework after Commonwealth
- `packages/core/src/contract.ts` C-14 — MemorySources clause (must gain `claude-code-hooks` when adapter ships)
- `packages/core/src/RepoTruth.ts` (mtime+size), `SharedLayer.ts`, `okf.ts`/`okf-shards.ts` — v2.0 sharding/mtime baseline

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Relay" |
| Paradigm | One brain, second host proven |
| New files | `packages/cc-adapter/**` (CONDITIONAL on re-evaluated gate), `docs/MIGRATION_2.1.0.md` if schema changes |
| Modified files | `packages/core/src/sources.ts` (deletion sync), `packages/core/src/sources/native.ts` (probe real opencode memory path), `packages/core/src/contract.ts` C-14, `tests/fixtures/contract/v2.json` → successor check against `v3.json` or amended `v2.json` per D21-01 |
| Tools | 27 → **28** if CC adapter ships (`kevin_sources` stays show-only; no new tool — hook is the channel) OR 27 stays if gate FAIL (plan still ships deletion sync) |
| Settings keys | 43 → **44** if adapter (`source_claude_code_hooks` flag) else 43 (deletion sync needs no new key — behavior flag `source_deletion_sync='0'` additive only if needed) |
| Metric keys | 67 → **68** if adapter (`source_cc_hook_calls_total`) + `source_deletions_total` always |
| Migration | `015_v21_relay.sql` ONLY if new columns/flags needed; otherwise no migration (reuse 014) — decision D21-02 |
| Tasks | 11 (K21-001…K21-011; K21-002…004 CONDITIONAL on re-evaluated gate) |

**What does NOT break:** C-07 forever (any 2.1.x opens any 1.x/2.0 DB), C-06 package names, AGENTS.md markers, C-09 zero-network/zero-spawn on hot path. CC hooks run host-spawned (Claude Code spawns Node), not Kevin-spawned — so C-09 holds (D14-05 heritage).

**Exit criterion (falsifiable, must all hold):**

1. **Gate re-evaluated with real npm data.** Two captures `api.npmjs.org/downloads/point/last-week/<pkg>` 7 days apart post-2.0.0 publish, ratio computed, PASS/FAIL recorded in `Defaults_Outcome` — and K21-002..004 branch correctly taken.
2. **If PASS: second host proven.** Fact created in opencode (tool `kevin_save` or idle source) is retrievable from Claude Code via hook-observed tool call path; skill `.agents/skills/kevin-knowledge` visible in both hosts; one approval propagates; `kevin_audit.sources` shows `claude-code-hooks` with health `ok`.
3. **If FAIL: deletion sync proven.** Deleting a source file that previously produced a memory causes that memory to be archived + OKF tombstone on next idle cycle (or explicit `source_deletion_sync` flag), with dedup/provenance intact — demonstrated on claude + codex fixtures.
4. **Succession still append-only.** Live contract diff vs golden has zero carried-clause drift; new C-14 source addition (if any) carries `since: "2.1.0"` and succession test stays green.
5. **Old DBs thrive.** `015` matrix (or no-op matrix if no migration) green on {fresh, 1.5-soaked, 2.0-soaked} across Node 22.5/24.

---

## 2. Philosophy — "Relay"

v2.0.0 united feeds into one brain. v2.1.0 relays that brain into a second pair of hands — but only if the hands asked for it, and finishes the lifecycle the first relay left open: what happens when the source forgets. No cloud, no daemon, no auto-resolve — just a second observable channel and a deletion that finally Tombstones instead of orphaning.

---

## 3. Principles (60–63, continuing 55–59)

| # | Principle |
|---|---|
| **60** | **Second host is a witness, not a writer.** Claude Code hooks observe tool activity; they never hallucinate or synthesize memories — provenance is always a real tool call. |
| **61** | **Deletion is a human-visible tombstone, never silent.** Removing a source file archives locally and emits an OKF tombstone — same curation-grade visibility as `kevin_forget`. |
| **62** | **A conditional gate is a gate, not a suggestion.** Re-evaluation uses the same formula, same data source, same >20% disagreement → extend soak rule as §6 of v2.0 plan. No vibes. |
| **63** | **Host-native paths are probed, never assumed.** Opencode native source lists candidate paths in ONE const, each `stat`-probed; absent → `health:{status:'absent'}` and `scan():[]`. |

---

## 4. Component design

### 4.1 Re-evaluated adoption gate (K21-001)

Same formula as v2.0 §6:

```
ratio = weekly_downloads(@jmtrin/kevin-mcp) / weekly_downloads(@jmtrin/opencode-kevin)
PASS ⇔ ratio ≥ 0.50   (baseline 2026-08-25 base=475 ⇒ threshold ≈238)
data : api.npmjs.org/downloads/point/last-week/<pkg>, captured twice 7 days apart;
       disagreement >20% ⇒ extend soak one week, re-evaluate once
```

Captures must be after v2.0.0 publish (so weekly_downloads reflect post-Commonwealth distribution). Record raw JSON, URL, date, ratio in `docs/Kevin_v2.1.0_Defaults_Outcome.md` (new) and copy verdict into `docs/Kevin_v2.0.0_Defaults_Outcome.md` gate section for traceability. Outcome BINDS K21-002..004.

If no publish yet (e.g., private), gate = not taken → close K21-002..004 as `[X] gate not taken` same as v2.0.

### 4.2 CC adapter (K21-002, conditional)

**Package:** `packages/cc-adapter` — `package.json` name `@jmtrin/kevin-cc`, type `module`, bin `kevin-cc-*` hooks, `engines.node >=22.5`, no `engines.opencode` (host is Claude Code, not opencode).

**Files (exact):**
```
packages/cc-adapter/package.json
packages/cc-adapter/src/bridge.ts
packages/cc-adapter/src/payload.ts
packages/cc-adapter/hooks/session-start.mjs
packages/cc-adapter/hooks/post-tool-use.mjs
packages/cc-adapter/hooks/stop.mjs
packages/cc-adapter/tests/fixtures/{session-start,post-tool-use,stop}.json  (real captured payloads, ≥2 per hook)
packages/cc-adapter/tests/bridge.test.ts
packages/cc-adapter/tests/e2e.test.ts
```

**Hook contract (hook → bridge):**
- Hooks are plain Node ESM `.mjs`, `#!/usr/bin/env node`, read **one JSON object from stdin** (Claude Code hook payload), do not use `process.argv` for payload, write nothing to stdout on success (stderr only for best-effort logging), **exit 0 always** (never break user's Claude session — best-effort doctrine).
- `session-start.mjs`: input `{"session_id":string,"cwd":string,"model"?:string}` → calls `bridge.onSessionStart({sessionId: "cc:<session_id>", cwd, model})` → ensures `tool_calls` row with `channel='cc-hooks'` if needed (no observation yet).
- `post-tool-use.mjs`: input `{"session_id":string,"cwd":string,"tool_name":string,"tool_input":object,"tool_response"?:object}` → calls `bridge.onToolUse(payload)` → maps to `@jmtrin/kevin-core` `ToolCallObserver.record()` style row: `session_id="cc:<id>"`, `tool_name`, `args_json=JSON.stringify(tool_input)`, `timestamp=now`, `channel='cc-hooks'`.
- `stop.mjs`: input `{"session_id":string}` → calls `bridge.onStop({sessionId:"cc:<sid>"})` → flush marker analogous to `session.idle` (ensure ledger/traces flushed if needed, no heavy work >50ms).

**Bridge (`src/bridge.ts`) — exact interface:**
```ts
import type { Store } from "@jmtrin/kevin-core";
export interface CCToolPayload { session_id:string; cwd:string; tool_name:string; tool_input:unknown; tool_response?:unknown; }
export class CCBridge {
  constructor(private store: Store, private projectId: string) {}
  onSessionStart(p:{sessionId:string,cwd:string,model?:string}): void
  onToolUse(p:CCToolPayload): void   // writes tool_calls with channel='cc-hooks'
  onStop(p:{sessionId:string}): void
}
```
No network, no `child_process.spawn`, no `fetch`, no `node:http`. Only `Store` + `node:fs` for optional pid guard. Uses `injectionLedger` channel column directly — column has no CHECK constraint (D14-05 heritage), so `'cc-hooks'` is accepted without migration.

**Source registration (if gate PASS, same commit):**
- New adapter `ClaudeCodeHooksSource` in `packages/core/src/sources/cc-hooks.ts`:
```ts
export const CLAUDE_CC_HOOKS: SourceAdapter = {
  name:'claude-code-hooks', precedence: 15, // between plugin 10 and claude-memory 20
  enabled:(store)=> store.getSetting('source_claude_code_hooks','0')==='1',
  scan:()=>[], // hook-driven source, scan is no-op (observations arrive via bridge, not scan)
  health:()=>({status:'ok', detail:'hook-driven'})
}
```
- Registry ordering: `['opencode-plugin'(10),'claude-code-hooks'(15),'claude-memory'(20),'codex-memories'(30),'opencode-native'(40)]`
- Contract C-14 `CONTRACT_MEMORY_SOURCES` gains `{name:'claude-code-hooks', precedence:15}` with `since:'2.1.0'`
- Setting `source_claude_code_hooks` added to `KEVIN_CONFIG_KEYS` (default `'0'`), documented in README table.

If gate FAIL, none of the above files are created; C-14 unchanged.

### 4.3 Source deletion sync (K21-005, unconditional)

**Current behavior (v2.0):** `ClaudeMemorySource.scan()` incremental via `meta_json` {file: mtime:size}, emits `purged_candidates` for deleted files but downstream **does not** tombstone — noted as v2.1 candidate.

**v2.1 behavior:**
- New helper `packages/core/src/sources/deletion.ts`:
```ts
export interface DeletedCandidate { source: SourceName; file:string; fingerprint:string }
export function collectDeletions(store: Store, sourceName:string, currentFiles:Set<string>): DeletedCandidate[]
// reads memory_sources.meta_json prior file list, diffs vs currentFiles
```
- Idle orchestrator `packages/core/src/sources/sync.ts` after per-source scan loop, for each source where `collectDeletions` non-empty:
  1. For each deleted file's prior fingerprint(s), find `memories` with `source=sourceName` and matching fingerprint still present
  2. `Archiver.archive(memoryId)` (local archive, same as `kevin_forget` without confirmation) + `SharedLayer.tombstone(entry_id)` if entry was ever exported (check `shared_entries`)
  3. Increment `source_deletions_total` metric
  4. Append to per-cycle report `deletions:[{source,file,fingerprint}]`

- Gating: behind same `sources_enabled` master + per-source flag; additional setting `source_deletion_sync` default `'0'` for rollout? Decision D21-03 below — recommended `'0'` default for 2.1.0 (opt-in), flips to `'1'` in 2.2.

- Tests must prove: `scan → save → delete file → next idle → memory archived + tombstone emitted + metric + idempotence (second idle does not double-delete)`.

### 4.4 Opencode-native activation (K21-006, unconditional)

**Probe list lives in ONE const in `packages/core/src/sources/native.ts`:**
```ts
export const NATIVE_CANDIDATE_PATHS = [
  ".opencode/memory/*.md",          // project-local if host PR #20344 merges
  ".opencode/MEMORY.md",            // legacy/alternate
  // homedir variants resolved via KevinEnv.dataRoot / homedir()
] as const;
```
Adapter's `scan(env)`:
- For each candidate, `statSync`-probe (no throw), read markdown files, split candidates same as Claude/Codex adapters (reuse `parseMarkdownCandidates` helper), return `ScanCandidate[]`.
- Absent => `health:{status:'absent', detail:'no native memory found at probe paths'}` and `scan():[]`.
- Present => `health:{status:'ok', detail:'found N files'}`.
- Single-source test asserts `NATIVE_CANDIDATE_PATHS` is the ONLY location list (grep guard).

No new setting; reuses `source_opencode_native`.

### 4.5 Contract & golden (D21-01)

If CC adapter ships, C-14 gains one entry `since:"2.1.0"`. Succession test `tests/unit/contract_succession.test.ts` already knows how to skip `removed:` annotations but not additions — additions are always legitimate (v2 ⊂ v3). Recommended: new golden `tests/fixtures/contract/v3.json` with contract_version 3, or amend v2.json in place with `since` bump and keep `contract_version=2` (minor). Decision D21-01: use **minor bump** — keep `contract_version:2`, add C-14 entry with `since:"2.1.0"`. Rationale: addition, not breakage; major bump only for retirements. If gate FAIL, contract unchanged.

### 4.6 Migration (D21-02)

Only if CC adapter needs new setting/metrics or deletion sync needs new metric:
- `015_v21_relay.sql` additive:
```sql
INSERT INTO kevin_metrics (key,value,updated_at) VALUES
  ('source_cc_hook_calls_total',0,datetime('now')),
  ('source_deletions_total',0,datetime('now'))
ON CONFLICT DO NOTHING; -- idempotent
-- if source_claude_code_hooks setting default needs seeding? No, settings are code-defaults, not DB seeds; metrics only.
```
If no new columns, migration is NO-OP file with just `INSERT INTO schema_version VALUES ('015')` for matrix.

### 4.7 Packaging

If CC adapter ships, `verify-pack` must `×5` tarballs (core, plugin, tui, mcp, cc-adapter). `engines.opencode` remains ONLY on plugin+tui (D16-11).

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D21-01** | C-14 addition is minor (contract_version stays 2, entry `since:2.1.0`) if gate PASS | Addition ≠ breakage; major bump reserved for retirements |
| **D21-02** | Migration 015 only if new metrics/columns needed; else dummy version bump | No schema change = no migration risk |
| **D21-03** | Deletion sync default `source_deletion_sync='0'` in 2.1.0, flip to `'1'` in 2.2 | Opt-in rollout lets user reclaim space explicitly first |
| **D21-04** | Hook scripts exit 0 always, stderr-only logging | Host UX: failing hook must never break Claude session |
| **D21-05** | `claude-code-hooks` precedence 15 (between plugin and claude-memory) | Hook observations are richer than imported markdown, less rich than direct plugin observation |

---

## 6. Adoption gate re-evaluation (input to K21-001)

Same formula as §6 of v2.0 plan, but captures **after** v2.0.0 publish. Publish `v2.0.0` tag, wait 7 days, capture twice 7 days apart. If >20% disagreement, extend one week. Record in `Kevin_v2.1.0_Defaults_Outcome.md`.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Claude Code hook payload shape changes | Fixtures are real captured JSON ≥2 per hook; bridge tests are snapshot + schema-tolerant (unknown fields ignored) |
| CC adapter writes contend with MCP/plugin | SQLite WAL + busy_timeout, single `Store`; bridge does <5ms sync writes only |
| Deletion sync tombstones too aggressively | Only fingerprints from deleted files that ARE still in DB and originated from same source; never cross-source; idempotent |
| Native probe hits host-in-progress file | Read with try/catch, skip on error, report health error without throwing |

---

## 8. Out of scope

OKF v4, embeddings/vector search, cloud sync, auto-conflict-resolution, transcripts, web UI — same as v2.0 §8. Reopening any requires roadmap amendment.

---

## 9. Task breakdown

See `docs/Kevin_v2.1.0_Task.md` — 11 tasks (K21-001…K21-011), phases F0 Gate → F1 Adapter (conditional) → F2 Lifecycle → F3 Docs → F4 Release.

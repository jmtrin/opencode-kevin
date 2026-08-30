# Opencode-kevin — Task Breakdown v2.1.0 "Relay"

**Version:** 2.1.0
**Date:** 2026-08-30
**Status:** Draft — gates on v2.0.0 completion
**Dependency:** v2.0.0 "Commonwealth" complete (K16-001…K16-026 all `[X]`)
**ID Convention:** `K21-XXX` ("Relay") · Decisions as `D21-NN` (plan §5)
**Total tasks:** 11 (K21-002…004 CONDITIONAL — see gate §6 of plan)
**Author:** ox-alpha + Muse Spark

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused deliberately |
| `[!]` | Blocked — reason in Status notes |
| `[X]` | Done — acceptance met, verification passes |
| `[C]` | CONDITIONAL — executes only if gate passes; otherwise close as `[X]` with "gate not taken" evidence |

Update §1 after each session.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K21-001 | F0 | Re-evaluate adoption gate + record (real npm captures) | P0 | S | `[ ]` |
| K21-002 | F1 | [COND] CC adapter package + hook scripts + source bridge | P0 | L | `[C]` |
| K21-003 | F1 | [COND] CC adapter e2e fixture tests + manual smoke | P0 | M | `[C]` |
| K21-004 | F1 | [COND] CC recipe doc + distribution slot + contract C-14 | P1 | S | `[C]` |
| K21-005 | F2 | Source deletion sync (tombstone on purged file) | P0 | M | `[ ]` |
| K21-006 | F2 | Opencode-native probe activation (real paths + absent-safe) | P1 | S | `[ ]` |
| K21-007 | F2 | Contract / golden update for C-14 (if gate PASS) or no-op | P0 | S | `[ ]` |
| K21-008 | F3 | Migration 015 (metrics; conditional) + matrix revalidation | P0 | M | `[ ]` |
| K21-009 | F3 | Engines sweep + packaging matrix (×5 if adapter) | P1 | M | `[ ]` |
| K21-010 | F3 | Docs: MIMO/MIGRATION_2.1.0, README, CHANGELOG, roadmap | P0 | M | `[ ]` |
| K21-011 | F4 | Final battery + exit-criterion walkthrough | P0 | L | `[ ]` |

**Phase totals:** F0 1 · F1 3 · F2 3 · F3 3 · F4 1 — **11 total**

**Critical path:**
```
K21-001 → (K21-002 → K21-003 → K21-004)? → K21-005 → K21-006 → K21-007 → K21-008 → K21-009 → K21-010 → K21-011
```

---

## 2. Conventions

Base rules from `Kevin_v2.1.0_Task.md` §2 / `Kevin_v2.0.0_Task.md` §2 apply.

**Less-capable-AI guardrails (MUST read before coding any task):**

1. **Every task starts with DISCOVERY** — paste the current file's relevant constant/array/header into Status notes before editing. Never guess shape.
2. **Exact paths matter** — `packages/core/src/sources/cc-hooks.ts` not `ccHooks.ts`; `packages/cc-adapter/hooks/*.mjs` not `.js`; `tests/fixtures/contract/v2.json` not `v3.json` unless D21-01 says otherwise.
3. **No new dependencies.** All tasks use `node:fs`, `node:path`, `node:sqlite`, existing `@jmtrin/kevin-core`. Any new `npm install` → mark `[!]` and escalate.
4. **Hot path stays clean.** Hooks write via `Store` synchronously <5ms; no `fetch`, no `http`, no `child_process.spawn` beyond being spawned BY Claude Code. Violate C-09 → `[!]` .
5. **Conditional tasks that don't fire MUST still be closed** with literal string `gate not taken: <reason>` in Status notes and `Task.md` table — exactly as K16 did. Never half-ship files.

---

# Phase F0 — Gate

### K21-001 — Re-evaluate adoption gate + record

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** v2.0.0 tag published · **Risk:** 🟢
- **Files:** `docs/Kevin_v2.1.0_Defaults_Outcome.md` (new), `docs/Kevin_v2.0.0_Defaults_Outcome.md` gate section (append verdict)
- **Description (step-by-step, execute in order):**
  1. Wait until `v2.0.0` tag is published and `npm publish` done for `@jmtrin/opencode-kevin` + `@jmtrin/kevin-mcp`.
  2. Day D: `curl -s https://api.npmjs.org/downloads/point/last-week/@jmtrin/opencode-kevin` → save JSON to `tmp/npm-base-D.json`; same for `@jmtrin/kevin-mcp` → `tmp/npm-mcp-D.json`. Record URLs + dates.
  3. Day D+7: repeat → `tmp/npm-base-D7.json`, `tmp/npm-mcp-D7.json`.
  4. Compute per day: `ratio = mcp_downloads / base_downloads`. If `abs(ratio_D - ratio_D7)/max(ratio_D,ratio_D7) >0.20` → extend one week, capture D+14 and re-evaluate once (document).
  5. PASS ⇔ `ratio ≥0.50` on the later capture (threshold per baseline 475 → ≈238). Write `docs/Kevin_v2.1.0_Defaults_Outcome.md`:
     ```
     # Kevin v2.1.0 — Adoption Gate (K21-001 / D21-05 / plan §6)
     ## Captures
     | date | base | mcp | ratio | url |
     ## Verdict
     PASS/FAIL — raw numbers cited, no vacuum
     ## Binding
     K21-002..004 go / gate not taken
     ```
  6. Append same verdict line to `docs/Kevin_v2.0.0_Defaults_Outcome.md` gate section ("Re-evaluated 2026-09-XX: ...").
- **Acceptance criteria:** file exists with 2 captures table + verdict + binding line; disagreement rule applied if needed.
- **Status notes:** paste raw `curl` outputs verbatim.
- **Verification:** `npx vitest run docs-gate-lint` (manual review — no code test; reviewer checks file exists and table has 2 rows).

---

# Phase F1 — CC adapter (CONDITIONAL on K21-001 PASS)

### K21-002 — CC adapter package + hook scripts + source bridge

**Status:** `[C]` Pending — executes only if K21-001 PASS; else close as `[X] gate not taken: ratio <0.50` (or pending publish) and create NO files.

- **Priority:** P0 · **Estimation:** L (16h) · **Dependencies:** K21-001 PASS · **Risk:** 🔴
- **Files (create exactly these, no more):**
  ```
  packages/cc-adapter/package.json
  packages/cc-adapter/src/bridge.ts
  packages/cc-adapter/src/payload.ts
  packages/cc-adapter/hooks/session-start.mjs
  packages/cc-adapter/hooks/post-tool-use.mjs
  packages/cc-adapter/hooks/stop.mjs
  packages/cc-adapter/tests/fixtures/session-start-1.json
  packages/cc-adapter/tests/fixtures/session-start-2.json
  packages/cc-adapter/tests/fixtures/post-tool-use-1.json
  packages/cc-adapter/tests/fixtures/post-tool-use-2.json
  packages/cc-adapter/tests/fixtures/stop-1.json
  packages/cc-adapter/tests/fixtures/stop-2.json
  packages/core/src/sources/cc-hooks.ts
  ```
- **Description:**
  1. DISCOVERY: paste `packages/core/src/sources.ts` registry array and `CONTRACT_MEMORY_SOURCES` into notes.
  2. `package.json`: `{name:"@jmtrin/kevin-cc", version:"2.1.0", type:"module", engines:{node:">=22.5"}, bin:{"kevin-cc-session-start":"./hooks/session-start.mjs", ...} }`. No `engines.opencode`, no dependencies beyond `@jmtrin/kevin-core`.
  3. `src/payload.ts`: Zod-free runtime validators:
     ```ts
     export interface SessionStartPayload { session_id:string; cwd:string; model?:string }
     export interface PostToolPayload { session_id:string; cwd:string; tool_name:string; tool_input:unknown; tool_response?:unknown }
     export interface StopPayload { session_id:string }
     export function isSessionStart(x:unknown): x is SessionStartPayload { /* check session_id && cwd are strings */ }
     // similarly isPostTool, isStop
     ```
  4. `src/bridge.ts` (see plan §4.2 exact interface). Implementation:
     ```ts
     import type { Store } from "@jmtrin/kevin-core";
     // table tool_calls has columns (id, session_id, tool_name, args_json, channel, created_at)
     export class CCBridge {
       constructor(private store: Store, private projectId:string){}
       onSessionStart(p:{sessionId:string,cwd:string}){ /* INSERT OR IGNORE into tool_calls if needed; channel='cc-hooks' */ }
       onToolUse(p:PostToolPayload){ const id=uuidv7(); this.store.prepare("INSERT INTO tool_calls (id,session_id,tool_name,args_json,channel,created_at) VALUES (?,?,?,?,?,datetime('now'))").run(id, "cc:"+p.session_id, p.tool_name, JSON.stringify(p.tool_input), 'cc-hooks'); }
       onStop(p:{sessionId:string}){ /* no-op or flush marker: INSERT into tool_calls with tool_name='__stop__' for trace */ }
     }
     ```
     Use `node:sqlite` prepare; no async, <5ms, try/catch never throws — on error, `console.error` to stderr and exit 0.
  5. Hooks (each `.mjs`):
     ```mjs
     #!/usr/bin/env node
     import { readFileSync } from 'node:fs';
     import { CCBridge } from '../src/bridge.ts'; // or compiled js — but use tsx loader: node --loader tsx
     // read stdin fully: let data=''; process.stdin.on('data',c=>data+=c); on end: JSON.parse(data)
     // validate via payload helpers, resolve Store path via KevinEnv (import {resolveEnv} from '@jmtrin/kevin-core')
     // call bridge, exit 0
     ```
     Must handle empty stdin, malformed JSON (log to stderr, exit 0), missing session_id (exit 0). Never write to stdout.
  6. Fixtures: capture 2 real Claude Code hook payloads per hook (run a demo Claude session with `settings.json` hook echoing stdin to file). Paste verbatim JSON, each ≤2KB, deterministic.
  7. Source adapter `packages/core/src/sources/cc-hooks.ts`:
     ```ts
     import type { SourceAdapter } from "./sources.js";
     export const claudeCodeHooksSource: SourceAdapter = {
       name: "claude-code-hooks",
       precedence: 15,
       enabled: (store)=> store.prepare("SELECT value FROM kevin_settings WHERE key='source_claude_code_hooks'").get()?.value==="1",
       scan: (_env)=> [], // hook-driven
       health: (_env)=> ({status:'ok', detail:'hook-driven, see tool_calls channel cc-hooks'})
     };
     ```
     Register in `packages/core/src/sources.ts` registry array sorted by precedence: `[opencode-plugin(10), claude-code-hooks(15), claude-memory(20), codex-memories(30), opencode-native(40)]`.
  8. Add setting `source_claude_code_hooks` to `packages/core/src/index.ts` `KEVIN_CONFIG_KEYS` (default `'0'`), to `packages/core/src/contract.ts` `CONTRACT_CONFIG_ADDITIONS`+`CONTRACT_MEMORY_SOURCES`, and to `packages/plugin/src/index.ts` `KEVIN_CONFIG_KEYS` (mirror).
- **Acceptance criteria:** `npm run typecheck` green; no `fetch`/`http`/`child_process` grep hits in `packages/cc-adapter`; registry order asserted by unit test; contract C-14 count 5 and includes precedence 15 since 2.1.0.
- **Status notes:** discovery paste (registry + contract).
- **Verification:** `npx vitest run packages/cc-adapter/tests/bridge.test.ts` + `npm run typecheck -w @jmtrin/kevin-cc` + grep guards.

### K21-003 — CC adapter e2e fixture tests + manual smoke

**Status:** `[C]` Pending

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K21-002 · **Risk:** 🟡
- **Files:** `packages/cc-adapter/tests/e2e.test.ts`, `packages/cc-adapter/tests/bridge.test.ts` (if not already)
- **Description:**
  1. `bridge.test.ts`: unit tests for `CCBridge`:
     - `onToolUse` inserts row with `channel='cc-hooks'` and `session_id='cc:<id>'`
     - malformed payload does not throw (best-effort)
     - two `onToolUse` with same session_id produce two rows (no dedup at this layer)
  2. `e2e.test.ts`: replay fixtures through hooks via `node hooks/post-tool-use.mjs < fixtures/post-tool-use-1.json` against `:memory:` DB; assert row exists; then `SELECT * FROM tool_calls WHERE channel='cc-hooks'` count == fixtures count.
  3. Cross-host mini-proof: Insert memory via core `MemoryService.save()` in project A, hook inserts tool_call in same DB, query via `kevin_trace` shows both channels present.
  4. Manual smoke: run real Claude Code with `settings.json` → `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node ./packages/cc-adapter/hooks/session-start.mjs"}]}]}}` and paste transcript of `echo '{\"session_id\":\"test123\",\"cwd\":\"/tmp\"}' | node hooks/session-start.mjs` exit code 0.
- **Acceptance criteria:** suite green; smoke transcript pasted in notes.
- **Status notes:** smoke transcript (exit code + stderr).
- **Verification:** `npx vitest run packages/cc-adapter/tests/**`

### K21-004 — CC recipe doc + distribution slot + contract C-14

**Status:** `[C]` Pending

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K21-003 · **Risk:** 🟢
- **Files:** `docs/harnesses/claude-code-hooks.md`, `DISTRIBUTION.md` or `docs/DISTRIBUTION.md` slot
- **Description:**
  1. Write `docs/harnesses/claude-code-hooks.md` with sections: Install (`npm i -g @jmtrin/kevin-cc` OR copy hooks), Config (Claude `settings.json` snippet exactly as tested in K21-003), Troubleshooting (check `tool_calls` `SELECT`, check `kevin_audit.sources` block, health `source_claude_code_hooks` flag), Uninstall (remove hook entries), Honesty box: "scope = observation only; MCP remains IO channel; hooks never synthesize memories", Tested-on header: `Claude Code 2.0.x + Node 22.5`.
  2. Add distribution slot to `docs/DISTRIBUTION.md` (or create) checklist row for `kevin-cc` publish.
  3. Ensure contract C-14 already updated in K21-002; if not, add now (same commit) with `since:"2.1.0"`.
- **Acceptance criteria:** doc-lint: markdown validates, snippet JSON parses, no drift from K21-002 hook paths.
- **Status notes:** paste snippet.
- **Verification:** `npx vitest run docs/harnesses` doc-lint + manual review.

---

# Phase F2 — Lifecycle

### K21-005 — Source deletion sync (tombstone on purged file)

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** `packages/core/src/sources/deletion.ts` (new), `packages/core/src/sources/sync.ts` (modify), `packages/core/tests/source_deletion.test.ts` (new), `tests/integration/sources_deletion.test.ts` (new)
- **Description (exact steps):**
  1. DISCOVERY: paste current `packages/core/src/sources/sync.ts` idle loop header and `meta_json` shape into notes.
  2. Create `deletion.ts`:
     ```ts
     export interface DeletedInfo { source:string; file:string; fingerprint:string }
     export function collectDeletions(prevMetaJson:string|null, currentFiles:Set<string>): DeletedInfo[] {
       // prevMetaJson = row meta_json JSON string like {"files":{"~/.claude/.../memory/foo.md":{"mtime":123,"size":456}}}
       // Return entries where file in prev but not in current
     }
     ```
     Helper reads `memory_sources.meta_json`, parses safely (try/catch → []), diffs.
  3. Modify `sync.ts` idle pipeline (after per-source scan loop):
     ```ts
     for (const adapter of registry) {
       // existing scan → save
       // NEW: after save
       const row = store.prepare("SELECT meta_json FROM memory_sources WHERE name=?").get(adapter.name) as any;
       const deletions = collectDeletions(row?.meta_json ?? null, newFilesSet); // newFilesSet from scan result
       for (const d of deletions) {
         // find memories from this source with fingerprint === d.fingerprint still present
         const mems = store.prepare("SELECT id, fingerprint FROM memories WHERE source=? AND fingerprint=?").all(adapter.name, d.fingerprint) as any[];
         for (const m of mems) {
           // archive + tombstone if exported
           archiver.archive(m.id); // reuse Archiver class
           const entry = store.prepare("SELECT entry_id FROM shared_entries WHERE entry_id LIKE ?").get(m.fingerprint+"%"); // or exact mapping via okf entry_id
           if (entry) sharedLayer.tombstone(entry.entry_id);
         }
         store.prepare("UPDATE kevin_metrics SET value=value+1 WHERE key='source_deletions_total'").run();
       }
     }
     ```
     Exact archiver/sharedLayer wiring: reuse existing `Archiver` + `SharedLayer.tombstone` imported from `@jmtrin/kevin-core`; no new tables.
  4. Guard with setting `source_deletion_sync` (default `'0'` in `KEVIN_CONFIG_KEYS`; check `store.getSetting('source_deletion_sync','0')==='1'` before running). If `'0'`, collect but skip tombstone (log only).
  5. Tests:
     - `source_deletion.test.ts` unit: `collectDeletions` with prev 2 files, current 1 file → returns 1 deletion; malformed meta_json → [] ; empty current → all purged.
     - `sources_deletion.test.ts` integration: create 2 claude fixture files → run sync (master on, per-source on) → 2 memories saved; delete one file → run sync with `source_deletion_sync='1'` → 1 memory archived + tombstone file `.kevin/knowledge/*.okf` contains tombstone line + `source_deletions_total` ==1; second sync idempotent (counts not double).
- **Acceptance criteria:** both test suites green; tombstone line byte-pattern matches `okf.ts` serializer (check `^tombstone` prefix); no cross-source deletion (codex file delete does not tombstone claude memory with same fingerprint — test asserts).
- **Status notes:** paste `meta_json` before/after.
- **Verification:** `npx vitest run packages/core/tests/source_deletion.test.ts tests/integration/sources_deletion.test.ts`

### K21-006 — Opencode-native probe activation

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** S (3h) · **Dependencies:** none · **Risk:** 🟢
- **Files:** `packages/core/src/sources/native.ts` (modify), `packages/core/tests/source_native.test.ts` (extend)
- **Description:**
  1. DISCOVERY: paste current `NATIVE_CANDIDATE_PATHS` const and `scan()` body.
  2. Replace const with:
     ```ts
     export const NATIVE_CANDIDATE_PATHS = [
       ".opencode/memory/*.md",
       ".opencode/MEMORY.md",
     ] as const;
     // homedir variants: resolve via KevinEnv.dataRoot + join — handled in scan loop below
     ```
     Scan loop:
     ```ts
     scan(env: KevinEnv){
       const out=[]; const seen=new Set();
       for (const pattern of NATIVE_CANDIDATE_PATHS) {
         const abs = pattern.includes('*') ? glob(pattern, env.projectRoot) : join(env.projectRoot, pattern);
         // glob helper: readdir + match *.md (no new dep, use node:fs readdirSync)
         // for each file, statSync-try, read, parse candidates
       }
       // also probe env.dataRoot + "/memory/*.md" if exists
       return out;
     }
     health(): returns 'ok' if found ≥1 file else 'absent'
     ```
  3. Ensure `scan()` is absent-safe: every `statSync`/`readFileSync` in try/catch → skip, never throw; empty → return [].
  4. Extend test `source_native.test.ts`: add case "planted fixture dir discovered" — `mkdir .opencode/memory` + `writeFileSync("a.md","# test")` → `scan()` returns 1 candidate; "absent everywhere" → health absent and scan [].
  5. Grep guard test: `grep -r "opencode/memory" packages/core/src` must hit ONLY `native.ts` line of const (exactly one file).
- **Acceptance criteria:** typecheck green; absent path clean; planted fixture discovered; single-source location list asserted.
- **Status notes:** paste candidate list after change.
- **Verification:** `npx vitest run packages/core/tests/source_native.test.ts`

### K21-007 — Contract / golden update (C-14 addition if PASS else no-op)

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K21-001, K21-002 · **Risk:** 🟡
- **Files:** `packages/core/src/contract.ts`, `tests/fixtures/contract/v2.json` (amend in place, NOT v3), `tests/unit/contract_succession.test.ts` (no change needed)
- **Description:**
  1. DISCOVERY: paste `CONTRACT_MEMORY_SOURCES` array and `contract_version` value.
  2. If K21-001 PASS (CC adapter shipped): add to `CONTRACT_MEMORY_SOURCES` array entry `{name:"claude-code-hooks", precedence:15, since:"2.1.0"}` in precedence order; run `scripts/gen-contract-v2.mjs` (or manual) to regenerate `v2.json` — CARRY all existing v2 entries verbatim, append new. Tool count stays 27 (no new tool), settings count 43→44 (`source_claude_code_hooks`), metrics 67→68/69 per D21-02.
  3. If K21-001 FAIL (gate not taken): touch no contract file; instead add comment in `Defaults_Outcome` that C-14 unchanged for 2.1.0.
  4. Run succession probe: temporarily edit one carried C-04 default in v2.json → `contract_succession.test.ts` must turn red naming it; revert.
- **Acceptance criteria:** `npx vitest run tests/unit/contract_succession.test.ts` green baseline + red-probe recorded in notes; live-vs-v2 diff empty.
- **Status notes:** paste before/after C-14 array.
- **Verification:** `npx vitest run tests/unit/contract_frozen.test.ts tests/unit/contract_succession.test.ts`

---

# Phase F3 — Packaging & docs

### K21-008 — Migration 015 + matrix revalidation

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K21-005, K21-007 · **Risk:** 🟡
- **Files:** `packages/core/migrations/015_v21_relay.sql` (new, conditional), `tests/unit/migrate_015.test.ts` (new), `tests/integration/migration_matrix.test.ts` (extend)
- **Description:**
  1. If new metrics needed (`source_cc_hook_calls_total`, `source_deletions_total`): create `015_v21_relay.sql`:
     ```sql
     INSERT INTO kevin_metrics (key,value,updated_at) VALUES
       ('source_cc_hook_calls_total',0,datetime('now')),
       ('source_deletions_total',0,datetime('now'))
     ON CONFLICT(key) DO NOTHING;
     INSERT INTO schema_version (version) VALUES ('015');
     ```
     If only `source_deletions_total` needed, include only that line. Use `ON CONFLICT` for idempotence on double-run.
     If NO new metrics/columns: still create file with just `INSERT INTO schema_version (version) VALUES ('015');` (so matrix expects 015).
  2. Create `migrate_015.test.ts` mirroring `migrate_014.test.ts`: fresh DB → `Migrate.run()` → row exists; double-run idempotent; backfill no-op; old sqlite without `ON CONFLICT`? Test skip if error is syntax.
  3. Extend `migration_matrix.test.ts` to include `015` in expected version list and ladder counts (migrations 015).
- **Acceptance criteria:** `Migrate` on fresh DB ends at 015; double-run green; matrix green.
- **Status notes:** paste 015 file content.
- **Verification:** `npx vitest run tests/unit/migrate_015.test.ts tests/integration/migration_matrix.test.ts`

### K21-009 — Engines sweep + packaging matrix (×5 if adapter)

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** M (3h) · **Dependencies:** K21-002, K21-008 · **Risk:** 🟡
- **Files:** `packages/*/package.json` (verify), `scripts/verify-pack.ts` (if exists)
- **Description:**
  1. Ensure `engines.opencode` present ONLY on `plugin` + `tui` (not core, not mcp, not cc-adapter); `engines.node >=22.5` present on all; sweep test `tests/unit/engines_sweep.test.ts` (create if missing) asserts placement map exactly.
  2. Run packaging grid: `npm run verify:pack` (or `npm pack` dry-run) for {core, plugin, tui, mcp} plus `cc-adapter` if shipped → 5 tarballs, each `tar -tzf` lists expected files (no `src` leak if build step).
  3. Record grid table in Status notes: Node 22.5/24 × Bun × {fresh, 1.5-soaked, 2.0-soaked} — all green.
- **Acceptance criteria:** sweep assertions green; verify-pack ×4 or ×5 green; grid table pasted.
- **Status notes:** grid pasted.
- **Verification:** `npm run verify:pack && npx vitest run tests/integration/upgrade_matrix.test.ts` (or sweep test)

### K21-010 — Docs: MIGRATION_2.1.0, README, CHANGELOG, roadmap

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K21-007, K21-008 · **Risk:** 🟡
- **Files:** `docs/MIGRATION_2.1.0.md` (new if schema changed else no-op note), `README.md` (Upgrade to 2.1 section), `CHANGELOG.md` 2.1.0 entry, `docs/Kevin_Roadmap_v2.md` close-out
- **Description:**
  1. If migration 015 exists: write `MIGRATION_2.1.0.md` with upgrade paths (fresh/2.0 DB/2.0 with cc-adapter) and JSON-step blocks `kevin-steps` covering: deletion sync opt-in (`kevin_config set source_deletion_sync 1`), CC adapter hook install snippet (if PASS), rollback steps. If no schema: write doc with "No migration — 2.1.0 is additive, no DB change" + gate outcome.
  2. README: add "Upgrade to 2.1" section linking migration doc; mention `claude-code-hooks` source if PASS else "deletion sync opt-in".
  3. CHANGELOG: 2.1.0 entry with exhaustive delta bullets mirroring roadmap (one bullet per code diff).
  4. Roadmap close-out: footer marking v2.1.0 date, link to outcome doc.
- **Acceptance criteria:** checklist cross-ref MIGRATION steps ↔ CHANGELOG bullets ↔ code diffs (spot-audit table 3 rows pasted in notes).
- **Status notes:** cross-ref table pasted.
- **Verification:** doc-lint green (no broken links).

---

# Phase F4 — Release

### K21-011 — Final battery + walkthrough

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** L (6h) · **Dependencies:** everything · **Risk:** 🔴
- **Files:** none (transcript archived locally, not committed)
- **Description:**
  1. Clean-checkout battery: `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm run verify:pack` (+ `bench` + `bench:regress` + `replay` + `bun test` if available) — all green. For less-capable AI: run exactly `npm run verify` then `npm test` — if either red, stop and fix before proceeding.
  2. Exit criterion walkthrough scripted:
     - If PASS: two-host one-repo demo: create memory in opencode (`kevin_save`), trigger hook `echo '{"session_id":"demo","cwd":"'$(pwd)'","tool_name":"Read","tool_input":{"file":"/tmp/x"}}' | node packages/cc-adapter/hooks/post-tool-use.mjs` → `SELECT * FROM tool_calls WHERE channel='cc-hooks'` shows row → `kevin_audit --sources` shows `claude-code-hooks` ok.
     - If FAIL: deletion sync demo: `mkdir -p /tmp/src && echo "# hello" > /tmp/src/a.md` import via claude source → delete file → idle → `kevin_audit` shows `source_deletions_total`+1 and tombstone file.
  3. Ladders final: tools 27→28 if adapter else 27, settings 43→44 if adapter else 43 (or 44 with deletion flag), metrics 67→69/68, migrations ≤015, principles 60–63 cited, D21-01…05 referenced (grep table `grep -r D21 packages/core/src`).
  4. Publish ORDER: core → tui → plugin → mcp → (cc-adapter if shipped); tags + GitHub Releases per DISTRIBUTION.
- **Acceptance criteria:** battery log pasted; succession+subset suites green on release commit; tag `v2.1.0` pushed.
- **Status notes:** full outputs (paste `npm test` tail 20 lines + `git tag`).
- **Verification:** battery.

---

## Done definition

11/11 resolved (`[X]`; conditionals closed with gate evidence either way); 3 exit statements demonstrated with logs; tag `v2.1.0`; releases published in pin order; `MIGRATION_2.1.0.md` green on all fixtures if exists.


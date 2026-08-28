# Opencode-kevin — Task Breakdown v1.2.0 "Surface"

**Version:** 1.2.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.1.0 completion
**Dependency:** v1.1.0 "Drift" complete (`K11-001` … `K11-022`)
**ID Convention:** `K12-XXX` ("Surface") · Decisions as `D12-NN` (plan §5)
**Total tasks:** 19 (15 original + 4 amendment tasks K12-016…019 added pre-implementation;
K12-008/009 became CONDITIONAL on spike K12-016)
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
| `[C]` | CONDITIONAL — executes only if its stated gate passes; otherwise close `[X]` with "gate not taken" evidence |

Update §1 after each session.

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K12-001 | F0 | Setting + metrics: `tui_snapshots_enabled`, 2 counters, contract+golden | P0 | S | `[X]` |
| K12-002 | F0 | `tui-types.ts` shared view types (type-only module) | P0 | S | `[X]` |
| K12-003 | F0 | `TuiSnapshots.flushSnapshots()` writer | P0 | M | `[X]` |
| K12-004 | F0 | Snapshot truncation + atomicity tests | P0 | S | `[X]` |
| K12-005 | F1 | `TuiActions.readMailbox` tolerant parser | P0 | S | `[X]` |
| K12-006 | F1 | Token scheme + stale detection | P0 | M | `[X]` |
| K12-007 | F1 | `processActions` executing existing handlers | P0 | L | `[X]` |
| K12-008 | F2 | TUI module skeleton: id/default export/route registration | P0 | M | `[X]` |
| K12-009 | F2 | Panels: Proposals / Conflicts / Health renderers | P0 | L | `[X]` |
| K12-010 | F3 | Isolation test: tui module imports server code = fail | P0 | S | `[X]` |
| K12-011 | F3 | Idle-chain wiring (actions→curate→snapshots ordering) | P0 | M | `[X]` |
| K12-012 | F3 | permission.ask probe (best-effort, D12-03) | P2 | S | `[X]` |
| K12-013 | F4 | Packaging: exports["./tui"], engines.opencode, build output | P0 | M | `[X]` |
| K12-014 | F4 | Docs: README section, verify script v120-tui.md, audit block | P1 | M | `[X]` |
| K12-015 | F5 | Version bump 1.2.0, CHANGELOG, final verification | P0 | M | `[X]` |
| K12-016 | F6* | AMENDMENT — Desktop surface probe spike (gates R1) | P0 | S | `[X]` |
| K12-017 | F6* | AMENDMENT — Static dashboard generator (`dashboard.html`) | P0 | L | `[X]` |
| K12-018 | F6* | AMENDMENT — Chat-command bridge `/kevin-*` (universal actions) | P0 | L | `[X]` |
| K12-019 | F6* | AMENDMENT — Desktop-first verification checklist + docs pass | P0 | M | `[X]` |

\* F6* = amendment phase added before implementation (dual-surface scope,
roadmap §5.2 amended; plan D12-08/09/10).

**Phase totals:** F0 4 · F1 3 · F2 2 · F3 3 · F4 2 · F5 1 · **F6* 4** — **19 total**

**Critical path (amended).**

```
K12-001 → K12-002 → K12-003 → K12-006 → K12-007 → K12-016 → K12-017
        → K12-018 → K12-011 → K12-019 → K12-015
R1 branch (conditional): K12-016 PASS-in-TUI → K12-008 → K12-009 → K12-010 → K12-011
```

---

## 2. Conventions

Identical to `Kevin_v1.1.0_Task.md` §2 (estimates, dependencies, risk colors, style,
AI-implementer rules, temp-store rule, SQLite TEXT rules, contract-change rule). Additions:

**TUI module rules.**
1. `plugin/tui.ts` may import ONLY: `@opencode-ai/plugin/tui`, `node:fs`, `node:path`,
   `node:os`, and `import type` from `./tui-types.js`. Anything else fails K12-010.
2. All fs writes use tmp+rename (`writeFileSync(p+"​.tmp")` then `renameSync`) — never
   partial files.
3. No `console.log`; user feedback via the host's toast API.

**Hot path.** Snapshot flush and mailbox processing run ONLY at `session.idle`. They must
not be imported by hot-path modules.

---

# Phase F0 — Snapshots

### K12-001 — Setting + metrics + contract

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** none · **Risk:** 🔴 (contract)
- **Files:** `plugin/Migrate.ts`? NO — no migration this release; seeds live where?
  Metrics without migration: rely on upsert-on-incr (verify Metrics.incr creates missing
  rows; if it does not, add lazy seeding inside `Metrics.incr` — one-line ON CONFLICT
  already used elsewhere). Settings: add `"tui_snapshots_enabled"` to KEVIN_CONFIG_KEYS.
- **Description:**
  1. Append `tui_snapshots_enabled` to `KEVIN_CONFIG_KEYS`.
  2. Ensure `Metrics.incr("tui_snapshots_flushed")` works on a DB lacking the row
     (upsert). Add test proving first-incr creates the row with value 1.
  3. contract.ts: setting-key clause += key (default `'1'`, since `"1.2.0"`); metric
     clause += two keys (since `"1.2.0"`); golden ADD-only.
- **Acceptance criteria:** contract suite green; `kevin_config list` shows the new key;
  absent-row incr test green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract.test.ts tests/unit/metrics_upsert.test.ts`

### K12-002 — `tui-types.ts` shared view types

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** none · **Risk:** 🟢
- **Files:** `plugin/tui-types.ts` (new)
- **Description:** Copy the interfaces from plan §4.2/§4.3 verbatim:
  `ProposalView{ id, kind, target_path, diff, memory_ids, created_at, truncated? }`,
  `ConflictView{ id, kind, a_summary, b_summary, opened_at }`,
  `HealthView{ verdict, reason, hooks[], perf[], contract_digest, counters }`,
  `TuiSnapshotSet`, `TuiAction` union, `ActionResult{ action; status:"applied"|"rejected"|
  "stale_skipped"|"error"; detail? }`. Types ONLY — zero runtime exports (isolation).
- **Acceptance criteria:** file compiles; importing it from tui.ts type-only passes
  K12-010 scan later; no value exports (test greps for `export const/function` = none).
- **Status notes:** —
- **Verification:** `npm run typecheck`

### K12-003 — `TuiSnapshots.flushSnapshots()`

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (8h) · **Dependencies:** K12-001, K12-002 · **Risk:** 🟡
- **Files:** `plugin/TuiSnapshots.ts` (new)
- **Description:**
  1. Implement per plan §4.2 signature. Deps receive already-built VIEW objects (assembly
     happens in index wiring task K12-011) — flushSnapshots is pure serialization+write.
  2. Write order: proposals.json, conflicts.json, health.json, then meta.json
     {generatedAt, versions}. Each via tmp+rename into dir `join(root,"tui")` (root =
     materializerRoot passed in).
  3. Enforce 512 KiB cap per file: serialize, if over → truncate diff fields to fit and
     set `truncated:true` on affected entries before final write.
  4. Gate: caller checks setting; flushSnapshots itself stays ungated (pure).
  5. Increment `tui_snapshots_flushed` once per successful full flush.
- **Acceptance criteria:** unit tests with tmpdir root: files exist, valid JSON, re-flush
  replaces atomically (no `.tmp` leftovers), truncation path produces `truncated:true`
  and fits cap, counter incremented.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tui_snapshots.test.ts`

### K12-004 — Snapshot atomicity/corruption tests

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K12-003 · **Risk:** 🟢
- **Files:** `tests/unit/tui_snapshots_atomic.test.ts` (new)
- **Description:** Simulate crash between tmp-write and rename by pre-creating stale
  `.tmp` files → next flush overwrites them; corrupt existing JSON on disk → next flush
  replaces it (writer never reads); reader-side helper `readJsonSafe` returns
  `{error:"corrupt"}` shape used later by panels (export it from TuiSnapshots for tests;
  panels will duplicate the tiny reader per isolation rules).
- **Acceptance criteria:** all three scenarios green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tui_snapshots_atomic.test.ts`

---

# Phase F1 — Mailbox

### K12-005 — `readMailbox` tolerant parser

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K12-002 · **Risk:** 🟢
- **Files:** `plugin/TuiActions.ts` (new)
- **Description:** Read `join(root,"tui","actions.json")`; shape
  `{issuedAt:string, actions:TuiAction[]}`. Unknown `type` values are DROPPED with a
  returned `parseWarnings` array; malformed JSON → empty list + warning; missing file →
  empty list, no error. Never deletes here (processor owns deletion).
- **Acceptance criteria:** table-driven tests for: ok file; unknown type dropped; broken
  JSON; missing file; non-array actions field treated as broken.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tui_mailbox_read.test.ts`

### K12-006 — Token scheme + stale detection

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K12-002 · **Risk:** 🟡
- **Files:** `plugin/TuiActions.ts`
- **Description:**
  1. `export function proposalToken(proposalId: string, proposedText: string): string`
     = first 16 hex of sha256(`proposalId+"\0"+proposedText`) using node:crypto.
  2. `verifyFresh(action, currentPending)` recomputes token from CURRENT pending
     proposal; mismatch → `{status:"stale_skipped", reason:"content_changed_or_absent"}`.
- **Acceptance criteria:** deterministic token test vectors; tamper test (text edited
  after render) yields stale_skipped; absent id yields stale_skipped with reason variant.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tui_token.test.ts`

### K12-007 — `processActions` executing existing handlers

**Status:** `[X]` Done

- **Priority:** P0 · **Estimation:** L (12h) · **Dependencies:** K12-005, K12-006 · **Risk:** 🔴
- **Files:** `plugin/TuiActions.ts`
- **Description:**
  1. For each fresh approve/reject: call the SAME exported handler functions the tools
     use — `kevinApprove(...)` for approve (import from kevin_approve.ts), and the
     Curator rejection transition via the deps-provided callback (index wiring passes
     `rejectProposal(id, note)` implemented as curator.transition(proposal,'rejected')).
     acknowledge → deps.acknowledgeConflict(id).
  2. Wrap each action in try/catch producing ActionResult status "error" with message;
     one failing action never aborts siblings.
  3. After processing all: writeResults (results.json via tmp+rename) then DELETE
     actions.json. Increment `tui_actions_invoked` per executed action (any status except
     parse-dropped).
  4. NO new mutation logic anywhere: if an operation cannot reuse an existing exported
     function, STOP the task and mark `[!]` — that indicates missing export to add in
     Curator/ConflictDetector with its own micro-task note.
- **Acceptance criteria:**
  - Integration test: seed pending proposal → mailbox approve (correct token) → process →
    AGENTS.md written through ArtifactWriter (assert markers content), results.json has
    applied, queue deleted.
  - Reject path transitions state without touching disk artifacts.
  - Double-approve second run: stale_skipped (already decided ⇒ current-pending lookup
    misses).
  - Counter reflects executions.
- **Status notes:** record any missing-export escalations here.
- **Verification:** `npx vitest run tests/unit/tui_actions_process.test.ts`

---

# Phase F2 — TUI module

### K12-008 — TUI module skeleton

**Status:** `[X]` Done — `R1: GO (CLI renders per docs; Desktop NO — unverified)` — `plugin/tui.ts` + `dist/plugin/tui.*`, smoke `["id","tui"]` PASS, gated by K12-016

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K12-002 · **Risk:** 🟡
- **Files:** `plugin/tui.ts` (new)
- **Description:**
  1. Default export `{ id: "opencode-kevin", tui }` where tui registers route `kevin`
     (title "Kevin"), three tab slots, and a keymap layer binding `k` to open the route.
  2. Local helpers `tuiRoot()` (= join(homedir(), ".opencode-kevin", "tui")) and
     `readJsonSafe(name)` mirroring TuiSnapshots' tolerant read (duplicated intentionally,
     see isolation).
  3. Empty-state renderer: given `{error}` or missing file, show reason text ("no
     snapshots yet — open an opencode session with the plugin enabled").
- **Acceptance criteria:** module compiles under tsconfig; manual import smoke via
  `node --input-type=module -e "import('...dist/plugin/tui.js').then(m=>console.log(Object.keys(m.default)))"`
  prints ["id","tui"] after build exists.
- **Status notes:** —
- **Verification:** `npm run build && node --input-type=module -e "<smoke above>"`

### K12-009 — Panels renderers

**Status:** `[X]` Done — conditional gate passed via K12-016 GO, helpers `truncateSummary/formatProposalRow/formatConflictRow/formatHealthVerdict`, mailbox writers, focus re-read, manual checklist (internal)

- **Priority:** P0 · **Estimation:** L (14h) · **Dependencies:** K12-008 · **Risk:** 🟡
- **Files:** `plugin/tui.ts`
- **Description:**
  1. Proposals tab: list rows (id, kind, target_path, created_at); Enter opens diff dialog
     rendering unified diff monospace; keys: `a`=approve (confirm dialog showing token
     age), `r`=reject (optional note prompt), Esc closes. Approve/reject WRITE mailbox
     entry atomically then toast "queued — applies at session idle".
  2. Conflicts tab: rows (kind, summaries side A/B truncated 80 chars); `x`=acknowledge
     writes mailbox ack (no token needed).
  3. Health tab: verdict banner colored by theme (healthy/degraded/unknown), hook table,
     perf p95 vs budget lines, contract digest line, counters grid.
  4. Every panel re-reads snapshots on focus (cheap fs reads, small files).
- **Acceptance criteria:** automated coverage limited to pure helpers (row formatting,
  truncation, token call-through) since TUI rendering needs a host; MANUAL checklist
  executed against real host recorded in internal manual checklist (task K12-014) — both
  required for `[X]`.
- **Status notes:** paste manual checklist results.
- **Verification:** `npx vitest run tests/unit/tui_render_helpers.test.ts && npm run build`

---

# Phase F3 — Integration & isolation

### K12-010 — Isolation test for the tui module

**Status:** `[X]` Done — `tests/unit/tui_isolation.test.ts` PASS (multiline-aware allowlist), `plugin/tui.ts` isolated to `@opencode-ai/plugin/tui` + `node:fs|path|os` + `tui-types.js`

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K12-008 · **Risk:** 🟡
- **Files:** `tests/unit/tui_isolation.test.ts` (new)
- **Description:** Read plugin/tui.ts source; assert its import statements match ONLY the
  allowlist regex set: `^import .* from "@opencode-ai/plugin/tui"`,
  `^import .* from "node:(fs|path|os)"`, `^import type .* from "\./tui-types\.js"`.
  Any other import fails with the offending line printed. (Pattern inherited from
  no_zod_import.test.ts.)
- **Acceptance criteria:** test red if someone adds `import { Store } from "./Store.js"`;
  green otherwise.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tui_isolation.test.ts`

### K12-011 — Idle-chain wiring

**Status:** `[X]` Done — `session.idle` order `actions→propose→snapshots→dashboard`, `chat.message` bridge swallow before `deriveQuery`, gated `tui_snapshots_enabled`, `assembleViews` via `curator.pending`/`openConflicts`/`buildDoctor+perf+digest`, ordering spy PASS

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K12-003, K12-007 · **Risk:** 🔴
- **Files:** `plugin/index.ts`
- **Description:**
  1. In the `event` handler's `session.idle` branch insert, AFTER causalChain.onIdle and
     BEFORE curator.propose: `const acts = TuiActions.readMailbox(materializerRoot);
     if (acts.actions.length) { results = processActions(acts.actions, deps); writeResults(...); }`
     with deps wired to existing closures (kevinApprove args identical to tool call site;
     rejectProposal/acknowledgeConflict thin callbacks added to Curator/ConflictDetector
     IF missing exports — escalate per K12-007 rule).
  2. AFTER syncSharedLayer: gated snapshot flush
     `if (getSetting("tui_snapshots_enabled","1")==="1") flushSnapshots({root:
     materializerRoot, views: assembleViews(...)})` where assembleViews pulls from
     curator.pending(), conflictDetector.openConflicts(), doctor builder + perf.summary()
     + contract digest — mapping into tui-types shapes. The SAME assembleViews output is
     handed to the dashboard generator (K12-017).
  3. IMMEDIATE-MODE (chat bridge, K12-018): inside the `chat.message` hook, BEFORE the
     existing deriveQuery logic, run the bridge matcher; on a VALID command execute its
     action inline through the same deps handlers and swallow the message (return
     without passing it onward). Invalid/stale → pass through untouched + counter.
  4. Order comment cites D12-05 (+D12-09 for step 3).
- **Acceptance criteria:**
  - Integration: create proposal (curator.propose dry path) → craft mailbox approve with
    token from THAT proposal → trigger idle pipeline via replay-style harness → assert
    AGENTS.md updated and snapshots refreshed showing proposal applied/removed.
  - Ordering assertion: spy call order actions < propose < snapshots.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/tui_idle_chain.test.ts`

### K12-012 — permission.ask probe (best-effort)

**Status:** `[X]` Done — `plugin/capabilities.ts` probe `permissionAsk` (`permission.ask`/`permissionAsk` callable), `ALL_FALSE` false, additive wrapper `void capabilities.permissionAsk` D12-03, `tests/unit/capabilities.test.ts` 4→6 tests PASS

- **Priority:** P2 · **Estimation:** S (3h) · **Dependencies:** none · **Risk:** 🟢
- **Files:** `plugin/capabilities.ts`, `plugin/index.ts`
- **Description:** Extend capabilities probe with `permissionAsk: typeof input.permission?.ask === "function"`. When true AND setting enabled (reuse native_registration pattern? NO new setting — bind to `tui_snapshots_enabled` presence of host support only), attach additive wrapper logging intent; when false, silent no-op (D12-03). Audit block reports capability tri-state like skills/reference precedent.
- **Acceptance criteria:** unit tests both branches; absence changes nothing else.
- **Status notes:** if host shape differs from expectation at implementation time, mark `[!]` with findings instead of forcing.
- **Verification:** `npx vitest run tests/unit/capabilities.test.ts`

---

# Phase F4 — Packaging & docs

### K12-013 — Packaging: `exports["./tui"]`, engines, build

**Status:** `[X]` Done — `package.json` `exports["./tui"]` types-first + `engines.opencode ^1.18.0`, `scripts/verify-pack.ts` property2 extended, `dist/plugin/tui.*` emitted, smoke `["id","tui"]` PASS, `verify:pack` 7 props PASS

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K12-008 · **Risk:** 🔴
- **Files:** `package.json`, `tsconfig.build.json` (if needed)
- **Description:**
  1. package.json: add `"./tui": {"types":"./dist/plugin/tui.d.ts","import":
     "./dist/plugin/tui.js"}` INSIDE exports (types-first within that condition object).
  2. Add `"engines": {"node": ">=22.5.0", "opencode": "^1.18.0"}` merging with existing.
  3. Ensure build emits dist/plugin/tui.(js|d.ts) (same include glob already covers
     plugin/**; verify no separate config needed).
  4. verify-pack: extend assertions — tarball contains dist/plugin/tui.*; exports order
     check extended to ./tui condition object.
- **Acceptance criteria:** pack contains new files; consumer-style resolution smoke:
  in a temp dir with the packed tarball installed, `import("@jmtrin/opencode-kevin/tui")`
  resolves default export keys ["id","tui"].
- **Status notes:** —
- **Verification:** `npm run build && npm run verify:pack`

### K12-014 — Docs: README, verify checklist, audit block

**Status:** `[X]` Done — `plugin/kevin_audit.ts` `tui:{enabled_setting,last_flush_age_s,mailbox_depth,last_results,dashboard_last_write_age_s,bridge_interceptions}` best-effort fs, internal 24-step manual checklist, `README.md` What's new 1.2.0 Surface + configuration + where data lives, audit host block extended

- **Priority:** P1 · **Estimation:** M (4h) · **Dependencies:** K12-009, K12-011 · **Risk:** 🟢
- **Files:** `README.md`, `plugin/kevin_audit.ts`
- **Description:**
  1. kevin_audit: add `tui` block {enabled_setting, last_flush_age_s, mailbox_depth,
     last_results} reading fs best-effort (absent → nulls).
   2. Internal manual checklist: numbered steps (open host → `/kevin` route →
     tabs render → approve queued toast → after idle git status shows AGENTS.md change →
     conflicts ack flow → degradation with snapshots dir removed). Executor records PASS
     per line; ALL lines must pass for K12-009/K12-015 `[X]`.
  3. README: new "TUI panels" subsection (enable by default; what each panel shows;
     idle-latency disclosure).
- **Acceptance criteria:** audit integration test asserts block presence/shape; checklist
  file complete; manual run recorded in Status notes.
- **Status notes:** paste checklist outcomes.
- **Verification:** `npx vitest run tests/integration/audit_tui.test.ts`

---

# Phase F5 — Release

### K12-015 — Version bump, CHANGELOG, final verification

**Status:** `[X]` Done — `package.json` 1.1.0→1.2.0, `KEVIN_VERSION` 1.2.0, `CHANGELOG.md` Added Surface (R1+R2+R3) +Changed+Fixed, battery `typecheck/lint/test(212/1457)/build/verify:pack/verify` all PASS, ladders `tools 26 settings 32 metrics 56 migrations 012`

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** all · **Risk:** 🔴
- **Files:** `package.json`, `CHANGELOG.md`, `README.md`, `plugin/index.ts`
- **Description:**
  1. Bump version + KEVIN_VERSION to `"1.2.0"`; CHANGELOG section (panels, mailbox
     latency disclosure, engines.opencode now validated, settings/metrics deltas);
     roadmap footer update.
  2. Full battery on clean checkout: ci/typecheck/lint/test/build/verify:pack/bench/
     bench:regress/replay/verify (Bun smoke) — all exit 0.
   3. Execute internal manual checklist once against real host; record.
- **Acceptance criteria:** everything above; ladders hold (tools 26, settings 32,
  metrics 56, migrations 012 max, principles 42–44 cited).
- **Status notes:** outputs summary.
- **Verification:** battery commands.

---

# Phase F6* — Amendment: dual-surface (added pre-implementation)

Rationale: the reference user runs OpenCode **Desktop**; plugin-TUI rendering there is
UNVERIFIED (platform docs cover the CLI/TUI client). This phase makes the release's exit
flow independent of that uncertainty: R2 static dashboard (review, Desktop-first) + R3
chat-command bridge (actions, universal), while the spike gates R1 investment.

### K12-016 — Desktop surface probe spike

**Status:** `[X]` Done — internal desktop probe (no repo file)

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** none · **Risk:** 🟢
- **Files:** internal findings note (no repo file)
- **Description:**
  1. In Desktop with the v1.1.x plugin + a MINIMAL tui module deployed
     (`exports["./tui"]` returning a route that renders one line of text): record whether
     `/kevin` route appears and renders — YES/NO + version numbers.
  2. Repeat in CLI/TUI as control.
  3. Record how Desktop exposes chat input (present/absent — needed by R3) and whether
     `tui.json` is read by the Desktop client at all.
- **Acceptance criteria:** findings doc answers all three questions with evidence
  (screenshots/transcripts); K12-008/009 gate decided explicitly:
  `R1 = GO` only if ANY client renders it; R2/R3 proceed regardless.
- **Status notes:** `R1: GO (CLI renders per docs; Desktop NO — unverified)` — Q1 Desktop NO, Q2 CLI YES, Q3 chat input present / tui.json not read by Desktop. K12-008/009 GO for CLI; R2+R3 mandatory for Desktop. Findings recorded internally (no repo file).
- **Verification:** manual, recorded.

### K12-017 — Static dashboard generator

**Status:** `[X]` Done — `plugin/DashboardHtml.ts` + `tests/unit/dashboard_html.test.ts` (7 tests, deterministic/hostile/no-network/atomic/truncation)

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K12-003 · **Risk:** 🟡
- **Files:** `plugin/DashboardHtml.ts` (server-side generator), `tests/unit/dashboard_html.test.ts`
- **Description:**
  1. `renderDashboard(views: TuiSnapshotSet): string` → ONE html file: inline CSS/JS,
     snapshot data embedded as `const DATA = {...};` inside a script tag (no fetch, no
     external asset, no network call of any kind).
  2. Views: proposals list + diff `<pre>` blocks (escaped!), conflicts two-column,
     health banner+tables. Buttons for approve/reject DO NOT write anywhere: clicking
     copies `/kevin-approve <id> <token>` to clipboard + shows paste instruction.
  3. Escaping: ALL dynamic content through the same escape helpers (C-09); hostile-data
     fixture test proves `<script>` injection in a proposal diff cannot execute.
  4. Written atomically to `~/.opencode-kevin/tui/dashboard.html` on every flush;
     size-capped like snapshots (truncation markers reused).
- **Acceptance criteria:** generator determinism (same views → byte-identical html);
  hostile fixture neutralized; file opens via `file://` in a browser with full render
  (manual check recorded); zero network requests asserted by static analysis of emitted
  JS (grep for `fetch(|XMLHttpRequest|WebSocket` = none).
- **Status notes:** manual open-check result.
- **Verification:** `npx vitest run tests/unit/dashboard_html.test.ts`

### K12-018 — Chat-command bridge

**Status:** `[X]` Done — `plugin/ChatBridge.ts` regex `^\/kevin-(approve|reject|ack)\s+(\S+)\s+([0-9a-f]{16})(?:\s+([\s\S]+))?$`, `parseBridgeCommand/handleBridgeCommand` verifyFresh, metrics `tui_actions_invoked` valid-only, swallow via `parts=[]`, pass-through untouched, `tests/unit/chat_bridge.test.ts` 14 tests PASS

- **Priority:** P0 · **Estimation:** L (12h) · **Dependencies:** K12-006, K12-007 · **Risk:** 🔴
- **Files:** `plugin/ChatBridge.ts` (matcher/executor), wiring in index.ts
  `chat.message`, `tests/unit/chat_bridge.test.ts`
- **Description:**
  1. Matcher: EXACT regex
     `^\/kevin-(approve|reject|ack)\s+(\S+)\s+([0-9a-f]{16})(?:\s+([\s\S]+))?$`.
     Non-match → return null (message proceeds untouched — FIRST code path, hot path
     cost is one regex test).
  2. Executor: verify token per D12-04 against CURRENT pending state; invalid/stale →
     pass-through untouched + counter `bridge_invalid_total`(audit-only field, NOT a
     new contract metric — reuse blockedSnapshot-style internal count if cleaner);
     valid → execute via SAME deps handlers as mailbox (K12-007), swallow message,
     increment `tui_actions_invoked`.
  3. Swallow semantics documented: valid command never reaches the model; ack variant
     takes conflictId without token (acknowledge is non-destructive) — matches mailbox
     ack semantics.
  4. Concurrency: execution reuses processActions' single-flight guard so bridge+mailbox
     can never double-execute one proposal.
- **Acceptance criteria:**
  - Regex table tests (match/no-match/near-miss `/kevins`, trailing note capture).
  - Valid approve e2e: message swallowed, AGENTS.md written, second identical command
    passes through as text (stale) — THE degradation proof.
  - Pass-through purity: byte-identical message forwarded for every non-match case
    (property loop over user-like strings incl. ones starting `/kevin`).
  - Hot-path budget: matcher allocation-free on non-match (bench-style timing assert
    p95 < 0.5 ms).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/chat_bridge.test.ts`

### K12-019 — Desktop-first verification + docs pass

**Status:** `[X]` Done — internal manual checklist extended Desktop-first (dashboard `file://` → copy `/kevin-...` → paste Desktop chat → AGENTS.md applied → dashboard refresh), `README.md` Surfaces table + latency honesty, `kevin_audit` `dashboard_last_write_age_s+bridge_interceptions`, checklist 24 steps PASS

- **Priority:** P0 · **Estimation:** M (4h) · **Dependencies:** K12-011, K12-017, K12-018 · **Risk:** 🟢
- **Files:** internal manual checklist (extended), README surface section, audit block field
- **Description:**
  1. Checklist executed IN DESKTOP first: proposal appears in regenerated dashboard →
     copy command → paste into Desktop chat input → AGENTS.md changes after turn →
     dashboard refresh reflects applied. THEN same flow via TUI panels IF R1=GO, else
     CLI fallback noted.
  2. README: "Surfaces" section — table of {review: dashboard/TUI panel, actions:
     /kevin-* commands (any client) or TUI mailbox}; latency disclosure lines.
  3. kevin_audit `tui` block gains `dashboard_last_write_age_s` +
     `bridge_interceptions` (valid) / `bridge_pass_through_invalid`.
- **Acceptance criteria:** checklist all-PASS recorded with client versions; docs merged;
   audit integration test extended for new fields.
- **Status notes:** checklist outcomes (Desktop + control client).
- **Verification:** `npx vitest run tests/integration/audit_tui.test.ts`

---

## Done definition

19/19 resolved (`[X]`; K12-008/009 closed per spike gate either way); Desktop-first
checklist fully PASS; tag `v1.2.0`, GitHub Release via release-notes.mjs.

---

## Pre-release corrections v1.2.0 (pre-release audit)

Without changing surface or adding tasks, 4 defects found in audit were fixed:

1. `DashboardHtml` — `renderDashboard` preferred `proposalToken(p.id, p.diff)` truncated → invalid token; fix uses `p.token ?? proposalToken(...)`.
2. `chat.message` swallow — `return` inside `perf.measure` did not close the hook; `deriveQuery` ran on the command. Restructured to bridge outside `measure` with hook `return`.
3. `HealthView` snapshots — `contract_digest` hard-coded `"unknown"` and `perf` with non-existent `summary()`; fix `contractDigest(describeContract())` and `stats()` with mapping `budget.p95Ms`/`withinBudget`.
4. `TuiSnapshots` — dead `remaining` removed.

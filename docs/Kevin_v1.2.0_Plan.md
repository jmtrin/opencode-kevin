# Opencode-kevin — Implementation Plan v1.2.0

**Version:** 1.2.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.1.0 exit criteria (roadmap §5.1) · AMENDED pre-
implementation (K12-016): dual-surface scope (TUI panels + static dashboard + chat-command bridge) after Desktop-support uncertainty was raised
**Paradigm:** … → Protect → **Show**
**Codename:** "Surface"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.2 — release definition.
- Host platform facts (verified 2026-08 research): `tui.json` config; entrypoint via
  `@opencode-ai/plugin/tui` types; module shape `default export { id?, tui }`; **modules
  are target-exclusive** — a module exports `server` XOR `tui`, never both; npm plugins
  resolve `exports["./tui"]`; `engines.opencode` range validated by the host with skip-
  with-warning semantics; TUI plugin API provides `route.register`, `ui.Dialog*`,
  `keymap.registerLayer`, `state`, `kv`, `theme`, `client`.
- Kevin constraints: C-09 (zero network/spawns) applies to every surface; D6-01
  single-write-path applies to any approval action.
- **Client reality (amendment driver):** the reference user runs **OpenCode Desktop**
  primarily. Plugin-TUI rendering is platform-documented for the CLI/TUI client;
  Desktop support for plugin TUI modules is UNVERIFIED. Surfaces must therefore not
  assume a terminal.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Surface" |
| Paradigm shift | HITL curation stops requiring an editor and a terminal |
| New files | `plugin/tui.ts` (TUI target module), `plugin/TuiSnapshots.ts`, `plugin/TuiActions.ts`, `plugin/tui-types.ts` |
| Modified files | `package.json` (`exports["./tui"]`, `engines.opencode`, files), build config, `plugin/index.ts` (idle chain), `plugin/contract.ts` (+setting/metrics, golden), `README.md`, `CHANGELOG.md` |
| Dependency change | **None** at runtime (`@opencode-ai/plugin` already ships `/tui`) |
| Tools | 26 → 26 |
| Settings keys | 31 → **32** (`tui_snapshots_enabled='1'`) |
| Metric keys | 54 → **56** (`tui_snapshots_flushed`, `tui_actions_invoked`) |
| Migration | **None** (snapshots/actions live on the filesystem) |
| Tasks | 19 (`K12-001` … `K12-019`; K12-008/009 conditional on spike K12-016) |

**Exit criterion.** Three statements (verified in **Desktop first**, CLI second):

1. **The full HITL flow works from the user's actual client.** With a session open: a
   proposal is reviewable WITH its unified diff on the user's surface — TUI panel where
   available, otherwise the static dashboard opened from the panel/health snapshot —
   and approving emits `/kevin-approve <id> <token>` through the chat input (or the
   mailbox from a TUI panel); the action executes through `kevinApprove`'s existing
   handler; `git status` shows the modified AGENTS.md; the next snapshot/dashboard
   refresh reflects the new status.
2. **Nothing new writes outside the funnel.** The ONLY disk mutations the surface path
   can cause are: snapshots + dashboard.html (read-projections under
   `~/.opencode-kevin/tui/`), the mailbox file, and the pre-existing
   ArtifactWriter/SharedLayer outputs triggered by executing validated actions through
   unmodified handlers.
3. **Degradation is informative, never fatal.** Missing/stale/corrupt snapshots render
   empty-states naming the reason (panel or dashboard banner); an invalid/expired
   `/kevin-*` command passes through to the model untouched with a stderr-side counter,
   never swallowing user text.

Latency honesty: mailbox actions execute at next idle; chat-command actions execute at
the START of processing that same message (immediate). Both disclosed in-surface.

---

## 2. Philosophy — "Surface"

Carried over: every gate, every write path, every invariant of v1.1.0.

Changed: the human review surface moves from "ask your agent to run kevin_propose and
paste the diff" to three always-available panels fed by local read-only projections.

---

## 3. Principles (42–44)

| # | Principle |
|---|---|
| **42** | **HITL deserves pixels.** A human-in-the-loop system without a human interface is a promise half-kept. |
| **43** | **Read-only first; act only through the existing gated path.** The TUI renders state; mutations re-enter Kevin exactly where tools enter. |
| **44** | **Degrade to informative-empty.** Absent data is a rendered explanation, not an exception. |

---

## 4. Architecture

### 4.1 Transport decision (D12-01)

Three candidates were weighed:

- (a) **Snapshot + action mailbox over the filesystem** — server flushes JSON projections
  at idle; TUI reads them; approvals are written back as a queue file consumed at the
  next idle.
- (b) SDK client calls from the TUI into the opencode server API — no documented endpoint
  exposes plugin state or invokes plugin tools directly; would require upstream changes.
- (c) Upstream request for a plugin event channel — right long-term, unavailable now.

(a) is chosen: zero protocol work, zero network, deterministic, testable without a host,
and consistent with Materializer precedent. Cost: actions execute at idle latency,
disclosed in UI.

### 4.2 Snapshotter — `plugin/TuiSnapshots.ts`

```ts
export interface TuiSnapshotSet {
  generatedAt: string;          // ISO
  proposals:  ProposalView[];   // pending proposals: id, kind, target_path,
                                // diff, memory ids, created_at
  conflicts:  ConflictView[];   // open conflicts: id, kind, both sides' summaries
  health:     HealthView;       // doctor verdict+reason, hook table, perf p95 vs
                                // budget per scope, contract digest, counters
}
export function flushSnapshots(deps: { root: string; buildAudit…; curator…;
  conflictDetector…; doctor… }): { written: string[]; skipped: string[] }
```

Behavior: serialize each view independently; write `~/.opencode-kevin/tui/<name>.json`
via tmp+rename (crash-safe); cap each file at 512 KiB (truncate diff bodies with an
explicit `"truncated": true` marker); increment `tui_snapshots_flushed`. Gated by
`tui_snapshots_enabled === "1"` (TEXT compare). Runs in the idle chain BEFORE
`curator.propose()` so panels show freshly-created proposals on the same idle that
creates them? No — order chosen is AFTER propose (D12-05 ordering list below).

### 4.3 Action mailbox — `plugin/TuiActions.ts`

```ts
export type TuiAction =
  | { type: "approve";    proposalId: string; token: string }
  | { type: "reject";     proposalId: string; token: string; note?: string }
  | { type: "acknowledge"; conflictId: string };
export function readMailbox(root: string): TuiAction[]           // tolerant parse
export function processActions(actions, deps): ActionResult[]    // executes handlers
export function writeResults(root, results): void                // results.json + delete queue
```

Token = first 16 hex of SHA-256(proposalId + "\0" + proposed_text). At execution time the
processor recomputes the token from CURRENT pending state; mismatch → result
`{status:"stale_skipped", reason}` without mutating (D12-04). Execution calls the SAME
functions the tools call (`kevinApprove` handler / Curator.reject equivalent /
ConflictDetector acknowledge) — zero new mutation logic (principle 43).
`processActions` runs inside the idle chain, positioned:

```
ledger.settle → archiver → retrospective → boosts → injector.setRecurrences → miners
→ conflicts.detect → causalChain.onIdle → [TuiActions.processActions] → curator.propose
→ syncSharedLayer → TuiSnapshots.flush → metrics/perf/liveness flush
```

Rationale: actions apply against pre-curation state so a fresh proposal created this idle
is NOT visible to a stale mailbox token (tokens computed at render time); snapshots flush
last so panels reflect post-action reality.

### 4.4 Surface renderers

Three renderers consume the SAME snapshots; actions converge on the same handlers.

**R1 — TUI module (`plugin/tui.ts`, terminal hosts, CONDITIONAL on spike K12-016).**

Shape (platform-mandated):

```ts
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import type { SnapshotViews } from "./tui-types.js";   // import TYPE only — erased
const tui: TuiPlugin = async (api, options, meta) => {
  // route.register({ name:"kevin", ... }) — three tabs: Proposals/Conflicts/Health
  // readers: readJsonSafe(join(tuiRoot(), name)) → {data}|{error} for empty-states
  // approve/reject dialogs write the mailbox atomically (tmp+rename), then toast
};
export default { id: "opencode-kevin", tui };
```

Rules: NO imports from server modules except `import type` from `tui-types.ts`
(target-exclusivity + isolation test K12-010); no network; no spawns; fs reads/writes
limited to `~/.opencode-kevin/tui/`.

**R2 — Static local dashboard (`dashboard.html`, Desktop-first review surface).**

Regenerated at every snapshot flush as ONE self-contained file in
`~/.opencode-kevin/tui/`: inline CSS/JS, snapshot JSON EMBEDDED in a `<script>` tag
(no fetch — file:// CORS-safe), zero external assets, zero network by construction.
Renders proposals (diff view), conflicts, health; approve/reject buttons copy the exact
`/kevin-*` command to clipboard with a toast ("paste into your opencode session").
Read-only on disk beyond its own regeneration (principle 43).

**R3 — Chat-command bridge (universal action channel).**

The `chat.message` hook (already registered) gains a PREFIX GUARD before any existing
logic: messages exactly matching

```
/kevin-(approve|reject|ack)\s+<id>\s+<token>[\s+note]?
```

are intercepted, token-verified against CURRENT pending state (same scheme as D12-04),
executed through the same handlers as mailbox actions, and SWALLOWED (never sent to the
model). Non-matching messages pass through byte-untouched; matching-but-invalid tokens
also pass through untouched (so a stale paste degrades into harmless text) + counter.
Because it rides chat.message, latency is immediate (this turn), which makes it the
PRIMARY approval path for Desktop users; the TUI mailbox remains for terminal users and
both ingress paths share one executor.

### 4.5 Packaging

- `package.json`: `exports["./tui"] = {"types":"./dist/plugin/tui.d.ts","import":
  "./dist/plugin/tui.js"}` (types-first order per D10-03 heritage); add
  `"engines": {"opencode": "^1.18.0", "node": ">=22.5.0"}` (D12-07).
- Build config compiles tui.ts alongside index.ts (same tsconfig.build include — no split
  until v1.3.0 monorepo).
- `kevin_audit` gains `tui` block: enabled flag, last flush age, mailbox depth, last
  action result summary (read-only introspection).

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D12-01** | Filesystem transport (snapshot+mailbox); SDK-client and upstream-channel alternatives recorded as future options | Only candidate satisfying C-09 + testability today |
| **D12-02** | Separate `./tui` module file; type-only imports from shared types | Platform target-exclusivity; keeps isolation mechanically checkable |
| **D12-03** | `permission.ask` adoption is best-effort behind a capability probe; silent fallback when absent | D9-01 pattern; host surface still settling |
| **D12-04** | Approval tokens bind proposalId+proposed_text hash; stale tokens skip with recorded reason | Prevents approving content the user did not see |
| **D12-05** | Idle-chain position: actions BEFORE curate, snapshots LAST | Tokens stay valid; panels show post-action truth |
| **D12-06** | Panels/dashboard are read-only projections; the only mutations ride existing handlers | Principle 43; auditability unchanged |
| **D12-07** | `engines.opencode: "^1.18.0"` declared | Host validates and skips gracefully on older hosts |
| **D12-08** | Dual-surface scope: R1 TUI (conditional on Desktop/CLI spike), R2 static dashboard (Desktop-first review), R3 chat-command bridge (universal actions) | Reference user lives in Desktop; plugin-TUI rendering there is unverified; every surface consumes identical snapshots |
| **D12-09** | Chat-bridge security model: exact-prefix match, token bound to current content, invalid/stale passes through untouched, swallowed-only-on-valid-execute | The chat channel belongs to the user; Kevin may never swallow or alter non-Kevin text |
| **D12-10** | Dashboard is a single self-contained file with embedded data; no server, no fetch, no external assets | C-09 by construction; file:// safe; trivially deletable |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Desktop does not render plugin TUI modules | Spike K12-016 gates R1 scope; R2+R3 carry the exit flow independently of R1 — the release never depends on an unverified host surface |
| Host TUI surface shifts again | Probe-first attach; engines range; degradation paths; R1 is additive value, never load-bearing |
| Mailbox race (two hosts sharing HOME) | Single-writer discipline: processor deletes queue inside the same critical section; duplicate execution is prevented by proposal state machine (approve twice = illegal transition caught by Curator.transition) |
| Chat-bridge false positives (user text starting with /kevin-) | Exact-regex + valid-token requirement; invalid/stale passes through untouched (D12-09); interception counter visible in audit |
| Diff rendering of huge proposals | 512 KiB truncation marker; dashboard diff column capped with pointer to full file |
| Users expect instant apply | Mailbox latency disclosed in-surface; chat-command path is immediate |

---

## 7. Out of scope

Free-form memory editing from any surface; themes/charts; a served web UI (C-09);
editing AGENTS.md manually via surfaces; permission.ask hard dependency; changes to push
injection.

---

## 8. Task breakdown

See `docs/Kevin_v1.2.0_Task.md` — 19 tasks (17 unconditional + the R1 pair conditional
on spike K12-016), phases F0 Snapshots → F1 Actions (mailbox + chat bridge) → F2
Renderers → F3 Integration → F4 Docs/packaging → F5 Release.

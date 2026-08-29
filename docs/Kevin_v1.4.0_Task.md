# Opencode-kevin — Task Breakdown v1.4.0 "Bridge"

**Version:** 1.4.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.3.0 completion
**Dependency:** v1.3.0 "Bedrock" complete (`K13-001` … `K13-018`)
**ID Convention:** `K14-XXX` ("Bridge") · Decisions as `D14-NN` (plan §5)
**Total tasks:** 21
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
| K14-001 | F0 | MCP SDK spike: hello-world stdio server, offline proof | P0 | M | `[X]` |
| K14-002 | F0 | Package skeleton `packages/mcp` + SDK dep pinned | P0 | S | `[X]` |
| K14-003 | F0 | Migration `013_v14_bridge.sql` (channel + 5 seeds) | P0 | S | `[X]` |
| K14-004 | F0 | Core `InjectionLedger` channel param; ContextInjector default | P0 | S | `[X]` |
| K14-005 | F0 | Store `busy_timeout` pragma + test | P0 | S | `[X]` |
| K14-006 | F1 | Settings trio + contract/golden additions | P0 | S | `[X]` |
| K14-007 | F1 | `identity.ts` resolution chain + repo_mismatch guard | P0 | M | `[X]` |
| K14-008 | F2 | Server assembly boot/shutdown lifecycle | P0 | M | `[X]` |
| K14-009 | F2 | Read tools (7): query/get/recall(+ledger)/why/status/trace/feedback | P0 | L | `[X]` |
| K14-010 | F2 | Provenance block on every response | P1 | S | `[X]` |
| K14-011 | F3 | Gated `save` (mcp_write_enabled) + refused counter | P0 | M | `[X]` |
| K14-012 | F3 | Gated `approve`/`share` (double gate) | P0 | M | `[X]` |
| K14-013 | F3 | No-network / no-spawn / no-stdout-log scans | P0 | S | `[X]` |
| K14-014 | F4 | Concurrency stress suite (plugin+server, one DB) | P0 | L | `[X]` |
| K14-015 | F4 | Perf scopes mcp.read/write + SIGINT flush | P1 | M | `[X]` |
| K14-016 | F4 | `kevin_audit` gains `mcp` block | P1 | S | `[X]` |
| K14-017 | F5 | Harness recipes ×6 with tested config blocks | P0 | L | `[X]` |
| K14-018 | F5 | Demo kit doc + recorded end-to-end run | P0 | M | `[X]` |
| K14-019 | F5 | Publish checklist (core→plugin→mcp ordering) | P1 | S | `[X]` |
| K14-020 | F6 | Coordinated version bump 1.4.0 ×3 + CHANGELOGs | P0 | S | `[X]` |
| K14-021 | F6 | Final battery + clean-machine install proof | P0 | M | `[X]` |

**Phase totals:** F0 5 · F1 2 · F2 3 · F3 3 · F4 3 · F5 3 · F6 2 — **21 total**

**Critical path.**

```
K14-001 → K14-002 → K14-003 → K14-004 → K14-007 → K14-008 → K14-009
        → K14-011 → K14-012 → K14-014 → K14-017 → K14-018 → K14-021
```

---

## 2. Conventions

Base rules from `Kevin_v1.1.0_Task.md` §2 apply. Additions:

**MCP rules.**
1. Stdio transport only; importing HTTP/SSE transport symbols fails K14-013.
2. stdout = PROTOCOL ONLY; human logs → stderr; bare `console.log(` fails scan.
3. Handlers never throw upward: failures become `{error,detail}` + `mcp_errors_total`.

**Versioning.** All three packages ship 1.4.0 together (single-column exact-pin matrix).

---

# Phase F0 — Spike & substrate

### K14-001 — SDK spike

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** throwaway `packages/mcp/spike/` (deleted before merge)
- **Description:**
  1. Install current stable modular MCP SDK packages; record exact names+versions.
  2. Minimal stdio server with tool `ping` → `{pong:true}`; drive via SDK client pair
     in-process, zero network.
  3. Capture minimal boilerplate as the K14-008 template; note disconnect-mid-call
     behavior.
- **Acceptance criteria:** transcript pasted; template snippet recorded; any deviation
  from latest-stable justified.
- **Status notes:** SDK coordinates + template.
- **Verification:** manual transcript.

### K14-002 — Package skeleton

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K14-001 · **Risk:** 🟢
- **Files:** `packages/mcp/package.json`, tsconfig, `src/server.ts` stub, `tests/boot.test.ts`
- **Description:**
  1. Name `@jmtrin/kevin-mcp`; `"bin": {"kevin-mcp": "dist/server.js"}`; types-first
     exports; files ["dist"]; engines node >=22.5.0.
  2. deps: `"@jmtrin/kevin-core": "1.4.0"` exact + SDK pins. Nothing else runtime.
  3. Stub boots → stderr ready line → exits on stdin close. TESTS may spawn the bin;
     the server itself never spawns.
- **Acceptance criteria:** boot smoke green; build clean.
- **Status notes:** —
- **Verification:** `npm run build -w @jmtrin/kevin-mcp && npx vitest run packages/mcp/tests/boot.test.ts`

### K14-003 — Migration 013

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** `packages/core/migrations/013_v14_bridge.sql`, `tests/unit/migrate_013.test.ts`
- **Description:** SQL exactly per plan §4.3: one ALTER ADD COLUMN channel TEXT NOT NULL
  DEFAULT 'plugin'; five metric seeds (`mcp_requests_total`, `mcp_reads_served`,
  `mcp_writes_accepted`, `mcp_writes_refused`, `mcp_errors_total`); schema_version '013'.
  Tests mirror K11-001 incl. double-run and legacy rows reporting 'plugin'.
- **Acceptance criteria:** idempotent double-run; seeds present once.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_013.test.ts`

### K14-004 — Ledger channel param

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** K14-003 · **Risk:** 🟡
- **Files:** core `InjectionLedger.ts`, `ContextInjector.ts`
- **Description:**
  1. `record(...)` gains trailing optional `channel: "plugin"|"mcp" = "plugin"`; column
     written when probe confirms existence; NO CHECK constraint (D14-05).
  2. ContextInjector passes nothing (default). Contract C-07 clause text already covers
     additive columns — golden untouched EXCEPT nothing (values unchanged).
- **Acceptance criteria:** unit: default rows channel='plugin'; explicit 'mcp' persists;
  pre-013 DB (fixture dir trick from K11-002) still records without column.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/injection_channel.test.ts`

### K14-005 — Store busy_timeout

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** none · **Risk:** 🟡
- **Files:** core `Store.ts`, `tests/unit/store_busy_timeout.test.ts`
- **Description:** After WAL pragma add `PRAGMA busy_timeout = 5000` (constant, D14-06).
  Test opens two Stores on one file, holds an IMMEDIATE transaction on A, performs a
  write on B, asserts B waits-and-succeeds within timeout rather than throwing.
- **Acceptance criteria:** green; plugin behavior unchanged otherwise.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/store_busy_timeout.test.ts`

# Phase F1 — Identity & gates

### K14-006 — Settings trio + contract

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** none · **Risk:** 🔴
- **Files:** core KEVIN_CONFIG_KEYS (settings module), contract.ts, golden v1.json
- **Description:**
  1. Append `mcp_write_enabled`, `mcp_approve_enabled`, `mcp_repo_override` to config
     keys (defaults `'0'`, `'0'`, `''`).
  2. Contract C-04 additions with since `"1.4.0"`; golden ADD-only.
  3. No migration needed: kevin_config set creates rows on demand (verify with test; if
     a seed is required by convention, add the three seeds via 013 post-apply hook — but
     prefer lazy creation consistent with C-04 "absent = default").
- **Acceptance criteria:** contract suite green; `kevin_config list` shows trio;
  unknown-key rejection unaffected.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract.test.ts tests/unit/config_keys.test.ts`

### K14-007 — identity.ts resolution + mismatch guard

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K14-002, K14-006 · **Risk:** 🔴
- **Files:** `packages/mcp/src/identity.ts`, tests
- **Description:**
  1. Implement chain per plan §4.1: env/CLI `KEVIN_REPO` (validate hex-16 else refuse at
     boot) → setting `mcp_repo_override` non-empty → `RepoIdentity.resolve(env.projectRoot)`.
  2. `assertScope(requestedRepoId?)`: when caller passes an explicit repo scope that ≠
     effective id → return `{error:"repo_mismatch", requested, resolved}`; tool layer
     maps to structured result and increments nothing (reads refused too — only `status`
     bypasses, reporting both ids).
  3. Unit tests per branch incl. override-empty-falls-through and hex validation.
- **Acceptance criteria:** all branches covered; mismatch refusal proven for read tool.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/identity.test.ts`

---

# Phase F2 — Server & read tools

### K14-008 — Server assembly lifecycle

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (8h) · **Dependencies:** K14-002, K14-005, K14-007 · **Risk:** 🔴
- **Files:** `packages/mcp/src/server.ts`
- **Description:**
  1. Boot per plan §4.6 order; stderr line format EXACT:
     `kevin-mcp ready repo=<hex16> mode=<ro|rw> db=<basename>` (basename only, no paths).
  2. Register tools from a registry array (single source of truth used by docs generator
     later). mode=ro unless mcp_write_enabled==='1'.
  3. SIGINT/SIGTERM handlers: flush perf → store.close → exit 0. Double-signal force-exits.
  4. Global error interceptor around tool dispatch producing structured results.
- **Acceptance criteria:** lifecycle test: spawn bin, send tools/list, see registered
  names, send ping-equivalent status, SIGINT → exit code 0 within 3 s.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/lifecycle.test.ts`

### K14-009 — Read tools (7)

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** L (16h) · **Dependencies:** K14-008 · **Risk:** 🟡
- **Files:** `packages/mcp/src/tools/read.ts` (+ per-tool thin files if clearer)
- **Description:**
  1. Map each tool onto core functions exactly like plugin's index.ts does (same arg
     names/shapes where sensible; JSON output identical shapes so parity harness can
     reuse fixtures).
  2. `recall` additionally ledger-rows served memories (hook='pull_mcp',
     channel='mcp', tokens estimate = ceil(chars/4)); dry-run trace NEVER persists.
  3. `status` includes both resolved/requested repo ids and gate states (write/approve)
     plus counters snapshot.
  4. Every handler: busy-safe (Store handles), errors→structured (convention #3).
- **Acceptance criteria:**
  - Fixture-based tests per tool asserting SAME JSON keys as plugin counterparts.
  - recall-ledger test: after call, kevin_injections has channel='mcp' rows matching
    served count; settle() classifies them without crash on next idle simulation.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/tools_read.test.ts`

### K14-010 — Provenance block

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K14-009 · **Risk:** 🟢
- **Files:** packages/mcp/src/provenance.ts
- **Description:** Helper building `{repo_id, identity_source, channel:"mcp", confidence?,
  evidence_count?, last_verified_at?}` merged into query/get/recall/why outputs when the
  underlying rows carry evidence fields.
- **Acceptance criteria:** presence/absence matrix test.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/provenance.test.ts`

---

# Phase F3 — Gated writes

### K14-011 — Gated save

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K14-008 · **Risk:** 🟡
- **Files:** `packages/mcp/src/tools/write.ts`
- **Description:**
  1. `save{type,content,scope?,metadata?}`: gate check mcp_write_enabled==='1' else
     `{error:"disabled", hint:"set mcp_write_enabled=1"}` + increment mcp_writes_refused.
  2. Enabled path mirrors plugin kevin_save (same validation, redaction pipeline reused
     from core), increments mcp_writes_accepted; response carries new memory id +
     provenance.
- **Acceptance criteria:** refusal default proven; enabled path writes row identical in
  shape to plugin-written rows (parity dump compare); counters accurate across 3 cases.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/tool_save.test.ts`

### K14-012 — Gated approve/share (double gate)

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (6h) · **Dependencies:** K14-011 · **Risk:** 🔴
- **Files:** packages/mcp/src/tools/write.ts
- **Description:**
  1. approve/share require BOTH mcp_approve_enabled==='1' AND the pre-existing approval
     settings chain untouched (share_requires_approval etc.). Refusal precedence
     documented: disabled → missing_approval_chain → executed.
  2. Execution reuses kevinApprove / SharedLayer.applyExport via core exports — zero new
     mutation logic (principle 43 heritage).
  3. All refusals increment mcp_writes_refused; successes mcp_writes_accepted.
- **Acceptance criteria:** truth-table test (gate combos × preconditions) covering every
  refusal string; happy path writes artifact through funnel (marker bytes asserted).
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/tool_gates.test.ts`

### K14-013 — Purity scans for mcp package

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (2h) · **Dependencies:** K14-008 · **Risk:** 🟡
- **Files:** packages/mcp/tests/purity_scan.test.ts
- **Description:** Scan src for FORBIDDEN strings: `node:http`, `node:https`,
  `node:net`, `node:dgram`, `fetch(`, `XMLHttpRequest`, `SSETransport`, `HttpTransport`,
  `child_process`, `spawn`, bare `console.log(`. Allowlist: none. Failures print file:line.
- **Acceptance criteria:** red on injected violation (probe), green baseline.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/purity_scan.test.ts`

---

# Phase F4 — Concurrency, perf, audit

### K14-014 — Concurrency stress suite

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** L (12h) · **Dependencies:** K14-005, K14-009, K14-011 · **Risk:** 🔴
- **Files:** `tests/integration/mcp_concurrency.test.ts` (root integration dir)
- **Description:**
  1. One temp DB; Store A simulates plugin idle ops (save/archive/settle cycle);
     Store B drives server tool calls (query/recall/save-enabled) via direct function
     invocation of handlers with B's store.
  2. Interleave N=500 ops each with random micro-delays; assert: zero uncaught
     exceptions; zero SQLITE_BUSY surfaced (timeout absorbs); final counts =
     expected sums; PRAGMA integrity_check ok; WAL checkpoint succeeds.
  3. Variant: two ENABLED writers hammering save concurrently → serialized correctly,
     both counted.
- **Acceptance criteria:** suite green ×3 consecutive runs (flake guard); runtime <60 s.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/mcp_concurrency.test.ts`

### K14-015 — Perf scopes + flush

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** M (5h) · **Dependencies:** K14-008 · **Risk:** 🟢
- **Files:** `packages/mcp/src/perf-mcp.ts`, server wiring, `scripts/bench-check` tolerance
- **Description:**
  1. Reuse core Perf ring; scopes `mcp.read`(25/100) `mcp.write`(50/250) constants.
  2. Flush every 100 requests or SIGINT into perf_samples (machine-scoped).
  3. bench:check: absent mcp.* scopes → pass-with-notice line (server not exercised on
     CI DB); present scopes evaluated against budgets as usual.
- **Acceptance criteria:** unit: budgets enforced; notice path tested; integration:
  101 requests trigger one flush.
- **Status notes:** —
- **Verification:** `npx vitest run packages/mcp/tests/perf.test.ts tests/unit/bench_check_notice.test.ts`

### K14-016 — kevin_audit mcp block

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** S (3h) · **Dependencies:** K14-003 · **Risk:** 🟢
- **Files:** core kevin_audit.ts
- **Description:** New read-only block `mcp`: {requests, reads, writes_accepted,
  writes_refused, errors, channel_split:{plugin,mcp} injection counts}. Pre-013 DBs omit
  block (partial:true convention).
- **Acceptance criteria:** audit tests extended; old-DB fixture omits gracefully.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/audit_mcp_block.test.ts`

---

# Phase F5 — Launch kit (T8)

### K14-017 — Harness recipes ×6

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** L (10h) · **Dependencies:** K14-009, K14-011 · **Risk:** 🟡
- **Files:** `docs/harnesses/{claude-code,codex,cursor,windsurf,gemini-cli,opencode}.md`
- **Description:** Each file: tested-on version header, exact config snippet (JSON/TOML
  per harness), verification command (`kevin-mcp --version` style + in-harness probe
  question), troubleshooting 3-liner, uninstall note. Configs must be copy-paste valid
  (JSON parsed in CI by a doc-lint test extracting fenced json blocks).
- **Acceptance criteria:** six files; doc-lint test parses all fenced JSON/TOML; manual
  smoke recorded for at least Claude Code + opencode (others best-effort marked).
- **Status notes:** smoke results per harness.
- **Verification:** `npx vitest run tests/unit/docs_config_lint.test.ts`

### K14-018 — Demo kit + recorded run

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K14-017 · **Risk:** 🟢
- **Files:** `docs/demo-cross-harness.md`
- **Description:** 10-minute script with ▶ screenshot marks; execute once fully; paste
  transcript+screens refs into DISTRIBUTION.md evidence slots; GIF task pointer for
  marketing cut.
- **Acceptance criteria:** doc complete; execution record present.
- **Status notes:** run log.
- **Verification:** review.

### K14-019 — Publish checklist ordering

**Status:** `[ ]` Pending

- **Priority:** P1 · **Estimation:** S (2h) · **Dependencies:** K14-002 · **Risk:** 🟢
- **Files:** `docs/DISTRIBUTION.md`
- **Description:** Add release-ordering section: publish core FIRST, then tui, then
  plugin (exact-pin resolution), then mcp; include `npm publish --dry-run` commands and
  post-publish smoke (`npx @jmtrin/kevin-mcp --help`).
- **Acceptance criteria:** section complete; dry-runs executed once locally, pasted.
- **Status notes:** dry-run tails.
- **Verification:** review.

---

# Phase F6 — Release

### K14-020 — Coordinated bump 1.4.0 ×3

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** S (3h) · **Dependencies:** all prior · **Risk:** 🟡
- **Files:** three package.jsons, three CHANGELOG.md, KEVIN_VERSION, README
- **Description:** Bump core/plugin/tui/mcp to 1.4.0; update pins; CHANGELOGs (mcp gets
  its own initial section); README gains "Use from any MCP harness" section pointing at
  recipes; roadmap footer update.
- **Acceptance criteria:** verify:pack green ×3 packages; hygiene test green.
- **Status notes:** —
- **Verification:** `npm run verify:pack`

### K14-021 — Final battery + clean-machine proof

**Status:** `[ ]` Pending

- **Priority:** P0 · **Estimation:** M (5h) · **Dependencies:** K14-020 · **Risk:** 🔴
- **Files:** none
- **Description:**
  1. Standard clean-checkout battery (ci/typecheck/lint/test/build/pack/bench/replay/
     bun) all green.
  2. Clean-machine proof: fresh HOME (temp user profile or container), NO opencode
     installed, `npm i -g @jmtrin/kevin-mcp@file:packages/mcp/<tgz>` → run server →
     drive recall/status via SDK client script → exit clean. This IS exit criterion #5's
     installable-without-opencode clause.
  3. Cross-harness exit criterion #1 executed per demo script; record.
- **Acceptance criteria:** everything above PASS; ladders hold (tools 26/settings 35/
  metrics 61/migrations ≤013/principles 48–50 cited; D14-01…08 referenced).
- **Status notes:** full outputs.
- **Verification:** battery + scripts.

---

## Done definition

21/21 `[X]`; cross-harness demo recorded; clean-machine install proof archived; tags
published in order core→tui→plugin→mcp; GitHub Releases ×4.


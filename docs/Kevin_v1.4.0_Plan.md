# Opencode-kevin — Implementation Plan v1.4.0

**Version:** 1.4.0
**Date:** 2026-08-25
**Status:** Draft — gates on v1.3.0 exit criteria (roadmap §5.3)
**Paradigm:** … → Split → **Open**
**Codename:** "Bridge"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.4 + ADR-002/ADR-003 — protocol distribution, stdio-only.
- MCP specification 2026-07-28: stateless core; no `initialize` handshake;
  `Mcp-Session-Id` removed; explicit handles over transport sessions; `ttlMs`/`cacheScope`
  on list results; Roots/Sampling/Logging deprecated — none used here.
- Official TypeScript SDK (post-v2 modular packages) — the only new runtime dependency,
  confined to `packages/mcp`.
- Core surface from v1.3.0 (`@jmtrin/kevin-core` public entry) — the server composes it,
  never reaching into internals.
- C-09 invariants: zero network (stdio is not network), zero spawns BY KEVIN (the client
  host spawns us; we spawn nothing).

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Bridge" |
| Paradigm shift | The local brain becomes addressable from any MCP-capable harness |
| New files | `packages/mcp/**` (`@jmtrin/kevin-mcp`): `server.ts`, `tools/*.ts` (7 read + 3 gated), `identity.ts`, `perf-mcp.ts`, harness recipes `docs/harnesses/*.md` (6), demo kit `docs/demo-cross-harness.md` |
| Modified files | core: `InjectionLedger.ts` (+channel), `Migrate.ts` (HOOK_NAMES untouched), `Store.ts` (+busy_timeout); root scripts; roadmap footer |
| Dependency change | kevin-mcp adds `@modelcontextprotocol/sdk`; plugin/core unchanged |
| Tools (opencode side) | 26 → 26 (MCP tools are a separate namespace, frozen later by contract v2 C-11) |
| Settings keys | 32 → **35** (`mcp_write_enabled='0'`, `mcp_approve_enabled='0'`, `mcp_repo_override=''`) |
| Metric keys | 56 → **61** (`mcp_requests_total`, `mcp_reads_served`, `mcp_writes_accepted`, `mcp_writes_refused`, `mcp_errors_total`) |
| Migration | `013_v14_bridge.sql`: `ALTER TABLE kevin_injections ADD COLUMN channel TEXT NOT NULL DEFAULT 'plugin'` + metric seeds |
| Tasks | 21 (`K14-001` … `K14-021`) |

**Exit criterion.** Five statements:

1. **Cross-harness recall works.** Fact created in an opencode session is recalled from
   Claude Code (or Cursor) in the same repo via stdio config, with confidence and
   provenance visible in the tool response.
2. **Writes are impossible unless double-gated.** With defaults, every mutating MCP tool
   returns `{error:"disabled"}`; enabling requires BOTH the setting flip AND (for
   approve/share) the pre-existing approval flags.
3. **Concurrency holds.** Plugin (writer) + server (reader/writer) against one DB file:
   a stress suite with interleaved operations completes without corruption, deadlock or
   data loss; busy_timeout observable in pragmas.
4. **Local-first absolute.** Server opens zero TCP sockets, spawns zero processes;
   asserted by scan + runtime probe test.
5. **Launch kit shipped.** Demo script executed end-to-end once and recorded; six
   harness recipes published; kevin-mcp installable and functional on a machine WITHOUT
   opencode.

---

## 2. Philosophy — "Bridge"

The brain leaves the host without leaving the disk. Read is generous, write is paranoid,
identity is inherited from the same resolution chain the plugin uses, and everything the
server does lands in the SAME ledger so cross-channel utility becomes measurable (T7).

---

## 3. Principles (48–50)

| # | Principle |
|---|---|
| **48** | **stdio or nothing.** A local memory server that opens ports is a different product with a different threat model. |
| **49** | **Every channel carries its own ledger.** Untracked distribution is unmeasurable, therefore unimprovable. |
| **50** | **Conservative defaults across trust boundaries.** Another host's agent is a guest: read yes, write ask (settings), approve never-by-default. |

---

## 4. Component design

### 4.1 Identity & scoping — `packages/mcp/src/identity.ts`

Resolution order (D14-02): CLI/env `KEVIN_REPO` (declared hex-16) → setting
`mcp_repo_override` (if non-empty) → `RepoIdentity.resolve(env.projectRoot)`. Guard:
when override/declared id ≠ resolved id → operations scoped to the DECLARED id are still
allowed for reads? NO — refuse with `{error:"repo_mismatch", resolved, requested}` for
ALL tools except `status` (which reports both). Rationale: silent cross-project reads
are exactly the leak RepoIdentity exists to prevent.

### 4.2 Tool surface

Read (always): `query{query,type?,limit?}` · `get{id}` · `recall{query?,limit?,scope?}` ·
`why{query}` · `status{}` · `trace{query}` (dry-run) · `feedback{id,verdict}`.

Gated writes: `save{type,content,scope,…}` requires `mcp_write_enabled==='1'`;
`approve{proposalId}` / `share{ids}` require additionally `share_requires_approval`
chain unchanged AND `mcp_approve_enabled==='1'`. Disabled responses are structured,
never throws.

Every tool response embeds provenance block: `{repo_id, identity_source, channel:"mcp",
confidence?, evidence_count?}` where applicable.

`recall` additionally LEDGERS the delivery (D14-04): one `kevin_injections` row per
served memory with `hook='pull_mcp'`, `channel='mcp'`, estimated tokens — this is what
makes §5.5's comparative report possible.

### 4.3 Ledger channel column — migration `013_v14_bridge.sql`

```sql
ALTER TABLE kevin_injections ADD COLUMN channel TEXT NOT NULL DEFAULT 'plugin';
-- five metric seeds (see summary table)
INSERT INTO schema_version (version) VALUES ('013');
```

Core `InjectionLedger.record` gains optional `channel?: Channel = "plugin"`. ContextInjector passes nothing (default). MCP path passes `"mcp"`. CHECK constraint avoided
(open set per forward-only policy; validation at writers).

### 4.4 Concurrency — Store hardening

Core `Store` constructor adds `PRAGMA busy_timeout = 5000` after WAL. Stress suite:
two Stores on one file, writer loop (save/archive) × reader loop (query/recall)
interleaved N=500 ops each; assert zero exceptions beyond SQLITE_BUSY (which timeout
prevents), final counts consistent, WAL checkpoint clean.

### 4.5 Perf scopes — `perf-mcp.ts`

Scopes `mcp.read` (p95 25 ms / max 100 ms), `mcp.write` (50/250). Ring buffer reused
from core Perf; flush strategy: every 100 requests OR SIGINT handler writing to
`perf_samples` (machine-scoped like existing). `bench:check` treats absent scopes as
pass-with-notice (server may not have run on CI DB).

### 4.6 Server assembly — `server.ts`

Stdio transport ONLY. Boot sequence: parse args/env → open Store (create dirs as
plugin does) → Migrate.run → settings load → identity resolve → register tools → log
one stderr line `kevin-mcp ready repo=<hex16> mode=<ro|rw>` (stderr allowed; stdout is
protocol). Shutdown: SIGINT/SIGINT-alikes → perf flush → store.close.

### 4.7 Launch kit

- `docs/demo-cross-harness.md`: numbered 10-minute script (opencode create fact →
  Claude Code config snippet → recall → screenshot points marked ▶).
- `docs/harnesses/{claude-code,codex,cursor,windsurf,gemini-cli,opencode}.md`: exact
  JSON/TOML blocks per harness, tested against the demo.
- npm publish checklist item in DISTRIBUTION.md (core→plugin→mcp ordering note).

---

## 5. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D14-01** | New package `@jmtrin/kevin-mcp`; SDK dependency lives ONLY there | Keeps plugin's 1-dep promise intact (C-06 adjacent); supply-chain blast radius contained |
| **D14-02** | Identity chain: env/CLI declared → setting override → resolve; mismatch refuses all but `status` | Prevents cross-project leakage; status transparency aids debugging |
| **D14-03** | Writes double-gated; approvals additionally gated; refusals structured | Principle 50; audit trail via mcp_writes_refused |
| **D14-04** | `recall` writes ledger rows (hook=`pull_mcp`, channel=`mcp`) | Makes pull-channel utility measurable with existing settle() machinery |
| **D14-05** | No CHECK on channel column; writer-side union type | Forward-only friendliness; CHECK would need rebuild to extend |
| **D14-06** | busy_timeout in CORE Store (not mcp-local subclass) | Any multi-process future benefits; single place to test |
| **D14-07** | Server never migrates DOWN-compatible assumptions: runs full Migrate.run at boot like plugin | One code path; first-run on old DB upgrades transparently |
| **D14-08** | Demo/recipes are release-blocking docs, not afterthoughts | Exit criterion #5 enforces distribution workstream (T8) |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| SDK churn (stateless spec young) | Pin exact SDK version; conformance limited to stdio basics used; upgrade task template in DISTRIBUTION |
| Two writers corrupt shared file | WAL + busy_timeout + stress suite; single-writer discipline documented though SQLite arbitrates |
| Agent abuse of write tools once enabled | Defaults off; feedback loop applies; refused-counter surfaces anomalies in audit |
| Recipes drift per harness versions | Each recipe carries tested-on version header; community PR path noted |

---

## 7. Out of scope

HTTP/SSE transports; remote/multi-user auth; observation of non-opencode hosts (hooks);
embedding anything cloud; contract v2 freezing of MCP names (recorded as candidate
C-11 list instead); OKF v3.

---

## 8. Task breakdown

See `docs/Kevin_v1.4.0_Task.md` — 21 tasks, phases F0 Spike/Substrate → F1 Identity →
F2 Read tools → F3 Gated writes → F4 Concurrency/Perf → F5 Launch kit → F6 Release.

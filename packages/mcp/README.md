<div align="center">

# ⚡ Kevin MCP — Bridge

```
╔══════════════════════════════════════════════╗
║        @jmtrin/kevin-mcp  1.4.0              ║
║        MCP Bridge for Kevin                  ║
║        stdio · zero network · WAL            ║
╚══════════════════════════════════════════════╝
```

### Same SQLite, every harness — Kevin via Model Context Protocol

**Kevin MCP exposes the local `kevin.db` to Claude Code, Codex, Cursor, Windsurf, Gemini CLI and Opencode through one stdio server.**

![version](https://img.shields.io/badge/version-1.4.0-blue)
![node](https://img.shields.io/badge/node-%E2%89%A522.5-green)
![mcp](https://img.shields.io/badge/MCP-1.30.0-purple)
![transport](https://img.shields.io/badge/transport-stdio-black)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

> **No new database. No HTTP. One WAL file, two processes.**

---

## 📖 Contents

- [Why a Bridge](#-why-a-bridge)
- [Quick start](#-quick-start)
- [Tools (11)](#-tools-11)
- [Reads vs writes — gates](#-reads-vs-writes--gates)
- [Identity & repo scope](#-identity--repo-scope)
- [Provenance](#-provenance)
- [Harnesses](#-harnesses)
- [Architecture](#-architecture)
- [Configuration](#%EF%B8%8F-configuration)
- [Latency budgets](#-latency-budgets)
- [Development](#-development)
- [License](#-license)

---

## 🤔 Why a Bridge

OpenCode plugin memory is excellent inside OpenCode. The bridge makes that same ranked recall available to **any MCP host** without a second sync, a server, or a cloud hop.

| Before | After |
|---|---|
| `kevin.db` only reachable from plugin | `kevin.db` shared via WAL + `busy_timeout=5000` |
| one host | 6 harnesses (Claude Code / Codex / Cursor / Windsurf / Gemini CLI / Opencode) |

---

## 🚀 Quick start

```bash
npx -y @jmtrin/kevin-mcp           # ro by default, stderr ready line
npx -y @jmtrin/kevin-mcp --repo 2114ad162af50a25  # pinned repo_id
npx -y @jmtrin/kevin-mcp --help
```

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "kevin-mcp": { "command": "npx", "args": ["-y", "@jmtrin/kevin-mcp"] }
  }
}
```

### Codex / Cursor / Windsurf / Gemini CLI

See `docs/harnesses/{codex,cursor,windsurf,gemini-cli,opencode}.md` for exact JSON/TOML snippets, verification (`npx @jmtrin/kevin-mcp --version`), troubleshooting and uninstall.

### How to verify inside a host

```
what does Kevin remember about <topic>?
→ recall returns results + provenance {repo_id, identity_source, channel:"mcp"}
```

---

## 🧰 Tools (11)

<details open>
<summary><b>Always-on reads (7) + ping</b></summary>

| Tool | What it does | Ledger |
|---|---|---|
| `ping` | Liveness probe | — |
| `query` | Slim search | — |
| `get` | Fetch one memory | — |
| `recall` | Ranked recall (BM25 × origin × recency → token budget) | `channel='mcp'` injection row, tokens `ceil(chars/4)` |
| `why` | Failure→fix trace via `kevinWhy` | — |
| `status` | `{repo_id, resolved_repo_id, requested_repo_id, gates, counters{requests,reads,writes_accepted/refused}, perf}` | — |
| `trace` | Dry-run injection preview, zero side effects | — |
| `feedback` | Rate a memory `useful/wrong/outdated/ignore` | — |

Every read returns `provenance: {repo_id, identity_source, channel:"mcp"}` plus confidence/evidence when the underlying row carries them.

</details>

<details>
<summary><b>Gated writes (3) — disabled by default</b></summary>

| Tool | Gate | On refuse |
|---|---|---|
| `save` | `mcp_write_enabled==='1'` | `{error:"disabled", hint:"set mcp_write_enabled=1"}` + `mcp_writes_refused++` |
| `approve` | `mcp_write_enabled==='1'` **and** `mcp_approve_enabled==='1'` | same (`disabled`) |
| `share` | double-gate as `approve` (and existing `share_requires_approval` chain) | `disabled` → `missing_approval_chain` → `executed` |

On success `mcp_writes_accepted++`. All writes are repo-scoped and funnel through core's single write path.

</details>

---

## 🔐 Identity & repo scope

Repository identity resolves **once** at server init, in order:

`--repo <id>` (`KEVIN_REPO`) → `kevin_settings.mcp_repo_override` (`setting:mcp_repo_override`) → `RepoIdentity.resolve` (declared → remote hash → path).

Every tool carries an optional `repo_id` arg; mismatch returns:

```json
{ "error": "repo_mismatch", "expected": "<server repo_id>", "got": "<caller repo_id>" }
```

Declared ids must be 16-char lowercase hex (`/^[0-9a-f]{16}$/`).

---

## 🧾 Provenance

```json
{
  "provenance": {
    "repo_id": "2114ad162af50a25",
    "identity_source": "setting:mcp_repo_override",
    "channel": "mcp"
  }
}
```

When the memory row has confidence/evidence, those fields surface as `confidence`, `evidence_count`, `last_verified_at`.

---

## 🔌 Harnesses

| Harness | Recipe | Tested-on |
|---|---|---|
| Claude Code | `docs/harnesses/claude-code.md` | claude-code v1.0.0 |
| Codex | `docs/harnesses/codex.md` | codex v0.5.0 |
| Cursor | `docs/harnesses/cursor.md` | cursor v1.2.0 |
| Windsurf | `docs/harnesses/windsurf.md` | windsurf v1.0 |
| Gemini CLI | `docs/harnesses/gemini-cli.md` | gemini-cli v0.4.0 |
| Opencode | `docs/harnesses/opencode.md` | opencode v1.18.0 |

Each recipe is a tested JSON/TOML block (parsed by `tests/unit/docs_config_lint.test.ts`), verification command, troubleshooting and uninstall note. Demo: `docs/demo-cross-harness.md` (10-min `▶` script: opencode `save` → Claude Code `recall`).

---

## ⚙️ Architecture

```
plugin (opencode) ─┐
                   ├─► kevin.db (WAL, busy_timeout=5000) ◄─ kevin-mcp (stdio, SDK 1.30.0)
MCP host (any) ────┘        │   ▲                       │
                            │   └─ kevin_audit mcp block ─┘
                            └── perf_samples (mcp.read/write)
```

- **Zero network** — forbidden list enforced: `node:http/https/net/dgram, fetch, XMLHttpRequest, SSETransport, HttpTransport, child_process/spawn`; only `node:fs/path/os/sqlite`.
- **Logs on stderr only** — `stderr ready repo=... mode=ro|rw db=...`; stdout is MCP JSON only.
- **Lifecycle** — `resolveEnv → Store(busy_timeout) → Migrate(013) → Metrics+Perf → registry`; SIGINT/SIGTERM flush metrics + perf (every 100 req or signal).

Package layout:

```
src/server.ts       lifecycle, registry, ready line, signals
src/identity.ts     resolution + mismatch guard
src/tools/read.ts   7 reads + ping + provenance helper
src/tools/write.ts  3 gated writes
src/provenance.ts   block builder
src/perf-mcp.ts     mcp.read/write budgets wrapper
```

---

## ⚙️ Configuration

Text settings via `kevin_config` (compare `=== "1"`):

| Key | Default | Purpose |
|---|---|---|
| `mcp_write_enabled` | `'0'` | Gate for MCP `save` |
| `mcp_approve_enabled` | `'0'` | Double-gate for MCP `approve`/`share` |
| `mcp_repo_override` | `''` | Override RepoIdentity (hex-16) |

Plus the 32 core/plugin keys (`C-04` since `1.4.0` → golden 35 settings). `kevin_audit` block `mcp` appears only on schema `013`+; pre-013 omitted (`partial:true`). Channel split counters in `kevin_metrics` + `kevin_injections.channel`.

---

## ⏱️ Latency budgets

| Scope | p95 | max |
|---|---|---|
| `mcp.read` | 25 ms | 100 ms |
| `mcp.write` | 50 ms | 250 ms |

Measured on reference laptop: recall p50 ≈ 0.2ms. Persists to `perf_samples` every 100 requests or SIGINT; `bench:check` enforces.

---

## 🛠️ Development

```bash
npm install -w @jmtrin/kevin-mcp
npm run build -w @jmtrin/kevin-mcp
npm run typecheck -w @jmtrin/kevin-mcp
npx vitest run packages/mcp/tests/purity_scan.test.ts
npm pack --dry-run -w @jmtrin/kevin-mcp
# boot smoke (no stdout, stderr ready):
node packages/mcp/dist/server.js --help
```

Monorepo publish order: `core → tui → plugin → mcp` (exact `1.4.0` pin), see `docs/DISTRIBUTION.md`.

---

## 📄 License

MIT — see `LICENSE`. Kevin is built by [jmtrin](https://github.com/jmtrin); bug reports and PRs welcome at the [issue tracker](https://github.com/jmtrin/opencode-kevin/issues).

# Kevin contract — public surface

The obligations below predate this document. Each clause carries a `since` date proving it was depended upon before 1.0.0 was cut. The document records, it does not create.

Every clause has a stability. `frozen` means the clause will not change in 1.x without a 2.0.0. `forward-only` means additions only, never removals or renames.

## Deprecation policy

The following five rules govern every deprecation (§5.4):

1. A deprecated clause or member carries a `deprecated` date and a `replacement` pointer.
2. A deprecated item remains functional for at least one minor after deprecation, and its removal is a 2.0.0.
3. Deprecation is announced in the changelog with the `deprecated` date, the `replacement`, and the earliest removal version.
4. The contract's `deprecated_count` increments on deprecation so tooling can detect it.
5. `kevin_contract` surfaces deprecation state in both `summary` and `full` formats.

---

## C-01 — AGENTS.md marker pair

- **Stability:** frozen
- **Since:** 0.6.0
- **Covers:** `<!-- kevin:begin — curated by opencode-kevin, safe to edit -->` … `<!-- kevin:end -->` and the splice rule that bytes outside the markers are preserved verbatim.
- **Consumer may rely on:** markers are the only bytes Kevin overwrites in `AGENTS.md`; everything outside is untouched.

## C-02 — OKF v2 wire format

- **Stability:** frozen
- **Since:** 0.8.0
- **Covers:** 3 header lines, field order `entry_id type content scope created_at`, `entry_id` derivation via `fnv1a64` over canonical field ordering, `LF` EOL, integers-only, sort by `entry_id` ascending, `MAX_LINE_BYTES = 4096`, `MAX_ENTRIES = 2000`.
- **Consumer may rely on:** byte-identical serialization roundtrip; `entry_id` determinism; entry cap.

## C-03 — Tool names and argument shapes

- **Stability:** frozen
- **Since:** 0.2.0
- **Covers:** the 23 registered tool names (`kevin_save`, `kevin_query`, `kevin_get`, `kevin_recall`, `kevin_status`, `kevin_project`, `kevin_audit`, `kevin_doctor`, `kevin_native`, `kevin_retrospective`, `kevin_why`, `kevin_feedback`, `kevin_trace`, `kevin_export`, `kevin_import`, `kevin_config`, `kevin_facts`, `kevin_conflicts`, `kevin_propose`, `kevin_publish`, `kevin_approve`, `kevin_share`, `kevin_sync`) and their Zod argument shapes via `tool.schema`.
- **Consumer may rely on:** tool names are stable; argument shapes are additive only in 1.x.

## C-04 — Setting keys, types and defaults

- **Stability:** frozen
- **Since:** 0.2.0
- **Covers:** the 31 `kevin_settings` keys and their string-typed defaults.
- **Consumer may rely on:** every listed key is accepted by `kevin_config`; unknown keys error.

## C-05 — Metric key names

- **Stability:** frozen
- **Since:** 0.2.0
- **Covers:** the 51 `kevin_metrics` keys.
- **Consumer may rely on:** counters are monotonic integers; absent keys are zero.

## C-06 — Package entry points

- **Stability:** frozen
- **Since:** 0.1.0
- **Covers:** `name: "@jmtrin/opencode-kevin"`, `main: "dist/plugin/index.js"`, `types: "dist/plugin/index.d.ts"`, `exports` order `["types","import"]`, `engines: ">=22.5.0"`.
- **Consumer may rely on:** `import "@jmtrin/opencode-kevin"` resolves to `dist/plugin/index.js` with types first.

## C-07 — Database schema

- **Stability:** forward-only
- **Since:** 0.1.0
- **Covers:** schema version `011`, migrations are forward-only (`migrations/*.sql` apply in order, never rewritten).
- **Consumer may rely on:** forward-only migrations; `Migrate.run()` idempotent.

## C-08 — Filesystem locations

- **Stability:** frozen
- **Since:** 0.2.0
- **Covers:** `db: "~/.opencode-kevin/kevin.db"`, `refs: "refs/"`, `skills: "skills/"`, `okf: ".kevin/knowledge.okf"`.
- **Consumer may rely on:** these are the only paths Kevin reads/writes outside the project tree (plus `AGENTS.md`).

## C-09 — Behavioural invariants

- **Stability:** frozen
- **Since:** 0.8.0
- **Covers:** zero process spawns, zero network calls, no raw author email written, single write path through `ArtifactWriter.apply()`, and (since 1.0.0) the untrusted-input boundary below.
- **Consumer may rely on:** offline operation; privacy of author email; `AGENTS.md` never written except via `ArtifactWriter`.
## The untrusted-input boundary (since 1.0.0)

Kevin's data flow:

```
attacker-influenced bytes
        |
        v
  tool stdout/stderr        <- a dependency's postinstall banner, a crafted
        |                     compiler error, a test fixture, a fetched file
        v
  ToolCallObserver          <- observed and fingerprinted
        |
        v
  Reflector -> memories     <- promoted to stored knowledge
        |
        +--> ContextInjector --> **the system prompt**      (v0.2.0)
        +--> Curator -> ArtifactWriter --> **AGENTS.md**    (v0.6.0)
        +--> SharedLayer --> **.kevin/knowledge.okf** -> git -> **teammates**
                                                            (v0.8.0)
```

Every arrow after `memories` was added by a later release for an unrelated reason — merge semantics, write atomicity, injection recall — and each one lengthened the reach of a byte Kevin never chose to trust. Neither the v0.6.0 arrow (attacker-influenced text into a file the user's other tools read) nor the v0.8.0 arrow (into git history and onto other people's machines) was treated as a security boundary at the time.

The boundary, frozen as part of C-09 in three rules:

1. **Stored is not trusted.** A memory derived from tool output carries its provenance. Kevin distinguishes `origin` values; anything reaching an artifact or a prompt is escaped according to its container, not according to where it came from.
2. **Escaping happens once, at the single write path.** `plugin/escape.ts` provides one pure, total, idempotent function per container — `escapeForMarkerBlock` (the marker pair itself, comment terminators), `escapeForFence` (fenced-code delimiters), `escapeForOkfLine` (any byte that would terminate an OKF v2 line). They are applied only inside `ArtifactWriter`; a second call site would reopen the audit D6-01 closed.
3. **Sharing requires curation, and curation requires a human.** `kevin_share` routes through `share_requires_approval` and `SharedLayer.applyExport()` has exactly one call site; a memory reaches git only via a human-approved proposal.

A frozen invariant whose rationale lives only in a plan document is one refactor away from being deleted as dead code — which is why the threat model lives here, beside the clause that freezes it.

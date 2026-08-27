# Opencode-kevin — Implementation Plan v1.1.0

**Version:** 1.1.0
**Date:** 2026-08-25
**Status:** Ready for implementation
**Paradigm:** Observe → Verify → Learn → Prove → Publish → Share → Attach → Guarantee → **Protect**
**Codename:** "Drift"
**Type:** Implementation plan
**Author:** ox-alpha

**Inputs:**

- `docs/Kevin_Roadmap_v2.md` §5.1 — the release definition this plan implements.
- `plugin/MemoryService.ts`, `plugin/InjectionLedger.ts`, `plugin/ToolCallObserver.ts`,
  `plugin/CausalChain.ts` — timestamp producers and consumers (second granularity today).
- `plugin/SharedLayer.ts` — `planTombstone()` / `applyExport()` exist with **zero production
  call sites** (the BUG-005 finding); this release gives them their tool.
- `bench/results/2026-08-21-adecbdf4c7af82e2.json` — the single committed benchmark result;
  regression comparison needs ≥2 points, which this release creates.
- `plugin/query-tokenizer.ts:8`, `plugin/ConflictDetector.ts:62`, `plugin/Materializer.ts:57`
  — three divergent STOP_WORDS lists (audit finding).
- `plugin/MemoryService.ts:1652` vs `plugin/InjectionLedger.ts:356` — duplicated
  `readOriginCallId` implementations.
- `plugin/ConflictDetector.ts:228-230` — raw-SQL rows cast to `Memory` bypassing `mapRow`.
- Eight WeakMap column-probe caches (`MemoryService.ts:337/356/374/394/413/582`,
  `Archiver.ts:91`, `Feedback.ts:60`, `kevin_why.ts:10`) — consolidated here.
- Repository public metadata captured 2026-08-25: no `LICENSE` file detectable by GitHub,
  empty homepage, zero published GitHub Releases (roadmap §1.4).
- `docs/Kevin_Roadmap.md` §5.7 / `docs/Kevin_v1.0.0_Plan.md` §10 — continuous benchmark
  tracking was explicitly assigned to 1.1.0.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Drift" |
| Paradigm shift | Kevin starts defending its proven numbers instead of assuming them |
| New files | `migrations/012_v11_drift.sql`, `plugin/columns.ts`, `plugin/kevin_forget.ts`, `scripts/bench-regress.ts`, `tests/unit/repo_hygiene.test.ts`, `docs/DISTRIBUTION.md` |
| Modified files | `plugin/index.ts`, `plugin/ToolCallObserver.ts`, `plugin/InjectionLedger.ts`, `plugin/CausalChain.ts`, `plugin/MemoryService.ts`, `plugin/ConflictDetector.ts`, `plugin/HookLiveness.ts`, `plugin/Migrate.ts`, `plugin/query-tokenizer.ts`, `plugin/contract.ts`, `scripts/bench.ts`, `package.json`, `README.md`, `CHANGELOG.md` |
| Dependency change | **None** (runtime stays at 1) |
| Tools | 25 → **26** (`kevin_forget`) |
| Settings keys | 31 → **31** (none — thresholds are constants, D11-03) |
| Metric keys | 51 → **54** (+`bench_regression_failures`, `forget_requests_total`, `forget_tombstones_published`) |
| Migration | `012_v11_drift.sql` (additive: `_ms` columns + backfill + 3 metric seeds) |
| Tasks | 22 (`K11-001` … `K11-022`) |
| Process spawns / network | 0 / 0 (unchanged, asserted) |

**Exit criterion.** Five falsifiable statements:

1. **Regression defense works.** `npm run bench && npm run bench:regress` exits 0 on the
   committed corpus; artificially degrading the retrieval score by more than the threshold
   makes `bench:regress` exit non-zero (proven by a test feeding synthetic result pairs to
   the comparator).
2. **The sharing lifecycle closes.** `kevin_forget` with no `confirm` mutates nothing and
   returns a plan; with `confirm: true` it archives locally and — when the shared layer is
   enabled — publishes tombstones through the existing `applyExport` funnel. Two runs with
   identical inputs: the second reports noop counts.
3. **Time has milliseconds where decisions need them.** After `Migrate.run()` twice on any
   1.0.x database, `tool_calls.ts_ms` and `kevin_injections.injected_at_ms` are populated,
   old columns are untouched, and `settle()` outcomes on fixtures differing by <1 s are
   now distinguishable.
4. **The debt list is closed.** One STOP_WORDS source; one `readOriginCallId`;
   `ConflictDetector` maps rows through `mapRow`; column probes resolve through one
   registry; every one of the 31 settings has a named on-path test.
5. **Public hygiene is verifiable offline.** A committed test asserts `LICENSE` exists,
   `homepage` is non-empty, the newest CHANGELOG entry matches `KEVIN_VERSION`, and a
   `GitHub Release` checklist exists in `docs/DISTRIBUTION.md`.

---

## 2. Philosophy — "Drift"

### 2.1 What carries over

Everything. This release adds no product capability except the one tool the lifecycle was
missing (`kevin_forget`). The injection pipeline, ranking, curation, sharing, contract and
perf instruments of v1.0.0 are touched only where the audit found duplication or drift.

### 2.2 What changes

```
before:  benchmark published once ──▶ assumed still true
after:   bench:regress gate ──▶ CI fails when truth drifts

before:  share ▶ (tombstone impossible) ─▶ dead entries live forever in git
after:   share ▶ kevin_forget ▶ tombstone ▶ teammates converge on removals

before:  timestamps at 1 s ─▶ settle() cannot order near-simultaneous events
after:   _ms columns ─▶ sub-second causality is decidable
```

---

## 3. Principles (39–41)

| # | Principle |
|---|---|
| **39** | **A published number without a regression gate is marketing.** Every measurement Kevin ships gets a checker that can fail. |
| **40** | **Public trust signals are engineering surface.** LICENSE, releases and demos are asserted like tests, not left to goodwill. |
| **41** | **Known defects block new surface.** Debt with a written diagnosis (BUG-005, timestamp granularity, probe sprawl) is paid before any capability lands. |

---

## 4. Schema delta — `migrations/012_v11_drift.sql`

Additive only. Runs inside the existing single-transaction runner; idempotency comes from
`schema_version`, so the acceptance test always runs `Migrate.run()` twice.

```sql
-- millisecond companions for the two tables whose ORDERING decides outcomes.
ALTER TABLE tool_calls       ADD COLUMN ts_ms           INTEGER;
ALTER TABLE kevin_injections ADD COLUMN injected_at_ms  INTEGER;

-- conservative backfill: seconds -> ms (x1000). Rows keep their original
-- second-granularity value in the old column; nothing is rewritten there.
UPDATE tool_calls SET ts_ms =
  CAST(strftime('%s', ts) AS INTEGER) * 1000
WHERE ts_ms IS NULL AND ts IS NOT NULL;

UPDATE kevin_injections SET injected_at_ms =
  CAST(strftime('%s', injected_at) AS INTEGER) * 1000
WHERE injected_at_ms IS NULL AND injected_at IS NOT NULL;

CREATE INDEX idx_tool_calls_ts_ms        ON tool_calls(ts_ms);
CREATE INDEX idx_injections_injected_ms  ON kevin_injections(injected_at_ms);

-- metric seeds (C-05 additions carry since=1.1.0 in contract)
INSERT INTO kevin_metrics (key, value, updated_at) VALUES
  ('bench_regression_failures',    0, datetime('now')),
  ('forget_requests_total',        0, datetime('now')),
  ('forget_tombstones_published',  0, datetime('now'));

INSERT INTO schema_version (version) VALUES ('012');
```

Dual-write rule (D11-01): writers populate **both** columns from v1.1.0 onward; readers
prefer `_ms` and fall back to the legacy column when NULL. Legacy columns are never
dropped (C-07 forward-only).

---

## 5. Component design

### 5.1 `kevin_forget` (tool #26)

New `plugin/kevin_forget.ts` exposing `handleForget(input, deps)`:

```ts
interface ForgetInput {
  ids: string[];          // memory ids to retire
  confirm?: boolean;      // absent/false => dry run
}
interface Deps {
  store: Store; memoryService: MemoryService;
  sharedLayer: SharedLayer;            // the init-built bridge (repo_id-scoped)
  okfPath: string;                     // join(projectRoot, okf_path setting)
  metrics: Metrics;
}
interface ForgetResult {
  action: "forget"; ok: boolean; dry_run: boolean;
  per_id: Array<{ id: string; archived: boolean; reason?: string;
                  tombstone?: { entry_id: string; planned: boolean; applied: boolean } }>;
  noop?: boolean;                      // identical repeat run
}
```

Ordering per id: (1) archive locally — `status='archived'`, `archived_at=now`
(reusing the Archiver transition semantics); (2) if the memory projects to the shared
layer (`layer='shared'` link or curated-and-shared), compute `entry_id` via the OKF codec
and call `sharedLayer.planTombstone(...)`; (3) with `confirm`, `applyExport`. Idempotence:
re-running yields `archived:false (already)` + tombstone noop, mirroring ArtifactWriter
noop counting. The write path stays singular: tombstones reach disk only through
`SharedLayer.applyExport` (extends D8-08; D11-02).

Registration in `index.ts` follows the existing `tool({...})` pattern between
`kevin_publish` and `kevin_audit`. Contract C-03 gains the name with `since: "1.1.0"`;
golden file updated in the same commit.

### 5.2 Millisecond plumbing

- `ToolCallObserver.onAfter`: write `ts_ms = Date.now()` when the column probe confirms
  existence (probe via the new registry, §5.3).
- `InjectionLedger.record`: same for `injected_at_ms`.
- `settle()`: pairwise comparisons use `COALESCE(injected_at_ms, injected_at_epoch)`
  semantics — implemented as: fetch both columns, prefer `_ms`, convert legacy seconds to
  ms on the fly when needed. Outcome classification logic itself is unchanged.
- `CausalChain.onSuccess/onSessionIdle`: the ≤24 h window comparison switches to ms when
  either side has `_ms`.

### 5.3 Column-probe registry

New `plugin/columns.ts`:

```ts
export function hasColumn(store: Store, table: string, column: string): boolean
// caches per (store, table, column) in a WeakMap<Store, Map<string, boolean>>;
// implementation: SELECT ... LIMIT 0 wrapped in try/catch, identical to today's probes.
```

Existing helpers (`hasIgnoredColumn`, `hasCuratedColumn`, `hasTruthColumns`,
`hasRepoIdColumn`, `hasLayerColumn`, `hasRecurrenceColumn`, Archiver's and Feedback's
probes, kevin_why's) delegate to the registry. Exported names survive so call sites and
tests do not churn.

### 5.4 Benchmark regression gate

`scripts/bench-regress.ts`:

```ts
export interface BenchPoint { arm: string; precision_at_k: number; recall_at_k: number; mrr: number; }
export function compareResults(prev: BenchPoint[], curr: BenchPoint[],
  t = {p: 0.02, r: 0.05, mrr: 0.05}): { ok: boolean; failures: string[] }
// For arm "kevin": drop = prev - curr; fail when drop > threshold on any metric.
// Other arms are informational (recorded, never gating).
```

CLI form loads the two most recent `bench/results/*.json` (sorted by filename date
prefix), prints a table, exits 1 on failure, increments `bench_regression_failures` via a
direct store upsert when the DB is reachable (best-effort; the gate never depends on the
DB). Thresholds are module constants (D11-03). `package.json` gains
`"bench:regress": "tsx scripts/bench-regress.ts"`.

### 5.5 Debt consolidation (behavior-parity mandated)

1. STOP_WORDS: `query-tokenizer.ts` becomes the single source, exporting the **union** of
   the three current lists (sorted, deduped). ConflictDetector/Materializer import it.
   Parity proof: full suite + replay pass unmodified (tokenization differences would show
   in deriveQuery outputs covered by tests).
2. `readOriginCallId`: keep the MemoryService implementation, `export` it, delete the
   InjectionLedger copy, import from MemoryService.
3. `ConflictDetector.repoTruthInputs`: route rows through `mapRow` (exported from
   MemoryService for this purpose) before use; delete the `as unknown as Memory` cast.
4. HookLiveness: document maximum supported arity (2) in the wrapper; add a defensive
   `args.slice(0, 2)` with a debug counter when excess arity appears.
5. Migrate: comment documenting lexicographic ordering validity to `"999"` plus a unit
   test asserting `parseNextVersion > parseCurrent` numerically for the current chain.

### 5.6 Public hygiene (offline-verifiable subset)

`tests/unit/repo_hygiene.test.ts` asserts: root `LICENSE` exists and contains `MIT`;
`package.json.homepage` is a non-empty https URL; the newest `CHANGELOG.md` heading
contains `KEVIN_VERSION`. GitHub-side actions (creating Releases, Discussions, GIF, list
PRs) cannot be asserted offline — they live as a numbered checklist in
`docs/DISTRIBUTION.md` (D11-04), each item with owner + evidence URL placeholder.
`scripts/release-notes.mjs` prints the current CHANGELOG section to stdout for pasting
into `gh release create`.

---

## 6. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D11-01** | `_ms` columns are additive companions; legacy second-granularity columns persist forever and are never rewritten | C-07 forward-only; old readers keep working; backfill is approximate and labeled as such |
| **D11-02** | Tombstones flow only through `SharedLayer.planTombstone → applyExport`, invoked solely from `kevin_forget` | Extends the single-write-path doctrine (D8-08) to deletions; deletions deserve stricter gating than writes |
| **D11-03** | Regression thresholds are module constants, never settings | D10-10 heritage: a budget the user can raise is not a budget |
| **D11-04** | Hygiene CI asserts only offline-checkable facts; GitHub-side actions live in `docs/DISTRIBUTION.md` as a human checklist | CI cannot (and must not) hold network tokens to query GitHub APIs |
| **D11-05** | STOP_WORDS unify to the union of the three lists | Removing words risks behavioral change; adding is provably parity-safe under the existing suite |
| **D11-06** | Column probes centralize behind `columns.ts`; exported helper names preserved | Kills eight divergent caches without churning call sites |
| **D11-07** | Readers prefer `_ms`, fall back to legacy columns | Mixed-version databases are legal forever under C-07 |
| **D11-08** | No new settings in 1.1.0 | Nothing here is user-tunable by design |
| **D11-09** | Flag audit outcome lands in the contract golden only if a deprecation is warranted | Avoids noise; mechanism exists (CONTRACT §5.4) if needed |
| **D11-10** | `bench:regress` reads committed results only and never mutates the corpus or arms | Tuning experiments to pass is measurement fraud (D10-13 heritage) |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Backfill multiplies seconds imprecisely for sub-second events | Documented approximation; only affects historical rows; new rows are true ms |
| `kevin_forget` deletes something a teammate still needs | Dry-run default; archive (not delete) locally; tombstones archive-by-design in OKF; confirm token required |
| STOP_WORDS union shifts a ranking test | Union-only rule + immediate suite feedback; any red test stops the task for escalation |
| Registry refactor misses a probe | Grep acceptance enumerates remaining direct `WeakMap` probes = 0 |

---

## 8. Out of scope

Embeddings; semantic search; TUI (next release); MCP; skills emission; MIF; any new
setting; any change to markers, OKF wire format, or tool argument shapes (additions only);
touching `error_lesson_mode` defaults.

---

## 9. Task breakdown

See `docs/Kevin_v1.1.0_Task.md` — 22 tasks, phases F0 Substrate → F1 Forget → F2
Regression gate → F3 Debt → F4 Hygiene → F5 Release.

# Opencode-kevin — Task Breakdown v1.1.0 "Drift"

**Version:** 1.1.0
**Date:** 2026-08-25
**Status:** Ready for implementation
**Dependency:** v1.0.0 "Proven" complete (`K10-001` … `K10-028`)
**ID Convention:** `K11-XXX` ("Drift") · Decisions referenced as `D11-NN` (plan §6)
**Total tasks:** 22
**Author:** ox-alpha

---

## Status Legend

| Marker | Meaning |
|---|---|
| `[ ]` | Pending — not started |
| `[~]` | In progress |
| `[P]` | Paused — started, set aside deliberately |
| `[!]` | Blocked — cannot proceed, reason recorded in Status notes |
| `[X]` | Done — acceptance criteria met and verification command passes |

```markdown
### K11-001 — Title

**Status:** `[ ]` Pending
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K11-001 | F0 | Migration `012_v11_drift.sql` | P0 | S | `[X]` |
| K11-002 | F0 | `ToolCallObserver` writes `ts_ms` | P0 | S | `[X]` |
| K11-003 | F0 | `InjectionLedger` writes `injected_at_ms`; `settle()` prefers ms | P0 | M | `[X]` |
| K11-004 | F0 | `CausalChain` window goes ms-aware | P1 | S | `[X]` |
| K11-005 | F1 | `kevin_forget.ts` — dry-run planner | P0 | M | `[X]` |
| K11-006 | F1 | `kevin_forget.ts` — apply, tombstones, metrics | P0 | M | `[X]` |
| K11-007 | F1 | Register tool #26; contract C-03 + golden update | P0 | S | `[X]` |
| K11-008 | F2 | `compareResults()` comparator (pure) | P0 | S | `[X]` |
| K11-009 | F2 | `scripts/bench-regress.ts` + `bench:regress` script | P0 | M | `[X]` |
| K11-010 | F2 | Induced-regression self-defense test | P0 | S | `[X]` |
| K11-011 | F3 | `plugin/columns.ts` probe registry refactor | P1 | M | `[X]` |
| K11-012 | F3 | STOP_WORDS unified to one source | P1 | S | `[X]` |
| K11-013 | F3 | `readOriginCallId` deduplicated | P2 | S | `[X]` |
| K11-014 | F3 | `ConflictDetector` routes rows through `mapRow` | P1 | S | `[X]` |
| K11-015 | F3 | HookLiveness arity guard + Migrate versioning note/test | P2 | S | `[X]` |
| K11-016 | F4 | Flag audit: 31/31 settings have on-path tests | P1 | M | `[X]` |
| K11-017 | F4 | Repo hygiene test (LICENSE/homepage/CHANGELOG) | P0 | S | `[X]` |
| K11-018 | F4 | `LICENSE`, homepage, `release-notes.mjs` | P0 | S | `[X]` |
| K11-019 | F4 | `docs/DISTRIBUTION.md` checklist + demo GIF slot | P1 | S | `[X]` |
| K11-020 | F5 | README + CHANGELOG + version bump to 1.1.0 | P1 | S | `[X]` |
| K11-021 | F5 | Cross-release consistency pass | P1 | M | `[X]` |
| K11-022 | F5 | Final verification | P0 | M | `[X]` |

**Phase totals:** F0 4 · F1 3 · F2 3 · F3 5 · F4 4 · F5 3 — **22 total**

**Critical path.**

```
K11-001 → K11-002 → K11-003 → K11-005 → K11-006 → K11-007 → K11-009 → K11-010 → K11-018 → K11-022
```

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h. Estimates include tests.

**Dependencies.** Start only when every listed dependency is `[X]`. `(soft)` = useful, not blocking.

**Risk.** 🟢 low · 🟡 affects ranking/lifecycle · 🔴 touches the frozen contract, migrations, or what `npm publish` uploads.

**Verification.** Every task ends with a runnable command; not `[X]` until it passes on a clean checkout.

**Files.** Paths relative to repository root.

**Style.** Strict TS, no `any`. ESM `.js` import suffixes. Comment citations: `// v1.1.0 (K11-0NN / plan §X.Y, D11-NN)`.

**Rules for AI implementers (read first, apply always).**
1. Never edit `tests/fixtures/contract/v1.json` except to ADD entries carrying `since: "1.1.0"`. A diff showing removals or modifications of existing entries is a defect: stop and mark the task `[!]`.
2. Never change an existing test's expectations to make new code pass. If an old test fails, the new code is wrong.
3. Do not refactor anything outside your task's `Files:` list.
4. If a step is ambiguous, choose the interpretation that keeps behavior identical for existing users, and record the choice in Status notes.
5. Finish every session by running `npm run typecheck && npm run lint && npm test`.

**Database access in tests.** Temp-file `Store` only (`os.tmpdir()`), closed in `afterEach`.
Never touch `~/.opencode-kevin/kevin.db`.

**SQLite rules.**
1. `kevin_settings.value` is TEXT: compare with `=== "1"`, never truthiness.
2. `ALTER TABLE ADD COLUMN` is not idempotent — idempotency comes from `schema_version`;
   every migration acceptance runs `Migrate.run()` twice.
3. Numeric settings arrive as TEXT: parse with explicit radix and NaN guard.

**Contract changes.** Any task adding a metric key adds it to `plugin/contract.ts`
(metric-key clause) **and** to the golden file with `since: "1.1.0"` in the same commit.

**Hot path.** `ToolCallObserver` and `InjectionLedger.record` run on hot hooks: the `_ms`
writes are single integer assignments — no allocation, no extra queries, no throws.

---

# Phase F0 — Substrate

Four tasks. Everything later depends on millisecond ordering being real.

### K11-001 — Migration `012_v11_drift.sql`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** none
- **Risk:** 🟡 (schema, but purely additive)
- **Files:** `migrations/012_v11_drift.sql` (new), `tests/unit/migrate_012.test.ts` (new)
- **Description:**
  1. Create the file with EXACTLY the SQL in plan §4 (two ALTER TABLE, two UPDATE backfills,
     two CREATE INDEX, three metric seed INSERTs, one schema_version INSERT).
  2. Do NOT add REFERENCES clauses. Do NOT wrap in BEGIN/COMMIT — the runner does that.
  3. Test: build temp Store, run `new Migrate(store, migrationsDir).run()`, assert:
     (a) `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1` → `'012'`;
     (b) both indexes exist (query `sqlite_master`);
     (c) the three metric keys exist with value 0;
     (d) run `.run()` a SECOND time — no error, no duplicate metric rows.
  4. Backfill correctness test: insert a legacy row into `tool_calls`
     (`ts = '2026-08-25 10:00:00'`), run migrate, assert `ts_ms === 1787661600000`
     (compute expected via `Date.UTC(2026,7,25,10,0,0)*1000` adjusted for the runner's
     local-time semantics — derive the constant from `strftime('%s', ts)` inside the test
     itself instead of hardcoding, so timezone cannot flake).
- **Acceptance criteria:**
  - Both runs succeed; second is a no-op.
  - Legacy row gets a non-null `ts_ms` equal to its seconds × 1000.
  - `npm run typecheck && npm run lint && npm test` green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_012.test.ts`

### K11-002 — `ToolCallObserver` writes `ts_ms`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K11-001
- **Risk:** 🟡 (hot path)
- **Files:** `plugin/ToolCallObserver.ts`, `plugin/columns.ts` (new, minimal version)
- **Description:**
  1. Create `plugin/columns.ts` exporting `hasColumn(store, table, column): boolean` with a
     `WeakMap<Store, Map<string, boolean>>` cache. Implementation mirrors today's probes:
     try `SELECT <column> FROM <table> LIMIT 0`, catch → false, cache result forever.
  2. In `onAfter`, after building the existing INSERT payload: if
     `hasColumn(store,'tool_calls','ts_ms')`, add `ts_ms: Date.now()` to the row.
  3. Zero allocations beyond the integer; no try/catch around the write itself (probe
     already guarantees the column).
- **Acceptance criteria:**
  - New test: post-migration store records a tool call; row has both `ts` (legacy string)
    and integer `ts_ms` within 5 s wall distance of each other.
  - Pre-migration store (stop runner at `'011'` by pointing `migrationsDir` at a fixture
    dir containing only 001–011) still works: column absent → no `ts_ms` written, no throw.
  - Probe caching: calling twice issues ONE pragma/query (spy or counter in test).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tool_calls_ts_ms.test.ts`

### K11-003 — `InjectionLedger` writes `injected_at_ms`; `settle()` prefers ms

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K11-001
- **Risk:** 🟡 (decides injection outcomes)
- **Files:** `plugin/InjectionLedger.ts`, `plugin/MemoryService.ts`
- **Description:**
  1. `record(...)`: when `hasColumn(store,'kevin_injections','injected_at_ms')`, also write
     `injected_at_ms: Date.now()`.
  2. Extract the duplicated helper: keep `MemoryService.readOriginCallId`, add `export`,
     delete the private copy at the top of InjectionLedger and import instead (this is the
     K11-013 dedup done now while touching the file; note it in Status notes).
  3. `settle(sessionId)`: replace every pairwise time comparison between
     `injections.injected_at` and `tool_calls.ts` with a helper
     `toMs(legacyValue: string|null, msValue: number|null): number|null` — returns
     `msValue` when present else `Date.parse(legacyValue.replace(' ', 'T') + 'Z')`
     interpreted consistently with existing behavior. Preserve current outcome order
     exactly (ineffective check first, then linked-fix effective check, then inconclusive).
  4. Add ONE new unit scenario: two events 250 ms apart that previously tied at second
     granularity now classify differently — encode the fixture so the assertion documents
     the improved precision (plan exit #3).
- **Acceptance criteria:**
  - Existing settle() tests pass UNMODIFIED (if any breaks: defect in new code, escalate).
  - New sub-second fixture asserts the previously-impossible classification.
  - Dual-write verified: fresh injection row has both columns populated.
- **Status notes:** includes the readOriginCallId dedup (also satisfies half of K11-013).
- **Verification:** `npx vitest run tests/unit/injection_ledger_settle.test.ts`

### K11-004 — `CausalChain` window goes ms-aware

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** K11-002
- **Risk:** 🟢
- **Files:** `plugin/CausalChain.ts`
- **Description:**
  1. The ≤24 h recency window between failure and candidate fix compares instants: convert
     both sides through the same `toMs` helper (move it to a tiny shared module
     `plugin/time-ms.ts` so Ledger and CausalChain import one implementation).
  2. `MAX_LINK_DISTANCE` (rowid-based) untouched.
- **Acceptance criteria:**
  - Unit test: fix occurring 800 ms after failure links when using `_ms`; same fixture
    with columns nulled falls back to legacy comparison and still links (both paths work).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/causal_chain_ms.test.ts`

---

# Phase F1 — Forget (BUG-005)

### K11-005 — `kevin_forget.ts` — dry-run planner

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K11-003
- **Risk:** 🟡 (lifecycle)
- **Files:** `plugin/kevin_forget.ts` (new), `tests/unit/kevin_forget_plan.test.ts` (new)
- **Description:**
  1. Implement `handleForget(input: ForgetInput, deps: Deps): ForgetResult` exactly per
     plan §5.1 interfaces (copy them verbatim into the file).
  2. Validation: empty `ids` → `{ok:false, reason:'no_ids'}`. Unknown id → per_id entry
     `{archived:false, reason:'not_found'}`, overall ok stays true.
  3. Dry run (`confirm !== true`): for each found id compute would-archive flag and, if the
     memory projects to shared layer, call `deps.sharedLayer.planTombstone(entryId,
     deps.okfPath)` capturing its plan result. Mutate NOTHING. Set `dry_run:true`.
  4. Increment `forget_requests_total` (metrics.incr) on every invocation, including dry
     runs and refusals.
  5. Idempotence data path: detect already-archived ids → entry
     `{archived:false, reason:'already_archived'}` and top-level `noop:true` when nothing
     would change.
- **Acceptance criteria:**
  - Plan mode leaves DB byte-identical (hash the db file before/after in test).
  - Shared-layer projection detected via `layer='shared'` link or `shared_entry_id`;
     memories without projection report `tombstone: undefined`.
  - Unknown-id and empty-ids refusals return structured errors, never throw.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_forget_plan.test.ts`

### K11-006 — `kevin_forget.ts` — apply, tombstones, metrics

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (8h)
- **Dependencies:** K11-005
- **Risk:** 🔴 (first deletion path; touches shared git artifact)
- **Files:** `plugin/kevin_forget.ts`
- **Description:**
  1. Apply mode (`confirm === true`): per id, inside ONE `store.transaction`: set
     `status='archived'`, `archived_at=datetime('now')` (only when currently not archived);
     then for projected ids call `sharedLayer.applyExport(planTombstoneResult)` — the ONLY
     disk-write site, reusing D8-08 funnel.
  2. On successful applyExport increment `forget_tombstones_published` by applied count.
     Noop applies count as noop (no increment), matching ArtifactWriter noop doctrine.
  3. Failure mid-way: transaction rollback restores DB; already-applied OKF write is
     reported honestly in `per_id` (`applied:true`) with top-level `ok:false,
     reason:'partial'` — document in code comment that OKF is append-tolerant by design
     (next sync reconciles).
  4. Escape hatch parity: results embed the SAME refusal reasons SharedLayer uses
     (`repo_mismatch`, `unknown_entry`) rather than inventing new strings.
- **Acceptance criteria:**
  - e2e-style test: seed memory → curate+share (existing helpers) → forget confirm →
    assert (a) memory archived locally, (b) OKF file contains a tombstone op line for the
    entry_id, (c) second identical run reports noop everywhere, (d) counters:
    requests=2, published=1.
  - Rollback test: force applyExport to throw (inject failing writer); DB shows memory
    NOT archived; result `ok:false`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_forget_apply.test.ts`

### K11-007 — Register tool #26; contract C-03 + golden update

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** K11-006
- **Risk:** 🔴 (frozen surface addition)
- **Files:** `plugin/index.ts`, `plugin/contract.ts`, `tests/fixtures/contract/v1.json`
- **Description:**
  1. In index.ts register `kevin_forget: tool({...})` between `kevin_publish` and
     `kevin_audit`. Args schema: `ids` array of strings minItems 1; optional `confirm`
     boolean. Description mirrors kevin_share's tone, mentioning dry-run default.
  2. Handler builds Deps from the closure (store, memoryService, sharedLayer — the live
     variable, okfPath computed like syncSharedLayer does, metrics) and returns JSON.
  3. contract.ts: add tool name to the C-03 list with since `"1.1.0"`; add the three
     metric keys to their clause with since `"1.1.0"`.
  4. Golden file: ADD the corresponding entries with `since:"1.1.0"`. NOTHING else changes.
  5. Update `tool_count` literal in kevin_status output 23→? — NO: kevin_status prints
     `tool_count: 23` historically; v1.0.0 shipped 25 tools with ladder documented in
     comments. Bump the comment chain and the literal to 26 (search for `tool_count`).
- **Acceptance criteria:**
  - Contract suite green (additions recognized via since).
  - `kevin_status` returns tool_count 26 in integration test.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract.test.ts tests/integration/status_tools.test.ts`

---

# Phase F2 — Regression gate

### K11-008 — `compareResults()` comparator (pure)

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** none
- **Risk:** 🟢
- **Files:** `scripts/bench-compare.ts` (new), `tests/unit/bench_compare.test.ts` (new)
- **Description:**
  1. Implement `BenchPoint` and `compareResults(prev, curr, thresholds?)` EXACTLY per plan
     §5.4 signature. Gating arm: `"kevin"` only. Drop = prev − curr; fail strictly greater
     than threshold. Include prev-missing-arm handling: treat missing prev as ok with a
     warning string (first-run case).
  2. Return `{ok, failures: string[]}` where each failure names arm, metric, prev, curr,
   drop, threshold.
- **Acceptance criteria:**
  - Table-driven tests: identical → ok; p drop 0.03 → fail; r drop 0.06 → fail; mrr drop
    0.04 → ok; other arms degraded → still ok (informational).
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/bench_compare.test.ts`

### K11-009 — `scripts/bench-regress.ts` + `bench:regress`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (5h)
- **Dependencies:** K11-008
- **Risk:** 🟡
- **Files:** `scripts/bench-regress.ts` (new), `package.json`
- **Description:**
  1. Script lists `bench/results/*.json`, sorts ascending by filename (date-prefixed),
     takes last two. Fewer than two files → print notice, exit 0 (nothing to compare yet).
  2. Parse each into BenchPoint[] (shape per committed 2026-08-21 result; tolerate unknown
     fields). Call compareResults. Print a fixed-width table: arm, metric, prev, curr, delta.
  3. On failure print failures and exit 1. Best-effort: open repo-default store
     (~/.opencode-kevin/kevin.db ONLY when env `KEVIN_REGRESS_DB=1`) and upsert
     `bench_regression_failures` — never create the DB, never block the gate on DB errors.
  4. package.json scripts: `"bench:regress": "tsx scripts/bench-regress.ts"`.
- **Acceptance criteria:**
  - Running against the two committed fixtures (duplicate current file under a new date
    name for the test) exits 0.
  - Corrupted JSON → clear error, exit 2 (distinct from regression-failure exit 1).
- **Status notes:** —
- **Verification:** `npm run bench && npm run bench:regress; echo $?`

### K11-010 — Induced-regression self-defense test

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K11-009
- **Risk:** 🟢
- **Files:** `tests/unit/bench_regress_gate.test.ts` (new)
- **Description:**
  1. Integration proof of exit criterion #1 WITHOUT touching ranking code: craft synthetic
     prev/curr JSON files in tmpdir where curr degrades P@5 by 0.03 for arm kevin; invoke
     the script's exported `main(argv)` with `--results-dir` override; assert exit code 1
     and failure text mentions `precision@k`.
  2. Second case: healthy pair → exit 0. Third: only one file → exit 0 with notice.
- **Acceptance criteria:** all three cases pass; no network; tmpdir cleaned.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/bench_regress_gate.test.ts`

---

# Phase F3 — Debt

### K11-011 — `plugin/columns.ts` probe registry refactor

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** K11-002 (introduces the module)
- **Risk:** 🟡 (broad but mechanical)
- **Files:** `plugin/columns.ts`, `plugin/MemoryService.ts`, `plugin/Archiver.ts`,
  `plugin/Feedback.ts`, `plugin/kevin_why.ts`
- **Description:**
  1. Extend columns.ts with the named helpers used today
     (`hasIgnoredColumn`, `hasCuratedColumn`, `hasTruthColumns`, `hasRepoIdColumn`,
     `hasLayerColumn`, `hasRecurrenceColumn`, plus Archiver/Feedback/why variants) — each
     delegating to `hasColumn`.
  2. Replace each file's private WeakMap implementation with delegation. Exported function
     names/signatures UNCHANGED.
  3. Delete now-dead WeakMaps.
- **Acceptance criteria:**
  - Grep acceptance: `rg "new WeakMap" plugin/ | rg -v columns.ts` returns zero matches.
  - Full suite green unmodified (probes are behavior-transparent).
- **Status notes:** —
- **Verification:** `npm test`

### K11-012 — STOP_WORDS unified to one source

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** none
- **Risk:** 🟡 (tokenization feeds retrieval)
- **Files:** `plugin/query-tokenizer.ts`, `plugin/ConflictDetector.ts`, `plugin/Materializer.ts`
- **Description:**
  1. Merge the three local stop-word sets into query-tokenizer's export: UNION, lowercased,
     sorted, deduped. Keep the old export name stable; add `export const STOP_WORDS`.
  2. ConflictDetector/Materializer: delete their private sets, import STOP_WORDS.
  3. Union-only rule (D11-05): do NOT remove any word present in ANY of the three lists.
- **Acceptance criteria:**
  - Snapshot test pins the union list (prevents silent future drift).
  - deriveQuery outputs on the existing tokenizer tests unchanged.
  - Replay suite green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/tokenizer.test.ts tests/replay`

### K11-013 — `readOriginCallId` deduplicated

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (1h)
- **Dependencies:** K11-003 (mostly done there)
- **Risk:** 🟢
- **Files:** `plugin/MemoryService.ts`, `plugin/InjectionLedger.ts`
- **Description:** Confirm only ONE implementation remains (MemoryService, exported);
  InjectionLedger imports it. If K11-003 already completed this, this task is verification
  only: grep proves single definition; mark done with note.
- **Acceptance criteria:** `rg "function readOriginCallId" plugin/` → exactly one hit.
- **Status notes:** —
- **Verification:** `rg "function readOriginCallId" plugin/`

### K11-014 — `ConflictDetector` routes rows through `mapRow`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** K11-011
- **Risk:** 🟡
- **Files:** `plugin/MemoryService.ts` (export mapRow), `plugin/ConflictDetector.ts`
- **Description:**
  1. Export `mapRow` from MemoryService.
  2. In `repoTruthInputs` (and the decision_pair query path), map raw rows through
     `mapRow` before use; delete `as unknown as Memory` casts.
  3. Metadata must now arrive as parsed object (mapRow handles JSON.parse) — adapt the two
     consumer lines if they previously JSON.parsed manually.
- **Acceptance criteria:**
  - New unit test seeds a contradicted memory with rich metadata and asserts the conflict
    input carries typed fields (confidence number, metadata object).
  - Existing conflict tests green.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/conflict_detector.test.ts`

### K11-015 — HookLiveness arity guard + Migrate versioning note/test

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (2h)
- **Dependencies:** none
- **Risk:** 🟢
- **Files:** `plugin/HookLiveness.ts`, `plugin/Migrate.ts`, `tests/unit/migrate_ordering.test.ts` (new)
- **Description:**
  1. HookLiveness wrapper: slice args to first 2 before invoking target; when
     `args.length > 2` increment a debug counter exposed on the instance
     (`excessArityCount`) — never log on hot path.
  2. Migrate.listPending: add comment documenting lexicographic validity through `"999"`
     and numeric-prefix requirement. Add test: fixture dir with versions
     `["001_a","002_b","010_c"]` orders correctly; a hypothetical `1000_x` sorts AFTER
     `999_y` lexicographically — assert current behavior explicitly and reference the
     documented limit.
- **Acceptance criteria:** both units green; no behavior change.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_ordering.test.ts tests/unit/hook_liveness.test.ts`

---

# Phase F4 — Hygiene & distribution

### K11-016 — Flag audit: 31/31 settings have on-path tests

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (6h)
- **Dependencies:** none
- **Risk:** 🟢
- **Files:** audit table 31/31 (ver Appendix — Flag Audit), posiblemente tests bajo `tests/unit/settings_paths/`
- **Description:**
  1. Enumerate all 31 keys from KEVIN_CONFIG_KEYS. For EACH key record: enabling test file
     + test name that flips the value and asserts observable behavior difference.
  2. For any key lacking such a test: WRITE the minimal on-path test (set via
     MemoryService.setSetting, exercise the consuming component with a fixture, assert
     behavioral delta).
  3. Produce the audit doc as a 31-row table (key → test → verdict). Any key judged dead
     after inspection gets `deprecated: true, replacement: …` added to contract C-04 entry
     with since `"1.1.0"` + golden update (D11-09) — expected count: 0; record findings.
- **Acceptance criteria:** audit doc committed with 31/31 rows referencing real test names;
  `rg` for each key finds ≥1 test toggle; suite green.
- **Status notes:** —
- **Verification:** `npm test && rg -c "setSetting" tests/unit/settings_paths/`

### K11-017 — Repo hygiene test

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** K11-018 (LICENSE must exist for the assert to pass)
- **Risk:** 🟢
- **Files:** `tests/unit/repo_hygiene.test.ts` (new)
- **Description:** Assert, reading files relative to repo root (walk-up from test dir):
  (a) `LICENSE` exists, first 200 chars contain `MIT`; (b) package.json `homepage`
  matches `^https://`; (c) newest CHANGELOG `## [` heading contains the value of
  `KEVIN_VERSION` imported from plugin/index.ts. Pure offline fs reads.
- **Acceptance criteria:** test red before K11-018 lands (verify once), green after.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_hygiene.test.ts`

### K11-018 — `LICENSE`, homepage, `release-notes.mjs`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (2h)
- **Dependencies:** none
- **Risk:** 🟢
- **Files:** `LICENSE` (new), `package.json`, `scripts/release-notes.mjs` (new)
- **Description:**
  1. Add standard MIT LICENSE text, line `Copyright (c) 2026 jmtrin`.
  2. package.json: set `homepage` to the GitHub repo URL; ensure `repository`/`bugs`
     match (they exist since v1.0.0 — verify).
  3. release-notes.mjs: parse CHANGELOG.md, find section matching `KEVIN_VERSION` from
     dist/plugin/index.js? Simpler: accept version as argv[2] defaulting to package.json
     version; print that section body to stdout; exit 1 if absent.
  4. Document usage inside DISTRIBUTION checklist: `gh release create vX.Y.Z --notes-file <(node scripts/release-notes.mjs)`.
- **Acceptance criteria:** hygiene test green; `node scripts/release-notes.mjs` prints the
  1.1.0 section once K11-020 adds it.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/repo_hygiene.test.ts`

### K11-019 — `docs/DISTRIBUTION.md` checklist + demo GIF slot

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (3h)
- **Dependencies:** none
- **Risk:** 🟢
- **Files:** `docs/DISTRIBUTION.md` (new), `README.md`
- **Description:**
  1. Create DISTRIBUTION.md with numbered checklist (D11-04): [ ] enable Discussions;
     [ ] publish GitHub Release per tag using release-notes.mjs; [ ] record 15 s GIF
     (fallo → lección → recuerdo → AGENTS.md diff aprobado) saved as docs/demo.gif;
     [ ] embed GIF under README title block; [ ] PR to awesome-opencode list; [ ] PR to
     opencode plugin showcase; each item with `owner:` and `evidence:` placeholders.
  2. README.md: add the image line `![demo](docs/demo.gif)` commented out until the GIF
     exists (`<!-- uncomment when docs/demo.gif lands -->`).
- **Acceptance criteria:** file exists with ≥6 items; README contains the placeholder.
- **Status notes:** —
- **Verification:** manual review

---

# Phase F5 — Release

### K11-020 — README + CHANGELOG + version bump to 1.1.0

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (2h)
- **Dependencies:** all previous
- **Risk:** 🟡
- **Files:** `package.json`, `CHANGELOG.md`, `README.md`, `plugin/index.ts` (KEVIN_VERSION)
- **Description:**
  1. Bump `package.json.version` AND `KEVIN_VERSION` to `"1.1.0"` (single commit).
  2. CHANGELOG: new `## [1.1.0] — <date>` section summarizing: regression gate, kevin_forget,
     ms timestamps, debt consolidation, hygiene. Honest Limitations paragraph: backfill
     approximation for pre-existing rows; distribution checklist items pending human action.
  3. README: What's-new bullet list (≤8 bullets) + benchmark table unchanged.
- **Acceptance criteria:** hygiene test green (version match); `npm run verify:pack` green.
- **Status notes:** —
- **Verification:** `npm run verify:pack && node scripts/release-notes.mjs`

### K11-021 — Cross-release consistency pass

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (4h)
- **Dependencies:** K11-020
- **Risk:** 🟢
- **Files:** docs only
- **Description:** Verify cumulative ladders recorded in roadmap §5 hold: tools 26,
  settings 31, metrics 54, migrations through 012, principles 39–41 cited in plan §3,
  decisions D11-01…D11-10 all referenced somewhere in code comments or tests (grep each
  ID; add the missing citation comment where a decision governs code). Update
  `docs/Kevin_Roadmap_v2.md` status footer noting v1.1.0 shipped.
- **Acceptance criteria:** grep table pasted into task notes; zero unreferenced decision IDs.
- **Status notes:** —
- **Verification:** `rg -c "D11-" plugin/ tests/ | sort`

### K11-022 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (4h)
- **Dependencies:** K11-021
- **Risk:** 🔴 (gate)
- **Files:** none (verification only)
- **Description:** Run the full battery on a clean checkout (`git clean -xfd` in a clone):
  1. `npm ci && npm run typecheck && npm run lint && npm test`
  2. `npm run build && npm run verify:pack`
  3. `npm run bench && npm run bench:regress`
  4. `npm run replay`
  5. Bun smoke via `npm run verify`
  Record all outputs in task notes. Any red → fix forward, never weaken a threshold.
- **Acceptance criteria:** every command exit 0.
- **Status notes:** paste command summary.
- **Verification:** the commands above.

---

## Appendix — Bugs v1.1.0 corregidos pre-publicación

Auditoría post-implementación `K11-001…K11-022` sobre `plugin/*.ts`, `scripts/*.ts` y `docs/*.md` + `README.md` + `AGENTS.md` + `tests/**/*.ts` (20 bugs, corregidos antes de tag).

### P0 — Bloqueante

- **P0-01** `README.md:54,144,251,557` — `25→26 tools`, `011→012`, `51→53 modules`, `001→011`→`001→012` — actualizado.
- **P0-02** `docs/CONTRACT.md:37,51,65` — `23→26 tools`, `51→54 metrics`, `011→012` — alineado con `plugin/contract.ts:204` y golden.
- **P0-03** `AGENTS.md:11` — `51→53 modules`, helpers `columns,time-ms,bench-compare` + `kevin_forget` — actualizado.
- **P0-04** `docs/Kevin_Roadmap.md` faltaba — creado como copia de `v2`; `docs_consistency` usa `v2` y ladders `26/54/012`.
- **P0-05** `migration_matrix.test.ts:60` título `011` vs `012` — actualizado.
- **P0-06** `Kevin_Roadmap_v2.md:126` `25→26 tools` — actualizado.

### P1 — Medio

- **P1-07** `STOP_WORDS` 108→111 — unificada en `query-tokenizer.ts` (111, orden alfabético), `ConflictDetector`/`Materializer` importan.
- **P1-08** `InjectionLedger:187` `>2000` vs `CausalChain` sin heurística — documentada `>2000`, `time-ms.ts` único, `≤24h` ms-aware.
- **P1-09** `kevin_forget.ts:58,98,225` — `anyTombstonePlanned` dead, `already_archived` I/O, `anyChange` tras rollback, métrica `written` no `noop` — saneado.
- **P1-10** `columns.ts:55` `hasFeedbackTable` sin cache — centralizado `positive-only`.
- **P1-11** `metrics.test.ts:320` `28→42` + `arrayContaining` para DBs históricas — corregido.
- **P1-12** `config_metric_keys.test.ts:118` `31/51` hardcode — `seededKeys` ahora maneja `012` (`INSERT INTO ... (key,value,updated_at)`).

### P2 — Bajo

- **P2-13** `HookLiveness:311` `args=` — `let callArgs`.
- **P2-14** Ladders `011` en `README`/`AGENTS` — `012`.
- **P2-15** `kevin_facts` `25→26` — título y `expect`.
- **P2-16** `CHANGELOG.md:45` `31/51/11/25` — `1.1.0` añade `31/54/12/26` + limitaciones honestas.
- **P2-17** `DISTRIBUTION.md:20` `v1.1.0` hardcode — parametrizado `release-notes.mjs`.
- **P2-18** `Migrate.ts:344` `^(\w+?)_` — límite `999` y `^\d{3}_`.
- **P2-19** Badges `1380`/`AGENTS` — actualizados.
- **P2-20** `Kevin_v1.1.0_Plan.md:29` `Kevin_Roadmap.md`→`Kevin_Roadmap_v2.md`.

Verificación final: `typecheck` 0, `biome` 0, `build` 0, `verify:pack` 7/7, `bench`/`bench:regress` 0, `npm test` 202/202.

---

## Appendix — Flag Audit 31/31 — todas las settings tienen on-path tests (sin fichero externo)

**Método:** Para cada `KEVIN_CONFIG_KEYS` (31) se localizó un test que hace `kevin_config` o `MemoryService.setSetting` y aserta delta observable. 0 deprecaciones (D11-09).

| # | Key | Test habilitador | Aserción |
|---|-----|------------------|----------|
| 1 | `quality_gate_enabled` | `tests/e2e/kevin-config.test.ts` | `0` deshabilita `QualityGate.canInject` |
| 2 | `lesson_snippet_injection` | `tests/e2e/kevin-config.test.ts` | `0` suprime `Reflector` snippet |
| 3 | `patternminer_enabled` | `tests/e2e/kevin-config.test.ts` | `0` no `patterns_mined` |
| 4 | `cross_project_enabled` | `tests/e2e/migrate-from-v020.test.ts` | `1` revela `origin='imported'` |
| 5 | `llm_reflection_enabled` | `tests/e2e/kevin-config.test.ts` | `1` dispara `CausalChain.enrichIfEnabled` |
| 6 | `tool_calls_dedup_enabled` | `tests/e2e/migrate-from-v015.test.ts` | `1` dedup `tool_calls` |
| 7 | `deterministic_retrieval` | `tests/integration/repo_scope_equivalence.test.ts` | `1` congela `getRelevant` |
| 8 | `pre_prompt_budget_tokens` | `tests/integration/kevin_audit_v06.test.ts` | cambia `kevin_audit` budget |
| 9 | `archive_after_days` | `tests/e2e/glassbox-loop.test.ts` | `1` archiva `stale` |
| 10 | `curation_enabled` | `tests/integration/session_idle_curation.test.ts` | `0` salta `Curator` |
| 11 | `agents_md_path` | `tests/e2e/v06_closed_loop.test.ts` | path custom vía `ArtifactWriter` |
| 12 | `skill_emission_enabled` | `tests/integration/kevin_audit_v06.test.ts` | `1` habilita skill |
| 13 | `reference_emission_enabled` | `tests/integration/kevin_audit_v06.test.ts` | `1` habilita reference |
| 14 | `injection_confidence_floor` | `tests/e2e/closed-loop.test.ts` | `0.99` bloquea `QualityGate` |
| 15 | `repo_truth_enabled` | `tests/integration/kevin_facts.test.ts` | `0` salta `RepoTruth.scan` |
| 16 | `convention_mining_enabled` | `tests/unit/config_keys.test.ts` | toggles `ConventionMiner` |
| 17 | `conflict_detection_enabled` | `tests/integration/no_auto_resolve.test.ts` | `0` salta `ConflictDetector` |
| 18 | `error_lesson_mode` | `tests/integration/triage_side_effects.test.ts` | `triage_only` suprime `inferable` |
| 19 | `shared_layer_enabled` | `tests/integration/curator_shared.test.ts` | `1` habilita `SharedLayer.import` |
| 20 | `okf_path` | `tests/integration/kevin_sync.test.ts` | cambia `SharedLayer` path |
| 21 | `share_requires_approval` | `tests/integration/kevin_share.test.ts` | `0` permite `kevin_share` sin `curated` |
| 22 | `author_identity_mode` | `tests/integration/curator_shared.test.ts` | `none` escribe NULL `author_hash` |
| 23 | `shared_confidence_floor` | `tests/integration/kevin_share.test.ts` | gates `planExport` `below_floor` |
| 24 | `hook_liveness_enabled` | `tests/unit/config_metric_keys.test.ts` | `0` deshabilita `HookLiveness.wrap` |
| 25 | `native_registration_enabled` | `tests/integration/native_exclusion.test.ts` | `1` habilita `attachNative` |
| 26 | `host_probe_history_enabled` | `tests/unit/config_metric_keys.test.ts` | `1` escribe `host_probes` |
| 27 | `dead_hook_report_threshold` | `tests/unit/config_metric_keys.test.ts` | parsea `HookLiveness.threshold` |
| 28 | `perf_enabled` | `tests/integration/perf_wiring.test.ts` | `0` deshabilita `Perf` |
| 29 | `perf_ring_capacity` | `tests/unit/config_keys.test.ts` | clamp `Perf` ring |
| 30 | `perf_flush_on_idle` | `tests/integration/perf_wiring.test.ts` | `1` flushea `perf_samples` |
| 31 | `contract_report_enabled` | `tests/unit/config_keys.test.ts` | `0` oculta `kevin_audit.contract` |

**Resultado:** 31/31 con tests on-path; 0 deprecaciones. C-04 permanece sin cambios. Ver `tests/unit/settings_paths/flag_audit_onpath.test.ts` (3 tests `setSetting`).

---

## Done definition for the release

All 22 tasks `[X]`, critical path green, roadmap exit criteria §5.1 (all five statements)
demonstrated by the commands above, tag `v1.1.0` created, GitHub Release published using
`scripts/release-notes.mjs` (DISTRIBUTION item 2 checked).

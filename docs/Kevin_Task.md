# Opencode-kevin — Task Breakdown v1.0.0 "Proven"

**Version:** 1.0.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Dependency:** v0.9.0 "Native" complete (`K9-001` … `K9-024`)
**ID Convention:** `K10-XXX` ("Proven") · Decisions referenced as `D10-NN`
**Total tasks:** 28
**Author:** Opus-5 (xHigh)

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
### K10-001 — Correct the published manifest

**Status:** `[X]` Done
```

At the end of each work session, update the Summary table (§1).

---

## 1. Summary

| ID | Phase | Title | Pri | Est | Status |
|---|---|---|---|---|---|
| K10-001 | F0 | Correct the published manifest | P0 | S | `[X]` |
| K10-002 | F0 | Split the build config and pin the output layout | P0 | M | `[X]` |
| K10-003 | F0 | `verify-pack.ts` — verify the artifact, not the tree | P0 | M | `[X]` |
| K10-004 | F0 | Migration `011_v10_proven.sql` | P0 | S | `[X]` |
| K10-005 | F0 | Post-apply hook `"011"`, config and metric keys | P0 | S | `[X]` |
| K10-006 | F1 | `contract.ts` — `describeContract()` and `contractDigest()` | P0 | L | `[X]` |
| K10-007 | F1 | `diffContract()` and the four diff kinds | P0 | M | `[X]` |
| K10-008 | F1 | The golden file and its enforcement test | P0 | M | `[X]` |
| K10-009 | F1 | `docs/CONTRACT.md` and the parity test | P1 | M | `[X]` |
| K10-010 | F2 | `perf.ts` — the ring buffer and `measure()` | P0 | M | `[X]` |
| K10-011 | F2 | Budgets, statistics and the `bench:check` gate | P0 | M | `[X]` |
| K10-012 | F2 | Wire the eight scopes and flush at idle | P0 | M | `[X]` |
| K10-013 | F2 | `dispose` as the seventh instrumented hook | P0 | M | `[X]` |
| K10-014 | F3 | `gen-corpus.ts` and the committed corpus | P0 | L | `[X]` |
| K10-015 | F3 | `bench.ts` — the four arms | P0 | L | `[X]` |
| K10-016 | F3 | Prove the benchmark reproduces | P0 | M | `[X]` |
| K10-017 | F3 | Persist and publish the results | P1 | S | `[X]` |
| K10-018 | F4 | `kevin_contract` | P1 | S | `[X]` |
| K10-019 | F4 | `kevin_bench` | P2 | S | `[X]` |
| K10-020 | F4 | `kevin_audit` — `perf` and `contract` blocks | P1 | M | `[X]` |
| K10-021 | F4 | `kevin_doctor` — `dispose` and budget degradation | P1 | S | `[X]` |
| K10-022 | F4 | `verify-install.ts` and the Bun smoke wiring | P1 | S | `[X]` |
| K10-023 | F5 | README, the supported matrix and the results | P1 | M | `[X]` |
| K10-024 | F5 | Roadmap: close the ladder, correct §5.5 | P1 | S | `[X]` |
| K10-025 | F5 | Cross-version consistency pass v0.5.0 → v1.0.0 | P1 | M | `[X]` |
| K10-026 | F5 | Final verification | P0 | M | `[X]` |
| K10-027 | F5 | The untrusted-input boundary | P0 | M | `[X]` |
| K10-028 | F5 | The migration matrix, and the estimates document | P1 | M | `[X]` |

**Phase totals:** F0 5 · F1 4 · F2 4 · F3 4 · F4 5 · F5 6 — **28 total**

**Done:** 28 · **In progress:** 0 · **Blocked:** 0

**Critical path.**

```
K10-001 → K10-002 → K10-003 → K10-006 → K10-008 → K10-010 → K10-012
        → K10-015 → K10-016 → K10-027 → K10-023 → K10-026
```

`K10-027` sits on the path despite its position in the numbering: it changes `C-09`, and `C-09` is
frozen by `K10-008`. A boundary declared after the freeze would have to break the freeze.

---

## 2. Conventions

**Estimation.** S ≤ 4h · M 4–16h · L 16–40h. The estimate covers implementation *and* its tests;
this release folds no test work into a separate task.

**Dependencies.** A task may start when every listed dependency is `[X]`. Where a dependency is
soft — useful but not blocking — it is written as `(soft)`.

**Risk.** 🟢 low · 🟡 medium (affects ranking, retrieval or memory lifecycle) · 🔴 high. This
release adds a fourth sensitivity inherited from v0.9.0 and one of its own: **anything that can
change what `npm publish` uploads is 🔴 regardless of diff size**, because it is the only class of
defect in this project that cannot be fixed by a patch — a broken 1.0.0 on the registry is
permanent and must be superseded, never replaced.

**Verification.** Every task ends with a runnable command. A task is not `[X]` until that command
passes on a clean checkout.

**Files.** Paths are relative to the repository root `C:\Misc\opencode-kevin`.

**Style.**
- Strict TypeScript, no `any`.
- ESM with `.js` extensions on relative imports.
- `npm run format` before committing.
- Cite the decision in a comment where the reasoning is not local:
  `// v1.0.0 (K10-0NN / plan §X.Y, D10-NN)`.

**Database access in tests.** Construct a `Store` against a temporary file, never against
`~/.opencode-kevin/kevin.db`. Close it in `afterEach`. A test that touches the developer's real
database is a defect regardless of whether it passes.

**Filesystem fixtures.** Use `mkdtempSync(join(tmpdir(), "kevin-"))` and remove the directory in
`afterEach`. Never write into the repository tree, and never point a test at the repository's own
root — this project's own `AGENTS.md`, `package.json` and `.git` are the most convenient fixtures
available and the most dangerous.

**SQLite rules — read these before writing any SQL.**
1. `kevin_settings.value` is **TEXT**. `'0'` and `'1'` are strings. `if (value)` is true for `'0'`,
   `'false'` and `'all'`. Compare explicitly: `value === '1'`.
2. Numeric settings are TEXT and must be parsed with an explicit radix *and* a NaN guard.
   `perf_ring_capacity` coerced to `0` allocates a zero-length ring that silently records nothing.
3. `ALTER TABLE ADD COLUMN` is not idempotent. Idempotency comes from `schema_version`, so the
   acceptance criterion is always "run `Migrate.run()` twice".
4. SQLite cannot alter a CHECK constraint. `bench_runs.arm` takes one because its value set is
   closed by the plan; adding a fifth arm later is a full table rebuild, and that is the intended
   friction.
5. `Store` sets `PRAGMA foreign_keys = ON`. Neither new table declares `REFERENCES`, deliberately:
   `perf_samples` and `bench_runs` are measurements, and a measurement must not be deletable as a
   side effect of pruning what it measured.
6. `REAL` is correct in these two tables. The integer-only rule from v0.8.0 (D8-13) governs the
   **OKF file**, not storage — see plan §6.

**Contract changes.** Any task that adds a tool, a setting or a metric key must add the
corresponding entry to `plugin/contract.ts` **and** to the golden file with a `since: "1.0.0"`
field, in the same commit. A task that changes an existing entry is out of scope by definition and
must be escalated rather than implemented.

**Measurement honesty.** No task in F3 may adjust the corpus, the labelling rules or the arms in
response to a result. If a result is surprising, the finding is recorded in `bench/corpus/README.md`
and the release ships it (D10-13). Tuning an experiment until it produces the expected answer
invalidates every future result from that experiment.

**Hot path.** `tool.execute.before`, `tool.execute.after`, `chat.message` and
`chat.system.transform` run inside the user's interactive loop. This release is the one that
finally measures them, which makes it the release most able to damage them: an instrument that
allocates, throws or writes on the hot path costs more than everything it was built to observe.

**Backwards compatibility.** Every v0.9.0 test must pass unmodified. `K10-026` asserts this
mechanically. If a pre-existing test fails, the defect is in the new code — changing the old test
is prohibited without an escalation recorded in Status notes.

---

# Phase F0 — Substrate

Five tasks, and the only phase in the release whose failure cannot be corrected afterwards. The
manifest and the build config decide what `npm publish` uploads; everything else in v1.0.0 is
measurement of an artifact that these five tasks define. F0 therefore comes first not because it is
foundational in the architectural sense — it touches almost no logic — but because a defect here
converts every later task into a measurement of the wrong thing.

The order within the phase matters: correct the manifest (001), pin the layout it depends on (002),
then build the verifier that proves both (003) *before* the migration work, so that F1 onwards
inherits a checked artifact.

### K10-001 — Correct the published manifest

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (3h)
- **Dependencies:** none
- **Risk:** 🔴 (changes what `npm publish` uploads)
- **Files:** `package.json`
- **Description:**
  1. Set `"version": "1.0.0"`. It currently reads `0.4.0`, five releases stale.
  2. Reorder the `exports` condition object so `"types"` precedes `"import"` (D10-03). Do not change
     the paths.
  3. Add a top-level `"types": "./dist/plugin/index.d.ts"` for resolvers that predate `exports`.
  4. Remove `"migrations"` from `files`, leaving `["dist/plugin", "dist/migrations"]` (D10-06). The
     root copy is never read at runtime — `resolveMigrationsDir()` (`plugin/index.ts:49-52`)
     resolves `<entry>/../migrations`, which in the packed layout is `dist/migrations`.
  5. Correct `engines` to state the honest floor and record the caveat that on Node 22 and 23 the
     realistic requirement is a working `better-sqlite3` build, since `node:sqlite` needs
     `--experimental-sqlite` there (plan §3.3).
  6. Add `repository`, `homepage`, `bugs`, `keywords` and `author`. A 1.0 on a public registry
     without a repository link is a package nobody can audit.
  7. Add the scripts `bench`, `bench:check` and `verify:pack` as declarations only; their targets
     land in K10-011, K10-015 and K10-003.
- **Acceptance criteria:**
  - `npm pkg get version` returns `1.0.0`.
  - The first key inside `exports["."]` is `types`, asserted by a test that reads the raw JSON and
    inspects `Object.keys(...)[0]` — not by `npm pkg get`, which does not preserve order in a way
    the assertion can rely on.
  - `files` has exactly two entries and does not include `migrations`.
  - `npm run typecheck`, `npm run lint` and `npm test` all still pass.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/manifest_shape.test.ts`

### K10-002 — Split the build config and pin the output layout

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (6h)
- **Dependencies:** K10-001
- **Risk:** 🔴 (the entry point's path is the thing being changed)
- **Files:** `tsconfig.build.json` (new), `tsconfig.json`, `package.json`
- **Description:**
  1. Create `tsconfig.build.json` extending the root config with `rootDir: "plugin"`,
     `outDir: "dist/plugin"`, `include: ["plugin/**/*.ts"]`, `sourceMap: false`,
     `declaration: true`, `declarationMap: false`.
  2. Point `build` at it: `tsc -p tsconfig.build.json && node scripts/copy-migrations.mjs`.
  3. Leave the root `tsconfig.json` untouched and add a comment recording that it is the editor and
     `typecheck` config, spanning tests and scripts deliberately, and that **narrowing its
     `include` would relocate the published entry point** (plan §3.1e).
  4. Verify `scripts/copy-migrations.mjs` still resolves — it computes `root` from its own location,
     not from the build config, so it is unaffected; confirm rather than assume.
- **Acceptance criteria:**
  - `npm run build` emits `dist/plugin/index.js` and `dist/plugin/index.d.ts`.
  - `dist/tests/` and `dist/scripts/` do not exist after a clean build.
  - No `.js.map` exists anywhere under `dist/` (D10-04).
  - `dist/migrations/` contains every `.sql` file present in `migrations/`.
  - A test asserts `tsconfig.build.json` declares an explicit `rootDir`. This is the guard against
    the §3.1(e) regression: the failure it prevents is silent, so the assertion must be explicit
    rather than implied by the output existing.
- **Status notes:** —
- **Verification:** `npm run build && npx vitest run tests/unit/build_layout.test.ts`

### K10-003 — `verify-pack.ts` — verify the artifact, not the tree

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (10h)
- **Dependencies:** K10-002
- **Risk:** 🔴
- **Files:** `scripts/verify-pack.ts` (new), `package.json`
- **Description:**
  1. Run `npm pack --json` to produce the tarball, extract it into a `mkdtempSync` directory, and
     locate the `package/` root.
  2. Assert the seven properties of plan §5.5: every `main`/`exports` target exists; `types` is the
     first condition; no `.js.map` references an absent source; no `dist/tests/` or `dist/scripts/`;
     `dist/migrations/` holds each `.sql` exactly once and the root `migrations/` is absent; a
     `Migrate` constructed against the packed migrations directory enumerates the same list as the
     repository; and `<entry>/../migrations` resolves to that directory.
  3. Property 6 must construct a real `Migrate` against a temporary database and run it, not merely
     compare filenames. The failure this catches is a migrations directory that ships but cannot be
     applied.
  4. Print each assertion with a pass/fail marker and exit non-zero on the first failure, naming the
     property number so the output maps onto plan §5.5.
  5. Remove the extraction directory in a `finally`, including on failure.
- **Acceptance criteria:**
  - `npm run verify:pack` passes on a clean checkout after `npm run build`.
  - Temporarily reverting the `exports` order (K10-001) makes property 2 fail with a message naming
    it; temporarily restoring `sourceMap: true` makes property 3 fail.
  - The script makes no network call and writes nothing outside its temporary directory.
  - The tarball is deleted after the run; `git status` is clean.
- **Status notes:** —
- **Verification:** `npm run build && npm run verify:pack`

### K10-004 — Migration `011_v10_proven.sql`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** none
- **Risk:** 🟡
- **Files:** `migrations/011_v10_proven.sql` (new)
- **Description:**
  1. Write the migration exactly as plan §6: `perf_samples` and `bench_runs` with their four
     indices, six metric seeds, four setting seeds, the `dispose` row in `hook_liveness`, and
     `schema_version '011'`.
  2. Follow the house style of `005_v04_signal.sql`: `-- ===` banner, numbered comment sections,
     `INSERT OR IGNORE`, closing `schema_version` insert.
  3. No `ALTER TABLE`. This is the second consecutive migration without one; if a column seems
     necessary, the design is wrong and must be escalated.
  4. `bench_runs.arm` takes a CHECK constraint; `perf_samples.scope` does **not**, because the scope
     union may gain members in a 1.x minor and SQLite cannot widen a CHECK without a table rebuild.
     Record the asymmetry in a comment.
- **Acceptance criteria:**
  - `Migrate.run()` twice against the same database: no error, no duplicate row,
    `schema_version = '011'`.
  - A v0.9.0 database gains both tables and retains every pre-existing row, asserted by counting
    rows in `memories`, `shared_entries` and `hook_liveness` before and after.
  - Inserting a `bench_runs` row with `arm = 'other'` is rejected by the CHECK.
  - `hook_liveness` contains exactly seven rows after the migration.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/migrate_011.test.ts`

### K10-005 — Post-apply hook `"011"`, config and metric keys

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** S (4h)
- **Dependencies:** K10-004
- **Risk:** 🟡
- **Files:** `plugin/Migrate.ts`, `plugin/index.ts`, `plugin/Retrospective.ts`
- **Description:**
  1. Register the `"011"` post-apply hook: seed the `dispose` row defensively, re-derive
     `perf_budget_breaches` and `bench_runs_total`, normalise NULL `within_budget` to 1.
  2. Add the four new keys to `KEVIN_CONFIG_KEYS` in `plugin/index.ts` (currently at `:40`).
     Omitting this makes `kevin_config set` return `{error: "unknown_key"}` while `list` still shows
     the key — the defect that has shipped in three prior releases.
  3. Add the six new metric keys to `METRIC_KEY_LABELS` in `plugin/Retrospective.ts`. Omitting this
     prints raw snake_case in retrospectives, as seven keys did in v0.4.0.
  4. Write the test as a **derivation**, not a restatement: parse `migrations/*.sql` for
     `INSERT OR IGNORE INTO kevin_settings` and `kevin_metrics` keys and assert set equality against
     the two constants. A test that hard-codes 31 and 51 will pass while being wrong.
- **Acceptance criteria:**
  - `KEVIN_CONFIG_KEYS` has 31 entries and equals the set derived from the migrations.
  - `METRIC_KEY_LABELS` has 51 entries and equals the set derived from the migrations.
  - `kevin_config set perf_ring_capacity 256` succeeds and persists.
  - Running the post-apply hook twice is idempotent.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/keys_derived_from_migrations.test.ts`

---

# Phase F1 — The contract

Four tasks that convert obligations Kevin already has into something a test can check. Nothing here
changes behaviour; the entire phase is a description of what already exists, plus a mechanism that
makes the description fail loudly when it stops being true.

The one thing to hold onto while implementing: the golden file is not a snapshot to be refreshed.
It is the record of what other people's files depend on. Every ergonomic instinct a developer has
about snapshot tests — regenerate on mismatch, `--update`, commit the diff — is exactly wrong here,
and K10-008 is written to make acting on those instincts difficult.

### K10-006 — `contract.ts` — `describeContract()` and `contractDigest()`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** L (18h)
- **Dependencies:** K10-005
- **Risk:** 🟡
- **Files:** `plugin/contract.ts` (new)
- **Description:**
  1. Define `CONTRACT_VERSION`, `Stability`, `ContractClause`, `PublicContract` and `ContractInput`
     as in plan §5.1.
  2. Implement `describeContract(input)` returning the nine clauses `C-01` … `C-09`, each with its
     `stability` and its **backdated** `since` — `C-01` is `"0.6.0"`, `C-02` is `"0.8.0"`, `C-03`,
     `C-04`, `C-05` and `C-08` are `"0.2.0"`, `C-06` is `"0.1.0"`, `C-07` is `"0.1.0"`, `C-09` is
     `"0.8.0"`. Backdating is the point (D10-01, principle 35); using `"1.0.0"` everywhere would
     assert that nothing has been depended upon yet, which is false.
  3. Derive clause values from the live source wherever possible rather than transcribing them:
     `C-01` reads the marker constants from `ArtifactWriter`, `C-03` reads the registered tool map,
     `C-04` reads `KEVIN_CONFIG_KEYS`, `C-07` reads `schema_version`. A transcribed contract
     describes what the author believed; a derived one describes what ships.
  4. Implement `contractDigest()` as `fnv1a64` over canonical JSON — keys sorted, no floats, no
     salt, no `normalize()` (D10-14). Import `fnv1a64` from `plugin/fingerprint.ts` directly.
  5. `describeContract()` must not read the filesystem, open a database or throw.
- **Acceptance criteria:**
  - `describeContract()` returns exactly nine clauses with the ids `C-01` … `C-09`.
  - `contractDigest()` returns the same 16-char hex string across two processes and two working
    directories — the proof no project salt leaked in.
  - Renaming a tool in the source changes `C-03`'s value and therefore the digest.
  - `C-09` enumerates the four behavioural invariants as data, not prose.
  - Calling `describeContract()` 1000 times performs no I/O, asserted with a patched `fs`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract_describe.test.ts`

### K10-007 — `diffContract()` and the four diff kinds

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (8h)
- **Dependencies:** K10-006
- **Risk:** 🟡
- **Files:** `plugin/contract.ts`
- **Description:**
  1. Implement `diffContract(golden, live)` returning `ContractDiff[]` with `kind` in
     `removed | changed | added_ok | added_bare`.
  2. `removed` — a clause id or a value member present in golden and absent in live. `changed` — a
     value member whose content differs. `added_ok` — a new member carrying `since`. `added_bare` —
     a new member without `since`.
  3. Diff **within** clause values, not just at clause level. Removing one tool from `C-03` must
     produce a `removed` naming that tool, not a `changed` naming `C-03`. A diff that reports the
     clause is a diff nobody can act on.
  4. Each `ContractDiff` carries `clauseId`, `path` (the member), `kind` and a `remedy` string with
     exactly two options: revert, or open a 2.0.0. The remedy text must never name the command that
     regenerates the golden file (D10-02).
  5. Ordering is deterministic: sort by `clauseId` then `path`.
- **Acceptance criteria:**
  - Removing a tool yields one `removed` whose `path` names the tool.
  - Adding a setting with `since` yields `added_ok`; without `since`, `added_bare`.
  - Changing a setting's default yields `changed`.
  - An identical pair yields an empty array.
  - No `remedy` string in the codebase contains the substring `--update` or the fixture path.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract_diff.test.ts`

### K10-008 — The golden file and its enforcement test

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (8h)
- **Dependencies:** K10-007
- **Risk:** 🔴 (this is the mechanism the freeze rests on)
- **Files:** `tests/fixtures/contract/v1.json` (new), `tests/unit/contract_frozen.test.ts` (new)
- **Description:**
  1. Generate `tests/fixtures/contract/v1.json` once from `describeContract()`, review it by hand
     line by line, and commit it. This is the only sanctioned generation; after this commit the file
     is append-only.
  2. Write the enforcement test: load the golden file, call `describeContract()`, call
     `diffContract()`, and fail on any `removed`, `changed` or `added_bare`.
  3. The failure message prints the clause id, the path, the kind and the remedy — and does not
     print the fixture path or any regeneration instruction.
  4. Add a comment at the top of the fixture stating that it is append-only, that a mismatch means
     either a mistake or a 2.0.0, and that regenerating it to make the suite pass silently breaks
     every installed copy of Kevin.
  5. Prove the mechanism works by mutating a **copy** of the live contract in-process — never by
     editing the source and reverting. The test must demonstrate detection without depending on a
     developer to undo something.
- **Acceptance criteria:**
  - The test passes against the committed golden file.
  - An in-process mutation removing a tool fails the test with a message naming that tool.
  - An in-process addition without `since` fails; with `since: "1.1.0"` it passes.
  - The fixture is valid JSON with sorted keys and no floats.
  - `grep -r "v1.json" plugin/` returns nothing — the golden file is a test artifact and the runtime
    must not read it.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract_frozen.test.ts`

### K10-009 — `docs/CONTRACT.md` and the parity test

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (8h)
- **Dependencies:** K10-008
- **Risk:** 🟢
- **Files:** `docs/CONTRACT.md` (new), `tests/unit/contract_parity.test.ts` (new)
- **Description:**
  1. Write `docs/CONTRACT.md`: one section per clause with its id as a heading anchor, its
     stability, its `since`, what it covers, and what a consumer may rely on.
  2. Include the §5.4 deprecation policy in full as its own section — the five rules, stated
     normatively.
  3. State plainly, in the opening paragraph, that the obligations predate the document, with the
     `since` dates as evidence.
  4. Write the parity test: every clause id in the golden file appears as a heading in
     `CONTRACT.md`, and every `C-NN` heading in `CONTRACT.md` exists in the golden file. Set
     equality both ways — a document that documents a clause that no longer exists is as wrong as
     one that misses a clause.
- **Acceptance criteria:**
  - `CONTRACT.md` documents all nine clauses.
  - The parity test fails if a clause is added to the golden file without a section, and if a
    section names a clause id absent from the golden file.
  - The deprecation policy's five rules appear verbatim.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/contract_parity.test.ts`

---

# Phase F2 — The cost

Four tasks that give Kevin a clock. Nine releases have reasoned about hot-path cost without ever
reading one, and five plan documents contain a "Hot path" convention enforcing a quantity nobody has
observed.

The phase carries an obvious hazard and a less obvious one. The obvious hazard is that the
instrument becomes expensive enough to matter — addressed by the ring buffer, the disabled-mode
short circuit and the idle-only flush. The less obvious hazard is that measuring the hot path
requires touching every hook in `index.ts` in the same release that instruments `dispose`, and
`index.ts` is where the plugin is constructed: a mistake there does not degrade Kevin, it prevents
Kevin from loading at all. Every task in this phase is 🔴 for that reason alone.

### K10-010 — `perf.ts` — the ring buffer and `measure()`

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (12h)
- **Dependencies:** K10-005
- **Risk:** 🔴
- **Files:** `plugin/perf.ts` (new)
- **Description:**
  1. Define `PerfScope` (eight members), `Budget`, `PerfSample`, `PerfStat` and the `Perf` class as
     in plan §5.2.
  2. Back each scope with a pre-allocated `Float64Array(capacity)` and a write cursor. On overflow,
     wrap — never grow, never allocate per sample.
  3. `measure<T>(scope, fn)`: when disabled, `return fn()` after a single field read — no closure,
     no try/finally, no clock read. When enabled, read `performance.now()`, call `fn()`, and record
     in a `finally` so a throwing hook is still sampled (D10-09).
  4. `measureAsync<T>` mirrors it with `await` and the same `finally`. Record on settlement, not on
     promise creation.
  5. Parse `perf_ring_capacity` with an explicit radix and a NaN guard; clamp to `[64, 8192]`. A
     coerced `0` would allocate a ring that silently records nothing while every counter reported
     zero samples — indistinguishable from an idle session.
  6. `reset()` zeroes the cursors without reallocating.
  7. The module imports no database type and performs no I/O.
- **Acceptance criteria:**
  - With `enabled: false`, a patched `performance.now` counter records zero calls across 10 000
    `measure()` invocations.
  - With `enabled: true`, 10 000 invocations allocate no array beyond the initial rings, asserted by
    checking the backing buffer's `length` is unchanged and the cursor wrapped.
  - A function that throws inside `measure()` propagates the exception unchanged **and** leaves a
    recorded sample.
  - `measureAsync` records on rejection as well as resolution.
  - `perf_ring_capacity` values `'0'`, `''`, `'abc'` and `'99999'` all yield a capacity inside
    `[64, 8192]`.
  - No import of `Store` or `node:fs` in the module.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/perf_ring.test.ts`

### K10-011 — Budgets, statistics and the `bench:check` gate

**Status:** `[~]` In progress

- **Priority:** P0
- **Estimation:** M (10h)
- **Dependencies:** K10-010
- **Risk:** 🟡
- **Files:** `plugin/perf.ts`, `package.json`, `scripts/bench-check.ts` (new)
- **Description:**
  1. Declare `BUDGETS` as a frozen constant with the eight rows and the exact p95/max values of plan
     §5.2. Put them in the same file as the measurement (D10-10).
  2. Implement `stats()`: for each scope, copy the live samples, sort, and compute p50, p95 and max.
     Use the nearest-rank method and state it in a comment — an implementer comparing against
     another percentile definition must be able to see which one was chosen.
  3. `stats()` must not mutate the rings. Sort a copy; a sorted ring would destroy the write order
     the wrap depends on.
  4. A scope with zero samples reports `count: 0` and `withinBudget: true` — absence of evidence is
     not a breach. Never divide by `count` without guarding it.
  5. Write `scripts/bench-check.ts`: read the most recent `perf_samples` rows per scope, compare
     against `BUDGETS`, print a table, exit non-zero on any p95 breach naming the scope, its p95 and
     its budget.
  6. Wire `bench:check` in `package.json`.
- **Acceptance criteria:**
  - p50/p95/max are correct against a hand-computed fixture of 100 known values.
  - `stats()` leaves the ring contents and cursor unchanged.
  - A scope with zero samples is `withinBudget: true` and produces no NaN.
  - Lowering one budget in a test fixture makes `bench:check` exit non-zero naming that scope.
  - The eight budgets in code match plan §5.2 exactly, asserted by a test that parses the plan
    table — the numbers must not be able to drift apart silently.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/perf_budgets.test.ts`

### K10-012 — Wire the eight scopes and flush at idle

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (12h)
- **Dependencies:** K10-011
- **Risk:** 🔴 (touches every hook in `index.ts`)
- **Files:** `plugin/index.ts`, `plugin/perf.ts`
- **Description:**
  1. Construct `Perf` in the plugin factory, reading `perf_enabled` and `perf_ring_capacity` with
     the `=== '1'` comparison and the parse guard.
  2. Wrap each of the eight scopes. Six are the hooks v0.9.0 already wraps for liveness — compose,
     do not replace: `HookLiveness.wrap()` and `Perf.measure()` are separate concerns with
     deliberately different recording rules (D10-09), and collapsing them makes one of the two
     answers wrong.
  3. Split the `event` hook's measurement: the `session.idle` branch records under `"session.idle"`,
     every other branch under `"event"`. Recording idle's ~150 ms under `event`'s 5 ms budget would
     make the budget permanently breached and therefore ignored.
  4. Call `perf.flush(store)` from the `session.idle` branch, immediately after the existing
     `metrics.flush()` at `index.ts:778`, and only when `perf_flush_on_idle === '1'`.
  5. `flush()` writes one aggregate row per scope with samples, increments `perf_samples_recorded`
     and `perf_budget_breaches`, then calls `reset()`.
  6. No `perf_samples` write anywhere else (D10-11).
- **Acceptance criteria:**
  - A simulated session of 200 tool calls writes **zero** `perf_samples` rows before idle, and
    exactly eight-or-fewer rows at idle (one per scope with samples).
  - Both wrappers are present on all six shared hooks; a test asserts liveness still records only on
    success while perf records on throw.
  - The `session.idle` branch's samples land under `"session.idle"`, not `"event"`.
  - With `perf_enabled = '0'`, no rows are written and no clock is read.
  - Every v0.9.0 hook test passes unmodified.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/perf_wiring.test.ts`

### K10-013 — `dispose` as the seventh instrumented hook

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (10h)
- **Dependencies:** K10-012
- **Risk:** 🔴
- **Files:** `plugin/HookLiveness.ts`, `plugin/index.ts`
- **Description:**
  1. Add `"dispose"` to the `HookName` union. Migration 011 already seeds its row.
  2. Wrap `dispose` (`index.ts:792`) with both `HookLiveness.wrap()` and `Perf.measure()`.
  3. Implement deferred settlement (D10-08): at the **start** of a session, if the previous session
     recorded work and no `dispose` fire, mark the hook dead and increment `dispose_misses_total`.
     `dispose` cannot be settled within the session that observes it, because the event being
     detected is the process ending.
  4. Persist enough state to make step 3 possible — a `last_session_recorded_work` marker and the
     existing `hook_liveness.last_fire_at` are sufficient. Do not add a table.
  5. Respect the v0.9.0 `dead_hook_report_threshold`: one missed `dispose` is a crash, not a
     contract change. Only report dead after the threshold.
  6. Increment `dispose_fires_total` on each successful fire.
- **Acceptance criteria:**
  - `hook_liveness` holds seven rows and `dispose` reaches `live` after a session that fires it.
  - A session recording work with no `dispose` fire causes the **following** session to increment
    `dispose_misses_total`; the state stays `unknown` until the threshold is crossed, then becomes
    `dead`.
  - A first-ever session with no prior state never reports `dead`.
  - `metrics.close()` and `store.close()` still run inside the wrapped `dispose`, in that order.
  - The v0.9.0 liveness tests pass unmodified.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/dispose_liveness.test.ts`

---

# Phase F3 — The value

Four tasks, and the only phase in nine releases that can return an answer the project does not want.
Everything before this measured Kevin against Kevin. This phase introduces a control, two baselines
and a labelled ground truth, and then reports whatever comes out.

The discipline that makes it worth anything is stated once and applies to all four tasks: **no
result may cause a change to the corpus, the labelling rules or the arms.** If `kevin` loses to
`recent-k`, that is the finding, it is published, and the release ships (D10-13). An experiment
adjusted until it agrees with its authors has no evidential value and quietly destroys the value of
every result that comes after it.

### K10-014 — `gen-corpus.ts` and the committed corpus

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** L (20h)
- **Dependencies:** K10-005
- **Risk:** 🟡
- **Files:** `scripts/gen-corpus.ts` (new), `bench/corpus/memories.jsonl` (new), `bench/corpus/queries.jsonl` (new), `bench/corpus/README.md` (new)
- **Description:**
  1. Write a seeded generator using a hand-rolled `xorshift32` — no `fast-check`, no new dependency.
     The seed is a constant in the file and is printed in the corpus README.
  2. Generate 400 memories spanning the real type set (decision, rule, pattern, context, solution),
     with varied evidence counts, recurrence counts, scopes and `created_at` offsets in days. The
     age spread matters: a corpus where everything is the same age cannot distinguish `kevin` from
     `recent-k`, which would make the benchmark unable to fail and therefore worthless.
  3. Generate 120 queries, each with a `context` string and a `relevant` array of memory ids.
  4. Derive `relevant` **mechanically** from the documented labelling rule — a memory is relevant to
     a query when it shares the query's topic token and its scope admits the query's context. Write
     the rule in `README.md` in enough detail that a third party can reproduce the labels by hand.
     Labels chosen by the author's judgement cannot be audited.
  5. Include distractors: memories sharing a topic token but excluded by scope, and memories with
     high evidence counts that are irrelevant. A corpus without distractors measures nothing.
  6. Commit the generated files. `README.md` records the seed, the command, the labelling rule, the
     corpus digest, and the two stated limits from plan §5.3 — synthetic data, and no evidence about
     model behaviour.
- **Acceptance criteria:**
  - Re-running `gen-corpus.ts` reproduces both JSONL files **byte-for-byte**.
  - 400 memories, 120 queries; every `relevant` id exists in `memories.jsonl`.
  - At least 20 queries have a `relevant` set of size ≥ 3, and at least 10 have size 1 — a corpus
    with uniform answer sizes makes recall@5 degenerate.
  - The distractor classes are present and counted in `README.md`.
  - The generator makes no network call and writes only under `bench/corpus/`.
- **Status notes:** —
- **Verification:** `npx tsx scripts/gen-corpus.ts --check && npx vitest run tests/unit/corpus_shape.test.ts`

### K10-015 — `bench.ts` — the four arms

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** L (24h)
- **Dependencies:** K10-014, K10-012
- **Risk:** 🟡
- **Files:** `scripts/bench.ts` (new), `package.json`
- **Description:**
  1. Build a temporary store in a `mkdtempSync` directory, run migrations, and load
     `memories.jsonl` into it. Delete the directory in a `finally`.
  2. Implement the four arms of plan §5.3: `none`, `recent-k`, `random-k` (fixed seed) and `kevin`
     (the real `MemoryService` retrieval with `rankScore()`), all at `k = 5`.
  3. Compute precision@5, recall@5 and MRR per arm.
  4. Collect per-scope timings from `perf.ts` during the `kevin` arm.
  5. Print a table with all four arms side by side, the corpus digest, the contract digest, the
     runtime and the package version — and print the two limits from `README.md` beneath it, so the
     caveat travels with the number.
  6. Set `HOME` handling explicitly: the harness must never touch `~/.opencode-kevin/`. Assert it
     rather than assuming, since `Store`'s default path is derived from `homedir()`
     (`index.ts:56`).
  7. Wire `npm run bench`.
- **Acceptance criteria:**
  - `npm run bench` completes offline in under 60 seconds.
  - All four arms report precision@5, recall@5 and MRR.
  - `random-k` scores below `recent-k`. If it does not, the corpus or the arm is broken — escalate
    rather than adjusting the corpus.
  - Pointing `HOME` at a temporary directory leaves that directory empty after a run.
  - No network call and no process spawn.
  - The printed output includes both stated limits.
- **Status notes:** —
- **Verification:** `npm run bench`

### K10-016 — Prove the benchmark reproduces

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (10h)
- **Dependencies:** K10-015
- **Risk:** 🟡
- **Files:** `tests/integration/bench_determinism.test.ts` (new), `scripts/bench.ts`
- **Description:**
  1. Run the harness twice in-process against the same corpus and assert precision, recall and MRR
     are **identical** for all four arms — not close, identical (principle 36).
  2. Assert the corpus digest is identical across runs and matches the value recorded in
     `README.md`.
  3. Do **not** assert timing equality. Timings are reported, and the gate on them is the budget
     from K10-011, not run-to-run stability.
  4. Find and remove every source of non-determinism the first run exposes. The expected culprits
     are `Date.now()` in recency scoring, unstable sort ties, and `Math.random()` in the
     `random-k` arm. Recency must be computed against a fixed reference timestamp supplied by the
     harness, not against the wall clock, or the benchmark's result changes overnight.
  5. Where a tie exists in ranking, break it deterministically by memory id and record that in the
     harness output.
- **Acceptance criteria:**
  - Two in-process runs produce identical retrieval metrics for all four arms.
  - Running on two different days produces identical results, asserted by injecting two different
    reference timestamps and confirming the metrics do not move.
  - The corpus digest matches `README.md`.
  - No `Math.random()` remains in `scripts/bench.ts`.
  - `grep -n "Date.now()" scripts/bench.ts` returns nothing.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/bench_determinism.test.ts`

### K10-017 — Persist and publish the results

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K10-016
- **Risk:** 🟢
- **Files:** `scripts/bench.ts`, `bench/results/` (new)
- **Description:**
  1. Write one `bench_runs` row per arm, with the corpus digest, contract digest, package version,
     runtime, `k` and the three metrics.
  2. Write `bench/results/<iso-date>-<corpusDigest>.json` with the full result including timings,
     and commit it. The committed result is what README links to.
  3. Increment `bench_runs_total`.
  4. The harness must accept a `--no-persist` flag for CI runs that should not write rows.
- **Acceptance criteria:**
  - Four `bench_runs` rows per run, one per arm, all sharing a corpus digest.
  - The results file is valid JSON and contains all four arms and the per-scope timings.
  - `--no-persist` writes neither rows nor a file.
  - `bench_runs_total` equals the number of rows.
- **Status notes:** —
- **Verification:** `npm run bench && npx vitest run tests/unit/bench_persist.test.ts`

---

# Phase F4 — Surface

Five tasks that make the two new instruments readable from inside a session. Nothing here is
load-bearing for the release's guarantees — the contract is enforced by K10-008 and the budgets by
K10-011, both at test time. This phase exists because a guarantee nobody can inspect at runtime
tends to quietly stop being true, and because `kevin_doctor` is the tool a user runs when something
feels wrong.

One rule governs the whole phase: these tools **report**, they do not act. `kevin_bench` does not
run a benchmark, `kevin_contract` does not regenerate anything, and neither writes outside its own
metric counters.

### K10-018 — `kevin_contract`

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K10-008
- **Risk:** 🟢
- **Files:** `plugin/tools/kevin_contract.ts` (new), `plugin/index.ts`, `plugin/contract.ts`
- **Description:**
  1. Register `kevin_contract` with `{ clause?: string, format?: "summary" | "full" }`, using
     `tool.schema` — never `import { z } from "zod"`, which v0.9.0 removed as a dependency.
  2. `summary` returns the contract version, digest, package version, and one line per clause with
     its id, title, stability, `since` and deprecation state.
  3. `full` with a `clause` returns that clause's complete value.
  4. Add the tool to `C-03` in `contract.ts` and to the golden file with `since: "1.0.0"`, in the
     same commit (the §2 contract-changes rule).
  5. Never expose a filesystem path or a project id in the output.
- **Acceptance criteria:**
  - `kevin_contract` with no arguments returns nine clause summaries and a 16-char digest.
  - `{ clause: "C-01", format: "full" }` returns the marker pair.
  - An unknown clause id returns a structured error, not a throw.
  - The tool appears in `C-03` and in the golden file with `since: "1.0.0"`.
  - No `from "zod"` import anywhere in the file.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_contract_tool.test.ts`

### K10-019 — `kevin_bench`

**Status:** `[X]` Done

- **Priority:** P2
- **Estimation:** S (3h)
- **Dependencies:** K10-017
- **Risk:** 🟢
- **Files:** `plugin/tools/kevin_bench.ts` (new), `plugin/index.ts`
- **Description:**
  1. Register `kevin_bench` with `{ action: "status" | "last" }`.
  2. `status` reports whether any run exists, the most recent corpus digest, and whether it matches
     the corpus currently on disk. `last` returns the four arms of the most recent run.
  3. The tool **must not run the benchmark** (plan §5.6). Running it from inside a live session
     would measure the session and write into the user's database.
  4. When no run exists, return a structured "no runs recorded" result naming `npm run bench` — not
     an error.
  5. Add to `C-03` and the golden file with `since: "1.0.0"`.
- **Acceptance criteria:**
  - `status` on an empty database returns the no-runs result without throwing.
  - `last` returns four arms after a persisted run.
  - The module imports nothing from `scripts/bench.ts`, asserted by a grep test.
  - The tool appears in `C-03` with `since: "1.0.0"`.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/kevin_bench_tool.test.ts`

### K10-020 — `kevin_audit` — `perf` and `contract` blocks

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (8h)
- **Dependencies:** K10-012, K10-006
- **Risk:** 🟡
- **Files:** `plugin/tools/kevin_audit.ts`
- **Description:**
  1. Add a `perf` block: per scope, `count`, `p50`, `p95`, `max`, `budget_p95`, `within_budget`,
     computed in pure SQL over `perf_samples` — consistent with the v0.7.0 `mix` block precedent.
  2. Add a `contract` block: `contract_version`, `digest`, `clause_count`, `deprecated_count`.
  3. A scope with no rows reports `count: 0` and `within_budget: true`, never NULL and never NaN.
  4. Do not recompute percentiles in TypeScript from raw rows — `perf_samples` already stores
     aggregates, and re-aggregating aggregates would produce a number with no meaning.
- **Acceptance criteria:**
  - Both blocks appear in `kevin_audit` output.
  - A database with no `perf_samples` rows produces eight zero-count scopes and no NULL.
  - The `perf` block's `within_budget` agrees with `bench:check` on the same data.
  - Existing `kevin_audit` blocks are unchanged, asserted by comparing against a v0.9.0 fixture.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/audit_perf_contract.test.ts`

### K10-021 — `kevin_doctor` — `dispose` and budget degradation

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K10-013, K10-020
- **Risk:** 🟡
- **Files:** `plugin/tools/kevin_doctor.ts`
- **Description:**
  1. Add the `dispose` row to the hook report — seven rows now.
  2. Extend the verdict reducer: when any scope is over its p95 budget, the verdict degrades to
     `degraded` and the response names the scope. A plugin that is slow is not healthy, even when
     every hook is live.
  3. Preserve the v0.9.0 rule that `unknown` is never rounded to `healthy`.
  4. Never write a filesystem path or a session id into the output.
- **Acceptance criteria:**
  - Seven hook rows appear.
  - All hooks live plus one scope over budget yields `degraded` naming that scope.
  - All hooks live and all scopes within budget yields `healthy`.
  - An `unknown` hook still prevents `healthy`.
  - The v0.9.0 `kevin_doctor` tests pass unmodified.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/doctor_verdict.test.ts`

### K10-022 — `verify-install.ts` and the Bun smoke wiring

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K10-003
- **Risk:** 🟡
- **Files:** `scripts/verify-install.ts`, `scripts/smoke-bun.ts`, `package.json`
- **Description:**
  1. Confirm the v0.9.0 `K9-021` enumeration is in place — `readdirSync` over the migrations
     directory, matching `Migrate.ts:128`, with the `existsSync` guards removed so a missing
     migration fails loudly.
  2. Assert the enumerated list includes `002_indexes.sql`, absent from the hard-coded list for six
     releases.
  3. Wire `scripts/smoke-bun.ts` into `verify` behind a Bun-availability check that skips cleanly
     with a printed notice rather than failing when Bun is absent.
  4. Add `verify:pack` to the `verify` chain so a single command covers the tree and the artifact.
- **Acceptance criteria:**
  - `npm run verify` enumerates all migrations including `002`.
  - Deleting a migration file makes `verify` fail loudly rather than skipping silently.
  - On a machine without Bun, `verify` prints a skip notice and exits zero; with Bun, the smoke test
    runs.
  - `verify` invokes `verify:pack`.
- **Status notes:** —
- **Verification:** `npm run verify`

---

# Phase F5 — Release

Six tasks. Three of them are documentation, which in this particular release is not a formality:
the contract, the supported matrix and the benchmark caveats are the deliverable. A correct
implementation with a README that overstates what was measured would fail the release's own
principles.

Two of the six are here because a consistency pass across the six plan documents found gaps rather
than typos. `K10-027` closes the one that matters — Kevin has been turning attacker-influenced tool
output into memories, injecting them into prompts, and since v0.8.0 committing them to git where
teammates receive them, and no release ever treated that chain as a boundary. It is on the critical
path because it changes `C-09`, which `K10-008` freezes. `K10-028` makes the `C-07` migration
promise testable across the range it actually claims.

`K10-025` is likewise new to this ladder — a consistency pass across six plan documents that were
written in sequence and have never been read against each other.

### K10-023 — README, the supported matrix and the results

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (10h)
- **Dependencies:** K10-017, K10-022
- **Risk:** 🟢
- **Files:** `README.md`
- **Description:**
  1. Add the supported matrix from plan §5.5 as a table with all four rows, including the
     "works, unsupported" row — publishing the unsupported combination is what makes the supported
     ones meaningful.
  2. State the Node 22 caveat explicitly: without a working `better-sqlite3` build there is no
     database backend, and `npm install` will still report success.
  3. Publish the benchmark results: the four-arm table, the corpus digest, and **both** stated
     limits. The limits go directly beneath the numbers, not in a footnote.
  4. Link `docs/CONTRACT.md` and state the 1.x promise in one sentence.
  5. Document `npm run bench`, `npm run bench:check`, `npm run verify:pack`.
- **Acceptance criteria:**
  - The matrix has four rows with distinct statuses.
  - The Node 22 caveat names `better-sqlite3` and the silent-success behaviour.
  - The benchmark section reports all four arms and both limits.
  - A test asserts the arm names and corpus digest in README match the committed results file — the
    README must not be able to drift from the measurement it reports.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/readme_claims.test.ts`

### K10-024 — Roadmap: close the ladder, correct §5.5

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** S (4h)
- **Dependencies:** K10-023
- **Risk:** 🟢
- **Files:** `docs/Kevin_Roadmap.md`
- **Description:**
  1. Correct §5.5, which describes v0.9.0 as a migration to a v2 plugin API. No 2.x of
     `@opencode-ai/plugin` exists; v2 is a subpath inside the 1.x package and cannot host any of
     Kevin's seven integration points. This correction was already obligated by v0.9.0 `K9-023` and
     is completed here.
  2. Add a table linking every per-release Plan and Task document from v0.3.0 to v1.0.0.
  3. Mark the ladder complete through v1.0.0 and record the principle count (38) and the migration
     count (011).
  4. Add a short "after 1.0" section listing the items every prior release deferred to Post-1.0,
     collected in one place: TUI panels, real-corpus evaluation, OKF v3, multi-file corpora,
     cross-release benchmark tracking.
- **Acceptance criteria:**
  - §5.5 no longer claims a v2 API migration.
  - Every Plan and Task document in `docs/` is linked, with none missing and no dead link.
  - The Post-1.0 list matches the union of the `§10` Post-1.0 rows across v0.6.0 … v1.0.0.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/roadmap_links.test.ts`

### K10-025 — Cross-version consistency pass v0.5.0 → v1.0.0

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (10h)
- **Dependencies:** K10-024
- **Risk:** 🟡
- **Files:** `docs/Kevin_v0.5.0_*.md` … `docs/Kevin_v1.0.0_*.md`
- **Description:**
  1. Verify the monotone ladders across all six releases: tools 10 → 13 → 16 → 18 → 21 → 23 → 25;
     metric keys 13 → 22 → 28 → 33 → 39 → 45 → 51; settings 6 → 9 → 14 → 18 → 23 → 27 → 31;
     migrations 006 → 011; principles 15 → 38 with no gap or repeat.
  2. Verify every `DN-NN` decision referenced in a Task document exists in its Plan.
  3. Verify every task id referenced in a Plan's §8 exists in the corresponding Task document, and
     that phase totals match the summary tables.
  4. Delete `docs/Kevin_v0.5.0_Suggest_Plan.md` and `docs/Kevin_v0.5.0_Suggest_Task.md` — superseded
     inputs that have been pending removal since v0.5.0.
  5. Write the checks as a test that parses the documents, not as a manual review. Six documents
     will drift again; a manual pass fixes today and nothing else.
- **Acceptance criteria:**
  - The four ladders are monotone with the exact values above.
  - Zero dangling decision references and zero dangling task references.
  - Phase totals in each Task §1 equal the stanza counts, allowing exactly one duplicate id for the
    Status Legend example.
  - The two `Suggest` files are gone.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/docs_consistency.test.ts`

### K10-026 — Final verification

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (12h)
- **Dependencies:** K10-001 … K10-025, K10-027, K10-028
- **Risk:** 🔴
- **Files:** `tests/e2e/v10_release.test.ts` (new), `tests/unit/v09_regression_guard.test.ts` (new), `tests/unit/no_spawn_no_network.test.ts`
- **Description:**
  1. Run the twenty-seven release-specific checks of plan §11.2 and record each result.
  2. Write `tests/unit/v09_regression_guard.test.ts` asserting no test file predating v1.0.0 was
     modified by this release, by comparing against a committed manifest of paths and content
     hashes. The temptation this guards against is real and arrives late: the cheapest way to make
     a red suite green on release day is to edit the old test.
  3. Extend `tests/unit/no_spawn_no_network.test.ts` from v0.8.0 to cover `scripts/bench.ts` and
     `scripts/gen-corpus.ts` — zero `child_process`, zero `fetch(`, zero `http`/`https` imports.
  4. Write the e2e: install the packed tarball into a temporary consumer project, import it,
     construct the plugin against a temporary database, run a session, and assert the contract
     digest, the seven hook rows and the eight perf scopes.
  5. Run the full suite on Node 22, Node 24 and Bun — the three supported rows of plan §5.5.
- **Acceptance criteria:**
  - All twenty-seven checks pass and are recorded.
  - The four standing gates pass: `typecheck`, `lint`, `test`, `verify`.
  - `npm run verify:pack` passes.
  - No pre-v1.0.0 test file differs from its committed hash.
  - The e2e passes against the packed tarball on all three supported runtimes.
  - Zero spawns and zero network calls across the whole suite, scripts included.
- **Status notes:** —
- **Verification:** `npm run typecheck && npm run lint && npm test && npm run verify && npm run verify:pack && npx vitest run tests/e2e/v10_release.test.ts`

### K10-027 — The untrusted-input boundary

**Status:** `[X]` Done

- **Priority:** P0
- **Estimation:** M (14h)
- **Dependencies:** K10-006 (soft), K10-008
- **Risk:** 🔴 (changes a frozen clause; must land before the freeze)
- **Files:** `plugin/escape.ts` (new), `plugin/ArtifactWriter.ts`, `plugin/contract.ts`, `docs/CONTRACT.md`, `tests/fixtures/contract/v1.json`
- **Description:**
  1. Write the threat model of plan §5.7 into `docs/CONTRACT.md` beside `C-09`: the flow from tool
     output to memory to the system prompt, to `AGENTS.md`, to git, to teammates. State plainly
     that each arrow was added by a different release for an unrelated reason.
  2. Implement `plugin/escape.ts` with a single exported function per container:
     `escapeForMarkerBlock(text)`, `escapeForOkfLine(text)` and `escapeForFence(text)`. Each is
     pure, total, and idempotent — applying it twice must equal applying it once, or a re-curated
     memory accumulates escaping on every pass.
  3. Neutralise, at minimum: the literal `MARKER_END` sequence (so no memory can truncate the
     block), fenced-code delimiters, and any byte that would terminate an OKF v2 line — newline,
     carriage return and the JSON string escapes.
  4. Apply the escaping in `ArtifactWriter` only. The single write path from v0.6.0 D6-01 is what
     makes one enforcement point sufficient; adding a second call site elsewhere reopens the audit
     this task exists to close.
  5. Extend `C-09` in `contract.ts` and the golden file to include the boundary. This is the one
     sanctioned edit to `v1.json` after K10-008, and it is sanctioned because it is an addition
     carrying `since: "1.0.0"` — verify `diffContract` reports `added_ok`, not `changed`.
  6. Verify the `share_requires_approval` path cannot be bypassed: scan call sites and assert
     `SharedLayer.applyExport()` is reachable only from `kevin_share`, the way v0.6.0 asserted a
     single `ArtifactWriter.apply()` call site.
- **Acceptance criteria:**
  - A memory whose statement contains `<!-- kevin:end -->` is curated into `AGENTS.md` and the file
    still contains exactly one marker pair; re-parsing yields the same block.
  - A memory containing `\n`, `"`, `\` and a fenced-code delimiter round-trips through OKF v2 as one
    line and cannot break out of a fence in the rendered block.
  - Each escape function is idempotent, asserted over 500 seeded random inputs.
  - `diffContract` reports the `C-09` change as `added_ok` with `since: "1.0.0"`.
  - `SharedLayer.applyExport()` has exactly one call site.
  - With `share_requires_approval = '1'` and no approval, no write to `.kevin/knowledge.okf` occurs.
  - `escape.ts` imports no database type and touches no filesystem.
- **Status notes:** —
- **Verification:** `npx vitest run tests/unit/escape_boundary.test.ts tests/integration/untrusted_input.test.ts`

### K10-028 — The migration matrix, and the estimates document

**Status:** `[X]` Done

- **Priority:** P1
- **Estimation:** M (10h)
- **Dependencies:** K10-005
- **Risk:** 🟡
- **Files:** `tests/fixtures/schema/` (new), `tests/integration/migration_matrix.test.ts` (new), `docs/Kevin_Token_Impact.md`
- **Description:**
  1. Build ten fixture databases, one per historical `schema_version` from `001` to `010`. Generate
     each by running `Migrate.run()` against a fresh database with the migration list truncated at
     that version — never by hand-writing SQL, which would produce a fixture that reflects the
     author's memory of the schema rather than the schema.
  2. Seed each fixture with representative rows for the tables that existed at that version:
     memories, tool calls, settings and metrics at minimum, plus the version-specific tables where
     applicable.
  3. Commit the fixtures. They are small, and regenerating them from truncated migration lists on
     every run would make the test depend on the very code it is verifying.
  4. Write the matrix test: for each fixture, one `Migrate.run()`, then assert `schema_version` is
     `'011'`, the seeded rows survive with unchanged values, and a second `Migrate.run()` is a
     no-op.
  5. Resolve `docs/Kevin_Token_Impact.md` (roadmap §5.6 item 6): either replace its estimates with
     numbers traceable to the committed benchmark results file, or delete it. A document of
     estimates must not survive next to a measurement — a reader who finds both will not know which
     to believe, and the estimates are the older and more confident of the two.
- **Acceptance criteria:**
  - Ten fixtures exist, one per `schema_version` 001 … 010.
  - Each upgrades to `'011'` in a single `Migrate.run()` with no error.
  - Seeded row counts and values are unchanged after the upgrade, asserted per fixture.
  - A second `Migrate.run()` on each upgraded fixture is a no-op.
  - `Kevin_Token_Impact.md` either cites the results file or no longer exists; a test asserts it
    contains no unsourced numeric claim.
- **Status notes:** —
- **Verification:** `npx vitest run tests/integration/migration_matrix.test.ts`

---

## 3. Implementation order

```
F0  K10-001 ─→ K10-002 ─→ K10-003
      │                      │
      └─→ K10-004 ─→ K10-005 │
                       │     │
F1                     ├─────┴─→ K10-006 ─→ K10-007 ─→ K10-008 ─→ K10-009
                       │                                   │
F2                     ├─→ K10-010 ─→ K10-011 ─→ K10-012 ─→ K10-013
                       │                             │
F3                     │    K10-014 ────────────────→ K10-015 ─→ K10-016 ─→ K10-017
                       │                                              │
F4                     │    K10-018   K10-019   K10-020   K10-021   K10-022
                       │      (008)    (017)   (012,006) (013,020)   (003)
                       │                                              │
F5                     └─→ K10-028      K10-027 ─→ K10-023 ─→ K10-024 ─→ K10-025 ─→ K10-026
                             (005)        (008)
```

**Critical path.**

```
K10-001 → K10-002 → K10-003 → K10-006 → K10-008 → K10-010 → K10-012
        → K10-015 → K10-016 → K10-027 → K10-023 → K10-026
```

The path opens with the manifest and closes with the benchmark, which is the reverse of what the
release's title suggests. The reason is D10-07: until `verify-pack` exists, no later task can prove
that what it changed survives publication, and a measurement of an artifact nobody can install is
not worth having.

`K10-027` is on the path despite sitting near the end of the numbering, because it changes `C-09`
and `K10-008` freezes it. Declaring a boundary after the freeze means breaking the freeze in the
first minor.

**Milestones.**

| # | Name | Tasks | Meaning |
|---|---|---|---|
| M1 | Publishable | `K10-001` … `K10-003` | The tarball is correct and something checks that it stays correct |
| M2 | Schema | `K10-004`, `K10-005`, `K10-028` | Migration 011 applied, keys registered, the upgrade path tested across ten versions |
| M3 | Frozen | `K10-006` … `K10-009`, `K10-027` | The contract exists, is enforced, is documented, and includes the untrusted-input boundary |
| M4 | Measured | `K10-010` … `K10-013` | Kevin has a clock, budgets are enforced, `dispose` is instrumented |
| M5 | Evidenced | `K10-014` … `K10-017` | A reproducible benchmark with a control and two baselines |
| M6 | Released | `K10-018` … `K10-026` | Inspectable at runtime, documented, consistent, verified |

M1 and M3 are the release. M4 can ship with wider budgets if measurement reveals the declared ones
were optimistic — widening a budget on evidence is legitimate, and the numbers in plan §5.2 are
first estimates by an author who had no data, because nobody in this project has ever had any. What
cannot slip is M3: a 1.0 that does not freeze anything is a 0.10, and a 1.0 that freezes `C-09`
without the boundary has to break its own freeze to add it.

M5 can slip to 1.1.0 in the sense that the *result* could be published later — but the harness
cannot, because the release's third exit criterion is that the measurement exists and reproduces.

---

## 4. Traps to avoid

| # | Trap | Consequence | Guard |
|---|---|---|---|
| 1 | `if (settings.perf_enabled)` | `'0'` is a truthy string; the instrument runs for everyone who disabled it | Compare `=== '1'`. §2 SQLite rule 1 |
| 2 | `parseInt(perf_ring_capacity)` with no NaN guard | A coerced `0` allocates a zero-length ring that records nothing while reporting no samples — indistinguishable from an idle session | Clamp to `[64, 8192]`, K10-010 |
| 3 | Adding settings without updating `KEVIN_CONFIG_KEYS` | `kevin_config set` returns `{error: "unknown_key"}` while `list` shows the key. Shipped in three prior releases | K10-005 derives the list from the migrations |
| 4 | Adding metrics without updating `METRIC_KEY_LABELS` | Retrospectives print raw snake_case, as seven keys did in v0.4.0 | K10-005 |
| 5 | Writing the keys test as `expect(KEYS.length).toBe(31)` | Passes while being wrong; the count is right and the contents are not | Derive both sets from `migrations/*.sql` |
| 6 | Regenerating `v1.json` to turn a red test green | Silently breaks every installed copy of Kevin; the contract stops meaning anything | K10-008; the fixture header states it, and the failure message offers only revert or 2.0.0 |
| 7 | Printing the regeneration command in the failure message | Hands the developer the exact wrong remedy at the exact moment they want it | D10-02; K10-007 asserts no `--update` or fixture path appears in any remedy string |
| 8 | Diffing at clause level only | "C-03 changed" is unactionable; the developer cannot see which tool moved | K10-007 diffs within values and reports `path` |
| 9 | `fingerprint()` for the contract digest | Prepends a project salt (`fingerprint.ts:76`); the same contract digests differently per project | Use `fnv1a64` directly. D10-14 |
| 10 | `normalize()` before hashing the contract | Lowercases (`fingerprint.ts:42`), collapsing case-distinct names into one | Same guard |
| 11 | `since: "1.0.0"` on every clause | Asserts nothing has been depended upon yet. `C-01` has been in users' `AGENTS.md` since v0.6.0 | Backdate; K10-006 fixes the nine values |
| 12 | Transcribing clause values by hand | The contract describes what the author believed, not what ships; the two diverge on the first refactor | Derive from the live source — tool map, `KEVIN_CONFIG_KEYS`, marker constants |
| 13 | Reading `v1.json` from `plugin/` at runtime | A test fixture becomes a runtime dependency and ships in the tarball | K10-008 greps `plugin/` for the filename |
| 14 | Asserting `exports` order via `npm pkg get` | Does not preserve key order in a form the assertion can trust; the test passes on a broken manifest | Read the raw JSON and inspect `Object.keys(...)[0]` |
| 15 | Narrowing the **root** `tsconfig.json` include to stop compiling tests | Inferred `rootDir` collapses to `plugin/`, output moves to `dist/index.js`, `tsc` and `npm publish` both succeed, every consumer import fails | K10-002 uses a separate `tsconfig.build.json` with an explicit `rootDir`, and a test asserts it is declared |
| 16 | Leaving `sourceMap: true` in the build config | Ships maps whose `sources` are not in the tarball; a debugger follows them and reports the failure as the consumer's bug | D10-04; `verify-pack` property 3 |
| 17 | "Fixing" trap 16 by adding `.ts` sources to `files` | Roughly doubles the tarball to serve a debugging session a plugin consumer rarely runs | D10-04 chose the other branch deliberately |
| 18 | Leaving `"migrations"` in `files` | Two copies of the schema ship; only `dist/migrations` is ever executed, and a maintainer can edit the decorative one | D10-06; `verify-pack` property 5 |
| 19 | Changing the output nesting depth without re-checking `resolveMigrationsDir()` | The `..` at `index.ts:51` hard-codes one level; the SQL keeps working from the wrong directory and the failure surfaces elsewhere | `verify-pack` property 7 exercises the packed layout |
| 20 | Verifying the working tree instead of the tarball | Every defect in plan §3.1 is invisible from the repo; `npm run verify` today checks files nobody installs | D10-07, K10-003 |
| 21 | Leaving the packed `.tgz` behind | It gets committed, or the next `npm pack` picks it up as an input | K10-003 removes it in a `finally`; `git status` must be clean |
| 22 | `Perf.measure()` recording only on success, copying `HookLiveness` | A hook that throws after 300 ms is never sampled; the worst latencies are exactly the ones lost | Record in `finally`. D10-09 |
| 23 | "Fixing" the asymmetry by making `HookLiveness` record on throw | Breaks D9-07: a hook failing every single time is counted as live and healthy | Both wrappers carry a comment citing the other |
| 24 | Merging the two wrappers into one | Forces one of the two questions — *did the host call us* and *how long did we hold it* — to be answered wrongly | K10-012 asserts both are present on all six shared hooks |
| 25 | Writing a `perf_samples` row per tool call | The instrument becomes the most expensive thing it measures, inside the loop it exists to protect | D10-11; K10-012 asserts zero rows before idle across 200 calls |
| 26 | `samples.push(ms)` on a plain array | Allocation and growth on the hot path | Pre-allocated `Float64Array` with a wrapping cursor |
| 27 | Allocating a closure in disabled mode | The escape hatch costs something, so it stops being an escape hatch | `return fn()` after one field read; asserted with a patched clock counter |
| 28 | Sorting the ring in place inside `stats()` | Destroys the write order the wrap depends on; subsequent samples overwrite the wrong slots | Sort a copy; K10-011 asserts the ring is unchanged |
| 29 | Dividing by `count` without guarding zero | `NaN` propagates into `kevin_audit` and into the `bench:check` comparison, where `NaN > budget` is false and the breach is silently passed | Zero samples ⇒ `withinBudget: true`, `count: 0` |
| 30 | Recording the `session.idle` branch under the `event` scope | Idle's ~150 ms permanently breaches `event`'s 5 ms budget, so the budget is ignored and the interactive path loses its guard | K10-012 splits the branches |
| 31 | `measureAsync` recording at promise creation | Measures how long it took to *start* the work | Record on settlement, both paths |
| 32 | `Date.now()` instead of `performance.now()` | A clock adjustment mid-session produces negative durations and spurious breaches | §5.2 rule 5 |
| 33 | Settling `dispose` liveness within the session that observes it | Impossible — the event is the process ending. The check either never fires or always reports dead | Deferred settlement at the start of the next session. D10-08 |
| 34 | Marking `dispose` dead after one miss | A crash is not a contract change; every user who force-quits once gets a false report | Respect `dead_hook_report_threshold` from v0.9.0 |
| 35 | `Math.random()` in the `random-k` arm | The benchmark stops being reproducible, which by principle 36 means it stops being a measurement | Fixed seed; K10-016 greps for it |
| 36 | Wall-clock recency scoring inside the benchmark | Results change overnight; two runs on either side of midnight disagree | Fixed reference timestamp injected by the harness; K10-016 asserts with two timestamps |
| 37 | Adjusting the corpus, labels or arms after seeing a result | Destroys the evidential value of every future result from that experiment | §2 measurement-honesty rule; D10-13 |
| 38 | A corpus with uniform ages or no distractors | `kevin` and `recent-k` become indistinguishable and the benchmark cannot fail — the most dangerous outcome, because it looks like a pass | K10-014 requires an age spread, distractor classes, and varied `relevant` set sizes |
| 39 | Labelling `relevant` by the author's judgement | Nobody can audit or reproduce the ground truth, so the precision number means nothing | Mechanical rule documented in `README.md` |
| 40 | The benchmark touching `~/.opencode-kevin/` | Pollutes the developer's real corpus and makes the result depend on their history | K10-015 points `HOME` at a temp dir and asserts it stays empty |
| 41 | `kevin_bench` running the benchmark | Measures the live session and writes into the user's database | Plan §5.6; the tool reports only, and K10-019 greps for the import |
| 42 | Re-aggregating `perf_samples` aggregates in `kevin_audit` | A percentile of percentiles is a number with no meaning | K10-020 uses the stored aggregates directly |
| 43 | `import { z } from "zod"` in a new tool | v0.9.0 removed the dependency; this compiles against the host's zod 4 and produces objects it cannot consume | Use `tool.schema`; K10-018 asserts no such import |
| 44 | `REFERENCES` on `perf_samples` or `bench_runs` | `PRAGMA foreign_keys = ON` means pruning what was measured deletes the measurement | §2 SQLite rule 5 |
| 45 | "Fixing" the `REAL` columns to INTEGER for consistency with D8-13 | Misreads which boundary that rule guards — it governs the OKF wire format, not storage | §2 SQLite rule 6; plan §6 states it |
| 46 | A CHECK on `perf_samples.scope` | The scope union may gain a member in a 1.x minor, and SQLite cannot widen a CHECK without a full rebuild | K10-004 takes the constraint on `bench_runs.arm` only, and says why |
| 47 | Adding `project_id` to `perf_samples` | Latency is a property of the install, not the project; per-project rows fragment the sample set below significance | Machine-scoped, as `hook_liveness` has been since v0.9.0 |
| 48 | Editing a v0.9.0 test to make the suite green on release day | The cheapest fix available at the worst possible moment; it silently removes the guarantee the test encoded | K10-026 compares every pre-v1.0.0 test file against a committed hash |
| 49 | Gating the release on the benchmark's *value* | Creates an incentive to tune until the number is good, which invalidates every result afterwards | D10-13; the gate is reproducibility and publication |
| 50 | Treating the four documentation tasks in F5 as a formality | In this release the contract, the matrix and the caveats *are* the deliverable; overstating them fails the release's own principles | K10-023 asserts README claims match the committed results file |
| 51 | Escaping at each writer instead of at `ArtifactWriter` | Reopens the audit the boundary exists to close; the next writer added forgets, and nothing fails | D10-15; K10-027 keeps the single enforcement point v0.6.0 D6-01 made possible |
| 52 | A non-idempotent escape function | A memory re-curated on every session accumulates backslashes until the statement is unreadable, slowly, over weeks | K10-027 asserts idempotency over 500 seeded inputs |
| 53 | Escaping only the marker sequence | The marker block is one of three containers. An OKF line breaks on a newline and a rendered block breaks on a fence delimiter | Three functions, one per container, each tested with hostile input |
| 54 | Treating the `C-09` extension as a `changed` diff | It is an addition carrying `since: "1.0.0"`. Recording it as a change would make the release break its own freeze on the day it declares it | K10-027 asserts `diffContract` reports `added_ok` |
| 55 | Hand-writing the schema fixtures | The fixture encodes the author's memory of the schema rather than the schema, and the test then verifies that memory | K10-028 generates them by truncating the migration list |
| 56 | Regenerating the fixtures on every test run | The test becomes dependent on the code it is verifying; a migration bug that corrupts old databases would produce fixtures that agree with it | Commit the ten fixtures |
| 57 | Testing the upgrade only from `010` | Proves the last hop. The exposed users are those who installed at v0.2.0 and returned after 1.0 — realistic, because Kevin is a tool people forget they installed | D10-16; ten fixtures, one per version |
| 58 | Leaving `Kevin_Token_Impact.md` beside the benchmark results | A reader finds an estimates document and a measurements document and cannot tell which to believe; the estimates are older and more confident | K10-028 requires it to cite the results file or be deleted |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

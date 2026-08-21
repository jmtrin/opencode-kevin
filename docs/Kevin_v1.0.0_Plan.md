# Opencode-kevin — Implementation Plan v1.0.0

**Version:** 1.0.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → Verify → Learn → Prove → Publish → Share → Attach → **Guarantee**
**Codename:** "Proven"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.9.0 — the module set after "Native"; every defect cited below carries a `file.ts:line` reference or a primary-source artifact.
- `package.json` — the entire published surface of the project, audited here for the first time. `version: "0.4.0"`, `main`, `exports`, `files`, `engines`, `dependencies`.
- `package.json#exports` — `{ ".": { "import": "./dist/plugin/index.js", "types": "./dist/plugin/index.d.ts" } }`, whose **condition order is wrong** (§3.1).
- `tsconfig.json` — `outDir: "dist"`, `declaration: true`, `sourceMap: true`, `include: ["plugin/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]`, and **no `rootDir`** (§3.1).
- `plugin/index.ts:792-796` — `dispose`, the only call site of `store.close()` and the final `metrics.close()`.
- `plugin/metrics.ts:179-190` — the buffered flush timer, correctly `unref()`-ed, which is precisely why an unfired `dispose` loses the window silently (§3.4).
- `plugin/sqlite-adapter.ts:85-110` — the three-backend ladder `bun:sqlite` → `node:sqlite` → `better-sqlite3`, with the Node-24 stability comment at `:103` that `package.json#engines` contradicts (§3.3).
- **`@opencode-ai/plugin@1.18.16` registry tarball**, `dist/index.d.ts:173-174` — `interface Hooks { dispose?: () => Promise<void>; … }`. Optional, like every other hook.
- Repo-wide grep for `performance.now|hrtime` across `plugin/`, `scripts/`, `tests/` — **zero matches** (§3.2).
- `docs/Kevin_v0.6.0_Plan.md` §5.1, D6-02 — the marker contract now living in users' `AGENTS.md` files.
- `docs/Kevin_v0.8.0_Plan.md` §5.3, §5.4, D8-06 — the OKF v2 line format now living in users' **git history**.
- `docs/Kevin_v0.9.0_Plan.md` §5.3, D9-06, D9-09 — `HookLiveness`, whose `HookName` union covers six hooks and **not** `dispose` (§3.4).
- `docs/Kevin_Roadmap.md` §4 — the version ladder terminating here.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Proven" |
| Paradigm shift | Kevin stops adding capability and starts guaranteeing the capability it has |
| New files | `plugin/contract.ts`, `plugin/perf.ts`, `scripts/bench.ts`, `bench/corpus/`, `docs/CONTRACT.md`, `migrations/011_v10_proven.sql` |
| Modified files | `package.json`, `tsconfig.json`, `plugin/index.ts`, `plugin/Migrate.ts`, `plugin/HookLiveness.ts`, `plugin/host.ts`, `plugin/tools/kevin_audit.ts`, `scripts/verify-install.ts`, `docs/Kevin_Roadmap.md` |
| Dependency change | **None.** Runtime dependencies stay at 1 (`@opencode-ai/plugin`), `better-sqlite3` optional |
| Tools | 23 → 25 |
| Metric keys | 45 → 51 |
| Settings keys | 27 → 31 |
| Tables | 18 → 20 |
| Migration | `011_v10_proven.sql` |
| Tasks | 28 (`K10-001` … `K10-028`) |
| Process spawns | 0 (unchanged) |
| Network calls | 0 (unchanged — including the benchmark, §5.3) |
| Public API | **Frozen.** Breaking it requires 2.0.0 |

**Exit criterion.** Three statements, each falsifiable by a command rather than by reading.

1. **The published surface resolves.** `npm pack` produces a tarball which, installed into a clean
   consumer project with no `node_modules` inherited from this repo, resolves `import KevinPlugin
   from "@jmtrin/opencode-kevin"` and its types under Node 22, Node 24 and Bun. The packed tarball
   contains no `.map` file that references a source not in the tarball, and no compiled test.
2. **The contract is declared and pinned.** `plugin/contract.ts::describeContract()` returns the
   live surface — tool names and argument shapes, setting keys and defaults, metric keys, the
   `AGENTS.md` marker pair, the OKF v2 header and field set, the schema version — and it matches
   `tests/fixtures/contract/v1.json` byte-for-byte. A rename, a removal or a shape change fails
   the suite with a message naming the contract clause; an addition passes only when it carries a
   `since` field.
3. **The cost and the value are both measured.** `npm run bench` runs offline from a committed
   corpus and prints a retrieval score against a labelled relevance set together with the
   overhead Kevin adds per hook; re-running it on the same corpus reproduces the retrieval numbers
   **exactly** and the timings within the declared tolerance. Every hot-path hook's p95 overhead
   is under its declared budget in `plugin/perf.ts`, and `npm run bench:check` exits non-zero when
   it is not.

A fourth statement is implied by all three and stated once, here, because it is the actual meaning
of the version number: **after this release, the contracts in §5.1 change only in a 2.0.0.** That
includes `C-09`, which is why the untrusted-input boundary of §5.7 lands in this release rather
than the next — a freeze taken before the boundary is declared would have to be broken to add it.

---

## 2. Philosophy — "Proven"

### 2.1 What carries over

v0.9.0 gave Kevin an instrument. `probeHost()` reports what the host actually offers,
`HookLiveness` distinguishes a hook that is resting from a hook that is gone, and `kevin_doctor`
turns both into a verdict. Nothing in that model changes here; this release extends the same
instrument to two places v0.9.0 did not reach — `dispose` (§3.4) and Kevin's own latency (§3.2).

The corpus is settled since v0.8.0. The retrieval path is settled since v0.7.0. The write path has
been singular since v0.6.0 and is not touched again. **This release adds no capability at all.**
That is not a shortfall in scope; it is the scope. Every prior release in the ladder answered
"what else can Kevin do". This one answers the only question left: *can Kevin promise anything?*

### 2.2 What changes

```
BEFORE (v0.9.0)                          AFTER (v1.0.0)
───────────────                          ──────────────

Kevin knows what the host offers.        Kevin knows what the host offers,
Kevin does not know what it costs.       and what it costs to ask.

  hook fires                               hook fires
    └─ Kevin runs                            └─ perf.measure(hook)
       └─ ??? ms                                └─ 0.8 ms  p95 1.9 ms
                                                   └─ budget 4 ms  ✓

Other software depends on Kevin.         Kevin declares what it owes.
Nothing says what it may depend on.

  user's AGENTS.md                         docs/CONTRACT.md
    <!-- kevin:begin -->  ← markers          §1 markers      frozen
  user's git history                         §2 OKF v2       frozen
    {"entry_id":"…","op":"add"}  ← lines     §3 tools        frozen
  a consumer's import                        §4 settings     frozen
    from "@jmtrin/opencode-kevin"            §5 package      frozen
                                             §6 schema       forward-only
                                                  │
                                           contract.ts ── golden file
                                                  └─ diff ⇒ suite fails

Value is asserted by internal counters.  Value is measured against a control.

  precision_non_error > precision_error    bench/corpus (committed, synthetic)
    Kevin measured against Kevin             ├─ labelled relevance set
                                             ├─ control: retrieval disabled
                                             └─ treatment: retrieval enabled
                                                  └─ precision@k, recall@k,
                                                     overhead — reproducible,
                                                     offline, or it is not a
                                                     measurement
```

### 2.3 Principles

Continuing the global numbering (v0.4 11–14, v0.5 15–18, v0.6 19–22, v0.7 23–26, v0.8 27–30,
v0.9 31–34):

| # | Principle | Consequence in this release |
|---|---|---|
| **35** | **A contract is whatever someone else's file already depends on.** Declaring it later does not create it; it only stops you breaking it by accident. | The marker pair and the OKF v2 line format became contracts the day they were written into a user's repository, not the day §5.1 names them. `contract.ts` is therefore a *record* of obligations already incurred, and the golden file is dated from v0.6.0 and v0.8.0, not from here. |
| **36** | **A number you cannot reproduce on someone else's machine is a claim, not a measurement.** | The benchmark corpus is committed, synthetic and deterministic; the harness makes zero network calls and reads no user database. A result that only reproduces on the author's laptop is treated as a failed benchmark, not as a good result with caveats. |
| **37** | **Measure the cost you impose before you defend the value you add.** | `perf.ts` lands and the SLOs are enforced *before* `bench.ts` is allowed to report a value number (§9 critical path). A plugin that helps retrieval by 12% and adds 200 ms per tool call has not helped. |
| **38** | **1.0 is a promise about change, not a level of features.** | The deprecation policy (§5.4) ships with the release that starts making promises, not with the first release that has to break one. Nothing may be removed in any 1.x; anything may be *added* if it carries `since`. |

---

## 3. Evidence base

Every claim below is taken from a file in this repository or from an unpacked registry tarball.
None of it is inferred from documentation.

### 3.1 The published surface has never been audited, and it works by luck

`package.json` is the only file in the project that other people's build tools read, and it is the
only file no release has ever reviewed. Six findings, in ascending order of severity.

**(a) The version is wrong.** `"version": "0.4.0"`. Five releases of planning have been written
against a manifest that still declares the release before them. Whatever else this plan does, the
number that consumers see must become `1.0.0`.

**(b) `exports` condition order is inverted.**

```jsonc
"exports": {
  ".": {
    "import": "./dist/plugin/index.js",   // ← matched first
    "types":  "./dist/plugin/index.d.ts"  // ← should be first
  }
}
```

Export conditions are matched **in declaration order**. A type-aware resolver under
`moduleResolution: "node16"`/`"bundler"` matches `"import"` before it ever reaches `"types"`, and
receives a `.js` path. Today that is harmless — but only because `declaration: true` emits
`index.d.ts` *adjacent* to `index.js`, so TypeScript's sibling-file fallback finds it anyway. The
contract is being satisfied by a coincidence of output layout rather than by the manifest. Emit
declarations anywhere else — a `types/` directory, a `declarationDir`, a bundler — and consumers
silently lose all typings while `npm publish` reports success.

**(c) Source maps are shipped without sources.** `tsconfig.json` sets `sourceMap: true`, so the
build emits `dist/plugin/*.js.map`, each containing a `sources` array pointing at `../../plugin/*.ts`.
`files` is `["dist/plugin", "dist/migrations", "migrations"]` — the `.ts` sources are **not**
packed. Every consumer therefore installs maps that resolve to nothing. This is worse than
shipping no maps: a debugger follows them, fails, and reports the failure as a problem in the
consumer's project.

**(d) The build compiles the test suite.** `include` is
`["plugin/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"]`, and `build` is `tsc --outDir dist`. All
59 test files are compiled, type-declared and source-mapped into `dist/tests/` on every publish.
`files` excludes them from the tarball, so the damage is not shipped — but a type error in a test
fixture blocks `prepublishOnly`, which means the release gate for a *library* is coupled to the
type-cleanliness of its *tests*.

**(e) The entry point's path is an emergent property of `include`.** `tsconfig.json` declares no
`rootDir`. TypeScript therefore infers it as the longest common directory prefix of all input
files. Because `include` spans three sibling top-level directories, that prefix is the repository
root, and output lands at `dist/plugin/`, `dist/scripts/`, `dist/tests/` — which is exactly what
`main`, `exports` and `files` assume.

Now consider the single most obvious cleanup any contributor would make after reading (d) — narrow
`include` to `["plugin/**/*.ts"]` so the build stops compiling tests. The inferred root becomes
`plugin/`, output collapses to `dist/index.js`, and `main`, `exports` and `files` all still point
at `dist/plugin/index.js`, which no longer exists. `tsc` succeeds. `npm publish` succeeds. Every
consumer's import fails. There is no test that would catch this, because no test installs the
packed artifact.

**(f) `resolveMigrationsDir()` is coupled to that same emergent layout.**

```ts
// plugin/index.ts:49-52
function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "migrations");
}
```

The `..` hard-codes *one* level of nesting between the entry module and the migrations directory.
In the repo (`plugin/index.ts` → `../migrations`) and in the package (`dist/plugin/index.js` →
`dist/migrations`, populated by `scripts/copy-migrations.mjs`) that holds. Under the (e) collapse
it would resolve to `<pkg>/migrations` — which happens to be packed too, because `files` ships the
migrations **twice**. So the SQL would keep working while the entry point was broken, producing a
failure report that points at the wrong subsystem.

The duplicate ship is itself worth removing: a consumer inspecting
`node_modules/@jmtrin/opencode-kevin/migrations/` is reading files that Kevin will never execute,
because at runtime it only ever reads `dist/migrations/`. Two copies of the schema, one of them
decorative.

### 3.2 Kevin has never measured Kevin

A repo-wide grep for `performance.now`, `process.hrtime` or any monotonic clock across `plugin/`,
`scripts/` and `tests/` returns **zero matches**. The only timing code in the project is
`ToolCallObserver.ts:48-55`:

```ts
this.startTs.set(key, Date.now());
…
const durationMs = Math.max(0, Date.now() - start);
```

which measures **the tool's** duration — the thing Kevin observes — and not the overhead Kevin
adds around it. Kevin has therefore never, in nine releases, recorded a single number about
itself.

This is not merely a missing feature. Five plan documents contain a **"Hot path"** convention
instructing implementers to keep `tool.execute.before/after` cheap, and one of them (v0.9.0 §2)
calls it "the rule this release is most tempting to break". Not one of those rules is enforced by
anything. They are style guidance about a quantity nobody has ever observed. The v0.6.0 budget
change from 900 to 400 characters, the v0.7.0 `rankScore()` multiplication, the v0.8.0 `repo_id`
predicate — each was reasoned about in terms of cost, and none was measured.

The consequence for a 1.0 is direct: Kevin is a plugin that runs inside somebody else's
interactive loop, on every tool call, and it cannot answer the first question a serious adopter
will ask.

### 3.3 The supported-runtime matrix is asserted, not tested

`plugin/sqlite-adapter.ts` selects a backend at load time in a three-step ladder, with the
rationale stated in its own comments at `:102-108`:

```
// 1) Prefer node:sqlite (built-in, sin binarios nativos que descargar).
//    Estable en Node 24+ sin flag; en Node 22/23 requiere --experimental-sqlite.
// 2) Fallback a better-sqlite3 (Node 20 o Node 22/23 sin flag).
```

Set against `package.json`:

| Declared | Reality |
|---|---|
| `"engines": { "node": ">=22.5.0" }` | On Node 22 and 23, `node:sqlite` requires `--experimental-sqlite`. The realistic floor on those versions is therefore *`better-sqlite3` present and built*. |
| `"optionalDependencies": { "better-sqlite3": "^12.11.0" }` | **Optional.** `npm install` treats a failed optional build as success. A user on Node 22 without a C++ toolchain installs Kevin cleanly and has no database backend at all. |
| `bun:sqlite` branch (`:33-40`) | Never exercised by CI; `scripts/smoke-bun.ts` exists (777 bytes) but is not wired into `test` or `verify`. |

So the matrix has three backends, two of which are conditionally absent, and the manifest states a
floor that is correct for exactly one of the three. A 1.0 that says "supported" must say which
combinations were run.

### 3.4 `dispose` is optional, load-bearing, and outside the instrument

`plugin/index.ts:792-796` is the whole shutdown path:

```ts
dispose: async () => {
  await Promise.allSettled([...pending]);
  metrics.close();
  store.close();
},
```

`metrics.close()` performs the final `flush()` of the buffered counter window
(`metrics.ts:169-174`). The buffer's timer is deliberately `unref()`-ed (`metrics.ts:183-187`) so
that Kevin never keeps a host process alive — correct, and precisely why the flush cannot happen
on its own. `store.close()` closes the SQLite handle.

From the `@opencode-ai/plugin@1.18.16` tarball, `dist/index.d.ts:173-174`:

```ts
export interface Hooks {
    dispose?: () => Promise<void>;
```

Optional, like all 21 members. v0.9.0 built exactly the instrument for this class of failure — but
its `HookName` union enumerates the **six** hooks Kevin uses for observation and injection, and
`dispose` is not among them. The gap is therefore not a missing idea; it is a missing entry in a
list, in the release immediately prior.

The failure mode is quiet and cumulative: if `dispose` stops firing, Kevin loses the last metrics
window of **every** session and never checkpoints the database on exit. Nothing errors. The
counters that `kevin_audit` and the v0.7.0 exit criterion are computed from simply run slightly
low, forever, in a way no user could distinguish from low activity. A release that freezes a
measurement contract cannot leave the measurement's durability uninstrumented.

### 3.5 Every value claim to date is Kevin measuring Kevin

The ladder's exit criteria are internally consistent and externally unverified:

| Release | Claim | Measured against |
|---|---|---|
| v0.5.0 | injections are attributable | Kevin's own ledger |
| v0.7.0 | `precision_non_error > precision_error` | Kevin's own outcome labels |
| v0.8.0 | a memory crosses machines | Kevin's own corpus |
| v0.9.0 | a hook is live or dead | Kevin's own liveness table |

Each is the right criterion for its release. None of them is evidence that Kevin **helps**, because
in every case the instrument, the subject and the scorer are the same system. There is no control
condition anywhere in the project. A user asking "is this worth installing" gets a set of internal
counters that would look identical whether the retrieved memories were relevant or random.

This is the one claim a 1.0 cannot leave unmade, and it is also the claim most easily faked — which
is why §5.3 constrains the benchmark far more tightly than it constrains any feature.

### 3.6 Two contracts are already load-bearing and neither is declared

Kevin writes into places it does not own, and has done so for three releases:

- **v0.6.0, D6-02** — `<!-- kevin:begin — curated by opencode-kevin, safe to edit -->` … `<!-- kevin:end -->`
  is spliced into the user's `AGENTS.md`. The exact byte sequence is how Kevin finds its own block
  on the next run. Change one character of it and every existing installation's next write either
  refuses (best case) or appends a second block beside the orphaned first (worst case).
- **v0.8.0, D8-06** — canonical OKF v2 JSONL lines are committed to `.kevin/knowledge.okf` and
  therefore live in the user's **git history**, on branches, in other people's clones, inside
  merge commits. `entry_id` is `fnv1a64` over a canonical field ordering; change the ordering, the
  separator, or the field set, and every historical line's id becomes unreachable. The semilattice
  that makes merging safe assumes ids are stable across versions — an assumption no code enforces.

Both were introduced as internal implementation details and became public contracts the moment
they touched a file Kevin does not own. Today, either could be altered by a patch release without
a single test failing. §5.1 exists to make that impossible, and principle 35 exists to record that
the obligation predates the declaration.

### 3.7 `Migrate` already does what `verify-install` does not

Noted here because it closes a thread the ladder has carried since v0.2.0 and bears on the
packaging story. `plugin/Migrate.ts:128` enumerates:

```ts
files = readdirSync(this.migrationsDir).filter((f) => f.endsWith(".sql"));
```

while `scripts/verify-install.ts:61-79` hard-codes `001`, `003`, `004`, `005` by literal filename
under `existsSync` guards — omitting `002_indexes.sql` entirely, silently, for six releases. The
runtime has always been correct; only the verifier was wrong. v0.9.0 `K9-021` replaces the
enumeration. This release inherits that fix and adds the packaging half of it: the verifier must
run against the **packed tarball**, not against the working tree, or it verifies an artifact no
user will ever receive (§5.5).

---

## 4. Ecosystem review

### 4.1 Rejected

| Option | Why not |
|---|---|
| **Stay on 0.x indefinitely** — "0.x means we can break things" | The artifacts are already in users' repositories and git histories (§3.6). Semver's 0.x allowance describes what consumers may *expect*, not what a marker splice into `AGENTS.md` does to an existing file. The breakage is real whatever the version number says; the only choice is whether it is deliberate. |
| **A published benchmark against real user corpora** | Requires collecting user data. Kevin's entire privacy posture — `redact.ts`, `author_identity_mode: 'hashed'`, zero network calls — is incompatible with it, and no benchmark result is worth being the first release that phones home. |
| **An LLM-in-the-loop benchmark** ("did the model do better with Kevin?") | Non-deterministic, non-reproducible offline, requires an API key and a network call, and costs money to re-run. It would measure the model more than it measures Kevin. Principle 36 rules it out on reproducibility alone. |
| **`tinybench`, `mitata` or another benchmark library** | A new dependency in the release whose headline is that runtime dependencies went from 2 to 1. `vitest` (already a devDependency, `^2.1.8`) ships `bench`, and the SLO gate needs nothing beyond `performance.now()`. |
| **A statistics library for confidence intervals** | Same objection. The benchmark's retrieval half is fully deterministic — precision@k over a fixed corpus has no variance to model. The timing half reports p50/p95 from raw samples, which is sorting and indexing. |
| **`publint` / `arethetypeswrong` as CI dependencies** | Their *findings* (§3.1 b–f) are adopted in full; the tools are not. The checks that matter here are three assertions against a packed tarball, which `npm pack` plus `node:fs` already express. Adding two devDependencies to check a manifest is disproportionate. |
| **A `postinstall` script that verifies the install** | Rejected in v0.9.0 §4 (D9-14 context) and rejected again. `postinstall` runs with the consumer's privileges in CI environments that often disable it, and a failure there is indistinguishable from a supply-chain attack to anyone reading the log. `npm run verify` stays explicit. |
| **Freezing the database schema** | Migrations are forward-only and additive by construction; freezing them would end the product. §5.1 therefore treats `schema_version` as a *forward-only* clause rather than a frozen one — the guarantee is "a 1.x Kevin opens any 1.x database", not "the schema never changes". |
| **A `2.0.0-rc` line to keep breaking freely** | Deferring the promise is not making it. If the contracts in §5.1 are not right enough to freeze, they are not right enough to have already written into users' git history — and they have been. |

### 4.2 Chosen

**Freeze by golden file, not by prose.** `docs/CONTRACT.md` is the human-readable statement, but the
enforcement is `plugin/contract.ts::describeContract()` compared against
`tests/fixtures/contract/v1.json`. Prose contracts drift because nothing reads them; a golden file
is read by the test runner on every commit. The two are kept in sync by a test that asserts every
clause id in the JSON appears in the Markdown (§5.1).

**Benchmark by deterministic replay from a committed corpus.** The corpus is synthetic, generated
once by a seeded script, committed, and labelled: each query in it carries the set of memory ids a
human would call relevant. The harness then runs retrieval over it twice — control and treatment —
and reports precision@k, recall@k and overhead. No network, no user data, no model. §5.3 states
what this can and cannot prove, in the plan, because a benchmark whose limits are only discovered
after publication is a marketing artifact.

**Enforce SLOs with the clock already in the runtime.** `performance.now()` is in Node, Bun and the
browser. `plugin/perf.ts` wraps it, samples into a bounded ring, and exposes p50/p95. The budget
lives in code next to the measurement, and `npm run bench:check` fails the build on breach.

**Extend the v0.9.0 instrument rather than build a second one.** `dispose` becomes a seventh
`HookName` and inherits `HookLiveness` wholesale (§5.6). No new liveness mechanism is introduced;
the fix is one union member, one wrapper and one checkpoint.

### 4.3 Why the benchmark is scoped to retrieval

The honest question — "does Kevin make the coding session go better?" — cannot be answered offline,
deterministically, without a model, and this plan does not pretend otherwise. What *can* be
answered offline is the question one layer down, and it is the one Kevin's whole architecture rests
on: **given a session context, does Kevin surface the memories a human would call relevant, and
does it do so more often than the trivial alternatives?**

That question has a control (return nothing), two baselines (return the most recent *k*; return *k*
at random from the active corpus) and a ceiling (the labelled set itself). Those four reference
points make a precision@k number interpretable instead of decorative. If Kevin's ranking cannot
beat "the most recent five memories" on a corpus built to reward ranking, then `rankScore()` — six
releases of accumulated weighting, recency decay, truth penalties and confidence floors — is
elaborate machinery producing a result a two-line SQL query already produced, and the project needs
to know that before it freezes an API around it.

That is the sense in which this benchmark can fail. §5.3 requires the result to be published
whichever way it comes out, and §11 gate 4 makes a null result a release *finding* rather than a
release *blocker* — the release ships the measurement, not a particular value of it.

---

## 5. Architecture

### 5.1 `plugin/contract.ts` — the surface, as data

The contract is expressed as a value so a test can compare it, not as prose so a human can forget
it.

```ts
export const CONTRACT_VERSION = 1;

/** How a clause may change within the 1.x line. */
export type Stability =
  | "frozen"        // changes only in 2.0.0
  | "forward-only"; // may gain, never lose; old inputs stay readable

export interface ContractClause {
  readonly id: string;        // "C-01" — stable forever, never reused
  readonly title: string;
  readonly stability: Stability;
  /** The release in which the obligation was INCURRED, not declared (principle 35). */
  readonly since: string;
  /** Set only when a clause is superseded; the symbol keeps working for all of 1.x. */
  readonly deprecated?: string;
  readonly replacement?: string;
  readonly value: unknown;    // the frozen data itself
}

export interface PublicContract {
  readonly contractVersion: number;
  readonly clauses: readonly ContractClause[];
}

export function describeContract(input: ContractInput): PublicContract;
export function contractDigest(c: PublicContract): string;
export function diffContract(
  golden: PublicContract,
  live: PublicContract,
): readonly ContractDiff[];

export type ContractDiffKind =
  | "removed"      // fatal — requires 2.0.0
  | "changed"      // fatal — requires 2.0.0
  | "added_ok"     // permitted; carries `since`
  | "added_bare";  // fatal — an addition without `since`
```

The nine clauses, with the release each obligation actually began:

| id | Clause | Stability | since | Contents |
|---|---|---|---|---|
| **C-01** | `AGENTS.md` marker pair | frozen | 0.6.0 | The exact `MARKER_BEGIN` / `MARKER_END` byte sequences, and the splice rule that bytes outside them are preserved verbatim |
| **C-02** | OKF v2 wire format | frozen | 0.8.0 | The three `#` header lines, field names and order, `entry_id` derivation, LF-only, integers-only, sort order, `MAX_LINE_BYTES`, `MAX_ENTRIES` |
| **C-03** | Tool names and argument shapes | frozen | 0.2.0 | All 25 `kevin_*` names with their parameter names, types and optionality. Return shapes are **not** frozen beyond the documented fields |
| **C-04** | Setting keys, types and defaults | frozen | 0.2.0 | All 31 keys, each with its TEXT representation and default. Includes the `'0'`/`'1'` convention as a stated rule |
| **C-05** | Metric key names | frozen | 0.2.0 | All 51 keys. Values are counters; semantics are documented per key |
| **C-06** | Package entry points | frozen | 0.1.0 | `name`, the default export, `exports` conditions and their order, the resolved paths, `engines` |
| **C-07** | Database schema | forward-only | 0.1.0 | Any 1.x Kevin opens any 1.x database. Migrations only add; `schema_version` only advances |
| **C-08** | Filesystem locations | frozen | 0.2.0 | `~/.opencode-kevin/kevin.db`, `refs/`, `skills/`, retrospectives dir, and the repo-relative `.kevin/knowledge.okf` default |
| **C-09** | Behavioural invariants | frozen | 0.8.0 | Zero process spawns, zero network calls, no raw author email written, single write path through `ArtifactWriter.apply()`, and the untrusted-input boundary of §5.7 |

**Enforcement.** `tests/fixtures/contract/v1.json` is the golden file, generated once at
`K10-004` and thereafter append-only. The test computes `diffContract(golden, live)` and fails on
any `removed`, `changed` or `added_bare`. The failure message names the clause id and states the
remedy in two branches — *revert the change*, or *this is a 2.0.0* — because the one outcome to
prevent is a contributor regenerating the golden file to make a red test green.

`contractDigest()` is `fnv1a64` over the canonical JSON of the clause array, with keys sorted and
no floats — the same discipline v0.8.0 imposed on `entry_id`, and for the same reason. It reuses
`fnv1a64` from `plugin/fingerprint.ts` **directly**, never `fingerprint()` and never `normalize()`:
this is a fourth identity dimension alongside `memories.fingerprint`, `tool_calls.fingerprint` and
OKF `entry_id`, and salting or lowercasing it would silently make the digest project-dependent.

`C-09` is included deliberately even though it names absences rather than symbols. "Kevin never
opens a socket" is the single property most likely to be relied on by a security review, and it is
the property most easily lost by a well-meaning patch. Freezing it as a clause means the assertion
lives in the same file as the tool names and is checked by the same test.

### 5.2 `plugin/perf.ts` — measuring the cost

```ts
export type PerfScope =
  | "tool.execute.before"
  | "tool.execute.after"
  | "chat.message"
  | "chat.system.transform"
  | "session.compacting"
  | "event"
  | "session.idle"
  | "dispose";

export interface Budget {
  readonly scope: PerfScope;
  readonly p95Ms: number;   // enforced by `npm run bench:check`
  readonly maxMs: number;   // a single sample above this is a defect
}

export const BUDGETS: readonly Budget[];

export interface PerfStat {
  readonly scope: PerfScope;
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly budget: Budget;
  readonly withinBudget: boolean;
}

export class Perf {
  constructor(opts: { enabled: boolean; capacity?: number });
  measure<T>(scope: PerfScope, fn: () => T): T;
  measureAsync<T>(scope: PerfScope, fn: () => Promise<T>): Promise<T>;
  stats(): readonly PerfStat[];
  flush(store: Store): void;   // called at session.idle only
  reset(): void;
}
```

The declared budgets, and why each number is what it is:

| Scope | p95 | max | Rationale |
|---|---|---|---|
| `tool.execute.before` | 2 ms | 10 ms | Runs before **every** tool call, on the interactive path. Does cache bookkeeping and one timestamp write. |
| `tool.execute.after` | 5 ms | 25 ms | Runs after every tool call and may write a memory. The write is the justification for the wider budget. |
| `chat.message` | 2 ms | 10 ms | Records the user query. Should be near-free. |
| `chat.system.transform` | 15 ms | 50 ms | The expensive one: retrieval, ranking, budget fill. The user waits on this before every model turn. |
| `session.compacting` | 15 ms | 50 ms | Same shape as retrieval, far rarer. |
| `event` | 5 ms | 25 ms | The non-idle branches — session created, tool success/failure routing. |
| `session.idle` | 150 ms | 600 ms | Off the interactive path but on the host's event loop: ledger settle, reflector boosts, pattern mining. Wide, but bounded and measured for the first time. |
| `dispose` | 50 ms | 250 ms | Final flush plus a SQLite close. |

Five rules, each with a test:

1. **The ring is allocated once.** `capacity` (default 512) samples per scope, in a pre-allocated
   `Float64Array` with a write cursor. No array growth, no per-sample object, nothing for the GC to
   do on the hot path.
2. **Disabled is one boolean and a direct call.** When `perf_enabled = '0'`, `measure()` is
   `return fn()` after a single field read — no closure allocation, no try/finally, no clock read.
   The default is `'1'`; the escape hatch exists for users who want the last microsecond, and for
   proving in a test that the instrument's own cost is optional.
3. **`measure()` never throws and never swallows.** The wrapped function's exception propagates
   unchanged; the sample is recorded in a `finally`. This is the deliberate opposite of
   `HookLiveness.wrap()`, which records only on the success path (D9-07) — liveness asks *did the
   host call us*, latency asks *how long did we hold the host*, and a throwing hook held it too.
4. **No database write on the hot path.** Samples live in memory; `flush()` is called from the
   `session.idle` branch, alongside the existing `metrics.flush()`. Writing a `perf_samples` row
   per tool call would make the instrument the most expensive thing it measures.
5. **The clock is monotonic.** `performance.now()`, never `Date.now()`. A clock adjustment during
   a session must not be able to produce a negative duration or a spurious budget breach.

Rule 3's asymmetry with v0.9.0 is worth stating explicitly, because the two wrappers now sit
side-by-side on the same six hooks and an implementer will reasonably ask why they differ. They
differ because they answer different questions, and collapsing them into one wrapper would force
one of the two answers to be wrong.

### 5.3 `scripts/bench.ts` and `bench/corpus/` — measuring the value

**The corpus.** Committed, synthetic, and generated by a committed seeded script so that anyone can
audit or regenerate it:

```
bench/
  corpus/
    memories.jsonl   400 synthetic memories: statement, type, scope,
                     evidence, recurrence, created_at offset (days)
    queries.jsonl    120 queries: { id, context, relevant: string[] }
    README.md        provenance, seed, generation command, labelling rules
  results/
    <iso-date>-<corpusDigest>.json
scripts/
  gen-corpus.ts      seeded generator — xorshift32, no dependency
  bench.ts           the harness
```

`relevant` is the labelled ground truth: for each query, the memory ids a competent human would
want surfaced. The labelling rules live in `README.md` and are mechanical (a memory is relevant to
a query when it shares the query's topic token *and* its scope admits the query's context), so the
labels are themselves reproducible rather than a matter of the author's taste. The corpus digest is
`fnv1a64` over both JSONL files and is printed with every result — a result computed from a
different corpus is a different measurement and must not be comparable by accident.

**The arms.** Four, run over the same corpus, same `k = 5`:

| Arm | Retrieval |
|---|---|
| `none` | returns nothing — the control |
| `recent-k` | the *k* most recently created active memories — the trivial baseline |
| `random-k` | *k* drawn with a fixed seed — the floor |
| `kevin` | the real path: `MemoryService` retrieval with `rankScore()` |

**The measures.** precision@5, recall@5 and MRR per arm, plus per-scope timing from `perf.ts`. The
retrieval numbers are **exactly** reproducible — the same corpus and seed must produce identical
values on any machine, and a test asserts that by running the harness twice in-process and
comparing. Timings are reported with p50/p95 and are explicitly *not* asserted for equality; the
gate on them is the budget in §5.2, not run-to-run stability.

**What this proves and what it does not.** It proves that Kevin's ranking does or does not beat
recency on a corpus constructed to have a ranked answer. It does not prove that a real session's
memories look like this corpus, and it does not prove that a surfaced memory changed what the model
did. Both limits are printed in the harness output and written into `bench/corpus/README.md`, so
the caveat travels with the number rather than living in a plan document nobody reads next to the
result.

**Constraints.** Zero network calls. Zero reads of the user's real database — the harness builds a
temporary store from the corpus and deletes it. No wall-clock dependence in the retrieval half. The
harness must run to completion in under 60 seconds on a laptop, or nobody will run it.

### 5.4 The deprecation policy

Frozen once, in `docs/CONTRACT.md`, and enforced by the shape of `ContractClause`:

1. **Nothing in a `frozen` clause is removed or changed in any 1.x release.** Not renamed, not
   retyped, not given a different default. The remedy for a wrong decision is a new symbol beside
   the old one.
2. **Additions are permitted in any 1.x minor** and must carry `since: "1.N.0"`. An addition
   without `since` fails the contract test as `added_bare` — this is what stops the golden file
   from absorbing accidental changes.
3. **Deprecation marks, it does not remove.** Setting `deprecated: "1.4.0"` and `replacement`
   causes `kevin_contract` and `kevin_doctor` to report the symbol as deprecated. The symbol keeps
   working, unchanged, for the entire 1.x line.
4. **`C-07` is forward-only, not frozen.** Migrations may add tables, columns and indices; they may
   not drop or retype. Any 1.x Kevin opens any 1.x database — that is the actual guarantee, and it
   is the one that lets the schema keep evolving without a major.
5. **A `2.0.0` is the only place a frozen clause changes**, and it must ship a written migration
   path for `C-01` and `C-02` specifically, because those two live in files Kevin does not own.

### 5.5 Packaging, and the supported matrix

`scripts/verify-pack.ts` is a new verifier that operates on the **packed artifact**, because §3.1
demonstrated that everything defective about the published surface is invisible from the working
tree. It runs `npm pack`, extracts the tarball to a temporary directory, and asserts:

1. `package.json#main` and every `exports` target resolve to a file that exists in the tarball.
2. `exports["."]` lists `"types"` **first**.
3. No `.js.map` is present whose `sources` entries are absent from the tarball — satisfied either
   by shipping sources or by not shipping maps (§8 takes the second option).
4. No compiled test or script is packed: no `dist/tests/`, no `dist/scripts/`.
5. `dist/migrations/` contains every `.sql` file in `migrations/`, exactly once, and the root
   `migrations/` copy is **not** packed.
6. `new Migrate(store, <packed dist/migrations>)` enumerates the same file list the repository has
   — the runtime assertion that (5) is not merely a file count.
7. The `..` assumption in `resolveMigrationsDir()` holds for the packed layout: the entry module's
   parent's `migrations` directory is the one containing the SQL.

The declared matrix, each row a CI job that runs the full suite plus `verify-pack`:

| Runtime | SQLite backend | Status |
|---|---|---|
| Node 24.x | `node:sqlite` (stable, no flag) | **Supported** — the reference row |
| Node 22.5+ | `better-sqlite3` (optional dep, must build) | **Supported with a caveat**, stated in the README: without a build toolchain there is no backend |
| Node 22.5+ | `node:sqlite` behind `--experimental-sqlite` | **Works, unsupported** — exercised in CI, not promised |
| Bun ≥ 1.1 | `bun:sqlite` | **Supported** — `scripts/smoke-bun.ts` is wired into `verify` for the first time (§3.3) |

`engines` is corrected to state the honest floor and the README carries the caveat, rather than the
manifest implying a guarantee the ladder cannot keep.

### 5.6 `dispose` joins the instrument, and two new tools

**`dispose` as the seventh hook.** `HookName` in `plugin/HookLiveness.ts` gains `"dispose"`. The
wrapper is applied exactly as the other six, with one difference recorded in D10-08: `dispose`'s
liveness cannot be settled within the session that observes it, so its state is written at the
*start* of the following session — if the previous session recorded work but no `dispose` fire, the
hook is marked dead then. This is the same checkpoint reasoning as v0.9.0 `expect()`, shifted by
one session because the event being detected is the process ending.

**`kevin_contract`** — `{ clause?: string, format?: "summary" | "full" }`. Returns the live
contract, its digest, and per-clause stability, `since`, and any deprecation. With `clause`, returns
one clause's full value. This is what makes the frozen surface inspectable at runtime rather than
only at test time.

```jsonc
{
  "contract_version": 1,
  "digest": "9f2a41c7b8e05d13",
  "package_version": "1.0.0",
  "clauses": [
    { "id": "C-01", "title": "AGENTS.md marker pair", "stability": "frozen",
      "since": "0.6.0", "fields": 2 },
    { "id": "C-07", "title": "Database schema", "stability": "forward-only",
      "since": "0.1.0", "schema_version": "011" }
  ],
  "deprecated": []
}
```

**`kevin_bench`** — `{ action: "status" | "last", }`. Reads `bench_runs`; it does **not** run the
benchmark. Running a benchmark from inside a live session would measure the session and pollute the
user's database, so the harness stays a `npm run bench` script and the tool only reports what that
script recorded.

`kevin_audit` gains a `perf` block (per-scope p50/p95/budget/`within_budget`) and a `contract`
block (digest, version, deprecated count). `kevin_doctor` gains the `dispose` row and, when any
scope is over budget, degrades its verdict to `degraded` with the scope named — a plugin that is
slow is not healthy, even when every hook is live.

### 5.7 The untrusted-input boundary

Kevin's data flow has a property that no release has stated plainly, and a 1.0 that freezes `C-09`
must state it:

```
attacker-influenced bytes
        │
        ▼
  tool stdout/stderr        ← a dependency's postinstall banner, a crafted
        │                     compiler error, a test fixture, a fetched file
        ▼
  ToolCallObserver          ← observed and fingerprinted
        │
        ▼
  Reflector → memories      ← promoted to stored knowledge
        │
        ├──▶ ContextInjector ──▶ **the system prompt**      (v0.2.0)
        ├──▶ Curator ──▶ ArtifactWriter ──▶ **AGENTS.md**   (v0.6.0)
        └──▶ SharedLayer ──▶ **.kevin/knowledge.okf** ──▶ git ──▶ **teammates**
                                                            (v0.8.0)
```

Every arrow after `memories` was added by a later release, and each one lengthened the reach of a
byte that Kevin never chose to trust. The v0.6.0 arrow put attacker-influenced text into a file the
user's other tools read. The v0.8.0 arrow put it into git history and onto other people's machines.
Neither release treated that as a security boundary, because at the time each was reasoning about
merge semantics and write atomicity rather than provenance.

The boundary is therefore declared here, as part of `C-09`, in three rules:

1. **Stored is not trusted.** A memory derived from tool output carries its provenance. Kevin
   already distinguishes `origin` values; the invariant is that anything reaching an artifact or a
   prompt is escaped according to its origin, not according to where it is being written.
2. **Escaping happens at the boundary, once, in `ArtifactWriter`.** Neutralise the sequences that
   let stored text escape its container: the marker pair itself (so no memory can forge
   `<!-- kevin:end -->` and truncate the block), fenced-code delimiters, and anything that would
   terminate an OKF v2 line. The single write path from v0.6.0 D6-01 is what makes one enforcement
   point sufficient, and is the reason this is a small change rather than an audit of every writer.
3. **Sharing requires curation, and curation requires a human.** v0.8.0 already routes
   `kevin_share` through `share_requires_approval`. The invariant is that this cannot be bypassed —
   a memory reaches git only via a human-approved proposal, so the attacker's best case is a
   suggestion a person declines rather than a silent propagation.

This is deliberately not a new subsystem. It is one escaping function, applied at the one place
that writes, plus a test that proves a crafted memory cannot break out of a marker block, an OKF
line or a code fence. The threat model itself is written into `docs/CONTRACT.md` alongside `C-09`,
because a frozen invariant whose rationale lives only in a plan document is one refactor away from
being deleted as dead code.

---

## 6. Migration `011_v10_proven.sql`

```sql
-- =============================================================
-- Kevin v1.0.0 "Proven" — migration 011
-- Adds: perf sampling, benchmark results.
-- No ALTER TABLE (second release running); no column is retyped.
-- =============================================================

-- 1. Per-scope latency aggregates, flushed at session.idle.
--    Machine-scoped: no project_id, for the same reason hook_liveness
--    has none (v0.9.0 D9-08) — latency is a property of the install.
CREATE TABLE IF NOT EXISTS perf_samples (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    scope          TEXT    NOT NULL,
    sample_count   INTEGER NOT NULL,
    p50_ms         REAL    NOT NULL,
    p95_ms         REAL    NOT NULL,
    max_ms         REAL    NOT NULL,
    budget_p95_ms  REAL    NOT NULL,
    within_budget  INTEGER NOT NULL DEFAULT 1,
    recorded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_perf_samples_scope
    ON perf_samples(scope, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_samples_breach
    ON perf_samples(within_budget) WHERE within_budget = 0;

-- 2. Benchmark results. Append-only. One row per arm per run.
CREATE TABLE IF NOT EXISTS bench_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    corpus_digest    TEXT    NOT NULL,
    contract_digest  TEXT    NOT NULL,
    package_version  TEXT    NOT NULL,
    runtime          TEXT    NOT NULL,
    arm              TEXT    NOT NULL,
    k                INTEGER NOT NULL,
    precision_at_k   REAL    NOT NULL,
    recall_at_k      REAL    NOT NULL,
    mrr              REAL    NOT NULL,
    ran_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (arm IN ('none', 'recent-k', 'random-k', 'kevin'))
);

CREATE INDEX IF NOT EXISTS idx_bench_runs_corpus
    ON bench_runs(corpus_digest, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_bench_runs_arm
    ON bench_runs(arm, ran_at DESC);

-- 3. Metric seeds (45 -> 51).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('perf_samples_recorded', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('perf_budget_breaches', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('dispose_fires_total', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('dispose_misses_total', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('contract_digest_changes', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('bench_runs_total', 0);

-- 4. Setting seeds (27 -> 31). All TEXT; '0'/'1' are strings.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_enabled', '1');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_ring_capacity', '512');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_flush_on_idle', '1');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('contract_report_enabled', '1');

-- 5. `dispose` becomes the seventh instrumented hook (v0.9.0 migration 010
--    seeded six rows; this is a data seed, not a schema change).
INSERT OR IGNORE INTO hook_liveness (hook, state) VALUES ('dispose', 'unknown');

-- 6. Schema version.
INSERT OR IGNORE INTO schema_version (version) VALUES ('011');
```

**On `REAL` columns.** v0.8.0 forbade floats in the OKF **file** (D8-13) because byte-determinism
across machines is the property that makes the semilattice merge safely in git. That rule is about
a wire format, not about storage. `perf_samples` and `bench_runs` hold local measurements that are
never serialised into a shared artifact, so `REAL` is correct here — as it already is for
`memories.truth_penalty` since v0.7.0. An implementer who "fixes" these columns to INTEGER for
consistency has misread which boundary the rule guards.

### 6.1 Post-apply hook `"011"`

Registered in `plugin/Migrate.ts` alongside the `"007"`–`"010"` hooks:

1. Seed the `dispose` row in `hook_liveness` if the table exists and the row does not — belt and
   braces with section 5, since a database migrated by a build where 010 ran but its own post-apply
   hook did not would otherwise have a partial hook set.
2. Re-derive `perf_budget_breaches` as `SELECT COUNT(*) FROM perf_samples WHERE within_budget = 0`.
3. Re-derive `bench_runs_total` as `SELECT COUNT(*) FROM bench_runs`.
4. Normalise any `perf_samples.within_budget` NULL to 1 — defensive, and free.

### 6.2 Backward compatibility

Purely additive. Two new tables, four indices, six metric rows, four setting rows, one
`hook_liveness` row. No `ALTER TABLE`, no column retyped, no CHECK constraint widened, no FTS5
trigger touched. A v0.9.0 database opened by v1.0.0 gains the tables and keeps every row.

The reverse direction is the one this release must state precisely, because `C-07` now promises it:
a v1.0.0 database opened by a **v0.9.0** binary works — the older code simply never reads
`perf_samples` or `bench_runs`, and `schema_version` reporting `'011'` is not consulted as a floor
by anything in v0.9.0. That is a property of this particular migration, not a general guarantee,
and `C-07` is therefore worded as *forward*-only: any 1.x Kevin opens any 1.x database that a
**1.x-or-earlier** Kevin wrote. Downgrade below 1.0.0 is out of scope, as it has been since 006.

Idempotency comes from `schema_version`, not from the DDL — every statement here is
`IF NOT EXISTS` or `INSERT OR IGNORE`, but the standing acceptance criterion is unchanged and
unconditional: **run `Migrate.run()` twice against the same database and assert no error and no
duplicate row.**

### 6.3 The migration matrix

`C-07` promises that any 1.x Kevin opens any database a 1.x-or-earlier Kevin wrote. A test that
upgrades a v0.9.0 database proves only the last hop, and the users most exposed to the rest of the
range are the ones least likely to notice: Kevin is a background tool, and someone who installed at
v0.2.0 and returns after 1.0 is a realistic case, not a hypothetical one.

`K10-028` therefore commits one fixture database per historical `schema_version` — `001` through
`010`, ten fixtures — each populated with a handful of representative rows for the tables that
existed at that version, and runs a single `Migrate.run()` against each. The assertions are that
the run succeeds, that `schema_version` reaches `'011'`, that the seeded rows survive with their
values intact, and that a second `Migrate.run()` is a no-op.

Ten fixtures is the whole cost, and it is paid once. What it buys is the difference between a
promise and a tested promise, on the one clause where a failure destroys a user's accumulated
corpus rather than merely inconveniencing them.

---

## 7. Decisions log

| ID | Decision | Rationale |
|---|---|---|
| **D10-01** | **1.0.0 means the clauses in §5.1 change only in a 2.0.0**, and each clause records the release in which the obligation was *incurred*, not the release that declared it. | The alternative — staying on 0.x — is the version number saying "we may break things" while the actual breakage lands in a file Kevin does not own. Kevin has been splicing markers into users' `AGENTS.md` since v0.6.0 and writing lines into users' git history since v0.8.0. Those obligations exist whatever the manifest says. Backdating `since` is not cosmetic: it tells a future maintainer that `C-01` has been depended upon for four releases and that "nobody uses it yet" was never true. |
| **D10-02** | **The contract is enforced by a golden file compared in the test suite**, not by prose in `docs/CONTRACT.md`. The Markdown is generated-adjacent and checked for clause-id parity, but the JSON is the authority. | Prose contracts drift because nothing reads them; a golden file is read on every commit. The known failure mode is a contributor regenerating the golden file to turn a red test green, so the failure message must name the clause and offer exactly two remedies — revert, or open a 2.0.0 — and never print the command that regenerates the fixture. |
| **D10-03** | **`exports` lists `"types"` before `"import"`.** | Conditions match in declaration order. Today the wrong order is harmless only because `declaration: true` emits `index.d.ts` adjacent to `index.js` and TypeScript's sibling fallback finds it. That is a coincidence of output layout, not a property of the manifest, and it evaporates the moment declarations move. Fixing the order costs one line and removes a silent-typings failure that `npm publish` reports as success. |
| **D10-04** | **Source maps are removed from the published package** (`sourceMap: false` in the build config) rather than shipping `.ts` sources to satisfy them. | The two options are ship sources or ship no maps. Shipping sources roughly doubles the tarball to serve a debugging session that a consumer of a *plugin* almost never runs. Shipping maps that resolve to nothing is worse than either, because a debugger follows them, fails, and reports the failure as a defect in the consumer's project. Development keeps maps; only the published build drops them. |
| **D10-05** | **A separate `tsconfig.build.json` with an explicit `rootDir: "plugin"` and `include: ["plugin/**/*.ts"]`**, while the root `tsconfig.json` keeps spanning tests and scripts for editor and `typecheck` use. | This is the fix for §3.1(e), and it must be done in a way that cannot reintroduce it. Narrowing the *root* config would silently relocate the entry point to `dist/index.js`; a separate build config with `rootDir` stated explicitly makes the output layout a declaration rather than an inference. `outDir` becomes `dist/plugin`, which keeps every existing path in `main`, `exports` and `files` valid. |
| **D10-06** | **The root `migrations/` directory is removed from `files`.** `dist/migrations/` is the only copy shipped. | `resolveMigrationsDir()` reads `<entry>/../migrations`, which in the packed layout is `dist/migrations`. The root copy has never been executed by anything and exists in the tarball only because it was listed. Two copies of the schema means a consumer inspecting the package can read SQL that Kevin will never run, and a maintainer can edit the wrong one. |
| **D10-07** | **Verification runs against the packed tarball**, not the working tree. `scripts/verify-pack.ts` executes `npm pack`, extracts, and asserts seven properties (§5.5). | Every defect in §3.1 is invisible from the repository. `npm run verify` today inspects files that are not the artifact anybody installs. A 1.0 that promises `C-06` must check the thing the promise is about. |
| **D10-08** | **`dispose` becomes the seventh instrumented hook, and its liveness is settled at the start of the following session.** | v0.9.0's `expect()` anchors a hook's expectation to a checkpoint *within* the session. `dispose` cannot work that way: the event being detected is the process ending, which the process cannot observe after the fact. Deferring the verdict by one session is the only honest checkpoint — if the previous session recorded work and no `dispose` fire, it did not fire. The consequence of not doing this is losing the final metrics window and the SQLite checkpoint of every session, invisibly and forever. |
| **D10-09** | **`Perf.measure()` records in a `finally`; `HookLiveness.wrap()` records only on success.** The asymmetry is deliberate and documented at both call sites. | They answer different questions. Liveness asks *did the host call us* — a throwing hook still proves the host called it, but D9-07 deliberately excludes the error path so that a hook failing every time is not counted as healthy. Latency asks *how long did we hold the host* — and a hook that threw after 300 ms held it for 300 ms. Collapsing the two wrappers into one would force one of the answers to be wrong. |
| **D10-10** | **Budgets are constants in `plugin/perf.ts`, beside the measurement**, and `npm run bench:check` exits non-zero on a p95 breach. | A budget in a document is a wish. Putting the number in the same file as the code that produces the number it constrains means a change to either is visible in the same diff. The gate is p95 rather than mean because the complaint a user files is about the slow call, not the average one. |
| **D10-11** | **No `perf_samples` write on the hot path.** Samples accumulate in a pre-allocated ring and flush at `session.idle`. | A database write per tool call would make the instrument the most expensive thing it measures, and would do it inside the interactive loop the instrument exists to protect. This is the same discipline `metrics.ts` has followed since v0.2.0, applied to the measurement of that discipline. |
| **D10-12** | **The benchmark is deterministic replay over a committed synthetic corpus, offline, with four arms** (`none`, `recent-k`, `random-k`, `kevin`). | The control and the two baselines are what make a precision number interpretable. Reporting "Kevin achieves precision@5 of 0.62" alone is uninterpretable; reporting it against `recent-k` at 0.55 and `random-k` at 0.11 states how much of the result the ranking is responsible for. A synthetic corpus is a real limitation, accepted because the alternative — real user corpora — would require collecting user data and would end the zero-network posture that `C-09` freezes. |
| **D10-13** | **A null or negative benchmark result is published and the release still ships.** The gate is that the measurement exists and reproduces, not that it flatters the project. | If `kevin` cannot beat `recent-k` on a corpus built to reward ranking, that is the single most valuable thing the project could learn, and it is discoverable only by running the experiment honestly. A gate on the *value* creates an incentive to tune the corpus until the number is good, which would make every subsequent number worthless. §11 gate 4 therefore requires reproducibility and publication, not a threshold. |
| **D10-14** | **`contractDigest()` uses `fnv1a64` directly** — no salt, no `normalize()` — and is declared as a fourth identity dimension alongside `memories.fingerprint`, `tool_calls.fingerprint` and OKF `entry_id`. | `fingerprint()` prepends a project salt (`fingerprint.ts:76`) and `normalize()` lowercases and rewrites paths (`:42`). Either would make the digest of a *global, project-independent* contract vary by project or silently collapse case-distinct tool names. The codebase now has four hash uses with four different rules, which is exactly why each must be named in a decision rather than left for the next implementer to infer from a call site. |
| **D10-15** | **The untrusted-input boundary (§5.7) is frozen as part of `C-09`, and escaping happens once, in `ArtifactWriter`.** | Kevin turns tool output into memories, injects memories into the system prompt, writes them into `AGENTS.md`, and since v0.8.0 commits them to git where teammates receive them. Every one of those arrows was added for a reason unrelated to provenance, and the cumulative effect — attacker-influenced bytes reaching another person's machine — was never stated. Enforcing at `ArtifactWriter` rather than at each writer is possible only because v0.6.0 D6-01 made the write path singular; that decision is what turns a sprawling audit into one function. Putting the rule in `C-09` rather than a new clause is deliberate: it is a behavioural invariant of exactly the kind that clause already holds, and a separate clause would invite treating it as separable. |
| **D10-16** | **`C-07` is proven by a migration matrix from every prior `schema_version`, not by a single upgrade test.** | The roadmap's v1.0.0 scope asks that any v0.x database upgrade in one `Migrate.run()`. A test that upgrades from 010 proves the last hop; it says nothing about a user who installed at v0.2.0, stopped, and returns after 1.0. Those users exist precisely because Kevin is a background tool that people forget they installed. The matrix is cheap — eleven fixture databases, one loop — and it is the only evidence that the forward-only promise in `C-07` covers the range it claims. |

---

## 8. Changes per file

| File | Change | Task |
|---|---|---|
| `package.json` | `version` → `1.0.0`; `exports` reordered (`types` first); `files` drops root `migrations`; `engines` corrected; `build` uses `tsconfig.build.json`; adds `bench`, `bench:check`, `verify:pack` scripts; adds `repository`, `homepage`, `bugs`, `keywords`, `author` | K10-001, K10-002, K10-011 |
| `tsconfig.build.json` | **New.** `rootDir: "plugin"`, `outDir: "dist/plugin"`, `include: ["plugin/**/*.ts"]`, `sourceMap: false`, `declaration: true` | K10-002 |
| `tsconfig.json` | Unchanged in `include`; documented as the editor/`typecheck` config only | K10-002 |
| `scripts/verify-pack.ts` | **New.** Packs, extracts, asserts the seven properties of §5.5 | K10-003 |
| `migrations/011_v10_proven.sql` | **New.** §6 | K10-004 |
| `plugin/Migrate.ts` | Post-apply hook `"011"` | K10-005 |
| `plugin/Retrospective.ts` | `METRIC_KEY_LABELS` +6 | K10-005 |
| `plugin/contract.ts` | **New.** §5.1 — `describeContract`, `contractDigest`, `diffContract` | K10-006, K10-007 |
| `tests/fixtures/contract/v1.json` | **New.** The golden file; append-only after K10-008 | K10-008 |
| `docs/CONTRACT.md` | **New.** The human-readable statement of the nine clauses and the §5.4 policy | K10-009 |
| `plugin/perf.ts` | **New.** §5.2 — ring buffer, `measure`, budgets, stats | K10-010, K10-011 |
| `plugin/index.ts` | `KEVIN_CONFIG_KEYS` +4; `Perf` constructed and threaded through the eight scopes; `perf.flush()` at idle; `dispose` wrapped | K10-005, K10-012, K10-013 |
| `plugin/HookLiveness.ts` | `HookName` gains `"dispose"`; deferred settlement (D10-08) | K10-013 |
| `scripts/gen-corpus.ts` | **New.** Seeded synthetic corpus generator | K10-014 |
| `bench/corpus/*` | **New.** `memories.jsonl`, `queries.jsonl`, `README.md` | K10-014 |
| `scripts/bench.ts` | **New.** Four-arm harness, precision/recall/MRR, `bench_runs` rows | K10-015, K10-016, K10-017 |
| `plugin/tools/kevin_contract.ts` | **New.** §5.6 | K10-018 |
| `plugin/tools/kevin_bench.ts` | **New.** §5.6 — reports, never runs | K10-019 |
| `plugin/tools/kevin_audit.ts` | `perf` and `contract` blocks | K10-020 |
| `plugin/tools/kevin_doctor.ts` | `dispose` row; budget breach degrades the verdict | K10-021 |
| `scripts/verify-install.ts` | Reuses the v0.9.0 enumeration; gains the Bun smoke wiring | K10-022 |
| `scripts/smoke-bun.ts` | Wired into `verify` for the first time | K10-022 |
| `README.md` | Supported matrix, the Node 22 caveat, benchmark results, contract link | K10-023 |
| `docs/Kevin_Roadmap.md` | Ladder marked complete; per-release links; §5.5 correction inherited from v0.9.0 `K9-023`; §5.6 reconciled with what this plan actually scopes | K10-024 |
| `plugin/escape.ts` | **New.** §5.7 — the untrusted-input escaping function | K10-027 |
| `plugin/ArtifactWriter.ts` | Applies `escape.ts` at the single write path | K10-027 |
| `docs/CONTRACT.md` | Gains the §5.7 threat model beside `C-09` | K10-027 |
| `tests/fixtures/schema/` | **New.** One database per historical `schema_version`, 001 … 010 | K10-028 |
| `docs/Kevin_Token_Impact.md` | Replaced by the measured results, or deleted (roadmap §5.6 item 6) | K10-028 |

---

## 9. Tasks

| Phase | IDs | Content |
|---|---|---|
| **F0 — Substrate** | `K10-001` … `K10-005` | Manifest correctness, the build config, the pack verifier, migration 011 and its post-apply hook, config and metric keys |
| **F1 — The contract** | `K10-006` … `K10-009` | `contract.ts`, the diff semantics, the golden file and its enforcement test, `CONTRACT.md` |
| **F2 — The cost** | `K10-010` … `K10-013` | `perf.ts`, budgets and the `bench:check` gate, wiring the eight scopes, `dispose` as the seventh instrumented hook |
| **F3 — The value** | `K10-014` … `K10-017` | The seeded corpus generator, the four-arm harness, the determinism proof, result persistence |
| **F4 — Surface** | `K10-018` … `K10-022` | `kevin_contract`, `kevin_bench`, the `kevin_audit` and `kevin_doctor` blocks, the install verifier and Bun smoke |
| **F5 — Release** | `K10-023` … `K10-028` | README and the supported matrix, the roadmap, the cross-version consistency pass, the untrusted-input boundary, the migration matrix, final verification |

**Critical path.**

```
K10-001 → K10-002 → K10-003 → K10-006 → K10-008 → K10-010 → K10-012
        → K10-015 → K10-016 → K10-027 → K10-023 → K10-026
```

The path runs through the **manifest** first and the **benchmark** last, which inverts the
instinctive order. The reason is D10-07: until `verify-pack` exists (`K10-003`), no later task can
prove that what it changed survives publication — and `K10-001`/`K10-002` are what make the packed
artifact correct enough to be worth verifying. Everything else in the release is measurement, and
measurement of an artifact nobody can install is not worth having.

`K10-027` is on the path because it changes `C-09`, and `C-09` is frozen by `K10-008`: the boundary
must be in the contract before the contract is published, or the first thing 1.1.0 has to do is
break a freeze. `K10-016` (determinism) is on the path and `K10-017` (persistence) is not — a
benchmark that reproduces is the release-blocking property; storing its rows in SQLite is
convenience.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| An LLM-in-the-loop benchmark | Non-reproducible offline; requires a key, a network call and money per run. Violates principle 36 | **Never** in this form |
| Publishing user corpora as benchmark data | Requires collecting user data; ends the zero-network posture that `C-09` freezes | **Never** |
| A hosted results leaderboard | Same objection, plus it makes the project's honesty contingent on a server | **Never** |
| Removing or renaming anything in a frozen clause | That is the definition of the freeze | **2.0.0** |
| Dropping or retyping a database column | `C-07` is forward-only | **2.0.0** |
| A benchmark or statistics dependency | The release's premise is that runtime dependencies went 2 → 1; `vitest` and `performance.now()` cover it | **Never** |
| `publint` / `arethetypeswrong` as devDependencies | Their findings are adopted; the tooling is replaced by seven assertions in `verify-pack.ts` | **Never** |
| A `postinstall` verification hook | Rejected in v0.9.0 and again here — disabled in many CI environments, and a failure reads as a supply-chain attack | **Never** |
| Shipping `.ts` sources to make source maps resolve | Doubles the tarball for a debugging session a plugin consumer rarely runs (D10-04) | **Never** |
| Downgrade support below 1.0.0 | Out of scope since migration 006 | **Never** |
| Per-scope budget overrides as user settings | A budget the user can raise is not a budget. `perf_enabled` is the only escape hatch | **Never** |
| Real-corpus retrieval evaluation | Would require a corpus Kevin is not allowed to collect. The synthetic limitation is stated in the results rather than engineered around | **Post-1.0** |
| A TUI panel for contract or perf | Deferred from v0.9.0 for the same reason: the plugin TUI surface is not on the `latest` tag | **Post-1.0** |
| Continuous regression tracking of benchmark results across releases | Needs more than one published result to be meaningful | **1.1.0** |

---

## 11. Final verification

### 11.1 The four standing gates

| # | Gate | Command |
|---|---|---|
| 1 | Types | `npm run typecheck` |
| 2 | Lint | `npm run lint` |
| 3 | Tests | `npm test` |
| 4 | Install | `npm run verify` |

### 11.2 Release-specific checks

1. `Migrate.run()` executed **twice** against the same database produces no error and no duplicate
   row. `schema_version` reports `'011'`.
2. A v0.9.0 database opened by v1.0.0 gains `perf_samples` and `bench_runs` and retains every
   pre-existing row, verified by row counts before and after.
3. A v1.0.0 database opened by a v0.9.0 binary still starts and operates — the concrete meaning of
   `C-07` (§6.2).
4. `KEVIN_CONFIG_KEYS` contains all 31 setting keys and `METRIC_KEY_LABELS` all 51 metric keys,
   asserted by a test that **derives both lists from `migrations/*.sql`** rather than restating
   them.
5. `npm pack` → extract → the seven assertions of §5.5 all pass, run by `npm run verify:pack`.
6. The packed tarball contains no `dist/tests/`, no `dist/scripts/`, no `.js.map`, and exactly one
   copy of each migration.
7. A clean consumer project — its own `node_modules`, nothing inherited from this repo — imports
   the packed tarball and resolves both the default export and its types, under Node 22, Node 24
   and Bun.
8. `describeContract()` compared to `tests/fixtures/contract/v1.json` yields zero diffs of kind
   `removed`, `changed` or `added_bare`.
9. Renaming any tool, setting or metric key in the source makes the contract test fail, and the
   failure message names the clause id. Verified by a test that mutates a copy of the live surface
   in-process rather than by editing the source.
10. Every clause id in the golden file appears in `docs/CONTRACT.md`, and vice versa.
11. `contractDigest()` is stable across two processes and two working directories — the proof that
    D10-14 was honoured and no project salt leaked in.
12. With `perf_enabled = '0'`, `measure()` performs no clock read and allocates nothing, asserted
    by a counter injected in place of `performance.now()`.
13. Every scope's p95 is within its budget across the benchmark run; `npm run bench:check` exits
    non-zero when any is not, verified by temporarily lowering one budget in a test.
14. No `perf_samples` row is written during a simulated 200-tool-call session; exactly one flush
    occurs at `session.idle`.
15. A session that records work and never fires `dispose` causes the following session to mark the
    hook dead and increment `dispose_misses_total`.
16. `npm run bench` completes offline with the network unavailable, touches no path under the
    user's home directory, and finishes in under 60 seconds.
17. `npm run bench` run twice yields **identical** precision@5, recall@5 and MRR for all four arms,
    and identical `corpus_digest`.
18. The `random-k` arm scores below `recent-k`, and both are reported. If `kevin` does not exceed
    `recent-k`, the release still ships and the result is published (D10-13).
19. The benchmark harness opens no database under `~/.opencode-kevin/` — asserted by pointing
    `HOME` at a temporary directory and verifying it stays empty.
20. Zero process spawns and zero network calls across the whole suite, re-asserted from v0.8.0 and
    now also covering `scripts/bench.ts` and `scripts/gen-corpus.ts`.
21. `tests/unit/v09_regression_guard.test.ts` asserts that no test file predating v1.0.0 was
    modified by this release.
22. The full suite passes on Node 22 (`better-sqlite3`), Node 24 (`node:sqlite`) and Bun
    (`bun:sqlite`) — the three supported rows of §5.5.
23. A memory whose statement contains the literal `<!-- kevin:end -->` cannot terminate the marker
    block when curated into `AGENTS.md`; the written file still contains exactly one `begin`/`end`
    pair and re-parses to the same block.
24. A memory containing a newline, a `"` and a `\` round-trips through OKF v2 as **one** line, and
    a memory containing a fenced-code delimiter cannot break out of a code fence in the rendered
    block.
25. No path exists from an unapproved memory to `.kevin/knowledge.okf`, asserted by a test that
    attempts the write with `share_requires_approval = '1'` and no approval, and by a call-site
    scan showing `SharedLayer.applyExport()` is reachable only from `kevin_share`.
26. Each of the ten fixture databases (`schema_version` 001 … 010) upgrades to `'011'` in a single
    `Migrate.run()`, retains its seeded rows with unchanged values, and is a no-op on a second run.
27. `docs/Kevin_Token_Impact.md` either states measured numbers traceable to a committed results
    file, or is gone. A document of estimates is not permitted to survive alongside a measurement.

---

## 12. Summary of changes

| Dimension | v0.9.0 | v1.0.0 |
|---|---|---|
| Package version | `0.4.0` (five releases stale) | `1.0.0` |
| Public contract | Undeclared, unenforced | 9 clauses, golden-file enforced |
| `exports` condition order | `import` first (works by adjacency) | `types` first (works by declaration) |
| Published source maps | Shipped, resolve to nothing | Not shipped |
| Build input | `plugin/` + `scripts/` + `tests/` | `plugin/` only, explicit `rootDir` |
| Migrations in tarball | Two copies | One |
| Verification target | The working tree | The packed tarball |
| Self-measurement | **None** — zero clock reads | 8 scopes, p50/p95, enforced budgets |
| Instrumented hooks | 6 | 7 (`dispose`) |
| Value evidence | Internal counters only | 4-arm benchmark, reproducible, offline |
| Untrusted-input boundary | Undeclared; tool output reaches git | Declared, escaped at one point, frozen in `C-09` |
| Migration guarantee | Tested from the previous version | Tested from every schema version 001 … 010 |
| Tools | 23 | 25 |
| Metric keys | 45 | 51 |
| Settings keys | 27 | 31 |
| Tables | 18 | 20 |
| Runtime dependencies | 1 | 1 |
| Supported matrix | Asserted | Three CI rows, caveat stated |

---

## 13. References

- `docs/Kevin_v0.5.0_Plan.md` — "Glass Box": attribution, the injection ledger.
- `docs/Kevin_v0.6.0_Plan.md` §5.1, D6-02 — the marker contract frozen here as `C-01`.
- `docs/Kevin_v0.7.0_Plan.md` §5.3, D7-04 — the truth penalty and `REAL` precedent cited in §6.
- `docs/Kevin_v0.8.0_Plan.md` §5.3–5.4, D8-05, D8-06, D8-13 — the OKF v2 format frozen here as
  `C-02`, and the integer-only rule whose boundary §6 clarifies.
- `docs/Kevin_v0.9.0_Plan.md` §5.3, D9-07, D9-08 — `HookLiveness`, extended here by one hook, and
  the success-path rule whose asymmetry with `Perf` is recorded in D10-09.
- `@opencode-ai/plugin@1.18.16`, `dist/index.d.ts:173-174` — `dispose?: () => Promise<void>`.
- Node.js documentation, `node:sqlite` stability — the basis for the §5.5 matrix rows.
- Semantic Versioning 2.0.0 — the meaning §5.4 adopts for the 1.x line.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 — Substrate | `K10-001` … `K10-005` | ⬜ Pending |
| F1 — The contract | `K10-006` … `K10-009` | ⬜ Pending |
| F2 — The cost | `K10-010` … `K10-013` | ⬜ Pending |
| F3 — The value | `K10-014` … `K10-017` | ⬜ Pending |
| F4 — Surface | `K10-018` … `K10-022` | ⬜ Pending |
| F5 — Release | `K10-023` … `K10-028` | ⬜ Pending |

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

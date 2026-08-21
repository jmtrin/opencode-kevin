# Opencode-kevin — Implementation Plan v0.9.0

**Version:** 0.9.0
**Date:** 2026-08-11
**Status:** Ready for implementation
**Paradigm:** Observe → Verify → Learn → Prove → Publish → Share → **Attach**
**Codename:** "Native"
**Type:** Implementation plan
**Author:** Opus-5 (xHigh)

**Inputs:**

- `plugin/` at v0.8.0 — the module set after "Team"; every defect cited below carries a `file.ts:line` reference or a primary-source artifact.
- `plugin/index.ts:5-6` — `import type { Plugin } from "@opencode-ai/plugin"` and `import { tool } from "@opencode-ai/plugin"`, the entire host contract as it stands.
- `plugin/index.ts:54` — `export const KevinPlugin: Plugin = async (input, options) => { … }`, the v1 factory signature.
- `plugin/index.ts:597, 615, 669, 684, 702, 731` — the six lifecycle hooks Kevin registers, two of them `experimental.`-prefixed.
- `plugin/index.ts:175` — the `tool: { … }` block, Kevin's ten (v0.8.0: twenty-one) tool registrations.
- `plugin/index.ts:68` — `const projectId = fingerprint(process.cwd())`, retained here because the host offers a better answer and Kevin has never asked for it.
- `package.json` — `dependencies: { "@opencode-ai/plugin": "^1.17.6", "zod": "^3.23.8" }`, the pin held unchanged across v0.6.0, v0.7.0 and v0.8.0.
- `package-lock.json` — the resolved tree, which disagrees with the pin in a way §3.4 treats as evidence rather than trivia.
- **`@opencode-ai/plugin@1.17.6` and `@1.18.16` registry tarballs** — unpacked and compared byte-for-byte; every claim in §3 and §4 about the host surface is taken from `dist/*.d.ts` in those archives, not from documentation.
- `docs/Kevin_v0.6.0_Plan.md` §5.5, D6-13 — `Materializer` and the `capabilities.ts::probe()` duck-typing contract, which this release replaces with a typed registration and keeps as the fallback.
- `docs/Kevin_v0.8.0_Plan.md` §3.5, §10, D8-01 — the zero-spawn/zero-socket boundary, and the two items deferred to this release.
- `docs/Kevin_Roadmap.md` §4, §5.5 — the version ladder and this release's scope, **which §3.1 contradicts on primary evidence and this plan therefore restates**.

---

## 1. Executive Summary

| Dimension | Value |
|---|---|
| Codename | "Native" |
| Paradigm shift | Kevin stops guessing at the host and starts asking it |
| New files | `plugin/host.ts`, `plugin/HookLiveness.ts`, `plugin/native.ts`, `migrations/010_v09_native.sql` |
| Modified files | `plugin/index.ts`, `plugin/Migrate.ts`, `plugin/Materializer.ts`, `plugin/Retrospective.ts`, `plugin/tools/kevin_audit.ts`, `scripts/verify-install.ts`, `package.json` |
| Dependency change | **`zod` removed.** `@opencode-ai/plugin` moved `^1.17.6` → `^1.18.16`. Net runtime dependencies: 2 → 1 |
| Tools | 21 → 23 |
| Metric keys | 39 → 45 |
| Settings keys | 23 → 27 |
| Migration | `010_v09_native.sql` |
| Tasks | 24 (`K9-001` … `K9-024`) |
| Process spawns | 0 (unchanged, and now provably a choice — §3.6) |
| Network calls | 0 (unchanged) |

**Exit criterion.** Kevin can state, at runtime and in a machine-checkable form, exactly which host
capabilities it holds and which it has lost. Concretely: with `hook_liveness_enabled = '1'`, a
session that completes a prompt cycle without `experimental.chat.system.transform` ever firing
causes `kevin_doctor` to report that hook as **dead** and `injections_suppressed_dead_hook` to
increment, rather than Kevin reporting zero injections and no fault; the same run against a host
that does fire it reports **live** and injects normally. The v2 surface is attached by addition:
with `native_registration_enabled = '1'` on a host exposing `@opencode-ai/plugin/v2/promise`,
Kevin's curated skill is registered through `skill.transform` and no file is written to
`~/.opencode-kevin/skills/`; with the setting off, or on a host without the subpath, the v0.6.0
file emission runs unchanged and every v0.8.0 test still passes. `npm ls zod` reports a single
copy, resolved by the host, and `grep -r 'from "zod"' plugin/ tests/ scripts/` returns nothing.

---

## 2. Philosophy — "Native"

### 2.1 What carries over

v0.8.0 made the corpus shareable: `repo_id` survives the clone, OKF v2 merges through a
semilattice that git cannot disagree with, and the write path stayed singular. Nothing in that
model changes here. This release does not touch `okf.ts`, `SharedLayer.ts`, `RepoIdentity.ts`,
`Curator.ts`'s predicate, or `rankScore()`. The corpus is settled.

What is not settled is the **ground Kevin stands on**. Every release since v0.2.0 has assumed a
host contract that was never verified against the host, only against a type declaration that
happened to be installed at the time. Kevin registers six lifecycle hooks; two of them are marked
`experimental.` by the vendor; every hook in the interface is optional; the pin is a caret. Put
those four facts together and Kevin's most important capability — injecting knowledge into a
prompt — can be removed by a patch release of somebody else's package, at which point Kevin
continues to run, continues to observe, continues to write memories, and silently stops being
useful. No error is thrown, because nothing failed. A key that nobody reads is not an error.

That is the gap this release closes, and it is the last structural gap before v1.0.0 can honestly
freeze anything.

### 2.2 Before and after

```
BEFORE (v0.8.0)                          AFTER (v0.9.0)
──────────────────────────────           ──────────────────────────────

package.json                             package.json
  @opencode-ai/plugin ^1.17.6              @opencode-ai/plugin ^1.18.16
  zod ^3.23.8  ← never imported            (zod removed — tool.schema is the host's)
       │                                        │
       ▼                                        ▼
  node_modules/zod        3.25.76          node_modules/zod  4.1.8 (one copy, the host's)
  .../plugin/node_modules/zod 4.1.8
  two majors, one used

index.ts                                 index.ts
  const projectId =                        const host = probeHost(input)
    fingerprint(process.cwd())             const projectId =
       │                                     fingerprint(host.worktree ?? process.cwd())
       │  host already knew                       │
       │  (input.project, input.worktree,         │  asked, recorded, degradable
       │   input.directory)                       │
       ▼                                          ▼
  hooks = {                                hooks = liveness.wrap({
    "tool.execute.before":  …                "tool.execute.before":  …
    "tool.execute.after":   …                "tool.execute.after":   …
    "chat.message":         …                "chat.message":         …
    "experimental.chat.system.transform"     "experimental.chat.system.transform"
    "experimental.session.compacting"        "experimental.session.compacting"
    event:                  …                event:                 …
  }                                        })
       │                                          │
       │  optional keys. a rename                 │  first fire is recorded per hook
       │  is not an error. it is                  │  a hook that never fires becomes
       │  silence.                                │  DEAD, counted, and reported
       ▼                                          ▼
  injections quietly stop                  kevin_doctor says which capability
  metrics show zero, no fault              was lost, when, and what degraded

Materializer (v0.6.0)                    Materializer + native.ts
  writes ~/.opencode-kevin/                 if host.v2.skill:
    skills/project-knowledge.md               skill.transform(draft =>
    refs/<topic>.md                             draft.source(kevinSkill))
       │                                      else:
       │  speculative. hopes the host           write the file exactly as before
       │  scans that directory.                     │
       ▼                                            ▼
  no confirmation, ever                     typed registration, or the old
                                            path — never both, never neither
```

### 2.3 Principles

Continuing the global numbering (v0.4 11–14, v0.5 15–18, v0.6 19–22, v0.7 23–26, v0.8 27–30):

| # | Principle | Consequence in this release |
|---|---|---|
| **31** | **A capability you cannot observe is a capability you do not have.** | Every hook Kevin registers is wrapped so its first invocation is recorded. A hook that has never fired in a session that should have fired it is reported as dead, not assumed live. `kevin_doctor` exists so the answer is one command away rather than a log-reading exercise. |
| **32** | **Adopt a new surface by addition. Never migrate off a load-bearing one on a promise.** | The v2 subpath is attached alongside the v1 factory, never in place of it. v2 has no `tool`, `chat`, `session` or `event` domain (§3.2); a migration would delete observation and injection outright. Kevin adopts precisely the two v2 domains that do more than the v1 path could, and not one more. |
| **33** | **Declare the dependency you actually use, and none that you do not.** | `zod` is removed from `dependencies`: Kevin has zero `from "zod"` imports and reaches the host's own zod through `tool.schema`. Declaring it forced a second major of zod into every user's tree to be used by nobody. |
| **34** | **Register natively before you emit speculatively.** | Where the host offers a typed registration for something Kevin currently achieves by writing a file and hoping, the registration wins and the file is not written. Where it does not, the file path is unchanged. The two are mutually exclusive by construction, so a host upgrade can never produce both. |

---

## 3. The evidence base — what the host actually offers

Everything in this section was obtained by downloading `@opencode-ai/plugin@1.17.6` and
`@1.18.16` from the npm registry, unpacking both tarballs, and reading `dist/*.d.ts` and
`package.json`. No claim here rests on documentation or on memory. Every one of them can be
re-derived in under a minute, and `K9-002` turns the load-bearing ones into tests.

### 3.1 There is no v2 major, and the roadmap says there is

`docs/Kevin_Roadmap.md` §5.5 scopes this release as a migration to "the v2 `define()` / domain
plugin API", with the pin raised above `^1.17.6`. The registry disagrees:

| Query | Answer |
|---|---|
| `dist-tags.latest` | **`1.18.16`** |
| Versions matching `2.*` | **none** — 0 of 10 697 published versions |
| `dist-tags.latest-1` | `1.1.4` |

There is no 2.x to migrate to. What exists is a **subpath inside the 1.x package**:
`@opencode-ai/plugin/v2/promise` and `@opencode-ai/plugin/v2/effect`, added to `exports` between
`1.17.6` and `1.18.16`. "v2" names an API generation, not a package version, and the distinction
matters because it means the v1 surface is not deprecated, not sunset, and not going anywhere on
any announced schedule — it is shipping in the same tarball.

This plan therefore restates the release rather than executing the roadmap's version of it. The
roadmap is corrected in the same pass (`K9-023`); a plan that knowingly implements a false premise
is worth less than no plan.

### 3.2 What v2 is, and what it cannot host

`dist/v2/promise/plugin.d.ts`, in full:

```ts
import type { PluginContext } from "./context.js";
export interface Plugin {
    readonly id: string;
    readonly setup: (context: PluginContext) => Promise<void> | void;
}
export declare function define(plugin: Plugin): Plugin;
export interface PluginDomain {
    readonly add: (plugin: Plugin) => Promise<void>;
    readonly remove: (id: string) => Promise<void>;
}
```

And `dist/v2/promise/plugin.js`, also in full — 54 bytes:

```js
export function define(plugin) {
    return plugin;
}
```

`define()` is the identity function. It exists to attach a type, nothing else. Adopting it costs
one import and buys compile-time checking of the `{ id, setup }` shape; it is neither a framework
nor a commitment, which is exactly why it is safe to adopt in the same release that refuses to
migrate.

The substance is `PluginContext` (`dist/v2/promise/context.d.ts`):

```ts
export interface PluginContext {
    readonly options: PluginOptions;
    readonly agent: AgentHooks & Reload;
    readonly aisdk: AISDKHooks;
    readonly catalog: CatalogHooks & Reload;
    readonly command: CommandHooks & Reload;
    readonly integration: IntegrationHooks & Reload;
    readonly plugin: PluginDomain;
    readonly reference: ReferenceHooks & Reload;
    readonly skill: SkillHooks & Reload;
}
```

Nine members. Now place Kevin's six lifecycle hooks against them:

| Kevin's v1 hook | `plugin/index.ts` | v2 equivalent |
|---|---|---|
| `tool.execute.before` | L597 | **none** — no `tool` domain |
| `tool.execute.after` | L615 | **none** |
| `chat.message` | L669 | **none** — no `chat` domain |
| `experimental.chat.system.transform` | L684 | **none** |
| `experimental.session.compacting` | L702 | **none** — no `session` domain |
| `event` | L731 | **none** — no `event` domain |
| `tool: { … }` registration | L175 | **none** — `integration.transform` is not tool registration |

Seven of seven have no v2 equivalent. **Migrating Kevin to v2 today would delete its ability to
observe tool calls, to see user messages, to inject into a system prompt, and to act on session
lifecycle — that is, all of it.** This is not a judgement call or a risk assessment; it is a
missing-member list, and `K9-002` asserts it as a test so that the day it stops being true, Kevin
finds out from a failing build rather than from a rumour.

What v2 *does* offer that v1 does not is registration of the things v0.6.0's `Materializer` writes
to disk and hopes for (`dist/v2/promise/skill.d.ts`, `reference.d.ts`, and the `effect/` variants
which carry the concrete draft shapes):

```ts
export interface SkillDraft {
    source(source: SkillV2Source): void;
    list(): readonly SkillV2Source[];
}
export interface ReferenceDraft {
    add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void;
    remove(name: string): void;
    list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[];
}
```

That is the whole of the native opportunity, and §5.4 takes exactly it.

One further detail decides which flavour Kevin uses. `dist/v2/effect/registration.d.ts` types every
hook as returning `Effect.Effect<Registration, never, Scope.Scope>` and imports from `"effect"`;
`dist/v2/promise/registration.d.ts` returns `Promise<Registration>` and imports nothing. The
`effect/` flavour would make a beta-versioned functional-effects runtime a hard dependency of a
plugin whose entire value proposition is that it costs one dependency. Kevin uses `promise/`
(D9-04).

### 3.3 Optional hooks, experimental names, and silence as a failure mode

`dist/index.d.ts` declares `interface Hooks` with **21 members, every one of them optional**, six
of them `experimental.`-prefixed:

```
event?  config?  tool?  auth?  provider?  dispose?
chat.message?  chat.params?  chat.headers?
permission.ask?  command.execute.before?
tool.execute.before?  tool.execute.after?  tool.definition?
shell.env?
experimental.chat.messages.transform?
experimental.chat.system.transform?      ← Kevin's injection path
experimental.provider.small_model?
experimental.session.compacting?         ← Kevin's compaction path
experimental.compaction.autocontinue?
experimental.text.complete?
```

Kevin returns an object literal with six of these keys. Consider what happens when the host renames
`experimental.chat.system.transform` — the ordinary fate of a name whose prefix is a warning label:

1. The host iterates the hooks it knows about and calls the ones a plugin supplied.
2. Kevin supplied a key the host no longer looks for.
3. The key is never read. No lookup fails, because nobody looks.
4. Kevin injects nothing, forever, on every session.
5. `injections_total` stays at zero. So does `injections_blocked_*`, `injections_effective`, and
   every other counter — because the code path that increments them is downstream of a hook that
   is not being called.
6. Nothing is logged. Nothing throws. `npm test` passes, because Kevin's tests call
   `injector.onSystemTransform()` directly.

The failure is indistinguishable, from every instrument Kevin currently has, from "a user who
never accumulated any memories". That is the worst possible shape for a fault: it looks like the
product working correctly on an empty corpus.

TypeScript does not save this. It checks Kevin's object literal against the `Hooks` interface **at
Kevin's build time**, against whatever version was installed then. Users install a built `dist/`.
The host that invokes it may be any later 1.x (§3.4). There is no build step between the two.

### 3.4 The pin does not mean what the plan documents said it meant

Three releases of documentation have described the pin as "unchanged at `^1.17.6`", with the
implication that the host surface is therefore fixed. `package-lock.json` records what actually
resolved:

```
"node_modules/@opencode-ai/plugin": {
  "version": "1.17.13",
  ...
  "dependencies": { "@ai-sdk/provider": "3.0.8", "@opencode-ai/sdk": "1.17.13",
                    "effect": "4.0.0-beta.83", "zod": "4.1.8" }
}
```

`1.17.13`, not `1.17.6`. The caret did its job and floated seven patch versions, silently and
correctly. Caret auto-adoption is not a hypothetical risk to be weighed; it has already happened
in this repository, and the plan documents did not notice. Any argument of the form "the surface
cannot change because the pin is unchanged" is void.

The compensating good news is measurable and, for once, entirely reassuring:

| Artifact | `1.17.6` | `1.18.16` | Same? |
|---|---|---|---|
| `dist/index.d.ts` | 9285 B | 9285 B | **SHA-256 identical** |
| `dist/tool.d.ts` | 1527 B | 1527 B | identical |
| `dist/shell.d.ts` | 3248 B | 3248 B | identical |
| `dist/tui.d.ts` | 17 540 B | 17 573 B | differs |
| `dist/v2/**` | absent | 34 files | added |

The entire v1 hook surface is **byte-identical across eleven minor versions**. Moving the pin to
`^1.18.16` therefore cannot change any hook Kevin uses — a falsifiable claim, re-checked by
`K9-002` against both tarballs. The v2 subtree is purely additive. This is what makes the bump
safe to take in the same release that adds liveness detection: the bump is provably inert, so any
liveness failure the new machinery reports is a real one and not an artifact of the upgrade.

Bumping does pull `@ai-sdk/provider@3.0.8` into the tree as a transitive dependency of the host
package. It is not added to Kevin's `dependencies`, Kevin does not import it, and §3.5 removes
more weight than this adds.

### 3.5 `zod` is declared, installed, and never used

`package.json` declares `"zod": "^3.23.8"`. A search across `plugin/`, `scripts/` and `tests/` for
`from "zod"` returns **zero matches**. Every schema in the codebase — 25 occurrences across the ten
tool definitions — is written against `tool.schema`:

```ts
kevin_save: tool({
	args: {
		type: tool.schema.enum([...]),
		content: tool.schema.string().min(1),
		scope: tool.schema.enum(["project", "session"]).default("project"),
		...
```

`tool.schema` is declared in `dist/tool.d.ts` as `var schema: typeof z`, where `z` is imported by
that file from the **host package's own zod**. Kevin has, without ever writing it down, already
been doing the right thing: it uses the host's schema library rather than its own.

The declared dependency is therefore a phantom, and not a harmless one:

```
node_modules/zod                                 3.25.76   ← Kevin's. Imported by nothing.
node_modules/@opencode-ai/plugin/node_modules/zod 4.1.8    ← the host's. Used by everything.
```

A **major-version split**, duplicated in every install, to satisfy an import that does not exist.
Worse, it is a trap laid for the next contributor: `import { z } from "zod"` typechecks, resolves
to 3.25.76, and produces schema objects that the host will hand to zod 4 — two incompatible
internal representations meeting at a package boundary, with a validation bug rather than a
compile error as the outcome. Removing the declaration removes the trap along with the download.

Dropping it takes Kevin from two runtime dependencies to one, which is a claim v1.0.0 will want to
make and cannot make retroactively.

### 3.6 The host answers questions Kevin currently guesses

`dist/index.d.ts` types the argument Kevin already receives at `plugin/index.ts:54`:

```ts
export type PluginInput = {
    client: ReturnType<typeof createOpencodeClient>;
    project: Project;
    directory: string;
    worktree: string;
    experimental_workspace: { register(type: string, adapter: WorkspaceAdapter): void };
    serverUrl: URL;
    $: BunShell;
};
```

Kevin uses `input` for none of this. At `plugin/index.ts:68` it computes
`fingerprint(process.cwd())` while holding a parameter containing `project`, `directory` and
`worktree`. The host's own `ToolContext` documents the preference in a doc comment:

> `worktree`: Project worktree root for this session. Useful for generating stable relative paths.
> `directory`: Current project directory for this session. **Prefer this over `process.cwd()`**
> when resolving relative paths.

`process.cwd()` is the working directory of the *editor process*, which is not reliably the
project root, is not stable across a session, and is exactly what v0.8.0 §3.2 identified as the
reason a corpus does not survive a `git clone`. v0.8.0 solved that with a three-source
`RepoIdentity.resolve()`. This release adds the source that should have been first all along —
the host's own answer — as a **preferred input to the existing chain**, not a replacement for it
(§5.2). The chain's ordering, its confirmation requirement and its refusal to re-key automatically
are untouched.

There is one more line in that type worth naming explicitly, because it changes the status of a
claim made in v0.8.0:

```ts
    $: BunShell;
```

The host hands every plugin a shell. Kevin's zero-spawn property (v0.8.0 §3.5, D8-01) is therefore
**not a limitation of the platform — it is a decision Kevin makes while holding the means to do
otherwise.** That is a considerably stronger statement than the one v0.8.0 made, and `K9-002`
asserts it: `input.$` exists, and `plugin/` contains no reference to it.

### 3.7 The migration list nobody has read since v0.2.0

Deferred here from v0.8.0 §10. `scripts/verify-install.ts:61-79` enumerates migration files by
literal name, each under an `existsSync` guard:

```
001_initial.sql        ✓ listed
002_indexes.sql        ✗ ABSENT
003_v02_signal.sql     ✓ listed
004_v03_knowledge.sql  ✓ listed
005_v04_signal.sql     ✓ listed
```

`002_indexes.sql` exists on disk and has never been in the list. Six releases have shipped a
verification script that silently skips a real migration, and it has gone unnoticed for precisely
the reason the omission is dangerous: the `existsSync` guard means a *missing* file is also
silent. The script cannot fail. It can only decline to check things.

Each of v0.5.0 through v0.8.0 carries a task to append the new filename to this list — four more
chances to forget, in a mechanism whose entire failure mode is being forgotten. `K9-021` replaces
the enumeration with a directory read and makes an empty or short result a hard error.

---

## 4. Ecosystem review — what to build on, and what to refuse

### 4.1 Refused

| Option | Why not |
|---|---|
| **Migrate to `@opencode-ai/plugin/v2/promise`** | §3.2. Seven of Kevin's seven host integration points have no v2 equivalent. This is the roadmap's stated plan and it is not implementable; saying so is the single most valuable output of this release's research. |
| **Adopt `@opencode-ai/plugin/v2/effect`** | Makes `effect@4.0.0-beta.83` — a beta-versioned functional-effects runtime — a hard dependency, in a release whose other half is *removing* a dependency. The `promise/` flavour is type-identical in intent and costs nothing (D9-04). |
| **Pin exactly (`1.18.16`, no caret)** | Freezes Kevin out of patch-level fixes and guarantees a stale peer against a host that ships daily. The caret is not the problem; the absence of any check on what the caret produced is the problem (§3.4). Detection, not immobility. |
| **A `postinstall` script that compares the installed `index.d.ts` against a recorded hash** | Turns a supply-chain observation into an install-time failure for users who did nothing wrong, and `postinstall` scripts are a category the ecosystem is actively moving away from. The same signal is available at runtime, where it can be reported instead of thrown. |
| **Vendor the host's type declarations into the repo** | A copy that drifts, silently, in the same way §3.4 describes. The tarball is the source of truth and is one `npm view` away; `K9-002` reads it rather than mirroring it. |
| **Wrap every hook in a try/catch and infer liveness from absence of throw** | Confuses *did not fail* with *did run*. The failure in §3.3 produces no throw at all, so a catch-based instrument reports perfect health during total loss of function. Liveness must be recorded on the success path or it measures nothing. |
| **A background timer that pings the host** | A hot-path cost and a new failure mode to answer a question that the ordinary flow of a session already answers for free, provided anybody writes the answer down. |
| **TUI panels for curation and conflict review** (roadmap §5.5) | `dist/tui.d.ts` exists, but every TUI entry point in the package's `peerDependencies` is `@opentui/*`, optional, and pinned `>=0.4.5` against a package that reached `0.4.5` recently and whose plugin surface ships under the `tui-v2` and `snapshot-tui-plugins` dist-tags rather than `latest`. Building Kevin's review UX on it now would attach the release's schedule to a moving target for a convenience feature. Deferred to post-1.0, explicitly, in §10. |

### 4.2 Chosen

| Option | Why |
|---|---|
| **`^1.18.16`, taken on proof rather than faith** | The v1 surface is byte-identical to `1.17.6` (§3.4), so the bump is provably inert with respect to every hook Kevin uses, while making the v2 subpath resolvable. A bump that can be *demonstrated* not to change behaviour is the only kind worth taking in a release that also adds behaviour-change detection. |
| **Remove `zod`** | §3.5. It is imported by nothing, duplicates a major version in every install, and is a live trap for the next contributor. |
| **`define()` from `v2/promise`, for the additive surface only** | 54 bytes, identity function, pure typing. Attaches `skill.transform`/`reference.transform` without touching the v1 factory. |
| **Runtime liveness recording on the success path** | Principle 31. The instrument has to be inside the thing being measured. |
| **`probeHost(input)` — duck-typed, zero-throw** | Extends the v0.6.0 `capabilities.ts::probe()` contract (D6-13) rather than inventing a second one. Reads only what `input` already contains and what a dynamic `import()` either resolves or does not. |

### 4.3 The one thing v2 does better, and why it is worth the wiring

v0.6.0's `Materializer` writes `~/.opencode-kevin/skills/project-knowledge.md` and
`~/.opencode-kevin/refs/<topic>.md`, then stops. It has no way to learn whether the host ever read
them. D6-13 was honest about this — the emission is default-off (`skill_emission_enabled = '0'`,
`reference_emission_enabled = '0'`) precisely because it could not be confirmed. Three releases
later those settings are still off by default, which is the correct outcome of an unverifiable
mechanism and also a feature that has never actually run for anybody.

`skill.transform` and `reference.transform` replace hope with a call. `SkillDraft.source()` takes
the skill; `SkillDraft.list()` reads back what is registered, so Kevin can assert its own
registration succeeded — the confirmation the file path never had. That, and only that, is what
justifies importing a second API generation into a plugin that otherwise refuses to grow.

---

## 5. Architecture

### 5.1 `plugin/host.ts` — asking instead of assuming

```ts
export type HostFlavour = "v1-only" | "v1+v2";

export interface HostSurface {
	/** Semver of @opencode-ai/plugin as resolved at runtime, or null if unreadable. */
	pluginVersion: string | null;
	flavour: HostFlavour;
	/** Fields Kevin was handed and previously ignored (§3.6). */
	project: { id: string | null; worktree: string | null; directory: string | null };
	/** True when the host handed Kevin a shell. Recorded, never used (§3.6). */
	hasShell: boolean;
	/** Resolvable v2 domains, by duck-typed probe. Empty on a v1-only host. */
	v2: { skill: boolean; reference: boolean };
	/** Non-fatal reasons a probe returned false — surfaced by kevin_doctor. */
	notes: string[];
}

export async function probeHost(input: unknown): Promise<HostSurface>;
export function summarize(s: HostSurface): string;
```

`probeHost()` obeys the v0.6.0 probe contract (D6-13) and extends it:

1. **It never throws.** Every read is guarded; every failure appends to `notes` and yields a
   conservative `false`. A host that changes shape produces a degraded `HostSurface`, never an
   exception during plugin construction — a throw there takes down the editor's plugin load, which
   is a far worse outcome than a missing feature.
2. **It is duck-typed, not `instanceof`-typed.** `input` is read with `typeof` and `in` checks
   only. Kevin never asserts the host's classes.
3. **The v2 probe is a dynamic `import()` in a `try`.** `await import("@opencode-ai/plugin/v2/promise")`
   resolves on `1.18.x` and rejects on `1.17.x` — the subpath is simply absent from `exports`
   there. The rejection is the probe result, and it is the only honest way to ask, because the
   answer depends on the resolved package rather than on the declared range.
4. **It runs exactly once**, at plugin construction, and the result is frozen. A capability that
   appears mid-session would be indistinguishable from a bug.

`summarize()` renders a stable single-paragraph description used by `kevin_doctor` and
`kevin_status`. It contains no paths and no identifiers beyond the version string, so it is safe to
paste into an issue report — which is the entire point of having it.

### 5.2 Identity: prefer the host's answer, keep the chain

v0.8.0's `RepoIdentity.resolve(cwd)` resolves in order: `.kevin/project.json#id` → `.git/config`
remote → `fingerprint(process.cwd())`. Only the last of those three is affected here.

```ts
export type IdentitySource = "declared" | "remote" | "host" | "path";

export function resolve(cwd: string, host?: HostSurface): ResolvedIdentity;
```

The chain becomes **declared → remote → host → path**, with `host` reading
`HostSurface.project.worktree` (falling back to `.directory`). Three properties are deliberate:

- **The new source is third, not first.** `.kevin/project.json` still wins, because an explicit
  declaration is the mechanism monorepos and remoteless repositories depend on, and D8-03's
  human-confirmed re-keying is built on it. The host's answer is better than `process.cwd()`, not
  better than a human's.
- **It is inserted above `path`, not in place of it.** `worktree` may be absent or empty on a host
  that changes shape; `fingerprint(process.cwd())` remains the terminal fallback so `resolve()`
  stays total.
- **Adding it changes no existing installation's `repo_id`.** For any checkout that already
  resolved via `declared` or `remote` — which is every git checkout — the new source is never
  consulted. It only displaces `path`, and it does so for exactly the installations where `path`
  was producing the wrong answer. `K9-006` asserts this by resolving a fixture corpus under both
  the v0.8.0 and v0.9.0 chains and requiring byte-identical `repo_id` values wherever a remote or a
  declaration exists.

Re-keying remains explicit, confirmed and transactional. Nothing about D8-03 changes.

### 5.3 `plugin/HookLiveness.ts` — the instrument

```ts
export type HookName =
	| "tool.execute.before" | "tool.execute.after" | "chat.message"
	| "experimental.chat.system.transform" | "experimental.session.compacting" | "event";

export type LivenessState = "live" | "dead" | "unknown";

export interface HookReport {
	hook: HookName;
	experimental: boolean;
	state: LivenessState;
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	fireCount: number;
	/** Sessions that reached a checkpoint where this hook should already have fired. */
	expectedCount: number;
}

export class HookLiveness {
	/** Wraps a hooks object, recording the first and latest invocation of each key. */
	wrap<T extends Record<string, unknown>>(hooks: T): T;
	/** Called at a point in the session where `hook` must already have fired. */
	expect(hook: HookName, sessionID: string): void;
	report(): HookReport[];
	flush(): void;
}
```

The mechanism is deliberately small, because an instrument that can fail is not an instrument.

**`wrap()`** returns a new object with the same keys, each value replaced by a function that
records the call and then delegates. It records **after** delegation returns, on the success path
only — recording before would report a hook as live when it throws on every invocation, and
recording in a `finally` would do the same. A hook that always throws is not live; it is a
different fault, counted separately as `hook_errors_total`.

**`expect()`** is what makes `dead` meaningful, and it is the whole design. Liveness cannot be
inferred from a hook not having fired *yet* — most hooks legitimately do not fire in a given
second. It can only be inferred at a checkpoint where the hook's firing is guaranteed by the
host's own contract. Kevin has exactly one such checkpoint that it already observes:
`tool.execute.after` firing for a session means that session reached a model turn, which means
the system prompt was assembled, which means `experimental.chat.system.transform` must have been
offered. So `expect("experimental.chat.system.transform", sessionID)` is called from the
`tool.execute.after` path, once per session, and a hook with `expectedCount > 0 && fireCount === 0`
is **dead**. Everything else is `unknown`, and `unknown` is reported as `unknown` rather than
rounded to either side.

State is persisted per hook in `hook_liveness` (§6) so the signal survives a restart and so
`kevin_doctor` can answer "since when". Writes are debounced through the existing `metrics.flush()`
cadence and never occur inside a hot-path hook body (D9-07).

**What Kevin does with a dead injection hook.** Nothing automatic. It counts
`injections_suppressed_dead_hook`, marks the state, and surfaces it. There is no fallback
injection path — `experimental.chat.messages.transform` exists and is tempting, but silently
switching to a *different* experimental hook when one experimental hook disappears is how a
project ends up depending on four of them. The correct response to a lost capability is to report
it (D9-06).

### 5.4 `plugin/native.ts` — the additive v2 surface

```ts
import { define } from "@opencode-ai/plugin/v2/promise";

export interface NativeRegistration {
	registered: { skill: boolean; reference: boolean };
	verified: { skill: boolean; reference: boolean };
	notes: string[];
}

export function buildNativePlugin(deps: {
	materializer: Materializer;
	settings: SettingsReader;
}): Plugin;

export async function attachNative(
	host: HostSurface,
	deps: { materializer: Materializer; settings: SettingsReader },
): Promise<NativeRegistration | null>;
```

`attachNative()` returns `null` — cleanly, with a `note` — whenever the host lacks the subpath or
`native_registration_enabled` is `'0'`. That is the default on every existing installation, so the
default behaviour of this release is byte-identical to v0.8.0.

When it does attach:

```ts
export const KevinNative = define({
	id: "opencode-kevin",
	setup: async (ctx) => {
		await ctx.skill.transform(async (draft) => {
			draft.source(kevinSkillSource);
		});
		await ctx.reference.transform(async (draft) => {
			for (const [name, source] of curatedReferences) draft.add(name, source);
		});
	},
});
```

Four properties carry the design:

1. **Registration replaces emission; they are never both active.** `Materializer` gains a single
   guard: when `attachNative()` returned a registration for a given surface, the corresponding
   `*_emission_enabled` path is skipped. Expressed as a table, because this is the part an
   implementer will get wrong:

   | `native_registration_enabled` | v2 subpath present | Skill outcome |
   |---|---|---|
   | `'0'` | either | file emission, exactly as v0.6.0 |
   | `'1'` | no | file emission, exactly as v0.6.0, `note` recorded |
   | `'1'` | yes | `skill.transform` registration, **no file written** |

   `K9-016` asserts the third row leaves `~/.opencode-kevin/skills/` untouched, and the second row
   byte-identical to v0.8.0's output.

2. **Registration is verified, not assumed.** After `draft.source()`, Kevin calls `draft.list()`
   and checks its own entry is present. This is the confirmation the file path never had (§4.3),
   and it sets `NativeRegistration.verified`. An unverified registration is a `note` and a metric,
   not a throw.

3. **`draft.add()`/`draft.source()` are called only inside the transform callback.** The draft is
   a mutable builder valid for the duration of that call; retaining it is a defect that would
   surface as a mutation with no effect, or worse, an effect at an undefined time. `K9-014`
   asserts no reference to a draft escapes the callback.

4. **The v2 import is dynamic and isolated to this module.** `plugin/native.ts` is the only file
   in the repository permitted to name `@opencode-ai/plugin/v2/promise`, and it is reached only
   through `attachNative()`, which is only called when `host.v2.*` is true. On a `1.17.x` host the
   module's import never executes. `K9-013` asserts the containment with a source scan, and
   `K9-002` asserts Kevin still constructs successfully against the `1.17.6` type surface.

### 5.5 Tools 21 → 23

**`kevin_doctor {}`** — the release's user-visible payoff, and the reason liveness is worth
persisting. Pure reads, no writes, safe to run at any time:

```json
{
  "host": {
    "plugin_version": "1.18.16",
    "flavour": "v1+v2",
    "shell_available": true,
    "v2": { "skill": true, "reference": true }
  },
  "hooks": [
    { "hook": "tool.execute.after", "experimental": false,
      "state": "live", "fire_count": 1284, "expected_count": 96 },
    { "hook": "experimental.chat.system.transform", "experimental": true,
      "state": "dead", "fire_count": 0, "expected_count": 96,
      "since": "2026-08-09T11:02:14Z" }
  ],
  "dependencies": { "declared": ["@opencode-ai/plugin"], "zod_copies": 1 },
  "native": { "enabled": true, "registered": { "skill": true, "reference": false },
              "verified": { "skill": true, "reference": false } },
  "verdict": "degraded",
  "reason": "injection hook dead since 2026-08-09; 96 sessions affected"
}
```

`verdict` is one of `healthy`, `degraded`, `unknown`, computed in pure SQL and TypeScript with no
model call. `degraded` requires at least one hook in state `dead`; `unknown` is returned when no
session has yet reached a checkpoint, and is never rounded to `healthy` — a system that has not
been observed is not a system that is working.

**`kevin_native {action: "show" | "enable" | "disable", confirm?: boolean}`** — inspects and toggles
`native_registration_enabled`. `enable` on a host without the subpath succeeds and reports that
registration is inert, rather than refusing: the setting is a statement of intent that becomes
effective when the host catches up, and refusing would make the setting untestable on the majority
of installations.

`kevin_status` gains a one-line host summary from `summarize()`. `kevin_audit` gains a `host`
block carrying the same data as `kevin_doctor.hooks` in aggregate form, so a single audit run
captures it alongside the v0.7.0 `mix` and v0.8.0 `team` blocks.

---

## 6. Migration `010_v09_native.sql`

```sql
-- ============================================================
-- Kevin v0.9.0 "Native" — host surface and hook liveness
-- Migration 010. Additive only. No table rebuild.
-- ============================================================

-- 1. Hook liveness. Deliberately NOT project-scoped: a hook is a
--    property of the host binary, not of a checkout. One row per
--    hook name, updated in place. See D9-08.
CREATE TABLE IF NOT EXISTS hook_liveness (
	hook            TEXT PRIMARY KEY,
	experimental    INTEGER NOT NULL DEFAULT 0,
	fire_count      INTEGER NOT NULL DEFAULT 0,
	error_count     INTEGER NOT NULL DEFAULT 0,
	expected_count  INTEGER NOT NULL DEFAULT 0,
	first_seen_at   TEXT,
	last_seen_at    TEXT,
	dead_since      TEXT,
	plugin_version  TEXT
);

CREATE INDEX IF NOT EXISTS idx_hook_liveness_dead
	ON hook_liveness(dead_since);

-- 2. Host probe history. Append-only. Off by default; exists so a
--    user chasing an intermittent fault can turn it on and get a
--    timeline instead of a single current value.
CREATE TABLE IF NOT EXISTS host_probes (
	id              TEXT PRIMARY KEY,
	probed_at       TEXT NOT NULL DEFAULT (datetime('now')),
	plugin_version  TEXT,
	flavour         TEXT NOT NULL,
	has_shell       INTEGER NOT NULL DEFAULT 0,
	v2_skill        INTEGER NOT NULL DEFAULT 0,
	v2_reference    INTEGER NOT NULL DEFAULT 0,
	notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_host_probes_at
	ON host_probes(probed_at);

-- 3. Native registration outcomes. One row per attach attempt, so
--    "registered but unverified" is a queryable state rather than a
--    log line.
CREATE TABLE IF NOT EXISTS native_registrations (
	id              TEXT PRIMARY KEY,
	attached_at     TEXT NOT NULL DEFAULT (datetime('now')),
	surface         TEXT NOT NULL CHECK (surface IN ('skill', 'reference')),
	registered      INTEGER NOT NULL DEFAULT 0,
	verified        INTEGER NOT NULL DEFAULT 0,
	note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_registrations_surface
	ON native_registrations(surface, attached_at);

-- 4. Metric seeds (39 -> 45).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
	('hook_fires_total',                0),
	('hook_errors_total',               0),
	('hooks_dead_total',                0),
	('injections_suppressed_dead_hook', 0),
	('native_registrations_total',      0),
	('native_registration_failures',    0);

-- 5. Setting seeds (23 -> 27).
--    hook_liveness_enabled defaults ON: it is a read-only instrument
--    on the success path, and an instrument nobody switches on is an
--    instrument nobody has.
--    native_registration_enabled defaults OFF: it changes where a
--    curated skill comes from, and that is a change a user opts into.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
	('hook_liveness_enabled',       '1'),
	('native_registration_enabled', '0'),
	('host_probe_history_enabled',  '0'),
	('dead_hook_report_threshold',  '3');

-- 6. Version marker.
INSERT OR IGNORE INTO schema_version (version) VALUES ('010');
```

### 6.1 Post-apply hook `"010"`

Registered in `Migrate.ts` alongside the `"007"`, `"008"` and `"009"` hooks:

1. Seed one `hook_liveness` row per name in `HookName`, with `experimental` set from the
   `experimental.` prefix and every counter at zero. Seeding here rather than lazily on first fire
   means a hook that has *never* fired is a visible row with `fire_count = 0` rather than an absent
   row indistinguishable from a hook Kevin does not register.
2. Re-derive `hooks_dead_total` from `SELECT COUNT(*) FROM hook_liveness WHERE dead_since IS NOT NULL`.
3. Normalize any `hook_liveness.experimental` that disagrees with the `experimental.` prefix of its
   own `hook` column — cheap, and it repairs a row hand-edited during debugging.

### 6.2 Backward compatibility

Three new tables and no `ALTER TABLE` at all: this is the first migration since 006 that adds no
column to `memories`. A v0.8.0 binary opening a v0.9.0 database sees three tables it does not know
about and behaves identically, because nothing it queries has changed. A v0.9.0 binary opening a
v0.8.0 database runs `Migrate.run()` and reaches parity.

Idempotency comes from `schema_version`, as in every release since 002 — every statement above is
`IF NOT EXISTS` or `INSERT OR IGNORE`, but the criterion is unchanged and unchanged for a reason:
**run `Migrate.run()` twice against the same database and assert the second run is a no-op**
(`K9-001`).

The `CHECK (surface IN ('skill', 'reference'))` on `native_registrations` is the one constraint
here that could bite a future release, and it is deliberate: that column is a closed enumeration
of surfaces Kevin has verified it can register against, and widening it should require the same
scrutiny as adding one. Contrast `memories.layer` in v0.8.0, which took no CHECK precisely because
its value space was expected to grow (D8-07). The distinction is intentional, not an inconsistency.

---

## 7. Decisions log

| ID | Decision | Rationale |
|---|---|---|
| **D9-01** | Kevin does **not** migrate to the v2 API. The v1 factory remains the sole host integration for observation, injection, session lifecycle and tool registration. | §3.2, on primary evidence: v2's `PluginContext` exposes `agent`, `aisdk`, `catalog`, `command`, `integration`, `plugin`, `reference`, `skill` — and no `tool`, `chat`, `session` or `event` domain. All seven of Kevin's host integration points are in the missing set. A migration would not degrade Kevin; it would delete it. The roadmap said otherwise and the roadmap is wrong; `K9-023` corrects it. This decision is re-evaluated when, and only when, `K9-002`'s assertion that those domains are absent starts failing. |
| **D9-02** | The v2 surface is attached **by addition**, through `define()` from `@opencode-ai/plugin/v2/promise`, and only for `skill.transform` and `reference.transform`. | Principle 32. These are the two places where v2 does something v1 cannot: it lets Kevin register curated knowledge and read back a confirmation, replacing the v0.6.0 emission that writes a file and never learns whether anything consumed it. Everything else in `PluginContext` either duplicates what Kevin already has or belongs to concerns Kevin does not touch. |
| **D9-03** | The pin moves `^1.17.6` → `^1.18.16`, justified by a byte-level comparison rather than by release notes. | `dist/index.d.ts` is SHA-256 identical between the two versions (9285 bytes, unchanged across eleven minors), so no hook Kevin registers can behave differently. `dist/v2/**` is purely additive. The bump is provably inert with respect to Kevin's v1 surface, which is what makes it safe to take in the same release that starts detecting host-surface changes — any liveness fault reported afterwards is a real one, not an upgrade artifact. |
| **D9-04** | Kevin uses `v2/promise`, never `v2/effect`. | `v2/effect/registration.d.ts` types every hook as `Effect.Effect<Registration, never, Scope.Scope>` and imports from `"effect"`, which would make `effect@4.0.0-beta.83` — a beta — a hard dependency. `v2/promise` returns plain promises and imports nothing. Taking on a beta functional-effects runtime in the release that removes a dependency would be incoherent. |
| **D9-05** | `zod` is removed from `dependencies` entirely. | §3.5: zero `from "zod"` imports exist; all 25 schema expressions use `tool.schema`, which is the host package's own zod. The declaration forced zod 3.25.76 into every tree beside the host's zod 4.1.8 — a duplicated major used by nobody, and a trap that makes `import { z } from "zod"` typecheck while producing schema objects the host's zod 4 cannot consume. Runtime dependencies go 2 → 1. |
| **D9-06** | A dead hook is **reported, never routed around**. Kevin does not fall back to a different hook when one disappears. | `experimental.chat.messages.transform` exists and would technically serve as an alternative injection point. Silently switching to a second experimental hook when the first vanishes converts one unowned dependency into two, hides the very signal this release exists to produce, and means the next removal is diagnosed against a system whose behaviour nobody can any longer predict. The correct response to a lost capability is to say so. |
| **D9-07** | Liveness is recorded **after** the wrapped hook returns, on the success path only, and never written to the database from inside a hook body. | Recording before delegation would mark a hook that throws on every call as live. Recording in a `finally` would do the same. A hook that always throws is a distinct fault with a distinct counter (`hook_errors_total`). Database writes ride the existing `metrics.flush()` cadence, because the hot-path rule has held since v0.2.0 and a liveness instrument that costs a synchronous write per tool call would be the most expensive thing in the plugin. |
| **D9-08** | `hook_liveness` is **not** project-scoped, and carries no `project_id` or `repo_id`. | A hook is a property of the host binary. The database is global (`plugin/index.ts:56`), so a single row per hook name is the honest cardinality. Scoping it per project would produce N copies of one machine-wide fact, disagreeing with each other whenever one project happened not to exercise a code path, and would make the `dead` verdict depend on which directory the user last worked in. |
| **D9-09** | `dead` requires a **checkpoint**, not a timeout. A hook is dead only when `expected_count >= dead_hook_report_threshold` and `fire_count = 0`. | Absence of a call is not evidence of absence of the hook; most hooks legitimately idle. The only sound inference runs from a point where the host's own contract guarantees the hook was offered: `tool.execute.after` firing for a session proves that session reached a model turn, which proves a system prompt was assembled. The threshold (default 3 sessions) keeps a single anomalous session from producing a false alarm. Anything not proven live and not proven dead is reported `unknown`, never rounded. |
| **D9-10** | Native registration and file emission are **mutually exclusive**, resolved at attach time, with emission as the default. | Both active would put a curated skill in front of the model twice, from two sources that can disagree. Neither active would silently remove a feature on hosts that gained the subpath. The three-row table in §5.4 is exhaustive and each row has a test. Emission is the default because `native_registration_enabled` seeds to `'0'`, so this release changes nothing for anyone until they opt in. |
| **D9-11** | The v2 import is confined to `plugin/native.ts` and is dynamic. | A static import of a subpath absent from `1.17.x`'s `exports` map is a module-resolution failure at load time — the plugin would fail to construct on every host older than `1.18.0`, converting an optional enhancement into a hard requirement. A dynamic `import()` inside a `try` makes absence a probe result. The containment is asserted by source scan (`K9-013`) so no second file can quietly acquire the dependency. |
| **D9-12** | `probeHost()` never throws, runs exactly once at construction, and freezes its result. | A throw during plugin construction takes down the host's plugin load — strictly worse than any missing feature. Probing once and freezing means a capability cannot appear mid-session, where it would be indistinguishable from a bug; a host upgrade takes effect on the next start, which is when the user expects it. |
| **D9-13** | The host's `worktree` is inserted into `RepoIdentity.resolve()` as the **third** source, above `path` and below `declared` and `remote`. | It is strictly better than `process.cwd()` — the host's own `ToolContext` documents "prefer this over `process.cwd()`" — but it is not better than an explicit `.kevin/project.json`, which is the mechanism monorepos and D8-03's confirmed re-keying depend on. Inserting it above `path` displaces the source that was producing wrong answers and leaves every existing git checkout's `repo_id` byte-identical, which `K9-006` proves against a v0.8.0 fixture. |
| **D9-14** | `scripts/verify-install.ts` enumerates `migrations/` from disk, and a short or empty read is a **hard error**. | The hard-coded list has silently omitted `002_indexes.sql` for six releases (§3.7), and every `existsSync` guard means the script's only failure mode is declining to check. Enumeration removes the per-release chance to forget; failing loudly on a suspiciously small result removes the failure mode that hid the omission. A verification script that cannot fail verifies nothing. |

---

## 8. Changes per file

| File | Change | Tasks |
|---|---|---|
| `migrations/010_v09_native.sql` | **New.** Three tables, four indices, six metric seeds, four setting seeds, `schema_version '010'`. No `ALTER TABLE`. | `K9-001` |
| `plugin/Migrate.ts` | Register `010`; add the post-apply hook `"010"` (seed one row per `HookName`, re-derive `hooks_dead_total`, normalize `experimental`). | `K9-001` |
| `plugin/host.ts` | **New.** `HostSurface`, `probeHost()`, `summarize()`. Duck-typed, zero-throw, runs once, result frozen. | `K9-004` |
| `plugin/HookLiveness.ts` | **New.** `wrap()`, `expect()`, `report()`, `flush()`. Records on the success path only; never writes to the database from inside a hook body. | `K9-009`, `K9-010`, `K9-011` |
| `plugin/native.ts` | **New.** The only file permitted to name `@opencode-ai/plugin/v2/promise`, and only through a dynamic `import()`. `buildNativePlugin()`, `attachNative()`. | `K9-013` … `K9-015`, `K9-017` |
| `plugin/RepoIdentity.ts` | Insert `"host"` as the third `IdentitySource`, above `path`. Ordering, confirmation and re-key semantics unchanged. | `K9-006` |
| `plugin/Materializer.ts` | Skip the emission path for any surface `attachNative()` registered. No other change; the rendering is untouched. | `K9-016` |
| `plugin/index.ts` | Call `probeHost(input)` at construction; pass `host` to `RepoIdentity.resolve()`; wrap the hooks object in `HookLiveness.wrap()`; call `expect()` from the `tool.execute.after` path; register `kevin_doctor` and `kevin_native`; extend `KEVIN_CONFIG_KEYS` with the four new settings. | `K9-003`, `K9-004`, `K9-006`, `K9-009`, `K9-010`, `K9-018`, `K9-019` |
| `plugin/Retrospective.ts` | Extend `METRIC_KEY_LABELS` with the six new metric keys (39 → 45). | `K9-003` |
| `plugin/ContextInjector.ts` | Increment `injections_suppressed_dead_hook` when the injection hook is `dead`. No change to ranking, budget or gate order. | `K9-011` |
| `plugin/tools/kevin_audit.ts` | Add the `host` block: hook states in aggregate, plugin version, native registration outcomes. Pure SQL. | `K9-020` |
| `scripts/verify-install.ts` | Replace the hard-coded filename list at lines 61-79 with a `readdirSync` of `migrations/`, sorted, filtered to `*.sql`; a result shorter than the known floor is a hard error. | `K9-021` |
| `package.json` | Version `0.9.0`. **`zod` removed.** `@opencode-ai/plugin` → `^1.18.16`. | `K9-005`, `K9-007`, `K9-024` |
| `docs/Kevin_Roadmap.md` | Correct §5.5: there is no v2 major and no migration. Record the additive scope actually implemented. | `K9-023` |
| `README.md`, `AGENTS.md` | Document `kevin_doctor`, `kevin_native`, the four settings, and the dependency reduction. | `K9-023` |

---

## 9. Tasks

| Phase | IDs | Content |
|---|---|---|
| **F0 Substrate** | `K9-001` … `K9-004` | Migration `010` and its post-apply hook, the host-contract assertion suite, config and metric key registration, `probeHost()`. |
| **F1 Ground truth** | `K9-005` … `K9-008` | Remove `zod`; insert the host identity source; raise the pin on byte-level proof; persist probe history and surface it in `kevin_status`. |
| **F2 Liveness** | `K9-009` … `K9-012` | `wrap()`, the checkpoint and `dead` computation, the error path and suppression counter, the `verdict` reducer. |
| **F3 Native** | `K9-013` … `K9-017` | `native.ts` and its containment, skill registration with read-back verification, reference registration, mutual exclusion with emission, outcome persistence. |
| **F4 Surfacing** | `K9-018` … `K9-021` | `kevin_doctor`, `kevin_native`, the `kevin_audit` host block, and the `verify-install.ts` enumeration. |
| **F5 Release** | `K9-022` … `K9-024` | End-to-end degradation drill, documentation and roadmap correction, version bump and a full gate run. |

**Critical path.** `K9-001` → `K9-004` → `K9-009` → `K9-010` → `K9-012` → `K9-018` → `K9-022` → `K9-024`.

The path runs through liveness rather than through native registration, and that ordering is the
release's thesis: the instrument is the deliverable, the v2 attachment is the bonus. F3 can slip
to a later release without invalidating anything in F0 through F2; F2 cannot slip at all, because
without it v1.0.0 would be freezing a public contract over a host dependency nobody is watching.

---

## 10. Out of scope

| Item | Reason | Destination |
|---|---|---|
| Migrating observation, injection or tool registration to v2 | The domains do not exist (§3.2, D9-01) | When `K9-002` starts failing |
| `@opencode-ai/plugin/v2/effect` | Would make `effect@4.0.0-beta.83` a hard dependency (D9-04) | **Never**, while `promise/` exists |
| TUI curation and conflict-review panels | `@opentui/*` peers are optional and moving; the plugin TUI surface ships under `tui-v2`/`snapshot-*` tags, not `latest` (§4.1) | **Post-1.0** |
| Automatic fallback to a second injection hook when the first dies | Converts one unowned dependency into two and hides the signal (D9-06) | **Never** |
| Pinning the host exactly, or vendoring its type declarations | Immobility and drift respectively; detection is the answer (§4.1) | **Never** |
| A `postinstall` host-compatibility check | Install-time failure for users who did nothing wrong (§4.1) | **Never** |
| Using `input.$` (the shell the host provides) | D8-01's zero-spawn boundary is a decision, and this release only makes it a *provable* one (§3.6) | **Never** |
| Reporting `unknown` liveness as healthy | A system that has not been observed is not a system that is working (D9-09) | **Never** |
| Widening `native_registrations.surface` beyond `skill`/`reference` | Closed enumeration by design (§6.2) | Requires the same scrutiny as adding a surface |
| Adopting `tool.definition`, `chat.params`, `permission.ask` or the other unused v1 hooks | Real capabilities, but each is a feature in its own right rather than infrastructure this release needs | **Post-1.0** |
| Removing the `experimental.` hooks from Kevin | They are load-bearing and there is no non-experimental equivalent; the answer is observation, not abstinence | — |

---

## 11. Final verification

### 11.1 The four gates

| Gate | Command | Requirement |
|---|---|---|
| Types | `npm run typecheck` | Zero errors, against `^1.18.16` **and** against a `1.17.6` install |
| Lint | `npm run lint` | Zero findings |
| Tests | `npm test` | Full suite green; every v0.8.0 test still passes unmodified |
| Install | `npm run verify` | Passes, enumerates **six** migrations, and fails loudly if fewer |

### 11.2 Release-specific checks

1. **Migration idempotency.** `Migrate.run()` twice against the same database; the second run is a
   no-op and `schema_version` holds a single `'010'`.
2. **Post-apply seeding.** After `"010"`, `hook_liveness` holds exactly one row per `HookName`,
   with `experimental = 1` for precisely the two `experimental.`-prefixed names.
3. **The v2 domains are still absent.** A test reads the resolved `@opencode-ai/plugin`'s
   `dist/v2/promise/context.d.ts` and asserts `PluginContext` declares no `tool`, `chat`, `session`
   or `event` member. **This test is designed to fail one day**, and its failure is the signal to
   revisit D9-01.
4. **The v1 surface is unchanged by the bump.** A test asserts the SHA-256 of the resolved
   `dist/index.d.ts` matches the recorded digest for `1.17.6`. If a future host changes the v1
   surface, this fails before anything subtler does.
5. **Construction against the old host.** Kevin's plugin factory constructs successfully with
   `@opencode-ai/plugin@1.17.6` installed, with `host.v2` false and every v0.8.0 behaviour intact.
6. **No `zod` import, one `zod` copy.** `grep -r 'from "zod"' plugin/ tests/ scripts/` returns
   nothing; `package.json` declares no `zod`; the installed tree contains exactly one zod, owned by
   the host package.
7. **The shell is present and unused.** `input.$` is defined at construction, and `plugin/`
   contains zero references to it.
8. **Identity equivalence.** For a fixture checkout with a git remote, `resolve()` under the
   v0.9.0 chain yields a `repo_id` byte-identical to the v0.8.0 chain. The host source is consulted
   only when both `declared` and `remote` are absent.
9. **Liveness records on success only.** A hook that returns normally increments `fire_count`; a
   hook that throws increments `error_count` and leaves `fire_count` at zero.
10. **Dead requires a checkpoint.** With `dead_hook_report_threshold = '3'`, a hook with
    `expected_count = 2, fire_count = 0` is `unknown`; at `expected_count = 3` it becomes `dead`.
11. **Dead is reported, not routed around.** With the injection hook dead, no alternative hook is
    registered or invoked, `injections_suppressed_dead_hook` increments, and
    `kevin_doctor.verdict` is `degraded`.
12. **No hot-path database write.** A source scan asserts `HookLiveness` performs no `prepare`/`run`
    inside `wrap()`'s delegate; persistence occurs only on the `metrics.flush()` cadence.
13. **v2 containment.** Exactly one file in the repository names `@opencode-ai/plugin/v2/promise`,
    it is `plugin/native.ts`, and the reference is inside a dynamic `import()`.
14. **Registration is verified.** After `skill.transform`, `draft.list()` contains Kevin's entry;
    `NativeRegistration.verified.skill` is true. A stub host whose `list()` omits it yields
    `verified: false`, a `note`, and no throw.
15. **The draft does not escape.** A source scan asserts no draft parameter is assigned to
    module or instance scope.
16. **Mutual exclusion, all three rows.** The §5.4 table is exercised exhaustively: emission-only,
    emission-with-note, and registration-without-file. In the third, `~/.opencode-kevin/skills/` is
    untouched; in the first two, the emitted bytes match v0.8.0 exactly.
17. **Default behaviour is unchanged.** With the seeded defaults
    (`native_registration_enabled = '0'`), a full v0.8.0 e2e run produces byte-identical artifacts
    and identical metric deltas.
18. **`verify-install.ts` enumerates.** It reports all six migrations including `002_indexes.sql`,
    and exits non-zero when `migrations/` is emptied.
19. **The roadmap no longer claims a v2 migration.** `docs/Kevin_Roadmap.md` §5.5 matches D9-01.

---

## 12. Summary of what changed from v0.8.0

| Area | v0.8.0 | v0.9.0 |
|---|---|---|
| Runtime dependencies | `@opencode-ai/plugin`, `zod` | `@opencode-ai/plugin` only |
| Host pin | `^1.17.6` (resolving to `1.17.13`) | `^1.18.16`, justified by byte-identical `index.d.ts` |
| Host knowledge | assumed | probed once, frozen, reportable |
| Hook failure mode | silent and indistinguishable from an empty corpus | recorded, counted, and named by `kevin_doctor` |
| Project identity | `declared → remote → path` | `declared → remote → host → path` |
| Curated skill delivery | file emission, unconfirmable, default-off | native registration with read-back verification, or emission — never both |
| API generations in use | v1 | v1, plus v2 `skill`/`reference` by addition |
| Migration verification | hard-coded list missing `002_indexes.sql` | directory enumeration, fails loudly |
| Tables | 15 | 18 |
| Tools | 21 | 23 |
| Metric keys | 39 | 45 |
| Settings keys | 23 | 27 |

---

## 13. References

- `@opencode-ai/plugin@1.17.6` and `@1.18.16`, npm registry tarballs — `dist/index.d.ts`,
  `dist/tool.d.ts`, `dist/v2/promise/*.d.ts`, `dist/v2/effect/*.d.ts`, `package.json`. Primary
  source for every claim in §3 and §4.
- `package-lock.json` — the resolved tree, §3.4 and §3.5.
- `plugin/index.ts:5-6, 54, 68, 175, 597, 615, 669, 684, 702, 731` — the host integration surface.
- `scripts/verify-install.ts:61-79` — the enumeration replaced by `K9-021`.
- `docs/Kevin_v0.6.0_Plan.md` §5.5, D6-13 — `Materializer` and the probe contract this release extends.
- `docs/Kevin_v0.8.0_Plan.md` §3.5, §10, D8-01, D8-03, D8-07 — the zero-spawn boundary, the
  deferred items, the re-key semantics preserved here, and the CHECK-constraint precedent §6.2 departs from.
- `docs/Kevin_Roadmap.md` §4, §5.5 — the version ladder, and the scope statement §3.1 refutes.

---

## 14. Implementation status

| Phase | Tasks | Status |
|---|---|---|
| F0 Substrate | K9-001 … K9-004 | `[ ]` Pending |
| F1 Ground truth | K9-005 … K9-008 | `[ ]` Pending |
| F2 Liveness | K9-009 … K9-012 | `[ ]` Pending |
| F3 Native | K9-013 … K9-017 | `[ ]` Pending |
| F4 Surfacing | K9-018 … K9-021 | `[ ]` Pending |
| F5 Release | K9-022 … K9-024 | `[ ]` Pending |

---

**Author:** Opus-5 (xHigh)
**Date:** 2026-08-11

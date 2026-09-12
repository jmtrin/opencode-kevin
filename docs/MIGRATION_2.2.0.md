# MIGRATION 2.2.0 — Harbor (K22-005 / executable spec)

This doc is the runbook for 2.1.0 → 2.2.0. Every step is executable; re-running is idempotent. No new tools, settings, or metrics — 27 tools, 44 settings, 68 metrics stay; schema `015→016`.

## 0. Pre-check

```sh
npm run build
npm test -- tests/unit/contract_frozen.test.ts tests/unit/contract_succession.test.ts
```

Live contract version stays 2. C-03 prose fixed (27 tools, `kevin_sources` since 2.0.0 — golden already listed 27), C-07 `015→016`, every other clause byte-identical; diff against `tests/fixtures/contract/v2.json` is the single C-07 hunk.

## 1. Backup

```sh
cp ~/.opencode-kevin/kevin.db ~/.opencode-kevin/kevin.db.pre-2.2.0
cp .kevin/knowledge.okf .kevin/knowledge.okf.pre-2.2.0  # if exists
ls .kevin/knowledge*.okf  # note sharded files if okf_write_version=3
```

## 2. Apply migration 016 (Harbor)

```sh
node --import tsx -e "
import { Store } from './packages/core/src/Store.ts';
import { Migrate } from './packages/core/src/Migrate.ts';
const s=new Store({path: process.env.DB||'~/.opencode-kevin/kevin.db'});
await new Migrate(s, './packages/core/migrations').run();
console.log('migrated to', s.prepare('SELECT version FROM schema_version ORDER BY version').all());
"
# Verify 016 present
# sqlite3 kevin.db "SELECT version FROM schema_version ORDER BY version;"
```

### What 016 does (idempotent via version gate + OR IGNORE)

1. Seeds `kevin_settings` keys `mcp_write_enabled` ('0'), `mcp_approve_enabled` ('0'), `mcp_repo_override` ('') — `OR IGNORE` (BUG-05: accepted by `set` but missing from `list` on fresh DBs).
2. Inserts schema_version '016' — `OR IGNORE`.

No columns, no tables, no metrics. Double-run via `Migrate.run()`: version-gated no-op.

Existing 015 databases are healed twice: migration 016 on upgrade, plus factory runtime seeds at every boot (same K12-001/K15-001 convention). After upgrade, `kevin_config list` shows all 44 keys:

```sh
sqlite3 kevin.db "SELECT COUNT(*) FROM kevin_settings;"
# → 40 raw (37 carried + 3 from 016); 44 after boot (factory seeds
#    tui_snapshots_enabled + the skills trio at runtime, as before)
sqlite3 kevin.db "SELECT key,value FROM kevin_settings WHERE key LIKE 'mcp_%';"
# → mcp_write_enabled|0, mcp_approve_enabled|0, mcp_repo_override|
```

## 3. Import migration: `./config` subpath (K22-002)

The plugin entrypoint now exports only the `KevinPlugin` factory (the host loader rejects any other export). Public metadata moved to the additive `./config` subpath:

| Old (2.1.0, removed) | New (2.2.0) |
|---|---|
| `import { KEVIN_CONFIG_KEYS } from "@jmtrin/opencode-kevin"` | `import { KEVIN_CONFIG_KEYS } from "@jmtrin/opencode-kevin/config"` |
| `import { REMOVED_SETTINGS } from "@jmtrin/opencode-kevin"` | `import { REMOVED_SETTINGS } from "@jmtrin/opencode-kevin/config"` |
| `import { ERROR_LESSON_MODE_VALUES } from "@jmtrin/opencode-kevin"` | `import { ERROR_LESSON_MODE_VALUES } from "@jmtrin/opencode-kevin/config"` |
| `import { KEVIN_VERSION } from "@jmtrin/opencode-kevin"` | `import { KEVIN_VERSION } from "@jmtrin/opencode-kevin/config"` (or from `@jmtrin/kevin-core`, the canonical home) |
| `import { performRekey } from "@jmtrin/opencode-kevin"` | `import { performRekey } from "@jmtrin/opencode-kevin/config"` (+ `RekeyCounts`/`RekeyResult` types) |

```js
import { KEVIN_CONFIG_KEYS, KEVIN_VERSION } from "@jmtrin/opencode-kevin/config";
console.log(KEVIN_CONFIG_KEYS.length, KEVIN_VERSION);
```

There is no compatibility re-export from the entrypoint by design (it would reintroduce BUG-01). `KevinPlugin` imports are unchanged.

## 4. Desktop identity behavior change (K22-004)

Each instance now resolves identity from its own project directory (`input.directory ?? input.worktree`), not the server `process.cwd()`:

- CLI single-project mode (`directory === cwd`): byte-identical to 2.1.0. Nothing to do.
- OpenCode Desktop (one server process, N instances): `project_id`, `repo_id`, `.kevin/` resolution, `kevin_export` scoping, and `kevin_project show/init/rekey` targets now point at each project instead of the server home. Memories stored under the server-scoped id by 2.1.0 stay where they are (no silent moves — only confirmed `kevin_project rekey` moves rows); use `kevin_project show` per project to compare, and `rekey` (confirmed) to consolidate if desired.
- `opts.projectRoot` still overrides everything (tests unaffected).
- Precedence unchanged: `declared > remote > host > path` (C-08/D8-03).

Verify per-instance scoping:

```sh
# in two different projects, kevin_project show must report different project_id values,
# each equal to the fingerprint of its own directory — never the server home.
```

## 5. Derived tool count + English strings (K22-006/K22-007)

- `kevin_status.tool_count` derives from the live tool map (27 with `kevin_sources` since 2.0.0). Monitors keyed on the literal 26 should expect 27.
- Four user-visible strings are English now: the three `performRekey` messages (pre-009 refusal, monorepo collision, rollback failure) and the `kevin_status` title ("Kevin status"). Snapshots asserting the old Spanish bytes need updating. All other descriptions/labels are unchanged (deferred to a later release).

## 6. Verify

```sh
npm run typecheck
npm test
npm run verify:pack  # now includes P8 (loader contract) + CS3 (installed-artifact check)
sqlite3 kevin.db "SELECT key,value FROM kevin_settings WHERE key LIKE 'mcp_%' OR key LIKE 'source%';"
node --import tsx scripts/gen-contract-v2.mjs  # idempotent zero-diff
```

## 7. Rollback

```sh
cp ~/.opencode-kevin/kevin.db.pre-2.2.0 ~/.opencode-kevin/kevin.db
cp .kevin/knowledge.okf.pre-2.2.0 .kevin/knowledge.okf
# Or pin the previous release: npm i @jmtrin/opencode-kevin@2.1.0 (entrypoint bug BUG-01 applies there)
```

Note: rolling the package back to 2.1.0 reinstates the unloadable entrypoint (BUG-01) — the plugin will not load. Prefer rolling forward. The 016 seed rows are inert under 2.1.0 (`INSERT OR IGNORE`d settings the old code accepts).

## 8. Exit ramps

- `source_deletion_sync` stays opt-in (`'0'`, D21-03 unchanged).
- No default flips, no removals, no renames. Any 2.2.x binary opens any 1.x/2.0/2.1 DB (C-07 forever).

# MIGRATION 2.0.0 — Commonwealth (K16-010 / executable spec)

This doc is the **runbook**. Every step is executable; re-running is idempotent.

## 0. Pre-check

```sh
npm run typecheck
npm test -- tests/unit/contract_frozen.test.ts tests/unit/contract_succession.test.ts
```

Live contract version must be 2, diff against `tests/fixtures/contract/v2.json` zero.

## 1. Backup

```sh
cp ~/.opencode-kevin/kevin.db ~/.opencode-kevin/kevin.db.pre-2.0.0
cp .kevin/knowledge.okf .kevin/knowledge.okf.pre-2.0.0  # if exists
```

## 2. Apply migrations (014)

```sh
# Via plugin init (auto) or explicit:
node --import tsx -e "
import { Store } from './packages/core/src/Store.ts';
import { Migrate } from './packages/core/src/Migrate.ts';
const s=new Store({path: process.env.DB||'~/.opencode-kevin/kevin.db'});
await new Migrate(s, './packages/core/migrations').run();
console.log('migrated to', s.prepare('SELECT version FROM schema_version ORDER BY version').all());
"
# Verify 014 present
# sqlite3 kevin.db "SELECT version FROM schema_version ORDER BY version;"
```

### What 014 does (idempotent)

1. Creates `memory_sources` (opencode-plugin 10, claude-memory 20, codex-memories 30, opencode-native 40).
2. Seeds `kevin_settings` 5 keys: `sources_enabled` (1), `source_claude_memory` (0), `source_codex_memories` (0), `source_opencode_native` (0), `okf_write_version` (3).
3. Translation: if `import_host_memory`=='1' then UPDATE memory_sources SET enabled=1 WHERE name IN ('claude-memory','codex-memories') exactly once.
4. Deletes `import_host_memory` row after translation.
5. Seeds `kevin_metrics` 3 keys.
6. Inserts schema_version '014'.

Double-run: translation fires once, delete is idempotent, second run no change.

## 3. OKF v3 sharding (K16-008 / K16-009)

- Setting `okf_write_version` controls writer: `'2'` => legacy single-file byte-exact; `'3'` (default) => sharded.
- Reader: concatenates `knowledge.okf` (primary, FIRST) + `knowledge-*.okf` lexicographically, enforces global `entry_id` uniqueness (violation => structured error naming both files).
- Writer: packs primary to 2000 entries, overflow to `knowledge-002.okf`, `knowledge-003`… zero-padded; shards below capacity collapse upward; empty trailing shards deleted.
- Verify: `kevin_config set okf_write_version 3` (default), write 2001 entries => expect `knowledge.okf` 2000 + `knowledge-002.okf` 1.

## 4. Conditional defaults (K16-006)

Both candidates FALSE per `docs/Kevin_v2.0.0_Defaults_Outcome.md` — no default changes. No further action. If a future run flips TRUE, re-apply per outcome doc's exit-ramp.

## 5. Verify

```sh
npm run typecheck
npm test
node --import tsx scripts/gen-contract-v2.mjs  # idempotent zero-diff
sqlite3 kevin.db "SELECT key,value FROM kevin_settings WHERE key LIKE 'source%' OR key='okf_write_version' OR key='sources_enabled';"
sqlite3 kevin.db "SELECT name,enabled,precedence FROM memory_sources ORDER BY precedence;"
ls -l .kevin/*.okf
```

## 6. Rollback (if needed)

```sh
cp ~/.opencode-kevin/kevin.db.pre-2.0.0 ~/.opencode-kevin/kevin.db
cp .kevin/knowledge.okf.pre-2.0.0 .kevin/knowledge.okf  # if applicable
# Or: kevin_config set okf_write_version 2 to return to legacy writer without DB rollback
```

## 7. Exit ramps

- Skill emission default remains OFF (opt-in). To enable: `kevin_config set skill_emission_enabled 1`.
- error_lesson_mode remains `all`. To use triage_only: `kevin_config set error_lesson_mode triage_only`.

# MIGRATION 2.1.0 — Relay (K21-008 / executable spec)

This doc is the runbook for 2.0.0 → 2.1.0. Every step is executable; re-running is idempotent. Gate FAIL, so no CC adapter ships.

## 0. Pre-check

```sh
npm run typecheck
npm test -- tests/unit/contract_frozen.test.ts tests/unit/contract_succession.test.ts
```

Live contract version stays 2, C-14 unchanged (4 sources), C-04/C-05/C-07 additions for 2.1.0, diff against `tests/fixtures/contract/v2.json` zero.

## 1. Backup

```sh
cp ~/.opencode-kevin/kevin.db ~/.opencode-kevin/kevin.db.pre-2.1.0
cp .kevin/knowledge.okf .kevin/knowledge.okf.pre-2.1.0  # if exists
ls .kevin/knowledge*.okf  # note sharded files if okf_write_version=3
```

## 2. Apply migration 015 (Relay)

```sh
node --import tsx -e "
import { Store } from './packages/core/src/Store.ts';
import { Migrate } from './packages/core/src/Migrate.ts';
const s=new Store({path: process.env.DB||'~/.opencode-kevin/kevin.db'});
await new Migrate(s, './packages/core/migrations').run();
console.log('migrated to', s.prepare('SELECT version FROM schema_version ORDER BY version').all());
"
# Verify 015 present
# sqlite3 kevin.db "SELECT version FROM schema_version ORDER BY version;"
```

### What 015 does (idempotent via version gate)

1. `ALTER TABLE memories ADD COLUMN source TEXT` + `idx_memories_source` (WHERE source IS NOT NULL) — gated by `schema_version`; `Migrate.run()` applies each version once, so re-running via `Migrate` is no-op; raw `sqlite3 < 015.sql` re-run would error `duplicate column` (expected, use `Migrate`).
2. Seeds `kevin_metrics` key `source_deletions_total` (0) — `OR IGNORE`.
3. Seeds `kevin_settings` key `source_deletion_sync` ('0' opt-in, D21-03) — `OR IGNORE`.
4. Inserts schema_version '015' — `OR IGNORE`.

Double-run via `Migrate.run()`: version-gated, seeds `OR IGNORE`, no duplicate column re-executed.

## 3. Gate outcome (K21-001)

Real npm captures 2026-08-30: base 763 / mcp 219 → ratio 0.287 (<0.50) FAIL. Details in `docs/Kevin_v2.1.0_Defaults_Outcome.md`. Binding: K21-002..004 gate not taken — no `packages/cc-adapter`, no `claude-code-hooks` source, C-14 stays 4 entries.

## 4. Enable deletion sync (opt-in)

Default `source_deletion_sync='0'` in 2.1.0, flips to '1' in 2.2 (D21-03). To enable now:

```sh
kevin_config set source_deletion_sync 1
# or sqlite3: UPDATE kevin_settings SET value='1' WHERE key='source_deletion_sync';
```

When enabled, next idle cycle diffs active memories per source vs current fetch (fingerprint granularity, cross-source safe). Missing fingerprint → `status='archived'` + `shared_entries` tombstone if exported + `source_deletions_total++`. Idempotent: second idle does not double-delete.

Verify:

```sh
sqlite3 kevin.db "SELECT value FROM kevin_metrics WHERE key='source_deletions_total';"
sqlite3 kevin.db "SELECT id,source,status FROM memories WHERE status='archived' ORDER BY updated_at DESC LIMIT 5;"
cat .kevin/knowledge.okf  # should contain tombstone JSON lines if shared memory deleted
```

## 5. Opencode-native probe (K21-006)

Single-source list `NATIVE_CANDIDATE_PATHS = [".opencode/memory/*.md",".opencode/MEMORY.md"]` in `packages/core/src/sources/OpencodeNativeSource.ts`. Probes via `statSync` try/catch, absent → `health:{status:'absent'}` and `scan():[]`, no throw. Grep guard: `grep -r "opencode/memory" packages/core/src` hits only that const.

Verify: `mkdir -p .opencode/memory && echo "# hello" > .opencode/memory/a.md` → next idle sync imports line.

## 6. Verify

```sh
npm run typecheck
npm test
node --import tsx scripts/gen-contract-v2.mjs  # idempotent zero-diff
sqlite3 kevin.db "SELECT key,value FROM kevin_settings WHERE key='source_deletion_sync' OR key LIKE 'source%';"
sqlite3 kevin.db "SELECT name,enabled,precedence FROM memory_sources ORDER BY precedence;"
ls -l .kevin/*.okf
```

## 7. Rollback

```sh
cp ~/.opencode-kevin/kevin.db.pre-2.1.0 ~/.opencode-kevin/kevin.db
cp .kevin/knowledge.okf.pre-2.1.0 .kevin/knowledge.okf
# Or disable deletion sync: kevin_config set source_deletion_sync 0
```

## 8. Exit ramps

- Deletion sync remains opt-in until 2.2. To reclaim space: set flag to 1.
- CC adapter not shipped; to trial manually, copy hooks later when gate passes.

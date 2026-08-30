-- ============================================================
-- Kevin v2.0.0 "Commonwealth" — MemorySources, OKF v3, retirements
-- Migration 014. Forward-only. Additive + translation + cleanup.
-- ============================================================

-- 1. MemorySources table (K16-012 / plan §4.4)
CREATE TABLE IF NOT EXISTS memory_sources (
  name       TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  precedence INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO memory_sources (name, enabled, precedence) VALUES
  ('opencode-plugin',  1, 10),
  ('claude-memory',    0, 20),
  ('codex-memories',   0, 30),
  ('opencode-native',  0, 40);

-- 2. Translation of import_host_memory -> sources (K16-005 step 3)
-- If import_host_memory == '1', enable claude-memory and codex-memories exactly once.
-- This block is idempotent: double-run enables exactly once and preserves prior enables.
UPDATE memory_sources SET enabled = 1 WHERE name IN ('claude-memory','codex-memories')
  AND EXISTS (SELECT 1 FROM kevin_settings WHERE key='import_host_memory' AND value='1');

-- 3. New settings seeds (K16-013 / plan §4.4 + K16-008 okf_write_version)
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('sources_enabled',        '1'),
  ('source_claude_memory',   '0'),
  ('source_codex_memories',  '0'),
  ('source_opencode_native', '0'),
  ('okf_write_version',      '3');

-- Sync memory_sources enabled from individual source_* flags if they exist (absorption)
-- source_claude_memory / source_codex_memories are TEXT "1"/"0"
UPDATE memory_sources SET enabled = 1 WHERE name='claude-memory' AND EXISTS (SELECT 1 FROM kevin_settings WHERE key='source_claude_memory' AND value='1');
UPDATE memory_sources SET enabled = 1 WHERE name='codex-memories' AND EXISTS (SELECT 1 FROM kevin_settings WHERE key='source_codex_memories' AND value='1');
UPDATE memory_sources SET enabled = 1 WHERE name='opencode-native' AND EXISTS (SELECT 1 FROM kevin_settings WHERE key='source_opencode_native' AND value='1');

-- 4. Retire import_host_memory (K16-005 step 3 final delete) — after translation
DELETE FROM kevin_settings WHERE key='import_host_memory';

-- 5. New metrics seeds (K16-012)
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('source_syncs_total',      0),
  ('source_dedup_skips_total',0),
  ('okf_v3_files_written',    0);

-- 6. Version marker
INSERT OR IGNORE INTO schema_version (version) VALUES ('014');

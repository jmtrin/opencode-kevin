-- ============================================================
-- Kevin 0.2.0 — Migration 003: Signal Quality (additive)
-- ============================================================
-- Backward-compatible, additive only. All new columns are
-- nullable or carry a NOT NULL DEFAULT so legacy rows keep
-- working without a destructive rebuild. The partial UNIQUE
-- index excludes NULL fingerprints so legacy error memories
-- do not collide. The schema_version table (created by 001)
-- guarantees this file runs at most once per DB.
-- ============================================================

-- 1. memories: Signal Quality columns.
--    project_id — first-class scoping dimension (D2-11).
--    fingerprint — stable hash of normalized error content, salted by project_id (D2-14).
--    origin — distinguishes reflector-sourced vs agent-sourced memories (D2-06),
--             with a CHECK enum and DEFAULT 'agent' so legacy rows backfill cleanly.
ALTER TABLE memories ADD COLUMN project_id  TEXT;
ALTER TABLE memories ADD COLUMN fingerprint TEXT;
ALTER TABLE memories ADD COLUMN origin      TEXT NOT NULL DEFAULT 'agent'
  CHECK(origin IN ('reflector', 'agent', 'pattern', 'retrospective'));

-- 2. tool_calls: same scoping/fingerprint columns for dedup and PatternMiner.
ALTER TABLE tool_calls ADD COLUMN project_id  TEXT;
ALTER TABLE tool_calls ADD COLUMN fingerprint TEXT;

-- 3. Partial UNIQUE: one reflector-sourced error memory per (project_id, fingerprint).
--    NULL fingerprints are excluded (no dedup for non-error memories or legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memories_error_fp
  ON memories (project_id, fingerprint)
  WHERE type = 'error' AND fingerprint IS NOT NULL AND origin = 'reflector';

-- 4. kevin_metrics: seeded counters surfaced by kevin_status (D2-07 / K2-004).
CREATE TABLE IF NOT EXISTS kevin_metrics (
  key        TEXT PRIMARY KEY,
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('tokens_injected_pre_prompt', 0),
  ('tokens_injected_compacting',  0),
  ('reflections_throttled',       0),
  ('duplicate_suppressions',      0),
  ('tool_calls_deduped',          0),
  ('patterns_mined',              0);

-- 5. kevin_settings: opt-in feature flags (PatternMiner off, tool_calls dedup off).
CREATE TABLE IF NOT EXISTS kevin_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('patternminer_enabled',     '0'),
  ('tool_calls_dedup_enabled', '0');

-- 6. Seed version 003.
INSERT OR IGNORE INTO schema_version (version) VALUES ('003');
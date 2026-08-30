-- ============================================================
-- Kevin v2.1.0 "Relay" — Source deletion + Relay metrics
-- Migration 015. Forward-only. Additive only.
-- ============================================================

-- 1. Add source provenance column to memories (K21-005)
-- Stores the MemorySource name (opencode-plugin, claude-memory, codex-memories, opencode-native)
-- Nullable for legacy rows; new source-inserted rows populate it.
ALTER TABLE memories ADD COLUMN source TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source) WHERE source IS NOT NULL;

-- 2. New metric: source_deletions_total (K21-005)
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('source_deletions_total', 0);

-- 3. New settings seed (K21-005, D21-03: opt-in default 0)
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('source_deletion_sync', '0');

-- 4. Version marker
INSERT OR IGNORE INTO schema_version (version) VALUES ('015');

-- ============================================================
-- Kevin 0.3.0 — Migration 004: Knowledge + Causality (additive)
-- ============================================================
-- Backward-compatible, additive only. All new columns are
-- nullable or carry a NOT NULL DEFAULT so legacy rows keep
-- working without a destructive rebuild.
-- ============================================================

-- 1. memories: evidence + lifecycle columns.
--    evidence_count — how many times this fingerprint was confirmed as fixed.
--    last_verified_at — timestamp of the most recent causal confirmation.
--    status — lifecycle state; default 'active'. Superseded rows are hidden.
ALTER TABLE memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_verified_at TEXT;
ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'superseded', 'stale', 'archived'));

-- 2. tool_calls: causal link + feedback-loop link columns.
--    fix_for_fingerprint — set when this successful call resolved a prior failure
--    with the given fingerprint. NULL for tool calls that were not fixes.
--    error_fingerprint — set by Reflector (via onLinkError callback) when a call
--    FAILS, to the stderr-based fingerprint the matching error memory uses.
--    This fixes the v0.2.0/v0.3.0 feedback-loop fingerprint mismatch bug:
--    tool_calls.fingerprint is hashed from "tool|args|success" by ToolCallObserver,
--    while memories.fingerprint is hashed from stderr text by Reflector — they
--    never agreed, so boost/penalize queries silently mismatched. The new column
--    stores the SAME identity dimension the error memory uses.
ALTER TABLE tool_calls ADD COLUMN fix_for_fingerprint TEXT;
ALTER TABLE tool_calls ADD COLUMN error_fingerprint TEXT;

-- 3. Index: causal linkage by fingerprint. Used by CausalChain.onSuccess
--    and kevin_why to materialize traces.
CREATE INDEX IF NOT EXISTS idx_tool_calls_fix_fp
  ON tool_calls(fix_for_fingerprint)
  WHERE fix_for_fingerprint IS NOT NULL;

-- 3b. Index: feedback-loop linkage by error_fingerprint. Used by
--     boostPositiveReflectors / penalizeRecurringReflectors to count
--     recurrences by the same identity dimension the error memory uses.
CREATE INDEX IF NOT EXISTS idx_tool_calls_error_fp
  ON tool_calls(error_fingerprint)
  WHERE error_fingerprint IS NOT NULL;

-- 4. Index: memories by fingerprint for promotion + supersede queries.
CREATE INDEX IF NOT EXISTS idx_memories_fp
  ON memories(fingerprint)
  WHERE fingerprint IS NOT NULL;

-- 5. kevin_metrics: seed new v0.3 counters.
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('patterns_causal',     0),
  ('causal_links',        0),
  ('memories_superseded', 0);

-- 6. kevin_settings: seed new opt-in flags.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('llm_reflection_enabled', '0'),
  ('cross_project_enabled',  '0');

-- 7. Seed version 004.
INSERT OR IGNORE INTO schema_version (version) VALUES ('004');

-- ============================================================
-- 8. Rebuild memories table with expanded CHECK constraints.
--    v0.3.0 introduces new types (rule, solution) and origins
--    (causal, imported). SQLite cannot ALTER a CHECK constraint,
--    so we rebuild via a temporary table. FTS5 external-content
--    table references the content table by name, so we drop+recreate
--    the FTS5 triggers after the rebuild.
-- ============================================================

-- Step 1: Create new table with correct constraints
CREATE TABLE memories_v04 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('error','pattern','decision','context','rule','solution')),
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project','session')),
  relevance_score REAL DEFAULT 0.5,
  source_tool TEXT,
  source_session TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  project_id TEXT,
  fingerprint TEXT,
  origin TEXT NOT NULL DEFAULT 'agent'
    CHECK(origin IN ('reflector','agent','pattern','retrospective','causal','imported')),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','superseded','stale','archived'))
);

-- Step 2: Copy data preserving rowids (FTS5 content sync relies on rowid)
INSERT INTO memories_v04
  (rowid, id, type, content, scope, relevance_score, source_tool,
   source_session, metadata, created_at, updated_at, expires_at,
   project_id, fingerprint, origin, evidence_count, last_verified_at, status)
  SELECT rowid, id, type, content, scope, relevance_score, source_tool,
         source_session, metadata, created_at, updated_at, expires_at,
         project_id, fingerprint, origin, evidence_count, last_verified_at, status
  FROM memories;

-- Step 3: Drop old table and FTS triggers
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;
DROP TABLE memories;

-- Step 4: Rename new table
ALTER TABLE memories_v04 RENAME TO memories;

-- Step 5: Recreate FTS triggers (memories_fts is content=external, survives DROP of content table)
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Step 6: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_memories_error_fp
  ON memories(project_id, fingerprint)
  WHERE type = 'error' AND fingerprint IS NOT NULL AND origin = 'reflector';
CREATE INDEX IF NOT EXISTS idx_memories_fp
  ON memories(fingerprint)
  WHERE fingerprint IS NOT NULL;

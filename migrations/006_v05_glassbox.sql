-- ============================================================================
-- 006_v05_glassbox.sql — v0.5.0 "Glass Box"
--
-- Honest measurement, human feedback, lifecycle completion.
--
-- Section 1: rebuild kevin_injections to admit a fourth outcome.
-- Section 2: human feedback storage.
-- Section 3: memory lifecycle columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: schema_version.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. kevin_injections: add 'inconclusive'.
--
-- SQLite cannot ALTER a CHECK constraint, so the table must be rebuilt.
-- Migration 004 set this precedent. kevin_injections has no FTS5 triggers,
-- so unlike 004 this is a straight four-step rebuild.
--
-- Existing rows with outcome='effective' are remapped to 'inconclusive'.
-- This is not data loss: v0.4's 'effective' meant "the error did not recur",
-- which is the exact definition of the new 'inconclusive' bucket. Rows that
-- genuinely earned the new 'effective' will be re-settled naturally, and the
-- post-apply hook re-derives the counters from the table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kevin_injections_new (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  hook        TEXT NOT NULL CHECK (hook IN ('pre_prompt','compacting')),
  tokens      INTEGER NOT NULL,
  injected_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome     TEXT NOT NULL DEFAULT 'unmeasured'
              CHECK (outcome IN ('unmeasured','effective','ineffective','inconclusive'))
);

INSERT INTO kevin_injections_new
  (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome)
SELECT
  id, memory_id, fingerprint, session_id, hook, tokens, injected_at,
  CASE WHEN outcome = 'effective' THEN 'inconclusive' ELSE outcome END
FROM kevin_injections;

DROP TABLE kevin_injections;
ALTER TABLE kevin_injections_new RENAME TO kevin_injections;

CREATE INDEX IF NOT EXISTS idx_injections_fp      ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session ON kevin_injections(session_id);
CREATE INDEX IF NOT EXISTS idx_injections_outcome ON kevin_injections(outcome);

-- ---------------------------------------------------------------------------
-- 2. Human feedback. Append-only audit trail; the hot path reads the
--    denormalized counters on `memories` (section 3), never this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_feedback (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('useful','wrong','outdated','ignore')),
  session_id TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_memory  ON memory_feedback(memory_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON memory_feedback(created_at);

-- ---------------------------------------------------------------------------
-- 3. Memory lifecycle and feedback columns.
--
--    feedback_positive / feedback_negative are SEPARATE from evidence_count
--    and recurrence_count by design: human judgement is evidence about the
--    memory, causal counters are evidence about the world. Mixing them was
--    the confidence-poisoning defect closed in v0.4.0.
--
--    superseded_by has no REFERENCES clause on purpose. Store enables
--    PRAGMA foreign_keys=ON, and a hard FK would block deletion of a memory
--    that superseded another.
-- ---------------------------------------------------------------------------
ALTER TABLE memories ADD COLUMN feedback_positive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN feedback_negative INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN ignored           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN superseded_by     TEXT;
ALTER TABLE memories ADD COLUMN archived_at       TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_ignored  ON memories(ignored);
CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived_at);

-- ---------------------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS in metrics.ts.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('injections_inconclusive',      0),
  ('injections_blocked_seen',      0),
  ('injections_blocked_weak',      0),
  ('injections_blocked_recurrence',0),
  ('injections_blocked_stale',     0),
  ('injections_blocked_ignored',   0),
  ('feedback_positive_total',      0),
  ('feedback_negative_total',      0),
  ('memories_archived',            0);

-- ---------------------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an explicit
--    string comparison or an explicit Number() parse — never `=== 1`.
--    (That exact mistake kept cross_project_enabled unreachable for the
--    whole of v0.3.0.)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('deterministic_retrieval',    '0'),
  ('pre_prompt_budget_tokens', '900'),
  ('archive_after_days',        '30');

-- ---------------------------------------------------------------------------
-- 6. Version marker.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('006');

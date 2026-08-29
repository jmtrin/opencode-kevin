-- ============================================================
-- Kevin 0.1.1 — Migration 002: indexes adicionales
-- ============================================================

-- F#29: uniqueness on retrospectives.session_id
-- Prevents duplicate retrospective rows under concurrent session.idle events.
CREATE UNIQUE INDEX IF NOT EXISTS idx_retrospectives_session
  ON retrospectives(session_id);

-- F#31: index on memories.expires_at
-- Every query/queryRelevant/loadAll filters WHERE (expires_at IS NULL OR expires_at > datetime('now')).
-- Without this index the filter is a linear scan on large tables.
CREATE INDEX IF NOT EXISTS idx_memories_expires
  ON memories(expires_at);
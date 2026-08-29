-- =============================================================
-- Kevin v1.4.0 "Bridge" — migration 013
-- Adds: channel column on kevin_injections, 5 MCP metric seeds,
--       expands hook CHECK to include pull_mcp (D14-04).
-- =============================================================

ALTER TABLE kevin_injections ADD COLUMN channel TEXT NOT NULL DEFAULT 'plugin';

-- SQLite cannot ALTER a CHECK constraint, so rebuild to widen hook.
CREATE TABLE IF NOT EXISTS kevin_injections_new (
  id              TEXT PRIMARY KEY,
  memory_id       TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  hook            TEXT NOT NULL CHECK (hook IN ('pre_prompt','compacting','pull_mcp')),
  tokens          INTEGER NOT NULL,
  injected_at     TEXT NOT NULL DEFAULT (datetime('now')),
  outcome         TEXT NOT NULL DEFAULT 'unmeasured'
                  CHECK (outcome IN ('unmeasured','effective','ineffective','inconclusive')),
  injected_at_ms  INTEGER,
  channel         TEXT NOT NULL DEFAULT 'plugin'
);

INSERT INTO kevin_injections_new
  (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome, injected_at_ms, channel)
SELECT
  id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome, injected_at_ms, channel
FROM kevin_injections;

DROP TABLE kevin_injections;
ALTER TABLE kevin_injections_new RENAME TO kevin_injections;

CREATE INDEX IF NOT EXISTS idx_injections_fp       ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session  ON kevin_injections(session_id);
CREATE INDEX IF NOT EXISTS idx_injections_outcome  ON kevin_injections(outcome);
CREATE INDEX IF NOT EXISTS idx_injections_channel  ON kevin_injections(channel);
CREATE INDEX IF NOT EXISTS idx_tool_calls_ts_ms        ON tool_calls(ts_ms);
CREATE INDEX IF NOT EXISTS idx_injections_injected_ms  ON kevin_injections(injected_at_ms);

INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('mcp_requests_total', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('mcp_reads_served', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('mcp_writes_accepted', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('mcp_writes_refused', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('mcp_errors_total', 0);

INSERT INTO schema_version (version) VALUES ('013');

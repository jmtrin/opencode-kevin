-- ============================================================
-- Kevin 0.4.0 — Migration 005: Signal over Noise (additive)
-- ============================================================
-- Backward-compatible, additive only. All new columns are
-- nullable or carry a NOT NULL DEFAULT so legacy rows keep
-- working without a destructive rebuild.
-- ============================================================

-- 1. memories: positive/negative evidence split (D4-03).
--    recurrence_count — how many times this fingerprint recurred AFTER
--                       injection (negative evidence; lowers confidence).
--    fix_args — deterministic capture of the linked success call's
--               args_summary ("Fixed by:" raw material, D4-07).
--    last_injected_at — timestamp of the most recent injection of this memory.
ALTER TABLE memories ADD COLUMN recurrence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN fix_args TEXT;
ALTER TABLE memories ADD COLUMN last_injected_at TEXT;

-- 2. kevin_injections: the injection ledger (D4-04). One row per injected
--    memory per prompt/compaction, settled at session.idle.
CREATE TABLE IF NOT EXISTS kevin_injections (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  hook        TEXT NOT NULL CHECK (hook IN ('pre_prompt', 'compacting')),
  tokens      INTEGER NOT NULL,
  injected_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome     TEXT CHECK (outcome IN ('unmeasured', 'effective', 'ineffective'))
              NOT NULL DEFAULT 'unmeasured'
);

-- 2b. Indexes: settlement by session, recurrence lookups by fingerprint,
--     and outcome rollups for precision_rate.
CREATE INDEX IF NOT EXISTS idx_injections_fp
  ON kevin_injections(fingerprint);
CREATE INDEX IF NOT EXISTS idx_injections_session
  ON kevin_injections(session_id);
CREATE INDEX IF NOT EXISTS idx_injections_outcome
  ON kevin_injections(outcome);

-- 3. kevin_metrics: seed new v0.4 counters.
--    patterns_promoted_new replaces patterns_causal (which was inflated by
--    idempotent refreshes); the latter stays for compat but is frozen.
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('injections_total',        0),
  ('injections_effective',    0),
  ('injections_ineffective',  0),
  ('patterns_promoted_new',   0);

-- 4. kevin_settings: seed new v0.4 flags.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('quality_gate_enabled',    '1'),
  ('lesson_snippet_injection','1');

-- 5. Seed version 005.
INSERT OR IGNORE INTO schema_version (version) VALUES ('005');

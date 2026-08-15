-- ============================================================
-- Kevin 0.7.0 — Migration 008: Project Truth (additive)
-- ============================================================
-- Backward-compatible, additive only. Two new tables, two new
-- nullable/defaulted columns on `memories`, one index, five
-- metric seeds, four setting seeds. NO table rebuild: nothing
-- here widens a CHECK constraint on an existing table.
--
-- Section 1: repo_facts — the ground-truth store.
-- Section 2: memory_conflicts — surfaced, never auto-resolved.
-- Section 3: memories truth columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: schema_version.
-- ============================================================

-- ------------------------------------------------------------
-- 1. repo_facts — facts extracted from package.json and
--    tsconfig.json. Both are JSON, parsed with JSON.parse; this
--    release adds NO parser and NO runtime dependency.
--
--    The UNIQUE index INCLUDES project_id and that is load-
--    bearing (D7-02). Kevin's DB is global
--    (~/.opencode-kevin/kevin.db, projectId =
--    fingerprint(process.cwd())). Without project_id, project A's
--    packageManager=npm would overwrite project B's
--    packageManager=pnpm and contradictions() would then flag A's
--    memories against B's repository.
--
--    source_mtime lets scan() skip re-parsing an unchanged file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repo_facts (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  file         TEXT NOT NULL,
  key_path     TEXT NOT NULL,
  value        TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  source_mtime TEXT,
  scanned_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_repo_facts    ON repo_facts(project_id, file, key_path);
CREATE INDEX        IF NOT EXISTS idx_repo_facts_fp ON repo_facts(fingerprint);

-- ------------------------------------------------------------
-- 2. memory_conflicts — detection only. status moves
--    open → acknowledged → resolved, and ONLY the kevin_conflicts
--    tool may move it to 'resolved' (D7-06). No session.idle path
--    writes 'resolved'.
--
--    memory_a / memory_b / fact_id carry NO REFERENCES clause on
--    purpose: Store sets PRAGMA foreign_keys = ON, and a hard FK
--    would block deleting a memory that participates in a
--    conflict.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  memory_a    TEXT NOT NULL,
  memory_b    TEXT,
  fact_id     TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('repo_truth','decision_pair','temporal')),
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conflicts_status ON memory_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_memory ON memory_conflicts(memory_a);

-- ------------------------------------------------------------
-- 3. memories: the de-ranking column and its timestamp.
--
--    truth_penalty is clamped by application code to [0, 0.5] and
--    multiplies rankScore as (1 - truth_penalty), AFTER the
--    existing BM25 × origin_boost × recency_decay chain. At 0.0
--    the v0.6.0 ranking is reproduced exactly (D7-04).
--
--    There is deliberately no status transition here. Contra-
--    diction de-ranks; it never deletes (Principle 24, D7-03).
-- ------------------------------------------------------------
ALTER TABLE memories ADD COLUMN truth_penalty   REAL NOT NULL DEFAULT 0.0;
ALTER TABLE memories ADD COLUMN contradicted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_truth_penalty ON memories(truth_penalty);

-- ------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS
--    in metrics.ts (28 → 33).
-- ------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('repo_facts_scanned',       0),
  ('memories_contradicted',    0),
  ('conventions_mined',        0),
  ('conflicts_detected',       0),
  ('error_lessons_suppressed', 0);

-- ------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an
--    explicit string comparison or an explicit Number() parse —
--    never `=== 1`, and never for truthiness.
--
--    error_lesson_mode is a TEXT ENUM ('all' | 'triage_only').
--    `if (mode)` is true for BOTH values and would put every
--    installation into triage mode on upgrade. Compare with
--    === "triage_only" (D7-12). Defaults to 'all', preserving
--    v0.6.0 behaviour exactly.
--
--    The three feature flags default to '0' (off): a release that
--    changes nothing until asked must not silently start scanning
--    the repository or mining conventions on upgrade. They are
--    opted into explicitly. (Task K7-001 / plan §5 & §12.)
-- ------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('repo_truth_enabled',         '0'),
  ('convention_mining_enabled',  '0'),
  ('conflict_detection_enabled', '0'),
  ('error_lesson_mode',          'all');

-- ------------------------------------------------------------
-- 6. Version marker.
-- ------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('008');
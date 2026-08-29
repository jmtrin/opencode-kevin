-- ============================================================
-- Kevin 0.8.0 - Migration 009: Team (additive)
-- ============================================================
-- Backward-compatible, additive only. All new columns are
-- nullable or carry a NOT NULL DEFAULT so legacy rows keep
-- working without a destructive rebuild.
--
-- Scope note: this migration introduces `repo_id`, a SECOND
-- scoping dimension. `project_id` is retained on every table,
-- unchanged, as local-path provenance (D8-02). Nothing that
-- reads `project_id` today stops working.
-- ============================================================

-- 1. shared_entries: the local projection of the committed OKF file.
--    One row per (repo_id, entry_id). Rewritten by SharedLayer.import(),
--    never edited by hand, never the source of truth - the file is.
--    No REFERENCES to memories: an entry may arrive from a teammate
--    before any local memory corresponds to it (D8-12).
CREATE TABLE IF NOT EXISTS shared_entries (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL,
  entry_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('decision', 'rule', 'pattern', 'solution')),
  statement    TEXT NOT NULL,
  scope        TEXT,
  confidence   REAL NOT NULL DEFAULT 0.0,
  evidence     INTEGER NOT NULL DEFAULT 0,
  origin       TEXT NOT NULL DEFAULT 'shared',
  author_hash  TEXT,
  op           TEXT NOT NULL CHECK (op IN ('assert', 'tombstone')) DEFAULT 'assert',
  supersedes   TEXT,
  created_at   TEXT NOT NULL,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1b. Identity is (repo_id, entry_id). The UNIQUE index is what makes
--     import() an idempotent upsert instead of an append.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_entries
  ON shared_entries(repo_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_shared_entries_op
  ON shared_entries(op);
CREATE INDEX IF NOT EXISTS idx_shared_entries_type
  ON shared_entries(type);

-- 2. okf_imports: append-only audit of every read of the shared file,
--    including no-op reads and refusals. `file_hash` drives the skip
--    path in SharedLayer.import() (D8-14).
CREATE TABLE IF NOT EXISTS okf_imports (
  id               TEXT PRIMARY KEY,
  repo_id          TEXT NOT NULL,
  path             TEXT NOT NULL,
  file_hash        TEXT,
  entries_parsed   INTEGER NOT NULL DEFAULT 0,
  entries_folded   INTEGER NOT NULL DEFAULT 0,
  entries_rejected INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0,
  imported_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okf_imports_repo
  ON okf_imports(repo_id, imported_at);

-- 3. memories: the second scoping dimension and the layer marker.
--    repo_id is NULLABLE and back-filled by the post-apply hook, not by
--    a DEFAULT: the value depends on the row's existing project_id and
--    SQLite cannot express that in a column default.
--    layer carries NO CHECK constraint - widening it later would force
--    the migration-004 rebuild path (D8-07). Enforced in TypeScript.
ALTER TABLE memories ADD COLUMN repo_id TEXT;
ALTER TABLE memories ADD COLUMN layer TEXT NOT NULL DEFAULT 'local';
ALTER TABLE memories ADD COLUMN shared_entry_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_repo_id
  ON memories(repo_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_layer
  ON memories(layer);

-- 4. kevin_metrics: seed the six v0.8 counters (33 -> 39).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('shared_entries_total',    0),
  ('shared_entries_imported', 0),
  ('shared_entries_exported', 0),
  ('okf_merge_folds',         0),
  ('rekey_events',            0),
  ('injections_from_shared',  0);

-- 5. kevin_settings: seed the five v0.8 flags (18 -> 23).
--    shared_layer_enabled defaults OFF: this release must be opted into,
--    because its first side effect is a new file in the user's repository.
--    shared_confidence_floor (0.7) is deliberately STRICTER than
--    injection_confidence_floor (0.6) - see 5.7.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('shared_layer_enabled',     '0'),
  ('okf_path',                 '.kevin/knowledge.okf'),
  ('share_requires_approval',  '1'),
  ('author_identity_mode',     'hashed'),
  ('shared_confidence_floor',  '0.7');

-- 6. Seed version 009.
INSERT OR IGNORE INTO schema_version (version) VALUES ('009');
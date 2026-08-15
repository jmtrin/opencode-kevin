-- ============================================================================
-- 007_v06_pull.sql — v0.6.0 "Pull"
--
-- Distribution: curated artifacts instead of a per-prompt token tax.
--
-- Section 1: curation_proposals — the persisted human decision record.
-- Section 2: artifact_writes — the disk audit trail, including refusals.
-- Section 3: memories curation + inferability columns.
-- Section 4: metric seeds.
-- Section 5: setting seeds.
-- Section 6: conditional push-budget demotion.
-- Section 7: schema_version.
--
-- Additive only. Every CHECK constraint introduced here is on a NEW table;
-- no existing constraint is widened, so unlike migration 006 there is no
-- table rebuild in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. curation_proposals — one row per proposed artifact change.
--
--    This table is the "explicit human decision between generation and
--    application" of Principle 22. `kevin_propose` writes 'pending' rows and
--    nothing else; `kevin_approve` moves them to 'approved' → 'applied' or to
--    'rejected'. Rows are never deleted: rejection history is the evidence
--    base for roadmap kill criterion K4 ("proposals rejected more often than
--    approved"), which is uncheckable if rejections are discarded.
--
--    memory_id has no REFERENCES clause. Store sets PRAGMA foreign_keys = ON,
--    and a hard FK would block deleting a memory that a historical proposal
--    once mentioned — the same reasoning as superseded_by in migration 006.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curation_proposals (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  memory_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('agents_md','skill','reference')),
  target_path   TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  diff          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','applied','superseded')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT,
  applied_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON curation_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_memory  ON curation_proposals(memory_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON curation_proposals(project_id);

-- ---------------------------------------------------------------------------
-- 2. artifact_writes — the append-only audit trail for every disk operation.
--
--    A row is written for EVERY ArtifactWriter.apply() call, including
--    outcome='noop' and outcome='refused'. A refusal that leaves no trace is
--    indistinguishable from a write that never happened, and the whole point
--    of §5.1 rule 3 is that a refusal is a reportable event.
--
--    hash_before / hash_after are SHA-256 of the full file contents, not of
--    the marker block. That is what makes rule 4 (bytes outside the markers
--    are byte-identical) auditable after the fact rather than only at test
--    time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_writes (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT,
  project_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  bytes_before INTEGER,
  bytes_after  INTEGER,
  hash_before  TEXT,
  hash_after   TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('written','noop','refused')),
  reason       TEXT,
  wrote_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifact_writes_path ON artifact_writes(path);

-- ---------------------------------------------------------------------------
-- 3. memories: curation state and inferability.
--
--    curated / curated_at record that a memory has already been published,
--    so the Curator does not re-propose it on every session idle.
--
--    inferable is deliberately NULLABLE with no default. Three states are
--    needed, not two: 1 = inferable (a self-describing diagnostic the model
--    resolves for free), 0 = non-inferable (project truth), NULL = unknown
--    (not yet classified, or classified as 'unknown'). The Curator predicate
--    is `inferable != 1`, so NULL rows stay eligible — an unclassified memory
--    must not be silently withheld from curation.
-- ---------------------------------------------------------------------------
ALTER TABLE memories ADD COLUMN curated    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN curated_at TEXT;
ALTER TABLE memories ADD COLUMN inferable  INTEGER;

CREATE INDEX IF NOT EXISTS idx_memories_curated   ON memories(curated);
CREATE INDEX IF NOT EXISTS idx_memories_inferable ON memories(inferable);

-- ---------------------------------------------------------------------------
-- 4. Metric seeds. Order matches the additions to METRIC_KEYS in metrics.ts.
--    injections_blocked_confidence is the sixth member of the v0.5 blocked
--    family and MUST be counted like the other five (Principle 16).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
  ('proposals_created',             0),
  ('proposals_approved',            0),
  ('proposals_rejected',            0),
  ('artifact_writes_total',         0),
  ('artifact_writes_noop',          0),
  ('injections_blocked_confidence', 0);

-- ---------------------------------------------------------------------------
-- 5. Setting seeds. Values are TEXT, always. Read them with an explicit
--    string comparison or an explicit Number() parse — never `=== 1`.
--    (That exact mistake kept cross_project_enabled unreachable for the
--    whole of v0.3.0.)
--
--    skill_emission_enabled and reference_emission_enabled default to '0':
--    the pull channels ship OFF and are opted into, because they depend on a
--    v2 domain Kevin does not pin.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
  ('curation_enabled',           '1'),
  ('agents_md_path',             'AGENTS.md'),
  ('skill_emission_enabled',     '0'),
  ('reference_emission_enabled', '0'),
  ('injection_confidence_floor', '0.6');

-- ---------------------------------------------------------------------------
-- 6. Push-budget demotion.
--
--    Lower the default push budget only where the user has not overridden it.
--    A user who deliberately set 1200 (or 1500, or 200) keeps their value;
--    only an installation still sitting on the v0.5 default of '900' is
--    moved to '400'. An unconditional UPDATE here would silently discard a
--    deliberate configuration choice, which is a worse defect than the token
--    cost it would save.
-- ---------------------------------------------------------------------------
UPDATE kevin_settings SET value = '400'
 WHERE key = 'pre_prompt_budget_tokens' AND value = '900';

-- ---------------------------------------------------------------------------
-- 7. Version marker.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO schema_version (version) VALUES ('007');
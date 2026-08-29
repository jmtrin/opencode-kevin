-- ============================================================
-- Kevin 0.1.0 — Schema inicial
-- ============================================================

-- Tabla de versiones para migraciones
CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- memories: lecciones aprendidas
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('error', 'pattern', 'decision', 'context')),
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project', 'session')),
  relevance_score REAL DEFAULT 0.5,
  source_tool TEXT,
  source_session TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

-- FTS5: búsqueda full-text con remoción de diacríticos (mejor para español)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  tokenize='unicode61 remove_diacritics 1'
);

-- Triggers para mantener FTS5 sincronizado (FTS5 external-content se indexa por rowid)
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

-- ============================================================
-- tool_calls: observación de tool calls del agente
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,
  args_summary TEXT,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  duration_ms INTEGER,
  agent TEXT,
  error_type TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool);
CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(ts);
CREATE INDEX IF NOT EXISTS idx_tool_calls_success ON tool_calls(success);

-- ============================================================
-- retrospectives: resúmenes de sesión
-- ============================================================
CREATE TABLE IF NOT EXISTS retrospectives (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  failure_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  lessons_count INTEGER DEFAULT 0,
  file_path TEXT,
  metadata TEXT
);

-- ============================================================
-- Seed: versión inicial
-- ============================================================
INSERT OR IGNORE INTO schema_version (version) VALUES ('001');
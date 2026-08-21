-- =============================================================
-- Kevin v1.0.0 "Proven" — migration 011
-- Adds: perf sampling, benchmark results.
-- No ALTER TABLE (second release running); no column is retyped.
-- =============================================================

-- 1. Per-scope latency aggregates, flushed at session.idle.
--    Machine-scoped: no project_id, for the same reason hook_liveness
--    has none (v0.9.0 D9-08) — latency is a property of the install.
CREATE TABLE IF NOT EXISTS perf_samples (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    scope          TEXT    NOT NULL,
    sample_count   INTEGER NOT NULL,
    p50_ms         REAL    NOT NULL,
    p95_ms         REAL    NOT NULL,
    max_ms         REAL    NOT NULL,
    budget_p95_ms  REAL    NOT NULL,
    within_budget  INTEGER NOT NULL DEFAULT 1,
    recorded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_perf_samples_scope
    ON perf_samples(scope, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_samples_breach
    ON perf_samples(within_budget) WHERE within_budget = 0;

-- 2. Benchmark results. Append-only. One row per arm per run.
--    arm CHECK is closed by the plan; widening requires a table rebuild (intentional friction).
--    scope CHECK is intentionally absent: the scope union may gain members in a 1.x minor.
CREATE TABLE IF NOT EXISTS bench_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    corpus_digest    TEXT    NOT NULL,
    contract_digest  TEXT    NOT NULL,
    package_version  TEXT    NOT NULL,
    runtime          TEXT    NOT NULL,
    arm              TEXT    NOT NULL,
    k                INTEGER NOT NULL,
    precision_at_k   REAL    NOT NULL,
    recall_at_k      REAL    NOT NULL,
    mrr              REAL    NOT NULL,
    ran_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (arm IN ('none', 'recent-k', 'random-k', 'kevin'))
);

CREATE INDEX IF NOT EXISTS idx_bench_runs_corpus
    ON bench_runs(corpus_digest, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_bench_runs_arm
    ON bench_runs(arm, ran_at DESC);

-- 3. Metric seeds (45 -> 51).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('perf_samples_recorded', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('perf_budget_breaches', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('dispose_fires_total', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('dispose_misses_total', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('contract_digest_changes', 0);
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES ('bench_runs_total', 0);

-- 4. Setting seeds (27 -> 31). All TEXT; '0'/'1' are strings.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_enabled', '1');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_ring_capacity', '512');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('perf_flush_on_idle', '1');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('contract_report_enabled', '1');

-- 5. `dispose` becomes the seventh instrumented hook (v0.9.0 migration 010
--    seeded six rows; this is a data seed, not a schema change).
INSERT OR IGNORE INTO hook_liveness (hook) VALUES ('dispose');

-- 6. Schema version.
INSERT OR IGNORE INTO schema_version (version) VALUES ('011');

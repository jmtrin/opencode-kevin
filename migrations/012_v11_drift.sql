-- millisecond companions for the two tables whose ORDERING decides outcomes.
ALTER TABLE tool_calls       ADD COLUMN ts_ms           INTEGER;
ALTER TABLE kevin_injections ADD COLUMN injected_at_ms  INTEGER;

-- conservative backfill: seconds -> ms (x1000). Rows keep their original
-- second-granularity value in the old column; nothing is rewritten there.
UPDATE tool_calls SET ts_ms =
  CAST(strftime('%s', ts) AS INTEGER) * 1000
WHERE ts_ms IS NULL AND ts IS NOT NULL;

UPDATE kevin_injections SET injected_at_ms =
  CAST(strftime('%s', injected_at) AS INTEGER) * 1000
WHERE injected_at_ms IS NULL AND injected_at IS NOT NULL;

CREATE INDEX idx_tool_calls_ts_ms        ON tool_calls(ts_ms);
CREATE INDEX idx_injections_injected_ms  ON kevin_injections(injected_at_ms);

-- metric seeds (C-05 additions carry since=1.1.0 in contract)
INSERT INTO kevin_metrics (key, value, updated_at) VALUES
  ('bench_regression_failures',    0, datetime('now')),
  ('forget_requests_total',        0, datetime('now')),
  ('forget_tombstones_published',  0, datetime('now'));

INSERT INTO schema_version (version) VALUES ('012');

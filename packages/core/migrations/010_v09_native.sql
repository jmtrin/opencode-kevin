-- ============================================================
-- Kevin v0.9.0 "Native" — host surface and hook liveness
-- Migration 010. Additive only. No table rebuild.
-- ============================================================

-- 1. Hook liveness. Deliberately NOT project-scoped: a hook is a
--    property of the host binary, not of a checkout. One row per
--    hook name, updated in place. See D9-08.
CREATE TABLE IF NOT EXISTS hook_liveness (
	hook            TEXT PRIMARY KEY,
	experimental    INTEGER NOT NULL DEFAULT 0,
	fire_count      INTEGER NOT NULL DEFAULT 0,
	error_count     INTEGER NOT NULL DEFAULT 0,
	expected_count  INTEGER NOT NULL DEFAULT 0,
	first_seen_at   TEXT,
	last_seen_at    TEXT,
	dead_since      TEXT,
	plugin_version  TEXT
);

CREATE INDEX IF NOT EXISTS idx_hook_liveness_dead
	ON hook_liveness(dead_since);

-- 2. Host probe history. Append-only. Off by default; exists so a
--    user chasing an intermittent fault can turn it on and get a
--    timeline instead of a single current value.
CREATE TABLE IF NOT EXISTS host_probes (
	id              TEXT PRIMARY KEY,
	probed_at       TEXT NOT NULL DEFAULT (datetime('now')),
	plugin_version  TEXT,
	flavour         TEXT NOT NULL,
	has_shell       INTEGER NOT NULL DEFAULT 0,
	v2_skill        INTEGER NOT NULL DEFAULT 0,
	v2_reference    INTEGER NOT NULL DEFAULT 0,
	notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_host_probes_at
	ON host_probes(probed_at);

-- 3. Native registration outcomes. One row per attach attempt, so
--    "registered but unverified" is a queryable state rather than a
--    log line.
CREATE TABLE IF NOT EXISTS native_registrations (
	id              TEXT PRIMARY KEY,
	attached_at     TEXT NOT NULL DEFAULT (datetime('now')),
	surface         TEXT NOT NULL CHECK (surface IN ('skill', 'reference')),
	registered      INTEGER NOT NULL DEFAULT 0,
	verified        INTEGER NOT NULL DEFAULT 0,
	note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_registrations_surface
	ON native_registrations(surface, attached_at);

-- 4. Metric seeds (39 -> 45).
INSERT OR IGNORE INTO kevin_metrics (key, value) VALUES
	('hook_fires_total',                0),
	('hook_errors_total',               0),
	('hooks_dead_total',                0),
	('injections_suppressed_dead_hook', 0),
	('native_registrations_total',      0),
	('native_registration_failures',    0);

-- 5. Setting seeds (23 -> 27).
--    hook_liveness_enabled defaults ON: it is a read-only instrument
--    on the success path, and an instrument nobody switches on is an
--    instrument nobody has.
--    native_registration_enabled defaults OFF: it changes where a
--    curated skill comes from, and that is a change a user opts into.
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES
	('hook_liveness_enabled',       '1'),
	('native_registration_enabled', '0'),
	('host_probe_history_enabled',  '0'),
	('dead_hook_report_threshold',  '3');

-- 6. Version marker.
INSERT OR IGNORE INTO schema_version (version) VALUES ('010');
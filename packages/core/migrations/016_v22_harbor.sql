-- ============================================================
-- Kevin v2.2.0 "Harbor" — MCP bridge settings seeds
-- Migration 016. Forward-only. Additive only.
-- ============================================================
-- BUG-05 (K22-005 / plan §4.5, D22-06): KEVIN_CONFIG_KEYS lists 44 keys
-- but a fresh 001→015 database lists only 41 — the three MCP bridge
-- settings were accepted by `kevin_config set` yet absent from `list`
-- (migration 013 seeded the five mcp_* METRICS but no kevin_settings,
-- and the factory seeded only tui_*/skills_* at runtime). This migration
-- heals fresh databases; the factory runtime seeds (next to the tui_*/
-- skills_* block, same K12-001/K15-001 convention) heal existing 015 DBs.

INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_write_enabled', '0');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_approve_enabled', '0');
INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('mcp_repo_override', '');

-- Version marker
INSERT OR IGNORE INTO schema_version (version) VALUES ('016');

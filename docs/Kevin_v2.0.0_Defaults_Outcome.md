# Kevin v2.0.0 — Conditional Defaults Outcome (K16-006 / D16-03)

## Evidence (committed 1.5.0-close artifacts)

| Candidate | Source Artifact | Raw Value | Threshold | Verdict |
|---|---|---|---|---|
| `skill_emission_enabled` default ON | `channels_v2` export bench + feedback counters | channels exported 12, skill_emission adoption 0.42 (412/981 installs with skill dir present) | >=0.80 adoption | **FALSE** — keep OFF (opt-in) |
| `error_lesson_mode` triage_only | `bench` results + feedback counters | bench precision delta triage_only -0.02, feedback false-positive rate 0.11 for all vs 0.09 triage_only, below_floor 0.03 | false-positive <0.05 && precision loss <0.01 | **FALSE** — keep `all` |

*Numbers pasted from committed artifacts at 1.5.0 tag: `tests/replay/fixtures/bench-1.5.0.json` (precision 0.71 vs 0.69), `kevin_audit` feedback block (false-positives 11%), `channels_v2` export count (12 skills emitted). No vacuum: both branches measured.*

## Verdict

- **skill_emission_enabled**: FALSE — default remains `0` (off). No migration, no golden change. Users opt in via `kevin_config set skill_emission_enabled 1`.
- **error_lesson_mode**: FALSE — domain `["all","triage_only"]` retained, default `all` unchanged. No enum removal, no hardcoded dispatch. Golden C-04 annotation not needed.

## Application

No default constants changed. No golden C-04 `removed` or `changed` annotation for these candidates. Migration doc `MIGRATION_2.0.0.md` exit-ramp step notes both FALSE outcomes, no action required.

Flag audit 31/31 keys from 1.1.0 (Appendix — Flag Audit) reviewed: 0 deprecated keys found. Verdict line: `31/31 flags audited — 0 deprecated, 0 moved to REMOVED_SETTINGS beyond import_host_memory (absorption case).`

— K16-006 outcome doc, 2026-08-16, threshold applied mechanically.

## Adoption Gate — K16-021 (D16-10 / plan §6)

**Gate formula:** `ratio = weekly_downloads(@jmtrin/kevin-mcp) / weekly_downloads(@jmtrin/opencode-kevin)` — PASS if `ratio ≥ 0.50` (threshold ≈238 on baseline 475 at 2026-08-25). Data source `api.npmjs.org/downloads/point/last-week/<pkg>`, two captures 7 days apart, >20% disagreement → extend soak one week.

**Outcome 2026-08-30:** **gate not taken** — 2.0.0-dev not yet published to npm, so no weekly_downloads to capture. Soak for 1.5.0 not elapsed before 2.0.0 code-freeze. Per D16-10, non-PASS ships nothing. K16-022..024 closed as `[X] gate not taken`, no `packages/cc-adapter` code, no contract C-14 addition for `claude-code-hooks` source (remains v2.1 candidate). Re-evaluation scheduled for v2.1 with real npm captures.

*Evidence:* no npm captures taken; plan §6 intact; Task breakdown updated `K16-021..024 → [X] gate not taken`.

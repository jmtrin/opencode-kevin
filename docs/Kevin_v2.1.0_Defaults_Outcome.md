# Kevin v2.1.0 — Adoption Gate (K21-001 / D21-05 / plan §6)

## Captures

| date | base (@jmtrin/opencode-kevin) | mcp (@jmtrin/kevin-mcp) | ratio (mcp/base) | url |
|------|-------------------------------|-------------------------|------------------|-----|
| 2026-08-30 | 763 | 219 | 0.287 | https://api.npmjs.org/downloads/point/last-week/@jmtrin/opencode-kevin , https://api.npmjs.org/downloads/point/last-week/@jmtrin/kevin-mcp |
| 2026-08-30 (D+0 — same-day second capture, soak not yet elapsed) | 763 | 219 | 0.287 | same URLs — second capture pending 2026-09-06 |

Raw JSON captured 2026-08-30:

- base: `{"downloads":763,"start":"2026-08-23","end":"2026-08-29","package":"@jmtrin/opencode-kevin"}`
- mcp: `{"downloads":219,"start":"2026-08-23","end":"2026-08-29","package":"@jmtrin/kevin-mcp"}`

Both packages are published at 2.0.0 (registry `version: "2.0.0"` verified 2026-08-30 via `https://registry.npmjs.org/@jmtrin/opencode-kevin/latest` and `kevin-mcp/latest`). The weekly window 2026-08-23 → 2026-08-29 fully covers the post-2.0.0 publish week.

Disagreement check: `abs(0.287-0.287)/max(0.287,0.287)=0` → 0% <20%, no soak extension needed for disagreement. However threshold check is `ratio >=0.50` (baseline 475 →≈238). 0.287 <0.50.

## Verdict

**FAIL** — ratio 0.287 (<0.50). Threshold requires ≥382 downloads for kevin-mcp on base 763 (or ≥238 on baseline 475); actual 219 is below both.

No vacuum: raw numbers cited above, URLs and dates recorded, second same-day capture confirms stability (single-week publish window, no 7-day drift to measure yet). Full 7-day re-capture scheduled for 2026-09-06 will re-evaluate once if ratio moves >20%.

## Binding

K21-002…K21-004 **gate not taken** — conditional CC adapter, e2e fixture tests, and recipe doc/contract C-14 addition do not ship in 2.1.0. Plan §4.2/§4.5 C-14 remains at 4 sources (opencode-plugin 10, claude-memory 20, codex-memories 30, opencode-native 40). Artifact remains 4 packages (core, plugin, tui, mcp) — no `packages/cc-adapter`.

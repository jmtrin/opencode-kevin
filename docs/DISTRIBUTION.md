# Kevin — Distribution Checklist (v1.1.0 "Drift")

**Version:** 1.1.0
**Status:** Active
**Principle:** Public trust signals are engineering surface (P40) — these items are measured, not goodwill.

This checklist is the human-side of the release (D11-04). CI asserts only offline facts (LICENSE, homepage, CHANGELOG); GitHub-side actions live here with owner + evidence placeholders. (D11-04)

---

## Checklist

### 1. Enable GitHub Discussions
- [ ] Enable Discussions in repository settings (Settings → Features → Discussions)
- **Owner:** @jmtrin
- **Evidence:** URL to Discussions tab (e.g., `https://github.com/jmtrin/opencode-kevin/discussions`)

### 2. Publish GitHub Release per tag
- [ ] For each tag `vX.Y.Z`, create a GitHub Release using `scripts/release-notes.mjs`
- Command: `gh release create v1.1.0 --notes-file <(node scripts/release-notes.mjs 1.1.0)` or `node scripts/release-notes.mjs > /tmp/notes.md && gh release create v1.1.0 --notes-file /tmp/notes.md`
- **Owner:** @jmtrin
- **Evidence:** Release URL (e.g., `https://github.com/jmtrin/opencode-kevin/releases/tag/v1.1.0`)

### 3. Record 15-second demo GIF (failure → lesson → recall → AGENTS.md diff)
- [ ] Record a 15 s screen capture: a failing tool call → Reflector lesson → next session recall → `kevin_propose` → `kevin_approve` diff in AGENTS.md
- Save as `docs/demo.gif` (≤ 5 MB, 800×450)
- **Owner:** @jmtrin
- **Evidence:** `docs/demo.gif` committed, visible in README

### 4. Embed GIF in README title block
- [ ] Uncomment the demo image line in `README.md` once `docs/demo.gif` lands
- Line: `<!-- uncomment when docs/demo.gif lands -->` → `![demo](docs/demo.gif)`
- **Owner:** @jmtrin
- **Evidence:** README renders GIF on GitHub

### 5. PR to awesome-opencode list
- [ ] Open a PR adding `@jmtrin/opencode-kevin` to `https://github.com/awesome-opencode/awesome-opencode` (or equivalent list)
- **Owner:** @jmtrin
- **Evidence:** PR URL

### 6. PR to opencode plugin showcase
- [ ] Open a PR or issue adding Kevin to the opencode plugin showcase / docs
- **Owner:** @jmtrin
- **Evidence:** PR URL

---

## Notes

- Items 1, 2, 5, 6 require GitHub network access and are intentionally not asserted in CI (D11-04).
- Item 3 is the most first-session-perceptible improvement in the ladder (T8) — a new user sees value in minutes.
- Re-run `scripts/release-notes.mjs` for each version to generate release notes from `CHANGELOG.md`.

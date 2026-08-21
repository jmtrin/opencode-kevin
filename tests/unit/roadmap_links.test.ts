/**
 * K10-024 — roadmap integrity: every per-release Plan/Task document is
 * linked, no markdown link is dead, §5.5 no longer claims a v2 API
 * migration, and the after-1.0 section collects the deferred items.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS = join(process.cwd(), "docs");
const roadmap = readFileSync(join(DOCS, "Kevin_Roadmap.md"), "utf8");

describe("K10-024 — Kevin_Roadmap.md", () => {
	it("has no dead relative markdown links", () => {
		const links = [...roadmap.matchAll(/\]\(\.\/([^)#)]+)\)/g)].map(
			(m) => m[1],
		);
		expect(links.length).toBeGreaterThan(0);
		const dead = links.filter((l) => !existsSync(join(DOCS, l)));
		expect(dead, `dead links: ${dead.join(", ")}`).toEqual([]);
	});

	it("links every per-release Plan and Task document", () => {
		const perRelease = readdirSync(DOCS).filter((f) =>
			/^Kevin_v\d+\.\d+\.\d+_(Plan|Task)\.md$/.test(f),
		);
		expect(perRelease.length).toBeGreaterThanOrEqual(15);
		const missing = perRelease.filter((f) => !roadmap.includes(`](./${f})`));
		expect(missing, `documents not linked: ${missing.join(", ")}`).toEqual([]);
	});

	it("§5.5 states the non-migration decision instead of claiming a v2 migration", () => {
		const i = roadmap.indexOf("### 5.5");
		const j = roadmap.indexOf("### 5.6");
		const section = roadmap.slice(i, j);
		expect(section).toMatch(/Kevin does not\s+migrate to the v2 API/);
	});

	it("collects the post-1.0 deferrals in one place", () => {
		for (const item of [
			"TUI panels",
			"Real-corpus retrieval evaluation",
			"OKF schema v3",
			"Multi-file / per-directory OKF corpora",
			"cross-release benchmark tracking",
			"`tool.definition`, `chat.params`, `permission.ask`",
		]) {
			expect(roadmap).toContain(item);
		}
	});
});

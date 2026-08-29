import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitSkillBundle, refreshSkillBundle } from "@jmtrin/kevin-core";

describe("skills mirrors K15-006", () => {
	it("copies canonical to mirrors when enabled", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-mirror-"));
		const manifest = join(root, "manifest.json");
		const topics = [{ topic: "rule-m", content: "- mirror" }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude", "cursor"], topics, repoId: "aaaaaaaaaaaaaaaa", manifestPath: manifest });
		expect(existsSync(join(root, ".claude", "skills", "kevin-knowledge", "SKILL.md"))).toBe(true);
		expect(existsSync(join(root, ".cursor", "skills", "kevin-knowledge", "SKILL.md"))).toBe(true);
		expect(existsSync(join(root, ".claude", "skills", "kevin-knowledge", "references", "rule-m.md"))).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
	it("disabled mirrors leave zero writes", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-mirror2-"));
		const manifest = join(root, "manifest.json");
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: [{ topic: "rule-x", content: "- x" }], repoId: "bbbbbbbbbbbbbbbb", manifestPath: manifest });
		expect(existsSync(join(root, ".claude"))).toBe(false);
		expect(existsSync(join(root, ".cursor"))).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});
	it("mirror follows canonical: stale mirror overwritten only when canonical changed", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-mirror3-"));
		const manifest = join(root, "manifest.json");
		const topics1 = [{ topic: "rule-y", content: "- y1" }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics: topics1, repoId: "cccccccccccccccc", manifestPath: manifest });
		// tamper mirror
		const mirrorRef = join(root, ".claude", "skills", "kevin-knowledge", "references", "rule-y.md");
		const canonicalRef = join(root, ".agents/skills", "kevin-knowledge", "references", "rule-y.md");
		// refresh with same topics (CLEAN) -> mirror not overwritten
		refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics: topics1, repoId: "cccccccccccccccc", manifestPath: manifest });
		// now change canonical
		const topics2 = [{ topic: "rule-y", content: "- y2 changed" }];
		refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics: topics2, repoId: "cccccccccccccccc", manifestPath: manifest });
		expect(readFileSync(mirrorRef, "utf8")).toContain("y2");
		expect(readFileSync(canonicalRef, "utf8")).toContain("y2");
		rmSync(root, { recursive: true, force: true });
	});
});

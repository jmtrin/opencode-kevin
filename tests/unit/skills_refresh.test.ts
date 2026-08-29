import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitSkillBundle, refreshSkillBundle } from "@jmtrin/kevin-core";
import { createHash } from "node:crypto";

function sha(s: string) { return createHash("sha256").update(s, "utf8").digest("hex"); }

describe("skills refresh K15-005", () => {
	it("three-state: CLEAN -> noop, STALE -> rewrite, EXTERNAL_EDIT -> skip", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-refresh-"));
		const manifest = join(root, "manifest.json");
		const repoId = "abc123abc123abcd";
		const topics1 = [{ topic: "rule-a", content: "- alpha" }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: topics1, repoId, manifestPath: manifest });
		const skillPath = join(root, ".agents/skills", "kevin-knowledge", "SKILL.md");
		const refPath = join(root, ".agents/skills", "kevin-knowledge", "references", "rule-a.md");
		// CLEAN: refresh with same topics -> noop
		const r1 = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: topics1, repoId, manifestPath: manifest });
		expect(r1.noop).toContain(skillPath);
		expect(r1.written.length).toBe(0);
		expect(r1.skipped_external.length).toBe(0);
		// STALE: change content -> disk==manifest but fresh differs -> rewrite
		const topics2 = [{ topic: "rule-a", content: "- alpha changed" }];
		const r2 = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: topics2, repoId, manifestPath: manifest });
		expect(r2.written).toContain(refPath);
		expect(readFileSync(refPath, "utf8")).toContain("changed");
		// EXTERNAL_EDIT: manually edit file, then refresh with same topics -> skip
		writeFileSync(refPath, "tampered content", "utf8");
		const r3 = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: topics2, repoId, manifestPath: manifest });
		expect(r3.skipped_external).toContain(refPath);
		expect(readFileSync(refPath, "utf8")).toBe("tampered content");
		expect(r3.external_edits).toContain(refPath);
		rmSync(root, { recursive: true, force: true });
	});
	it("missing manifest + existing files = EXTERNAL", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-refresh2-"));
		const manifest = join(root, "manifest.json");
		const repoId = "deadbeefdeadbeef";
		const topics = [{ topic: "rule-x", content: "- x" }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest });
		// delete manifest
		rmSync(manifest, { force: true });
		const r = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest });
		expect(r.skipped_external.length).toBeGreaterThan(0);
		rmSync(root, { recursive: true, force: true });
	});
	it("deleted-file reconciliation: manifest entry without disk file -> rewrite", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-refresh3-"));
		const manifest = join(root, "manifest.json");
		const repoId = "feedfeedfeedfeed";
		const topics = [{ topic: "rule-del", content: "- del" }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest });
		const refPath = join(root, ".agents/skills", "kevin-knowledge", "references", "rule-del.md");
		rmSync(refPath, { force: true });
		const r = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest });
		expect(r.written).toContain(refPath);
		expect(existsSync(refPath)).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});

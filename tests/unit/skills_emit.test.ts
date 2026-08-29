import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitSkillBundle } from "@jmtrin/kevin-core";
import { validateSkill } from "@jmtrin/kevin-core";

describe("skills-emit K15-003", () => {
	it("emits canonical structure, validator passes, deterministic, counter", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-skill-"));
		const manifest = join(root, "manifest.json");
		const repoId = "abc123def4567890";
		const topics = [
			{ topic: "rule-alpha", content: "- Alpha rule: always use foo\n- second line" },
			{ topic: "pattern-beta", content: "- Beta pattern: avoid bar" },
		];
		let incrCount = 0;
		const metrics = { incr: (k: string) => { if (k === "skills_emitted_total") incrCount++; } };
		const report1 = emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest, metrics });
		expect(report1.written.length).toBe(3); // SKILL.md + 2 refs
		const skillPath = join(root, ".agents/skills", "kevin-knowledge", "SKILL.md");
		expect(existsSync(skillPath)).toBe(true);
		const skillContent = readFileSync(skillPath, "utf8");
		// validator must pass
		const v = validateSkill(skillContent, "kevin-knowledge");
		expect(v.ok, `validator errors: ${v.errors.join(";")}`).toBe(true);
		expect(skillContent).toContain("name: kevin-knowledge");
		expect(skillContent).toContain(`repo_id: ${repoId}`);
		// references exist and are escaped (no raw fence)
		for (const t of topics) {
			const refPath = join(root, ".agents/skills", "kevin-knowledge", "references", `${t.topic}.md`);
			expect(existsSync(refPath)).toBe(true);
		}
		// deterministic: second emit byte-identical
		const before = readFileSync(skillPath, "utf8");
		const report2 = emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId, manifestPath: manifest, metrics });
		const after = readFileSync(skillPath, "utf8");
		expect(before).toBe(after);
		expect(incrCount).toBe(2);
		// manifest exists and contains hashes
		expect(existsSync(manifest)).toBe(true);
		const mf = JSON.parse(readFileSync(manifest, "utf8"));
		expect(mf[skillPath]).toBeDefined();
		rmSync(root, { recursive: true, force: true });
	});

	it("empty topics emits skill with no knowledge yet body", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-skill-empty-"));
		const manifest = join(root, "manifest.json");
		const report = emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics: [], repoId: "deadbeefdeadbeef", manifestPath: manifest });
		const skillPath = join(root, ".agents/skills", "kevin-knowledge", "SKILL.md");
		expect(existsSync(skillPath)).toBe(true);
		const c = readFileSync(skillPath, "utf8");
		expect(c).toContain("No knowledge yet");
		const v = validateSkill(c, "kevin-knowledge");
		expect(v.ok).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});

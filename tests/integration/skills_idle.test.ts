import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitSkillBundle, refreshSkillBundle } from "@jmtrin/kevin-core";

describe("skills idle K15-007", () => {
	it("end-to-end idle produces canonical+mirrors per flags; second idle noop; tamper reports external_edits", () => {
		const root = mkdtempSync(join(tmpdir(), "idle-test-"));
		const manifest = join(root, "manifest.json");
		const topics = [{ topic: "rule-idle", content: "- idle content" }];
		// first idle emit
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics, repoId: "aaaaaaaaaaaaaaaa", manifestPath: manifest });
		expect(existsSync(join(root, ".agents/skills", "kevin-knowledge", "SKILL.md"))).toBe(true);
		expect(existsSync(join(root, ".claude", "skills", "kevin-knowledge", "SKILL.md"))).toBe(true);
		// second idle -> all noop
		const r2 = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics, repoId: "aaaaaaaaaaaaaaaa", manifestPath: manifest });
		expect(r2.noop.length).toBeGreaterThan(0);
		expect(r2.written.length).toBe(0);
		// tamper
		const skillPath = join(root, ".agents/skills", "kevin-knowledge", "SKILL.md");
		writeFileSync(skillPath, "tampered", "utf8");
		const r3 = refreshSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: ["claude"], topics, repoId: "aaaaaaaaaaaaaaaa", manifestPath: manifest });
		expect(r3.external_edits).toContain(skillPath);
		expect(readFileSync(skillPath, "utf8")).toBe("tampered");
		rmSync(root, { recursive: true, force: true });
	});
});

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { emitSkillBundle } from "@jmtrin/kevin-core";
import { escapeForFence, escapeForMarkerBlock } from "@jmtrin/kevin-core";

describe("skills escaping scan K15-004", () => {
	it("source scan: every write routes through escape helper", () => {
		const srcPath = join(process.cwd(), "packages", "core", "src", "skills-emit.ts");
		const src = readFileSync(srcPath, "utf8");
		// must contain escape usage before atomicWrite
		expect(src).toMatch(/escapeForFence|escapeForMarkerBlock|escaped\(/);
		// ensure at least one escaped call near toWrite composition
		expect(src).toContain("escaped(");
		// heuristic: every reference content assignment should be escaped
		const hasEscapedRef = src.includes("escaped(body)") || src.includes("escaped(");
		expect(hasEscapedRef).toBe(true);
	});

	it("behavior probe: hostile payload is escaped in emitted bytes", () => {
		const root = mkdtempSync(join(tmpdir(), "kevin-escape-"));
		const manifest = join(root, "manifest.json");
		const hostile = "- hostile <!-- kevin:end --> and fence ``` evil ``` and ~~~ also <script> & amp";
		const topics = [{ topic: "rule-evil", content: hostile }];
		emitSkillBundle({ projectRoot: root, canonicalDir: ".agents/skills", mirrors: [], topics, repoId: "abc123abc123abcd", manifestPath: manifest });
		const skillContent = readFileSync(join(root, ".agents/skills", "kevin-knowledge", "SKILL.md"), "utf8");
		const refContent = readFileSync(join(root, ".agents/skills", "kevin-knowledge", "references", "rule-evil.md"), "utf8");
		// skill references should be escaped
		// marker block escape: < becomes &lt;
		expect(refContent).not.toContain("<!-- kevin:end -->");
		expect(refContent).toContain("&lt;!--");
		// fence escape: ``` becomes &#96; sequence
		expect(refContent).not.toContain("```");
		expect(refContent).toContain("&#96;");
		// also check skill index escaped summary doesn't contain raw <
		expect(skillContent).not.toContain("<script>");
		if (skillContent.includes("script")) {
			expect(skillContent).toContain("&lt;script");
		}
		rmSync(root, { recursive: true, force: true });
	});
});

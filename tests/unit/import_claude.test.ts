import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseClaudeMemory } from "@jmtrin/kevin-core";

describe("import claude K15-011", () => {
	it("fixture expectations: files_scanned 4, candidates pinned, malformed skipped", () => {
		const root = mkdtempSync(join(tmpdir(), "claude-test-"));
		const proj = join(root, "claude", "projects", "proj1", "memory");
		mkdirSync(proj, { recursive: true });
		// MEMORY.md index (should be counted but not harvested)
		writeFileSync(join(proj, "MEMORY.md"), "# Index\n", "utf8");
		// 3 topic files with typed frontmatter incl. one malformed
		writeFileSync(join(proj, "topic1.md"), `---\ntype: user_preference\n---\n\n- pref one\n- pref two\n`, "utf8");
		writeFileSync(join(proj, "topic2.md"), `---\ntype: correction\n---\n\n- fix this\n`, "utf8");
		writeFileSync(join(proj, "bad.md"), `not frontmatter at all\n- bullet?`, "utf8");
		const res = parseClaudeMemory(root);
		expect(res.files_scanned).toBe(4);
		expect(res.candidates.length).toBeGreaterThan(0);
		expect(res.skipped_files).toBeGreaterThanOrEqual(1);
		// check type mapping: correction -> rule
		const hasRule = res.candidates.some((c) => c.type === "rule");
		expect(hasRule).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseCodexMemories } from "@jmtrin/kevin-core";

describe("import codex K15-012", () => {
	it("pinned counts on fixtures; malformed safe", () => {
		const root = mkdtempSync(join(tmpdir(), "codex-test-"));
		const memDir = join(root, "codex", "memories");
		mkdirSync(memDir, { recursive: true });
		writeFileSync(join(memDir, "memory_summary.md"), `# Summary\n- summary bullet one\n- bullet two\n`, "utf8");
		writeFileSync(join(memDir, "MEMORY.md"), `# Heading One\n- bullet a\n## Heading Two\n- bullet b\n`, "utf8");
		const res = parseCodexMemories(root);
		expect(res.files_scanned).toBe(2);
		expect(res.candidates.length).toBeGreaterThan(0);
		expect(res.candidates.every((c) => c.type === "context")).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});
});

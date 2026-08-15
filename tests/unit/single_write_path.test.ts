import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * K6-014 + K6-017 — D6-01 enforcement. `ArtifactWriter.apply()` is the ONLY
 * file-writing function in the plugin; there is no raw `writeFileSync`
 * anywhere. The call sites are exactly two, each with a constrained target:
 * `kevin_approve` reaches `agents_md_path` (D6-07) and `Materializer`
 * reaches `~/.opencode-kevin` bundles only. A third site breaks this test.
 */
describe("single write path (K6-014/K6-017 / D6-01)", () => {
	it("finds exactly two ArtifactWriter.apply() call sites: kevin_approve.ts and Materializer.ts", () => {
		const files = readdirSync(join(process.cwd(), "plugin")).filter((f) =>
			f.endsWith(".ts"),
		);
		const sites: { file: string; line: number; text: string }[] = [];
		for (const file of files) {
			const src = readFileSync(join(process.cwd(), "plugin", file), "utf8");
			const lines = src.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (/\.apply\(/.test(lines[i])) {
					sites.push({ file, line: i + 1, text: lines[i].trim() });
				}
			}
		}
		expect(sites).toHaveLength(2);
		expect(sites[0].file).toBe("kevin_approve.ts");
		expect(sites[0].text).toContain("writer.apply(plan,");
		expect(sites[1].file).toBe("Materializer.ts");
		expect(sites[1].text).toContain("writer.apply(writer.plan(");
	});

	it("the writer binding in kevin_approve.ts is the ArtifactWriter", () => {
		const src = readFileSync(
			join(process.cwd(), "plugin", "kevin_approve.ts"),
			"utf8",
		);
		expect(src).toMatch(/writer: ArtifactWriter/);
	});
});

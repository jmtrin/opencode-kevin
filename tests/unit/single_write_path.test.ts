import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * K6-014 + K6-017 + K8-019 — D6-01/D8-08 enforcement. Every file Kevin
 * writes goes through `ArtifactWriter.apply()`, reachable only from the
 * single `write()` funnel inside `ArtifactWriter.ts`; there is no raw
 * `writeFileSync` anywhere a repo file is written. The whole-file mode
 * (`mode: "whole"`) is constructed at exactly one site, in
 * `SharedLayer.ts`. Any new write path — a convenience `writeFileSync` in
 * a tool module, a second `apply()` call site, a whole-mode construction
 * outside SharedLayer — breaks this test on purpose.
 */
describe("single write path (K6-014/K6-017/K8-019 / D6-01, D8-08)", () => {
	function pluginFiles(): string[] {
		return readdirSync(join(process.cwd(), "packages/core/src")).filter((f) =>
			f.endsWith(".ts"),
		);
	}

	function scan(re: RegExp): { file: string; line: number; text: string }[] {
		const sites: { file: string; line: number; text: string }[] = [];
		for (const file of pluginFiles()) {
			const src = readFileSync(join(process.cwd(), "packages/core/src", file), "utf8");
			const lines = src.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (re.test(lines[i])) {
					sites.push({ file, line: i + 1, text: lines[i].trim() });
				}
			}
		}
		return sites;
	}

	it("finds exactly one ArtifactWriter.apply() call site, inside ArtifactWriter.write()", () => {
		const sites = scan(/\.apply\(/);
		expect(sites).toHaveLength(1);
		expect(sites[0].file).toBe("ArtifactWriter.ts");
		expect(sites[0].text).toContain(
			"this.apply(this.plan(request), proposalId)",
		);
	});

	it('mode:"whole" is constructed in SharedLayer.ts and RepoIdentity.ts and nowhere else', () => {
		// The two Kevin-owned files in a repository are written whole-file:
		// `.kevin/knowledge.okf` (SharedLayer) and `.kevin/project.json`
		// (RepoIdentity, K8-019 resolution of the K8-008 NOTE). Both route
		// through ArtifactWriter.write() — the invariant is the single
		// write PATH (D8-08), not the number of whole-file callers. A
		// third module constructing mode:"whole" breaks this test.
		const sites = scan(/mode:\s*"whole"/);
		expect(sites.filter((s) => s.file === "SharedLayer.ts")).toHaveLength(1);
		for (const site of sites) {
			expect(["SharedLayer.ts", "RepoIdentity.ts"]).toContain(site.file);
		}
	});

	it("writeFileSync appears only in RepoIdentity.ts and Retrospective.ts (D8-08)", () => {
		// The two allowed modules write to Kevin's own directories
		// (~/.opencode-kevin, .kevin/) — never to a file in the user's
		// repository. A third module acquiring raw fs writes breaks this
		// test, exactly as a writeFileSync in SharedLayer.ts would.
		// v1.2.0 (K12-003/K12-017) — TUI projection writers (TuiSnapshots,
		// DashboardHtml, TuiActions, tui) also target ~/.opencode-kevin/tui
		// — same allowed directory, hence allowlisted.
		// v1.5.0 (K15-003/006) — skills-emit.ts writes canonical/mirror skills under
		// <projectRoot>/.agents/skills and .claude/.cursor mirrors — same isolated
		// funnel, allowlisted (D15-04).
		const sites = scan(/\bwriteFileSync\b/);
		expect(sites.length).toBeGreaterThan(0);
		for (const site of sites) {
			expect([
				"RepoIdentity.ts",
				"Retrospective.ts",
				"TuiSnapshots.ts",
				"DashboardHtml.ts",
				"TuiActions.ts",
				"tui.ts",
				"skills-emit.ts",
			]).toContain(site.file);
		}
	});

	it("the writer binding in kevin_approve.ts is the ArtifactWriter", () => {
		const src = readFileSync(
			join(process.cwd(), "packages/core/src", "kevin_approve.ts"),
			"utf8",
		);
		expect(src).toMatch(/writer: ArtifactWriter/);
	});
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unifiedDiff } from "@jmtrin/kevin-core";

const FILE = "file.md";

function makeLines(count: number, seed = ""): string {
	let out = "";
	for (let i = 1; i <= count; i++) {
		out += `line ${seed}${i}\n`;
	}
	return out;
}

function countHunks(diff: string): number {
	return diff.split("\n").filter((l) => l.startsWith("@@ ")).length;
}

describe("K6-006 — plugin/diff.ts", () => {
	let tmpRoot: string;

	afterEach(() => {
		if (tmpRoot !== undefined) {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("identical inputs produce byte-identical output across 100 invocations", () => {
		const before = makeLines(40);
		const after = before
			.replace("line 7", "line 7 EDITED")
			.replace("line 39", "line 39 EDITED");
		const first = unifiedDiff(FILE, before, after);
		expect(first).not.toBe("");
		for (let i = 0; i < 100; i++) {
			expect(unifiedDiff(FILE, before, after)).toBe(first);
		}
	});

	it("empty-to-content produces the exact unified-diff layout", () => {
		expect(unifiedDiff(FILE, "", "l1\nl2\nl3\n")).toBe(
			"--- a/file.md\n+++ b/file.md\n@@ -0,0 +1,3 @@\n+l1\n+l2\n+l3\n",
		);
	});

	it("content-to-empty produces a full deletion hunk", () => {
		expect(unifiedDiff(FILE, "l1\nl2\nl3\n", "")).toBe(
			"--- a/file.md\n+++ b/file.md\n@@ -1,3 +0,0 @@\n-l1\n-l2\n-l3\n",
		);
	});

	it("no-change inputs produce the empty string", () => {
		expect(unifiedDiff(FILE, "a\nb\n", "a\nb\n")).toBe("");
	});

	it("a change at the top and at the bottom of a 200-line file produce two hunks", () => {
		const before = makeLines(200);
		const after = before
			.replace("line 1\n", "line 1 EDITED\n")
			.replace("line 200\n", "line 200 EDITED\n");
		const diff = unifiedDiff(FILE, before, after);
		expect(countHunks(diff)).toBe(2);
		expect(diff).toContain("-line 1\n");
		expect(diff).toContain("+line 1 EDITED\n");
		expect(diff).toContain("-line 200\n");
		expect(diff).toContain("+line 200 EDITED\n");
	});

	it("two changes four lines apart produce one merged hunk", () => {
		const before = makeLines(20);
		const after = before
			.replace("line 5\n", "line 5 EDITED\n")
			.replace("line 9\n", "line 9 EDITED\n");
		const diff = unifiedDiff(FILE, before, after);
		expect(countHunks(diff)).toBe(1);
		expect(diff).toContain("+line 5 EDITED\n");
		expect(diff).toContain("+line 9 EDITED\n");
	});

	it("hunk headers and body match git diff -U3 output byte-for-byte", () => {
		const before =
			"intro line one\nintro line two\nintro line three\nintro line four\n" +
			"intro line five\nkeep six\nkeep seven\nremove eight\nremove nine\n" +
			"keep ten\nkeep eleven\nadd context twelve\nadd context thirteen\n" +
			"add context fourteen\ntail fifteen\ntail sixteen\n";
		const after =
			"intro line one\nintro line two\nintro line three changed\nintro line four\n" +
			"intro line five\nkeep six\nkeep seven\nnew line eight\nnew line nine\n" +
			"keep ten\nkeep eleven\nadd context twelve\nadd context thirteen\n" +
			"add context fourteen\ntail fifteen\ntail sixteen tail changed\n";

		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-diff-git-"));
		const f1 = join(tmpRoot, FILE);
		const f2 = join(tmpRoot, "file2.md");
		writeFileSync(f1, before, "utf8");
		writeFileSync(f2, after, "utf8");
		let gitOut = "";
		try {
			gitOut = execFileSync(
				"git",
				[
					"-c",
					"core.autocrlf=false",
					"diff",
					"--no-index",
					"-U3",
					FILE,
					"file2.md",
				],
				{ cwd: tmpRoot, encoding: "utf8" },
			);
		} catch (err) {
			// git exits 1 when files differ; stdout still holds the diff.
			const e = err as { stdout?: string };
			gitOut = e.stdout ?? "";
		}
		// The second fixture lives at a different path; the path itself is
		// cosmetic to the algorithm, so normalize it before comparing. Git
		// versions differ on leading `diff --git`/`index` metadata lines —
		// the contract starts at the `--- a/` header.
		const headerStart = gitOut.indexOf("--- a/");
		expect(headerStart).toBeGreaterThanOrEqual(0);
		gitOut = gitOut.slice(headerStart).replaceAll("file2.md", FILE);
		expect(unifiedDiff(FILE, before, after)).toBe(gitOut);
	});

	it("a file without a trailing newline round-trips without a spurious final-line hunk", () => {
		// before lacks the final newline, after has it: identical logical
		// lines → no hunk at all.
		expect(unifiedDiff(FILE, "a\nb", "a\nb\n")).toBe("");
		// The real plan() round-trip shape: content gains the marker block.
		const before = "foo";
		const after =
			"foo\n\n<!-- kevin:begin — curated by opencode-kevin, safe to edit -->\n" +
			"body\n<!-- kevin:end -->\n";
		const diff = unifiedDiff(FILE, before, after);
		expect(countHunks(diff)).toBe(1);
		expect(diff).toContain(" foo\n");
		expect(diff).not.toContain("-foo\n");
	});
});

import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
} from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const BODY = "line1\nline2\nline3";

let tmpRoot: string;

function fixture(name: string, content: string): string {
	const p = join(tmpRoot, name);
	writeFileSync(p, content, "utf8");
	return p;
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("K6-005 — ArtifactWriter.plan()", () => {
	afterEach(() => {
		if (tmpRoot !== undefined) {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	function writer(): ArtifactWriter {
		const store = new Store({ path: ":memory:" });
		return new ArtifactWriter(store, "test-project");
	}

	it("rule 1 — plan() on a read-only directory returns normally and creates no file", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-ro-"));
		const p = fixture(
			"file.md",
			`# Title\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`,
		);
		try {
			chmodSync(tmpRoot, 0o500);
		} catch {
			// Windows ignores POSIX modes; the no-file-created assertion still
			// holds everywhere.
		}
		const before = new Set(readdirSync(tmpRoot));
		const plan = writer().plan(p, BODY);
		expect(plan.path).toBe(p);
		expect(plan.before).toBe(`# Title\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`);
		const after = new Set(readdirSync(tmpRoot));
		expect(after).toEqual(before);
	});

	it("rule 2 — missing file produces exactly: blank line, begin, body, end, trailing newline", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-new-"));
		const p = join(tmpRoot, "missing.md");
		const plan = writer().plan(p, BODY);
		expect(plan.before).toBe("");
		expect(plan.after).toBe(`\n${MARKER_BEGIN}\n${BODY}\n${MARKER_END}\n`);
		expect(plan.outcome).toBe("written");
		expect(existsFile(p)).toBe(false);
	});

	it("rule 2b — non-empty markerless file gets the block appended with a blank line separator", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-append-"));
		const p = fixture("bare.md", "hello");
		const plan = writer().plan(p, BODY);
		expect(plan.after).toBe(
			`hello\n\n${MARKER_BEGIN}\n${BODY}\n${MARKER_END}\n`,
		);
	});

	it("rule 3 — exactly one marker (begin only) refuses", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-b1-"));
		const p = fixture("broken.md", `# Title\n${MARKER_BEGIN}\nold\n`);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("refused");
		expect(plan.reason ?? "").not.toBe("");
		expect(plan.after).toBe(plan.before);
	});

	it("rule 3 — exactly one marker (end only) refuses", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-e1-"));
		const p = fixture("broken.md", `# Title\n${MARKER_END}\n`);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("refused");
		expect(plan.reason ?? "").not.toBe("");
		expect(plan.after).toBe(plan.before);
	});

	it("rule 3 — MARKER_END before MARKER_BEGIN refuses", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-rev-"));
		const p = fixture(
			"broken.md",
			`# Title\n${MARKER_END}\n${MARKER_BEGIN}\nold\n`,
		);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("refused");
		expect(plan.reason ?? "").not.toBe("");
		expect(plan.after).toBe(plan.before);
	});

	it("rule 3 — more than one pair refuses", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-multi-"));
		const p = fixture(
			"broken.md",
			`${MARKER_BEGIN}\nold\n${MARKER_END}\n${MARKER_BEGIN}\nold2\n${MARKER_END}\n`,
		);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("refused");
		expect(plan.reason ?? "").not.toBe("");
		expect(plan.after).toBe(plan.before);
	});

	it("rule 4 — bytes outside the marker pair are byte-identical", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-splice-"));
		const p = fixture(
			"file.md",
			`# Title\n\nIntro paragraph\n${MARKER_BEGIN}\nold block\n${MARKER_END}\n\nFooter\n`,
		);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("written");
		const beginIndex = plan.before.indexOf(MARKER_BEGIN);
		expect(beginIndex).toBeGreaterThan(0);
		expect(plan.after.slice(0, beginIndex)).toBe(
			plan.before.slice(0, beginIndex),
		);
		const endIndexBefore = plan.before.indexOf(MARKER_END) + MARKER_END.length;
		const endIndexAfter = plan.after.indexOf(MARKER_END) + MARKER_END.length;
		expect(plan.after.slice(endIndexAfter)).toBe(
			plan.before.slice(endIndexBefore),
		);
	});

	it("rule 6 — unchanged body yields noop and equal hashes", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-noop-"));
		const p = fixture(
			"file.md",
			`# Title\n${MARKER_BEGIN}\n${BODY}\n${MARKER_END}\n`,
		);
		const plan = writer().plan(p, BODY);
		expect(plan.outcome).toBe("noop");
		expect(plan.after).toBe(plan.before);
		expect(plan.hashBefore).toBe(plan.hashAfter);
	});

	it("hashes are 64-char lowercase hex matching node:crypto and differ on change", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-plan-hash-"));
		const p = fixture("file.md", `old\n${MARKER_BEGIN}\nx\n${MARKER_END}\n`);
		const plan = writer().plan(p, BODY);
		expect(plan.hashBefore).toMatch(/^[0-9a-f]{64}$/);
		expect(plan.hashAfter).toMatch(/^[0-9a-f]{64}$/);
		expect(plan.hashBefore).toBe(sha256(plan.before));
		expect(plan.hashAfter).toBe(sha256(plan.after));
		expect(plan.hashBefore).not.toBe(plan.hashAfter);
	});

	it("the module contains no file-write call yet", () => {
		const source = readFileSync(
			join(process.cwd(), "packages/core/src", "ArtifactWriter.ts"),
			"utf8",
		);
		expect(source).not.toContain("writeFileSync");
		expect(source).not.toContain("appendFileSync");
		expect(source).not.toContain("createWriteStream");
	});
});

function existsFile(p: string): boolean {
	try {
		readFileSync(p, "utf8");
		return true;
	} catch {
		return false;
	}
}

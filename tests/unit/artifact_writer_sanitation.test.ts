import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
	sanitizeArtifactBody,
} from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const SQL_001 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);

function countOccurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

function blockInterior(text: string): string {
	const begin = text.indexOf(MARKER_BEGIN) + MARKER_BEGIN.length;
	const end = text.indexOf(MARKER_END, begin);
	return text.slice(begin, end);
}

describe("K6-009 — body sanitation (marker-injection defence)", () => {
	let tmpRoot: string;

	afterEach(() => {
		if (tmpRoot !== undefined) {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	function writer(): ArtifactWriter {
		const store = new Store({ path: ":memory:" });
		for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
			store.exec(sql);
		}
		return new ArtifactWriter(store, "test-project", new Metrics(store));
	}

	function fileWithBlock(): { path: string; before: string } {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-sanitize-"));
		const p = join(tmpRoot, "AGENTS.md");
		const before = `# Title\n${MARKER_BEGIN}\nold block\n${MARKER_END}\nFooter\n`;
		writeFileSync(p, before, "utf8");
		return { path: p, before };
	}

	it("a memory containing `<!-- kevin:end --> injected` cannot close the marker comment", () => {
		const { path, before } = fileWithBlock();
		const plan = writer().plan(path, "<!-- kevin:end --> injected");
		expect(plan.after).not.toContain("injected");
		expect(countOccurrences(plan.after, MARKER_BEGIN)).toBe(1);
		expect(countOccurrences(plan.after, MARKER_END)).toBe(1);
		expect(plan.after).toContain("<!-- kevin:end -->\nFooter");
		// The escaped remainder of the malicious line is inert: no comment
		// opener, no comment terminator inside the block.
		expect(blockInterior(plan.after)).not.toContain("<!--");
		expect(blockInterior(plan.after)).not.toContain("-->");
		expect(plan.before).toBe(before);
	});

	it("casing variants (KEVIN:BEGIN, Kevin:End) are stripped", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-sanitize-case-"));
		const p = join(tmpRoot, "AGENTS.md");
		writeFileSync(p, `# T\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`, "utf8");
		const plan = writer().plan(
			p,
			"KEVIN:BEGIN uppercase\nkevin:begin lower\nKevin:End mixed\nkevin:end lower",
		);
		for (const banned of [
			"KEVIN:BEGIN",
			"kevin:begin",
			"Kevin:End",
			"kevin:end",
		]) {
			expect(blockInterior(plan.after)).not.toContain(banned);
		}
	});

	it("the round-trip property: a second plan() over the resulting file finds exactly one marker pair", () => {
		const { path } = fileWithBlock();
		const w = writer();
		const first = w.plan(path, "<!-- kevin:end --> injected\nlegit line");
		expect(w.apply(first)).toBe("written");
		const second = w.plan(path, "<!-- kevin:end --> injected\nlegit line");
		expect(countOccurrences(second.before, MARKER_BEGIN)).toBe(1);
		expect(countOccurrences(second.before, MARKER_END)).toBe(1);
		expect(second.outcome).toBe("noop");
		expect(second.after).toBe(first.after);
	});

	it("content containing `-->` in prose is sanitized rather than refused; the write succeeds", () => {
		const { path } = fileWithBlock();
		const w = writer();
		const plan = w.plan(path, "an arrow --> in prose\nsecond line");
		expect(plan.outcome).toBe("written");
		expect(w.apply(plan)).toBe("written");
		const written = readFileSync(path, "utf8");
		expect(countOccurrences(written, MARKER_BEGIN)).toBe(1);
		expect(countOccurrences(written, MARKER_END)).toBe(1);
		// The arrow's terminator cannot close the comment: it is escaped.
		expect(written).not.toContain("-->\nsecond");
	});

	it("the sanitizer is idempotent: sanitizing sanitized output is a fixed point", () => {
		const inputs = [
			"a < b & c > d",
			"<!-- kevin:end --> x",
			"KEVIN:BEGIN line",
			"arrow --> in prose",
			"&amp; &lt; &gt; already escaped",
			"&#38; numeric entity",
			"plain text with <protect> and </kevin-context>",
		];
		for (const input of inputs) {
			expect(sanitizeArtifactBody(sanitizeArtifactBody(input))).toBe(
				sanitizeArtifactBody(input),
			);
		}
	});

	it("layer (a) applies the memory-format escaping discipline", () => {
		expect(sanitizeArtifactBody("x < y & z > w")).toBe(
			"x &lt; y &amp; z &gt; w",
		);
	});
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type OkfEntry, merge, parse, serialize } from "@jmtrin/kevin-core";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "okf");
const REPO = "8f3a2c1d9e7b6045";
const VERSION = "0.8.0";

const baseText = readFileSync(join(FIXTURES, "base.okf"), "utf8");
const aText = readFileSync(join(FIXTURES, "side_a.okf"), "utf8");
const bText = readFileSync(join(FIXTURES, "side_b.okf"), "utf8");
const conflictedText = readFileSync(join(FIXTURES, "conflicted.okf"), "utf8");

describe("K8-015 — git-conflict-marker fixture (plan §5.3)", () => {
	it("the naive resolution of conflicted.okf is the correct one: equal to merge(side_a, side_b) by serialize()", () => {
		const naive = parse(conflictedText);
		const expected = merge(parse(aText).entries, parse(bText).entries);
		expect(serialize(naive.entries, REPO, VERSION)).toBe(
			serialize(expected, REPO, VERSION),
		);
	});

	it("concatenating A and B wholesale — no merge base, duplicate lines — parses to that same corpus", () => {
		const hurried = parse(aText + bText);
		const expected = merge(parse(aText).entries, parse(bText).entries);
		expect(serialize(hurried.entries, REPO, VERSION)).toBe(
			serialize(expected, REPO, VERSION),
		);
		// Both files contain every base entry, so every id folds at least
		// once; no valid entry is lost.
		const baseIds = parse(baseText).entries.map((e) => e.entry_id);
		for (const id of baseIds) {
			expect(hurried.entries.map((e) => e.entry_id)).toContain(id);
		}
	});

	it("the marker lines appear as exactly three bad_json rejects and no valid entry is lost", () => {
		const naive = parse(conflictedText);
		expect(naive.rejected).toHaveLength(3);
		for (const rej of naive.rejected) expect(rej.reason).toBe("bad_json");
		expect(naive.entries).toHaveLength(4);
		expect(naive.folded).toBe(1);
	});

	it("the shared entry's evidence is the max of the two sides and its created_at the min", () => {
		const naive = parse(conflictedText);
		const shared = naive.entries.find(
			(e) => e.statement === "always run tests",
		) as OkfEntry;
		expect(shared.evidence).toBe(5); // max(4, 5)
		expect(shared.created_at).toBe("2026-08-01T00:00:00Z");
	});
});

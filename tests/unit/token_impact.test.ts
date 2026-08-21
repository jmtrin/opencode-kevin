import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOC = join(process.cwd(), "docs", "Kevin_Token_Impact.md");
const RESULTS_DIR = join(process.cwd(), "bench", "results");

function resultsNumbers(): Set<string> {
	const values: number[] = [];
	for (const n of readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))) {
		const j = JSON.parse(readFileSync(join(RESULTS_DIR, n), "utf8")) as {
			arms?: Record<string, unknown>[];
		};
		const walk = (v: unknown): void => {
			if (typeof v === "number") values.push(v);
			else if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === "object") Object.values(v).forEach(walk);
		};
		walk(j);
	}
	return new Set(values.map((v) => v.toFixed(3)));
}

describe("K10-028 — Kevin_Token_Impact.md carries no unsourced claim", () => {
	it("exists and cites the committed benchmark results", () => {
		expect(existsSync(DOC)).toBe(true);
		const doc = readFileSync(DOC, "utf8");
		const names = readdirSync(RESULTS_DIR).filter((n) => n.endsWith(".json"));
		expect(names.length).toBeGreaterThan(0);
		for (const n of names) expect(doc).toContain(n);
	});

	it("contains no guess language", () => {
		const doc = readFileSync(DOC, "utf8");
		expect(doc).not.toMatch(
			/estimated|projection|assumed|roughly|approximately|speculative/i,
		);
	});

	it("every decimal number in the document traces to the results file", () => {
		const doc = readFileSync(DOC, "utf8");
		const decimals = doc.match(/\b\d+\.\d+\b/g) ?? [];
		expect(decimals.length).toBeGreaterThan(0);
		const known = resultsNumbers();
		for (const d of decimals)
			expect(known.has(Number(d).toFixed(3))).toBe(true);
	});
});

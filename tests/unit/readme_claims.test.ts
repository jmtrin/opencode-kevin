/**
 * K10-023 — the README must not be able to drift from the measurement it
 * reports: the benchmark table's corpus digest and arm names are asserted
 * against the committed results file.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

function committedResult(): {
	corpus_digest: string;
	arms: readonly { arm: string }[];
} {
	const dir = join(process.cwd(), "bench", "results");
	const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	expect(files.length, "no committed bench result found").toBeGreaterThan(0);
	const sorted = [...files].sort();
	const last = sorted[sorted.length - 1];
	return JSON.parse(readFileSync(join(dir, last), "utf8")) as {
		corpus_digest: string;
		arms: readonly { arm: string }[];
	};
}

describe("K10-023 — README benchmark claims match the committed results", () => {
	it("README carries the committed corpus digest", () => {
		const result = committedResult();
		expect(readme).toContain(result.corpus_digest);
	});

	it("README names every measured arm", () => {
		const result = committedResult();
		for (const { arm } of result.arms) {
			expect(
				readme.includes(`\`${arm}\``),
				`arm ${arm} absent from README benchmark section`,
			).toBe(true);
		}
	});

	it("README states both limits of the measurement", () => {
		expect(readme).toContain(
			"does **not** prove that real sessions look like this synthetic corpus",
		);
		expect(readme).toContain(
			"It does not prove that a surfaced memory changed what the model did",
		);
	});

	it("README links the contract document and states the 1.x promise", () => {
		expect(readme).toContain("docs/CONTRACT.md");
		expect(readme).toContain("`C-01` … `C-09`");
	});

	it("README documents the three v1.0.0 scripts", () => {
		for (const cmd of [
			"npm run bench",
			"npm run bench:check",
			"npm run verify:pack",
		]) {
			expect(readme).toContain(cmd);
		}
	});
});

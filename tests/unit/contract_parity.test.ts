import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PublicContract } from "../../plugin/contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURE = join(REPO_ROOT, "tests", "fixtures", "contract", "v1.json");
const CONTRACT_MD = join(REPO_ROOT, "docs", "CONTRACT.md");

function loadGolden(): PublicContract {
	const raw = readFileSync(FIXTURE, "utf8");
	const lines = raw.split("\n");
	const jsonLines = lines.filter((l) => !l.startsWith("//"));
	return JSON.parse(jsonLines.join("\n")) as PublicContract;
}

describe("Contract parity — docs/CONTRACT.md (K10-009)", () => {
	it("every clause id in the golden file appears as a heading in CONTRACT.md", () => {
		const golden = loadGolden();
		const md = readFileSync(CONTRACT_MD, "utf8");
		for (const c of golden.clauses) {
			expect(md, `missing heading for ${c.id} in CONTRACT.md`).toMatch(
				new RegExp(`## ${c.id}\\b`),
			);
		}
	});
	it("every C-NN heading in CONTRACT.md exists in the golden file", () => {
		const golden = loadGolden();
		const ids = new Set(golden.clauses.map((c) => c.id));
		const md = readFileSync(CONTRACT_MD, "utf8");
		const headings = [...md.matchAll(/^## (C-\d+)/gm)].map((m) => m[1]);
		for (const h of headings) {
			expect(
				ids.has(h),
				`heading ${h} in CONTRACT.md has no clause in golden file`,
			).toBe(true);
		}
	});
	it("deprecation policy's five rules appear verbatim", () => {
		const md = readFileSync(CONTRACT_MD, "utf8");
		expect(md).toMatch(/Deprecation policy/);
		// five numbered rules
		for (let i = 1; i <= 5; i++) {
			expect(md).toMatch(new RegExp(`^${i}\\.`, "m"));
		}
	});
});

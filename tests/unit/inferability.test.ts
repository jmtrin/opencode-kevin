import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SELF_DESCRIBING_CODES, classify } from "../../plugin/inferability.js";

function errorMemory(
	content: string,
	code: string | null,
): { type: string; content: string; metadata: unknown } {
	return {
		type: "error",
		content,
		metadata: { dispatch: { code, hint: null } },
	};
}

describe("K6-010 — inferability classifier (plan §5.3)", () => {
	it("rule 1 — decision/rule/solution are non_inferable regardless of content", () => {
		for (const type of ["decision", "rule", "solution"]) {
			expect(classify({ type, content: "anything" })).toBe("non_inferable");
			expect(
				classify({ type, content: "TS2304 on ./scripts/gen-routes.ts" }),
			).toBe("non_inferable");
		}
	});

	it("rule 1 negative — a non-rule-1 type is not classified by it", () => {
		expect(classify(errorMemory("generic failure", "TS9999"))).toBe("unknown");
	});

	it("rule 2 — pattern is non_inferable regardless of content", () => {
		expect(classify({ type: "pattern", content: "anything" })).toBe(
			"non_inferable",
		);
		expect(classify({ type: "pattern", content: "npm run build fails" })).toBe(
			"non_inferable",
		);
	});

	it("rule 2 negative — a non-pattern type is not classified by it", () => {
		expect(classify(errorMemory("generic failure", "TS9999"))).toBe("unknown");
	});

	it("rule 3 — a bare self-describing code is inferable", () => {
		expect(classify(errorMemory("Cannot find name 'x'", "TS2304"))).toBe(
			"inferable",
		);
	});

	it("rule 3 negative — an unrecognized code is not inferable", () => {
		expect(classify(errorMemory("something failed", "TS9999"))).toBe("unknown");
	});

	it("rule 4 — project-specific paths are non_inferable", () => {
		expect(
			classify(errorMemory("build failed for ./scripts/gen-routes.ts", null)),
		).toBe("non_inferable");
	});

	it("rule 4 — npm-script names are non_inferable", () => {
		expect(classify(errorMemory("npm run build exited 1", null))).toBe(
			"non_inferable",
		);
		expect(classify(errorMemory("pnpm exec tsc failed", null))).toBe(
			"non_inferable",
		);
	});

	it("rule 4 — --flag tokens are non_inferable", () => {
		expect(classify(errorMemory("tsc --watch crashed", null))).toBe(
			"non_inferable",
		);
	});

	it("rule 4 — file extensions are non_inferable", () => {
		expect(classify(errorMemory("parse error in src/app.ts", null))).toBe(
			"non_inferable",
		);
		expect(classify(errorMemory("bad tsconfig.json", null))).toBe(
			"non_inferable",
		);
	});

	it("rule 4 negative — generic content is not non_inferable", () => {
		expect(classify(errorMemory("something went wrong", null))).toBe("unknown");
	});

	it("rule 5 — otherwise unknown, positive case", () => {
		expect(classify(errorMemory("odd failure", "ENOENT"))).toBe("unknown");
		expect(classify({ type: "fact", content: "cold start" })).toBe("unknown");
	});

	it("rule 5 negative — a recognized code is not unknown", () => {
		expect(classify(errorMemory("Cannot find name 'x'", "TS2304"))).toBe(
			"inferable",
		);
	});

	it("ordering — rule 4 beats rule 3 when content is project-specific", () => {
		// Rule 3 evaluated first: the bare code is inferable.
		expect(classify(errorMemory("Cannot find name 'x'", "TS2304"))).toBe(
			"inferable",
		);
		// Rule 4 catches what rule 3 does not: same code, project-specific payload.
		expect(
			classify(
				errorMemory(
					"TS2304 on ./scripts/gen-routes.ts because the generator must run before tsc",
					"TS2304",
				),
			),
		).toBe("non_inferable");
	});

	it("every member of SELF_DESCRIBING_CODES is exercised bare", () => {
		for (const code of SELF_DESCRIBING_CODES) {
			expect(classify(errorMemory(`error: ${code}`, code))).toBe("inferable");
		}
		expect(SELF_DESCRIBING_CODES.size).toBe(12);
	});

	it("metadata is optional and defensive — absent dispatch yields unknown", () => {
		expect(classify({ type: "error", content: "generic" })).toBe("unknown");
		expect(
			classify({ type: "error", content: "generic", metadata: null }),
		).toBe("unknown");
		expect(
			classify({
				type: "error",
				content: "generic",
				metadata: { dispatch: null },
			}),
		).toBe("unknown");
		expect(
			classify({
				type: "error",
				content: "generic",
				metadata: { dispatch: { code: null, hint: null } },
			}),
		).toBe("unknown");
	});

	it("is deterministic — identical inputs yield identical outputs", () => {
		const memory = errorMemory("Cannot find name 'x'", "TS2304");
		expect(classify(memory)).toBe(classify(memory));
	});

	it("the module imports nothing from plugin/Store.js, node:fs or node:crypto", () => {
		const source = readFileSync(
			join(process.cwd(), "plugin", "inferability.ts"),
			"utf8",
		);
		expect(source).not.toContain("Store.js");
		expect(source).not.toContain("node:fs");
		expect(source).not.toContain("node:crypto");
		expect(source).not.toContain("Math.random");
	});
});

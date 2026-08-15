import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probe } from "../../plugin/capabilities.js";

const ALL_FALSE = { skills: false, references: false, apiVersion: null };

describe("K6-016 — capabilities probe (plan §5.7, D6-13)", () => {
	it("returns the all-false result and never throws for ten malformed inputs", () => {
		const throwingProxy = new Proxy(
			{},
			{
				get() {
					throw new Error("boom");
				},
			},
		);
		const malformed: unknown[] = [
			null,
			undefined,
			0,
			"",
			[],
			{},
			{ skill: null },
			{ skill: {} },
			{ skill: { source: 1 } },
			throwingProxy,
		];
		for (const input of malformed) {
			expect(() => probe(input)).not.toThrow();
			expect(probe(input)).toEqual(ALL_FALSE);
		}
	});

	it("returns { skills: true, references: true } for a synthetic v2-shaped input", () => {
		const input = {
			skill: { source: () => "draft" },
			reference: { add: () => "added" },
			apiVersion: "2.0.0",
		};
		expect(probe(input)).toEqual({
			skills: true,
			references: true,
			apiVersion: "2.0.0",
		});
	});

	it("treats the two capabilities as independent", () => {
		expect(probe({ skill: { source: () => "draft" } })).toEqual({
			skills: true,
			references: false,
			apiVersion: null,
		});
		expect(probe({ reference: { add: () => "added" } })).toEqual({
			skills: false,
			references: true,
			apiVersion: null,
		});
	});

	it("apiVersion is null when absent or not a string", () => {
		expect(probe({ apiVersion: 42 })).toEqual(ALL_FALSE);
		expect(probe({ skill: { source: () => "" } })).toEqual({
			skills: true,
			references: false,
			apiVersion: null,
		});
	});

	it("package.json still pins @opencode-ai/plugin ^1.17.6", () => {
		const pkg = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf8"),
		) as { dependencies: Record<string, string> };
		expect(pkg.dependencies["@opencode-ai/plugin"]).toBe("^1.17.6");
	});
});

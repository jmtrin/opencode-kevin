import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probe } from "../../plugin/capabilities.js";

const ALL_FALSE = {
	skills: false,
	references: false,
	apiVersion: null,
	permissionAsk: false,
};

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
			permissionAsk: false,
		});
	});

	it("treats the two capabilities as independent", () => {
		expect(probe({ skill: { source: () => "draft" } })).toEqual({
			skills: true,
			references: false,
			apiVersion: null,
			permissionAsk: false,
		});
		expect(probe({ reference: { add: () => "added" } })).toEqual({
			skills: false,
			references: true,
			apiVersion: null,
			permissionAsk: false,
		});
	});

	it("apiVersion is null when absent or not a string", () => {
		expect(probe({ apiVersion: 42 })).toEqual(ALL_FALSE);
		expect(probe({ skill: { source: () => "" } })).toEqual({
			skills: true,
			references: false,
			apiVersion: null,
			permissionAsk: false,
		});
	});

	it("permissionAsk capability reports correctly (K12-012)", () => {
		expect(probe({ permission: { ask: () => true } })).toEqual({
			skills: false,
			references: false,
			apiVersion: null,
			permissionAsk: true,
		});
		expect(probe({ permission: { ask: 1 } })).toEqual(ALL_FALSE);
		expect(probe({ permission: null })).toEqual(ALL_FALSE);
		expect(
			probe({ skill: { source: () => "" }, permission: { ask: () => true } }),
		).toEqual({
			skills: true,
			references: false,
			apiVersion: null,
			permissionAsk: true,
		});
	});

	// v0.9.0 (K9-007 / plan §3.4, D9-03): the pin rose to ^1.18.16 on the
	// byte-level proof that dist/index.d.ts is SHA-256-identical to 1.17.6's.
	it("package.json still pins @opencode-ai/plugin ^1.18.16", () => {
		const pkg = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf8"),
		) as { dependencies: Record<string, string> };
		expect(pkg.dependencies["@opencode-ai/plugin"]).toBe("^1.18.16");
	});
});

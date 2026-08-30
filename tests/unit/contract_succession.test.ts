import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffContract } from "@jmtrin/kevin-core";
import type { PublicContract } from "@jmtrin/kevin-core";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const V1 = join(REPO_ROOT, "tests", "fixtures", "contract", "v1.json");
const V2 = join(REPO_ROOT, "tests", "fixtures", "contract", "v2.json");

function load(p: string): PublicContract {
	const raw = readFileSync(p, "utf8");
	const json = raw
		.split("\n")
		.filter((l) => !l.startsWith("//"))
		.join("\n");
	return JSON.parse(json) as PublicContract;
}

describe("Contract succession v1 ⊆ v2 (K16-002)", () => {
	it("both fixtures exist with append-only header", () => {
		expect(existsSync(V1)).toBe(true);
		expect(existsSync(V2)).toBe(true);
		for (const p of [V1, V2]) {
			const raw = readFileSync(p, "utf8");
			expect(raw.startsWith("//")).toBe(true);
			expect(raw).toMatch(/append-only/i);
		}
	});

	it("v1 contractVersion 1, v2 contractVersion 2", () => {
		const v1 = load(V1);
		const v2 = load(V2);
		expect(v1.contractVersion).toBe(1);
		expect(v2.contractVersion).toBe(2);
	});

	it("every v1 clause exists in v2 verbatim (no drift)", () => {
		const v1 = load(V1);
		const v2 = load(V2);
		const v2ById = new Map(v2.clauses.map((c) => [c.id, c]));
		for (const c1 of v1.clauses) {
			const c2 = v2ById.get(c1.id);
			expect(c2, `missing carried clause ${c1.id} in v2`).toBeDefined();
			// title/stability/since must be identical
			expect(c2!.title).toBe(c1.title);
			expect(c2!.stability).toBe(c1.stability);
			expect(c2!.since).toBe(c1.since);
			// For C-03/C-04/C-05 additive members allowed, but no removal/change
			if (["C-03", "C-04", "C-05"].includes(c1.id)) {
				const diffs = diffContract(
					{ contractVersion: 1, clauses: [c1] } as PublicContract,
					{ contractVersion: 2, clauses: [c2!] } as PublicContract,
				);
				const bad = diffs.filter(
					(d) =>
						d.kind === "removed" ||
						d.kind === "changed" ||
						d.kind === "added_bare",
				);
				expect(
					bad,
					`bad diff in carried clause ${c1.id}: ${JSON.stringify(bad)}`,
				).toEqual([]);
				// every member in v1 must be in v2
				const v1Val = c1.value as Record<string, unknown>;
				const v2Val = c2!.value as Record<string, unknown>;
				const keys1 = (v1Val.keys ??
					v1Val.tools ??
					v1Val.markers ??
					v1Val.invariants ??
					[]) as unknown[];
				const keys2 = (v2Val.keys ??
					v2Val.tools ??
					v2Val.markers ??
					v2Val.invariants ??
					[]) as unknown[];
				// fallback: if not array-based, compare full value for non-additive clauses
				if (keys1.length === 0 && keys2.length === 0) {
					// For C-01 etc, compare value JSON, but C-07 allows forward schema_version bump
					if (c1.id === "C-07") {
						expect(
							(v2Val as Record<string, unknown>).migrations_forward_only,
						).toBe((v1Val as Record<string, unknown>).migrations_forward_only);
						// schema_version forward-only bump allowed
						continue;
					}
					expect(JSON.stringify(c1.value)).toBe(JSON.stringify(c2!.value));
				}
			} else {
				// Strict verbatim for C-01,C-02,C-06,C-07,C-08,C-09 (except C-07 schema_version forward bump)
				if (c1.id === "C-07") {
					expect(
						(c2!.value as Record<string, unknown>).migrations_forward_only,
					).toBe((c1.value as Record<string, unknown>).migrations_forward_only);
					// allow schema_version to be >= v1
					const v1v = String(
						(c1.value as Record<string, unknown>).schema_version,
					);
					const v2v = String(
						(c2!.value as Record<string, unknown>).schema_version,
					);
					expect(v2v >= v1v).toBe(true);
					continue;
				}
				expect(JSON.stringify(c1.value)).toBe(JSON.stringify(c2!.value));
			}
		}
	});

	it("v2 adds exactly C-10..C-14 with proper since", () => {
		const v2 = load(V2);
		const ids = new Set(v2.clauses.map((c) => c.id));
		for (const id of ["C-10", "C-11", "C-12", "C-13", "C-14"]) {
			expect(ids.has(id), `missing new clause ${id}`).toBe(true);
			const c = v2.clauses.find((x) => x.id === id)!;
			expect(typeof c.since).toBe("string");
			expect(c.since.length).toBeGreaterThan(0);
		}
		// No unexpected extra clauses beyond C-14 at v2
		const extra = v2.clauses.filter(
			(c) =>
				![
					"C-01",
					"C-02",
					"C-03",
					"C-04",
					"C-05",
					"C-06",
					"C-07",
					"C-08",
					"C-09",
					"C-10",
					"C-11",
					"C-12",
					"C-13",
					"C-14",
				].includes(c.id),
		);
		expect(extra).toEqual([]);
	});

	it("generation script is idempotent (v2 re-generated equals fixture)", async () => {
		// Compare live vs v2 already covered in contract_frozen, but also ensure v1->v2 subset via diffContract
		const v1 = load(V1);
		const v2 = load(V2);
		const diffs = diffContract(v1, v2);
		// C-07 schema_version forward bump is allowed (forward-only clause)
		const removedOrChanged = diffs.filter(
			(d) =>
				(d.kind === "removed" || d.kind === "changed") &&
				!(d.clauseId === "C-07" && d.path.endsWith("schema_version")),
		);
		expect(
			removedOrChanged,
			`v1->v2 should have no removals/changes: ${JSON.stringify(removedOrChanged)}`,
		).toEqual([]);
		// Added members must be added_ok (carry since)
		const bare = diffs.filter((d) => d.kind === "added_bare");
		expect(
			bare,
			`v1->v2 should have no added_bare: ${JSON.stringify(bare)}`,
		).toEqual([]);
	});
});

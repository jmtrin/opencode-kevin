import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeEntryId } from "@jmtrin/kevin-core";

// A deterministic PRNG so the 1000 random inputs are reproducible.
function xorshift32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 0xffffffff;
	};
}

function randomString(rnd: () => number, maxLen: number): string {
	const len = Math.floor(rnd() * maxLen);
	let out = "";
	for (let i = 0; i < len; i++) {
		const r = rnd();
		if (r < 0.5) out += String.fromCharCode(0x20 + Math.floor(rnd() * 95));
		else if (r < 0.9)
			out += String.fromCharCode(0x80 + Math.floor(rnd() * 0x80));
		else out += " \t\n\r";
	}
	return out;
}

describe("K8-010 — computeEntryId (plan §3.3, D8-05)", () => {
	it("yields the same id for the same triple under two different project_ids and working directories", () => {
		// project_id and cwd do not participate in the id at all.
		const a = computeEntryId("rule", "always run tests", "project");
		const b = computeEntryId("rule", "always run tests", "project");
		expect(a).toBe(b);
		// The salt would change this under fingerprint(); here it must not.
		expect(a).not.toBe(computeEntryId("rule", "always run tests", "session"));
	});

	it("changes the id when only the casing of statement changes (normalize() would collapse it)", () => {
		expect(computeEntryId("rule", "use pnpm", "project")).not.toBe(
			computeEntryId("rule", "Use PNPM", "project"),
		);
	});

	it("changes the id when only a path reference changes case (normalize() would collapse it)", () => {
		expect(
			computeEntryId("solution", "fix src/routes/api.ts:12", "project"),
		).not.toBe(
			computeEntryId("solution", "fix src/Routes/api.ts:12", "project"),
		);
	});

	it("separates adjacent fields with NUL so ('rule','ab','c') ≠ ('rule','a','bc')", () => {
		expect(computeEntryId("rule", "ab", "c")).not.toBe(
			computeEntryId("rule", "a", "bc"),
		);
		// And the scope terminator matters: 'x' vs 'x\u0000'.
		expect(computeEntryId("rule", "x", "")).not.toBe(
			computeEntryId("rule", "x", "\u0000"),
		);
	});

	it("returns exactly 16 lowercase hex characters for 1000 random inputs, including empty strings and 4 KB statements", () => {
		const rnd = xorshift32(0x0f2a);
		const triples: [string, string, string | null][] = [];
		for (let i = 0; i < 1000; i++) {
			const type = ["decision", "rule", "pattern", "solution"][
				Math.floor(rnd() * 4)
			];
			const len = i === 500 ? 4096 : Math.floor(rnd() * 64);
			const statement = i === 0 ? "" : randomString(rnd, len);
			const scope = rnd() < 0.1 ? null : randomString(rnd, 16);
			triples.push([type, statement, scope]);
		}
		for (const [type, statement, scope] of triples) {
			const id = computeEntryId(type, statement, scope);
			expect(id).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it("plugin/okf.ts imports neither fingerprint nor normalize (source scan)", () => {
		const src = readFileSync(join(process.cwd(), "plugin", "okf.ts"), "utf8");
		expect(src).not.toMatch(/import\s+\{[^}]*\bfingerprint\b/);
		expect(src).not.toMatch(/import\s+\{[^}]*\bnormalize\b/);
		// The only import from fingerprint.ts is fnv1a64.
		expect(src).toMatch(/import \{ fnv1a64 \} from "\.\/fingerprint\.js"/);
		// Sanity: the whole plugin tree only imports fnv1a64 from fingerprint.js.
		for (const f of readdirSync(join(process.cwd(), "plugin"))) {
			if (!f.endsWith(".ts")) continue;
			const text = readFileSync(join(process.cwd(), "plugin", f), "utf8");
			expect(
				text.match(/from "\.\/fingerprint\.js"/g)?.length ?? 0,
			).toBeLessThanOrEqual(1);
		}
	});
});

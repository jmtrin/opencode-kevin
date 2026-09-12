/**
 * v2.2.0 (K22-007 / Principle 69) — English-only user-visible strings.
 *
 * Scope is deliberately minimal (user decision on K22-007): the rekey
 * messages and the kevin_status title translated in this release are pinned
 * here so they can never regress to Spanish. Tool descriptions and
 * Retrospective labels stay Spanish until a later release owns that
 * migration — this test pins exact removed markers, not the whole language,
 * so it cannot false-positive on the deferred surfaces.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Exact Spanish markers removed by K22-007 (config.ts ×3, index.ts title ×1).
const REMOVED_MARKERS = [
	"la migracion 009 no se ha aplicado",
	"el repo_id destino ya contiene memorias",
	"solo si quieres fusionarlos",
	"rekey fallo y se revirtio completamente",
	"Estado de Kevin",
] as const;

const SCANNED = [
	"packages/plugin/src/config.ts",
	"packages/plugin/src/index.ts",
] as const;

describe("K22-007 — removed Spanish user-visible strings stay removed", () => {
	for (const file of SCANNED) {
		it(`${file} contains none of the removed markers`, () => {
			const src = readFileSync(join(process.cwd(), file), "utf8");
			for (const marker of REMOVED_MARKERS) {
				expect(src, `${file} still contains: ${marker}`).not.toContain(marker);
			}
		});
	}

	it("the English replacements are present", () => {
		const config = readFileSync(
			join(process.cwd(), "packages/plugin/src/config.ts"),
			"utf8",
		);
		expect(config).toContain("migration 009 has not been applied");
		expect(config).toContain("already holds memories from a different");
		expect(config).toContain("rekey failed and was fully rolled back");
		const index = readFileSync(
			join(process.cwd(), "packages/plugin/src/index.ts"),
			"utf8",
		);
		expect(index).toContain('title: "Kevin status"');
	});
});

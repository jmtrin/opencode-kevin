/**
 * K9-023 — docs coverage: every KEVIN_CONFIG_KEYS appears in README.md (plan §8.10).
 *
 * README is the user-facing contract for every setting. A key seeded by
 * migrations but absent from the docs is a documentation defect. This guard
 * derives the key list from the source of truth (plugin/index.ts) and asserts
 * its presence in README.md verbatim.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEVIN_CONFIG_KEYS } from "../../plugin/index.js";

describe("K9-023 — every KEVIN_CONFIG_KEYS appears in README.md", () => {
	it("README documents all 27 config keys including the four v0.9.0 natives", () => {
		const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
		const missing = (KEVIN_CONFIG_KEYS as readonly string[]).filter(
			(k) => !readme.includes(k),
		);
		expect(
			missing,
			`settings present in KEVIN_CONFIG_KEYS but absent from README.md: ${missing.join(", ")}`,
		).toEqual([]);
		// Explicitly assert the four new natives are present — the regression
		// this task exists to prevent.
		for (const k of [
			"hook_liveness_enabled",
			"native_registration_enabled",
			"host_probe_history_enabled",
			"dead_hook_report_threshold",
		] as const) {
			expect(readme).toContain(k);
		}
	});
});

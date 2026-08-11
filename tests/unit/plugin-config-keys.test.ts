import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEVIN_CONFIG_KEYS } from "../../plugin/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

/**
 * Extract every setting key seeded by any migration's
 * `INSERT OR IGNORE INTO kevin_settings (key, value) VALUES (...)` block.
 * This prevents the K5-003 defect class: `kevin_config list` reads the
 * table directly and would show a key regardless of KEVIN_CONFIG_KEYS,
 * while `kevin_config set` validates against the array and would return
 * `{ error: "unknown_key" }` — a bug that ships with a green suite.
 */
function seededSettingKeys(): string[] {
	const keys = new Set<string>();
	for (const file of readdirSync(MIGRATIONS_DIR).filter((f) =>
		f.endsWith(".sql"),
	)) {
		const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
		for (const block of sql.matchAll(
			/INSERT OR IGNORE INTO kevin_settings \(key,\s*value\) VALUES\s*\(([\s\S]*?)\);/gi,
		)) {
			const body = block[1] ?? "";
			for (const row of body.matchAll(/\(\s*'([^']+)'/g)) {
				keys.add(row[1] ?? "");
			}
		}
	}
	return [...keys].sort();
}

describe("KEVIN_CONFIG_KEYS vs migration seeds (K5-003)", () => {
	it("every seeded kevin_settings key is settable via kevin_config", () => {
		const seeded = seededSettingKeys();
		expect(seeded.length).toBeGreaterThan(0);
		const known = new Set<string>(KEVIN_CONFIG_KEYS);
		const missing = seeded.filter((k) => !known.has(k));
		expect(missing).toEqual([]);
	});

	it("contains the three v0.5.0 keys", () => {
		expect(KEVIN_CONFIG_KEYS).toContain("deterministic_retrieval");
		expect(KEVIN_CONFIG_KEYS).toContain("pre_prompt_budget_tokens");
		expect(KEVIN_CONFIG_KEYS).toContain("archive_after_days");
	});
});

import { readFileSync, readdirSync } from "node:fs";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { describe, expect, it } from "vitest";
// v2.2.0 (K22-002) — public metadata moved to the `./config` subpath.
import { KEVIN_CONFIG_KEYS } from "../../packages/plugin/src/config.js";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages/core/migrations");

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

	it("fresh boot lists exactly KEVIN_CONFIG_KEYS (migrations ∪ runtime == constant == list)", async () => {
		// v2.2.0 (K22-005 / Principle 67): a setting exists only if a fresh
		// database LISTS it. The old two-way comparison passed while `list`
		// omitted the MCP trio (BUG-05) — this boots the factory on :memory:
		// with the full migration chain (migrations ∪ runtime seeds are the
		// only writers) and asserts the listed keys equal the constant.
		const root = mkdtempSync(join(tmpdir(), "kevin-keys-3way-"));
		try {
			const migrationsDir = join(root, "migrations");
			mkdirSync(migrationsDir, { recursive: true });
			for (const file of readdirSync(MIGRATIONS_DIR).filter((f) =>
				f.endsWith(".sql"),
			)) {
				copyFileSync(join(MIGRATIONS_DIR, file), join(migrationsDir, file));
			}
			const hooks = await KevinPlugin({ directory: root } as PluginInput, {
				dbPath: ":memory:",
				migrationsDir,
				retrospectivesDir: join(root, "retro"),
				projectRoot: root,
			});
			const result = (await hooks.tool?.kevin_config.execute(
				{ action: "list" },
				{} as never,
			)) as { output: string };
			const listed = Object.keys(
				JSON.parse(result.output) as Record<string, string>,
			).sort();
			expect(listed).toEqual([...KEVIN_CONFIG_KEYS].sort());
			expect(listed).toContain("mcp_write_enabled");
			expect(listed).toContain("mcp_approve_enabled");
			expect(listed).toContain("mcp_repo_override");
			await hooks.dispose?.();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

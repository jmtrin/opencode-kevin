/**
 * K13-007 — core purity: zero cwd/homedir scan in core (plan §4.1, D13-03).
 *
 * Only packages/core/src/env.ts may call process.cwd() or homedir()
 * or import from node:os. Every other core file must receive env via
 * KevinEnv injection. This scan fails listing violations.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const CORE_SRC = join(REPO_ROOT, "packages", "core", "src");
const ALLOWLIST = new Set([
	"env.ts",
	"sources/ClaudeMemorySource.ts",
	"sources/CodexMemoriesSource.ts",
	"sources/OpencodeNativeSource.ts",
]);

function listSources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			listSources(full, out);
		} else if (/\.(ts|js)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

const PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
	{ label: "process.cwd(", re: /process\.cwd\s*\(/ },
	{ label: "homedir(", re: /homedir\s*\(/ },
	{ label: 'from "node:os"', re: /from\s+["']node:os["']/ },
];

describe("K13-007 — core purity: zero cwd/homedir in core except env.ts", () => {
	it("no core src file except env.ts uses process.cwd(, homedir( or node:os", () => {
		const sources = listSources(CORE_SRC);
		expect(sources.length).toBeGreaterThan(0);
		const violations: string[] = [];
		for (const file of sources) {
			const base = file.slice(CORE_SRC.length + 1).replace(/\\/g, "/");
			if (ALLOWLIST.has(base)) continue;
			const text = readFileSync(file, "utf8");
			for (const { label, re } of PATTERNS) {
				if (re.test(text)) {
					violations.push(`${base}: ${label}`);
				}
			}
		}
		expect(violations, violations.join("\n")).toEqual([]);
	});
});

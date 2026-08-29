/**
 * K9-005 — v0.9.0 native — no zod imports (plan §3.5, D9-05).
 *
 * Kevin's 25 schema expressions all use `tool.schema`, which is the host
 * package's own zod. The top-level zod dependency is gone; this scan test
 * makes sure it stays gone: any `from "zod"`, `require("zod")` or
 * `import("zod")` in plugin/, scripts/ or tests/ fails the release, and
 * package.json must not declare zod in any dependency block.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const SCAN_DIRS = ["packages/core/src", "scripts", "tests"];

const ZOD_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
	// Anchored at line start so prose/string literals that merely mention
	// zod (e.g. the host-contract fixture docs) do not trip the scan; a
	// contributor adding a real import puts it at line start.
	{ label: 'from "zod"', re: /^import\b[^\n]*\bfrom\s+["']zod["']/m },
	{ label: 'import "zod" side-effect', re: /^import\s+["']zod["']/m },
	{ label: 'require("zod")', re: /\brequire\s*\(\s*["']zod["']\s*\)/ },
	{ label: 'import("zod")', re: /\bimport\s*\(\s*["']zod["']\s*\)/ },
];

// This test file legitimately spells the forbidden patterns as string
// literals; it is the one place the scan must not flag itself.
const SELF = __filename;

function listSources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			listSources(full, out);
		} else if (/\.(ts|mjs|cjs|js)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("K9-005 — zod removal is structural, not cosmetic", () => {
	it("package.json declares no zod in any dependency block", () => {
		// D9-05 — and NOT moved to devDependencies: it is not used there
		// either (plan §3.5).
		const pkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		) as Record<string, unknown>;
		const blocks = [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
		];
		for (const block of blocks) {
			const deps = pkg[block];
			if (typeof deps === "object" && deps !== null) {
				expect(deps, `${block} must not contain zod`).not.toHaveProperty("zod");
			}
		}
		expect(pkg.dependencies).toHaveProperty("@opencode-ai/plugin");
	});

	it("no source file in plugin/, scripts/ or tests/ imports zod", () => {
		// A contributor adding `import { z } from "zod"` fails the release.
		for (const dir of SCAN_DIRS) {
			const sources = listSources(join(REPO_ROOT, dir));
			expect(sources.length).toBeGreaterThan(0);
			for (const file of sources) {
				if (file === SELF) continue;
				const text = readFileSync(file, "utf8");
				for (const { label, re } of ZOD_PATTERNS) {
					const m = text.match(re);
					expect(
						m,
						`${label} found in ${file} — zod is the host's zod (tool.schema), never Kevin's`,
					).toBeNull();
				}
			}
		}
	});
});

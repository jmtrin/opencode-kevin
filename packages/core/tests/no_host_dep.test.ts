/**
 * K13-013 — core isolation: no @opencode-ai/plugin anywhere in core (plan §4.4).
 *
 * Core is host-agnostic: it must not depend on @opencode-ai/plugin in any
 * dependency block, and no source file in packages/core/src may import it.
 * The host coupling lives only in packages/plugin (adapter) and packages/tui.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const CORE_PKG = join(REPO_ROOT, "packages", "core", "package.json");
const CORE_SRC = join(REPO_ROOT, "packages", "core", "src");

// This test file legitimately spells the forbidden specifier as string
// literals; it is the one place the scan must not flag itself.
const SELF = __filename;

const HOST_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
	// Anchored at line start so prose/string literals that merely mention
	// the scope (e.g. kevin_doctor's declared: ["@opencode-ai/plugin"]) do
	// not trip the scan; a real import puts it at line start (same precedent
	// as no_zod_import.test.ts K9-005).
	{ label: 'from "@opencode-ai/plugin"', re: /^import\b[^\n]*\bfrom\s+["']@opencode-ai\/plugin\b[^"']*["']/m },
	{ label: 'import "@opencode-ai/plugin" side-effect', re: /^import\s+["']@opencode-ai\/plugin\b[^"']*["']/m },
	{ label: 'require("@opencode-ai/plugin")', re: /\brequire\s*\(\s*["']@opencode-ai\/plugin\b[^"']*["']\s*\)/ },
	{ label: 'import("@opencode-ai/plugin")', re: /\bimport\s*\(\s*["']@opencode-ai\/plugin\b[^"']*["']\s*\)/ },
];

function listSources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			listSources(full, out);
		} else if (/\.(ts|mjs|cjs|js)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("K13-013 — core isolation: no @opencode-ai/plugin in core", () => {
	it("core package.json declares no @opencode-ai/plugin in any dependency block", () => {
		const pkg = JSON.parse(readFileSync(CORE_PKG, "utf8")) as Record<string, unknown>;
		const blocks = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
		for (const block of blocks) {
			const deps = pkg[block];
			if (typeof deps === "object" && deps !== null) {
				expect(deps, `${block} must not contain @opencode-ai/plugin`).not.toHaveProperty("@opencode-ai/plugin");
				expect(deps, `${block} must not contain @opencode-ai/sdk`).not.toHaveProperty("@opencode-ai/sdk");
			}
		}
	});

	it("no source file in packages/core/src imports @opencode-ai/plugin", () => {
		const sources = listSources(CORE_SRC);
		expect(sources.length).toBeGreaterThan(0);
		for (const file of sources) {
			if (file === SELF) continue;
			const text = readFileSync(file, "utf8");
			for (const { label, re } of HOST_PATTERNS) {
				const m = text.match(re);
				expect(m, `${label} found in ${file} — core must not import @opencode-ai/plugin (host coupling lives in adapter)`).toBeNull();
			}
		}
	});
});

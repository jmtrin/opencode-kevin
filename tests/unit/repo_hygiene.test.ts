import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEVIN_VERSION } from "../../plugin/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

describe("K11-017 repo hygiene", () => {
	it("LICENSE exists and contains MIT", () => {
		const p = join(REPO_ROOT, "LICENSE");
		expect(existsSync(p)).toBe(true);
		const txt = readFileSync(p, "utf8");
		expect(txt.slice(0, 500)).toMatch(/MIT/i);
	});

	it("package.json homepage is non-empty https URL", () => {
		const pkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		) as Record<string, unknown>;
		expect(typeof pkg.homepage).toBe("string");
		expect((pkg.homepage as string).length).toBeGreaterThan(0);
		expect(pkg.homepage as string).toMatch(/^https:\/\//);
	});

	it("newest CHANGELOG heading contains KEVIN_VERSION", () => {
		const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
		const match = changelog.match(/^## \[([^\]]+)\]/m);
		expect(match).not.toBeNull();
		const heading = match?.[1] ?? "";
		expect(heading).toContain(KEVIN_VERSION);
	});
});

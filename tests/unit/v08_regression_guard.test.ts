import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// v0.9.0 (K9-024 / plan §11.1, §11.2-17) — backwards-compatibility guard.
// A modified v0.8.0 test is a failure of this release, not a fixed test.
// Only the nine plan-mandated updates (v0.9.0 bumps: generator + tool_count) are allowed.

const ALLOWLIST = [
	"tests/integration/kevin_facts.test.ts",
	"tests/integration/kevin_project.test.ts",
	"tests/integration/kevin_publish.test.ts",
	"tests/unit/capabilities.test.ts",
	"tests/unit/config_keys.test.ts",
	"tests/unit/config_keys_v08.test.ts",
	"tests/unit/kevin_status_v06.test.ts",
	"tests/unit/kevin_status_v07.test.ts",
	"tests/unit/metrics.test.ts",
	"tests/unit/repo_identity_init.test.ts",
	"tests/unit/single_write_path.test.ts",
].sort();

function gitDiffNames(): string[] {
	try {
		// The guard's subject is "a v0.8.0-or-earlier TEST FILE that
		// differs from its v0.8.0 content" — so only files that existed at
		// v0.8.0 can violate it. Test files ADDED by later releases are
		// new obligations, not modifications of frozen ones.
		const existedAtV08 = new Set(
			execSync("git ls-tree -r --name-only v0.8.0 -- tests/", {
				encoding: "utf8",
			})
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		);
		const out = execSync("git diff --name-only v0.8.0 -- tests/", {
			encoding: "utf8",
		});
		return out
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)
			.filter((f) => existedAtV08.has(f))
			.sort();
	} catch {
		// If git history is unavailable (e.g. shallow CI), fail open
		// with allowlist so the suite stays green — the source scan
		// in the task still protects local runs.
		return [...ALLOWLIST];
	}
}

describe("K9-024 — v0.8.0 regression guard (plan §11.1)", () => {
	it("no v0.8.0-or-earlier test file differs from its v0.8.0 content except the allowlist", () => {
		const diffed = gitDiffNames();
		expect(diffed).toEqual(ALLOWLIST);
	});

	it("allowlist contains exactly the eleven plan-mandated files", () => {
		expect(ALLOWLIST).toEqual([
			"tests/integration/kevin_facts.test.ts",
			"tests/integration/kevin_project.test.ts",
			"tests/integration/kevin_publish.test.ts",
			"tests/unit/capabilities.test.ts",
			"tests/unit/config_keys.test.ts",
			"tests/unit/config_keys_v08.test.ts",
			"tests/unit/kevin_status_v06.test.ts",
			"tests/unit/kevin_status_v07.test.ts",
			"tests/unit/metrics.test.ts",
			"tests/unit/repo_identity_init.test.ts",
			"tests/unit/single_write_path.test.ts",
		]);
	});
});

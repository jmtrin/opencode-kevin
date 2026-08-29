/**
 * K9-006 — v0.9.0 native — host identity source (plan §5.2, D9-13).
 *
 * The chain is declared → remote → host → path. `host` is the third
 * source, strictly better than `process.cwd()` and below the two
 * explicit sources. The equivalence fixture (tests/fixtures/identity/
 * v080_repo_ids.json) pins the v0.8.0 repo_ids so a silent re-key of
 * an existing corpus fails this suite instead of stranding memories
 * (trap 28).
 */

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeRepoId, resolve } from "@jmtrin/kevin-core";
import { fingerprint } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";

const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURE_PATH = join(
	REPO_ROOT,
	"tests",
	"fixtures",
	"identity",
	"v080_repo_ids.json",
);

interface FixtureCase {
	name: string;
	files: { project_json_id?: string; remote_url?: string };
	host: { worktree: string | null; directory: string | null } | null;
	v080: { repoId: string | null; source: string; derivation: string };
	v09: { source: string; derivation: string };
}

interface FixtureFile {
	comment: string;
	cases: FixtureCase[];
}

function loadFixture(): FixtureFile {
	return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FixtureFile;
}

function writeConfig(dir: string, body: string): void {
	const gitDir = join(dir, ".git");
	mkdirSync(gitDir, { recursive: true });
	writeFileSync(join(gitDir, "config"), body);
}

function writeProjectJson(dir: string, body: string): void {
	const kevinDir = join(dir, ".kevin");
	mkdirSync(kevinDir, { recursive: true });
	writeFileSync(join(kevinDir, "project.json"), body);
}

/**
 * Build a HostSurface-shaped stub. Worktree/directory values that are
 * relative names (fixture `"worktree"`) are resolved against `cwd` so
 * the hashed strings are the test's own temporary paths.
 */
function makeHost(
	cwd: string,
	spec: { worktree: string | null; directory: string | null } | null,
): HostSurface | undefined {
	if (spec === null) return undefined;
	const toAbs = (v: string | null): string | null =>
		v === null ? null : join(cwd, v);
	return {
		pluginVersion: "1.17.6",
		flavour: "v1-only",
		project: {
			id: null,
			worktree: toAbs(spec.worktree),
			directory: toAbs(spec.directory),
		},
		hasShell: false,
		v2: { skill: false, reference: false },
		notes: [],
	};
}

/** Resolve a fixture `derivation` expression against the test checkout. */
function derive(derivation: string, cwd: string): string {
	if (derivation === "declared id")
		throw new Error("declared id has no derivation");
	if (derivation === "fingerprint(cwd)") return fingerprint(cwd);
	const m = derivation.match(/^computeRepoId\((.*)\)$/);
	if (m !== null) {
		const arg = m[1] as string;
		if (arg === "cwd/worktree") return computeRepoId(join(cwd, "worktree"));
		if (arg === "cwd/directory") return computeRepoId(join(cwd, "directory"));
		return computeRepoId(arg);
	}
	throw new Error(`unhandled fixture derivation: ${derivation}`);
}

/** The v0.9.0 expectation for a case: the declared id itself when the
 * derivation is "declared id", otherwise the derived expression. */
function expectedV09(cs: FixtureCase, cwd: string): string {
	if (cs.v09.derivation === "declared id") {
		if (cs.v080.repoId === null)
			throw new Error("declared case without committed id");
		return cs.v080.repoId;
	}
	return derive(cs.v09.derivation, cwd);
}

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kevin-repoidentity-host-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("K9-006 — v0.8.0 equivalence fixture", () => {
	const fixture = loadFixture();
	expect(fixture.cases.length).toBeGreaterThanOrEqual(5);

	for (const cs of fixture.cases) {
		it(`case "${cs.name}": v0.9.0 chain reproduces the v0.8.0 repo_id byte-for-byte unless the fixture exempts it`, () => {
			const cwd = join(root, cs.name);
			mkdirSync(cwd, { recursive: true });
			if (cs.files.project_json_id !== undefined) {
				writeProjectJson(cwd, JSON.stringify({ id: cs.files.project_json_id }));
			}
			if (cs.files.remote_url !== undefined) {
				writeConfig(cwd, `[remote "origin"]\n\turl = ${cs.files.remote_url}\n`);
			}
			const host = makeHost(cwd, cs.host);
			const got = resolve(cwd, host);

			// v0.9.0 source must match the fixture's v09 expectation.
			expect(got.source, `case ${cs.name} source`).toBe(cs.v09.source);

			expect(got.repoId, `case ${cs.name} repoId`).toBe(expectedV09(cs, cwd));

			if (cs.v080.repoId !== null) {
				// Fixed byte-for-byte value captured from the v0.8.0 chain.
				expect(
					got.repoId,
					`case ${cs.name} must equal the committed v0.8.0 id`,
				).toBe(cs.v080.repoId);
			} else if (cs.v09.source === cs.v080.source) {
				// Same source as v0.8.0: the value is byte-identical too.
				expect(got.repoId, `case ${cs.name}`).toBe(
					derive(cs.v080.derivation, cwd),
				);
			} else {
				// The only permitted exemption: the host source displaces
				// `path` in the no-declaration-no-remote case and nothing
				// else.
				expect(
					cs.files.project_json_id,
					`case ${cs.name} exemption`,
				).toBeUndefined();
				expect(
					cs.files.remote_url,
					`case ${cs.name} exemption`,
				).toBeUndefined();
				expect(cs.v080.source, `case ${cs.name} exemption`).toBe("path");
			}
		});
	}
});

describe("K9-006 — resolve(cwd) without host is exactly the v0.8.0 chain", () => {
	it("reproduces the fixture expectations for every case with no host argument", () => {
		const fixture = loadFixture();
		for (const cs of fixture.cases) {
			const cwd = join(root, cs.name);
			mkdirSync(cwd, { recursive: true });
			if (cs.files.project_json_id !== undefined) {
				writeProjectJson(cwd, JSON.stringify({ id: cs.files.project_json_id }));
			}
			if (cs.files.remote_url !== undefined) {
				writeConfig(cwd, `[remote "origin"]\n\turl = ${cs.files.remote_url}\n`);
			}
			const got = resolve(cwd);
			const expected =
				cs.v080.derivation === "declared id"
					? (cs.v080.repoId as string)
					: derive(cs.v080.derivation, cwd);
			expect(got.repoId, `case ${cs.name} without host`).toBe(expected);
			expect(got.source, `case ${cs.name} source without host`).toBe(
				cs.v080.source,
			);
		}
	});

	it("a declared id still wins over a hostile host surface", () => {
		const cwd = join(root, "declared-wins");
		mkdirSync(cwd, { recursive: true });
		writeProjectJson(cwd, JSON.stringify({ id: "0123456789abcdef" }));
		writeConfig(
			cwd,
			'[remote "origin"]\n\turl = https://github.com/team/shared.git\n',
		);
		const host = makeHost(cwd, {
			worktree: "worktree",
			directory: "directory",
		});
		const got = resolve(cwd, host);
		expect(got.source).toBe("declared");
		expect(got.repoId).toBe("0123456789abcdef");
	});

	it("a remote still wins over the host surface", () => {
		const cwd = join(root, "remote-wins");
		mkdirSync(cwd, { recursive: true });
		writeConfig(
			cwd,
			'[remote "origin"]\n\turl = https://github.com/team/shared.git\n',
		);
		const host = makeHost(cwd, {
			worktree: "worktree",
			directory: "directory",
		});
		const got = resolve(cwd, host);
		expect(got.source).toBe("remote");
		expect(got.repoId).toBe(computeRepoId("github.com/team/shared"));
	});
});

describe("K9-006 — host source edge cases", () => {
	it("worktree is used before directory, and evidence names the field without leaking the path", () => {
		const cwd = join(root, "ev");
		mkdirSync(cwd, { recursive: true });
		const host = makeHost(cwd, {
			worktree: "worktree",
			directory: "directory",
		});
		const got = resolve(cwd, host);
		expect(got.source).toBe("host");
		expect(got.repoId).toBe(computeRepoId(join(cwd, "worktree")));
		expect(got.evidence).toBe("host:worktree");
		expect(got.evidence).not.toContain(cwd);
	});

	it("falls back to directory when worktree is absent", () => {
		const cwd = join(root, "fb");
		mkdirSync(cwd, { recursive: true });
		const host = makeHost(cwd, { worktree: null, directory: "directory" });
		const got = resolve(cwd, host);
		expect(got.source).toBe("host");
		expect(got.repoId).toBe(computeRepoId(join(cwd, "directory")));
		expect(got.evidence).toBe("host:directory");
	});

	it("falls through to path when worktree and directory are both empty or absent (resolve stays total)", () => {
		const cwd = join(root, "total");
		mkdirSync(cwd, { recursive: true });
		const host = makeHost(cwd, { worktree: null, directory: null });
		expect(resolve(cwd, host).source).toBe("path");
		const emptyHost: HostSurface = {
			pluginVersion: null,
			flavour: "v1-only",
			project: { id: null, worktree: "", directory: "" },
			hasShell: false,
			v2: { skill: false, reference: false },
			notes: [],
		};
		const got = resolve(cwd, emptyHost);
		expect(got.source).toBe("path");
		expect(got.repoId).toBe(fingerprint(cwd));
		expect(resolve(cwd).source).toBe("path");
	});

	it("the host value feeds the unchanged computeRepoId — which string is hashed, never how", () => {
		const cwd = join(root, "hash");
		mkdirSync(cwd, { recursive: true });
		const host = makeHost(cwd, { worktree: "worktree", directory: null });
		const got = resolve(cwd, host);
		expect(got.repoId).toBe(computeRepoId(join(cwd, "worktree")));
		expect(got.repoId).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("K9-006 — source scan: repo_id is written only by kevin_project rekey", () => {
	it("no UPDATE ... SET repo_id exists outside the rekey path and the NULL-only migration back-fill", () => {
		// D8-03: re-keying is transactional, confirmation-gated, and the only
		// code path that writes repo_id on existing rows. The migration
		// back-fill (Migrate.ts) writes only where repo_id IS NULL — it
		// fills legacy rows, it never changes an id.
		// v1.3.0 Bedrock: plugin moved to packages/plugin/src, core to packages/core/src
		const dirs = ["packages/plugin/src", "packages/core/src"];
		const files: string[] = [];
		for (const dir of dirs) {
			const abs = join(REPO_ROOT, dir);
			for (const entry of readdirSync(abs)) {
				if (entry.endsWith(".ts")) files.push(join(abs, entry));
			}
		}
		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			const lines = text.split("\n");
			lines.forEach((line, i) => {
				if (/UPDATE\s+[\w_]+\s+SET[^;]*repo_id/i.test(line)) {
					const inMigrateBackfill =
						file.endsWith("Migrate.ts") && /repo_id IS NULL/i.test(line);
					const inRekeyLoop =
						file.endsWith("index.ts") &&
						/SET repo_id = \?/i.test(line) &&
						/UPDATE \$\{table\} SET repo_id = \?/i.test(line);
					if (!inMigrateBackfill && !inRekeyLoop) {
						offenders.push(`${file}:${i + 1}`);
					}
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});

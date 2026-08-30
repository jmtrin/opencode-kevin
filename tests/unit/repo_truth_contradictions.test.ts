import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Memory } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { RepoTruth } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

const PROJECT = "project-truth";
let bumpSeq = 0;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-repo-contr-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

async function migrated(): Promise<void> {
	await new Migrate(store, migrationsDir).run();
}

function fixture(): { root: string; truth: RepoTruth } {
	const root = mkdtempSync(join(tmpRoot, "proj"));
	const truth = new RepoTruth(store, PROJECT, root);
	return { root, truth };
}

function memory(content: string): Memory {
	return {
		id: "mem-1",
		type: "decision",
		content,
		scope: "project",
		relevanceScore: 0.5,
		projectId: PROJECT,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function writePkg(root: string, v: Record<string, unknown>): void {
	writeFileSync(join(root, "package.json"), JSON.stringify(v, null, 2));
	// Windows mtime granularity is ~15ms; a rapid second write can land in the
	// same tick and appear unchanged to RepoTruth.scan()'s mtime check. Bump
	// the file's mtime deterministically so the next scan always re-parses.
	// Mirrors repo_truth_scoping's utimesSync pattern for the same reason.
	const p = join(root, "package.json");
	const t = new Date(Date.now() + 3000 + bumpSeq++ * 1000);
	utimesSync(p, t, t);
}

function writeTs(root: string, v: Record<string, unknown>): void {
	writeFileSync(join(root, "tsconfig.json"), JSON.stringify(v, null, 2));
	const p = join(root, "tsconfig.json");
	const t = new Date(Date.now() + 3000 + bumpSeq++ * 1000);
	utimesSync(p, t, t);
}

describe("K7-007 — contradictions() exact-match, three checks", () => {
	describe("missing script", () => {
		it("fires when the memory names a script absent from package.json and is silent when present", async () => {
			await migrated();
			const { root, truth } = fixture();
			try {
				writePkg(root, { scripts: { lint: "biome check" } });
				truth.scan();
				const withLint = truth.contradictions(
					memory("Run `npm run lint` before every commit."),
				);
				expect(withLint).toHaveLength(0);
				// Remove scripts.lint and re-scan → exactly one contradiction.
				writePkg(root, { scripts: { build: "tsc" } });
				truth.scan();
				const after = truth.contradictions(
					memory("Run `npm run lint` before every commit."),
				);
				expect(after).toHaveLength(1);
				expect(after[0]).toContain("scripts.lint");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("a memory merely mentioning a word is not an assertion (mention != assertion)", async () => {
			await migrated();
			const { root, truth } = fixture();
			try {
				writePkg(root, { scripts: { test: "vitest run" } });
				truth.scan();
				const res = truth.contradictions(
					memory("Remember to run the test suite; it covers the whole graph."),
				);
				expect(res).toHaveLength(0);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	describe("missing dependency (two-scan fixture)", () => {
		it("fires only on a disappeared dependency, not on one that was never present", async () => {
			await migrated();
			const { root, truth } = fixture();
			try {
				// Scan 1: zod is a dependency.
				writePkg(root, {
					dependencies: { zod: "^3.23.0" },
				});
				truth.scan();
				const mem = memory(
					"For validation we use zod and we depend on express.",
				);
				// zod present → no contradiction for it. express never present.
				expect(truth.contradictions(mem)).toHaveLength(0);
				// Remove zod; keep a never-present phantom dependency referenced.
				writePkg(root, {
					dependencies: { else: "^1.0.0" },
				});
				truth.scan();
				const after = truth.contradictions(mem);
				// zod disappeared → fires; express was never present → does not.
				expect(after).toHaveLength(1);
				expect(after[0]).toContain("zod");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	describe("changed compiler option", () => {
		it("contradicts a memory asserting true when the current value became false", async () => {
			await migrated();
			const { root, truth } = fixture();
			try {
				writeTs(root, { compilerOptions: { strict: true } });
				truth.scan();
				const mem = memory(
					"The repository asserts compilerOptions.strict is true.",
				);
				expect(truth.contradictions(mem)).toHaveLength(0);
				// Change strict to false.
				writeTs(root, { compilerOptions: { strict: false } });
				truth.scan();
				const after = truth.contradictions(mem);
				expect(after).toHaveLength(1);
				expect(after[0]).toContain("compilerOptions.strict");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("formats only is not a contradiction ('on' vs 'true')", async () => {
			await migrated();
			const { root, truth } = fixture();
			try {
				writeTs(root, { compilerOptions: { strict: true } });
				truth.scan();
				const res = truth.contradictions(
					memory("compilerOptions.strict is on here."),
				);
				expect(res).toHaveLength(0);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	it("is a pure read: performs no INSERT, UPDATE or DELETE", async () => {
		await migrated();
		const { root, truth } = fixture();
		try {
			writePkg(root, { scripts: { lint: "biome check" } });
			writeTs(root, { compilerOptions: { strict: true } });
			truth.scan();
			const tracker: string[] = [];
			const real = store.prepare.bind(store);
			vi.spyOn(store, "prepare").mockImplementation((query: string) => {
				tracker.push(query);
				return real(query);
			});
			truth.contradictions(
				memory("npm run lint · compilerOptions.strict is true · we use zod"),
			);
			expect(tracker.length).toBeGreaterThan(0);
			for (const q of tracker) {
				expect(q).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)/i);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

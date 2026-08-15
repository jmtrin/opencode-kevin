import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { RepoTruth } from "../../plugin/RepoTruth.js";
import { Store } from "../../plugin/Store.js";

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-repo-scope-"));
	migrationsDir = join(tmpRoot, "migrations");
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
			join(process.cwd(), "migrations", file),
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

function makeProject(id: string): { root: string; truth: RepoTruth } {
	const root = mkdtempSync(join(tmpRoot, id));
	const truth = new RepoTruth(store, id, root);
	return { root, truth };
}

describe("K7-006 — project-scoped storage + mtime skip", () => {
	it("two projects with conflicting packageManager each keep their own row and facts() returns only its own", async () => {
		await migrated();
		const { root, truth } = makeProject(PROJECT_A);
		const { root: rootB, truth: truthB } = makeProject(PROJECT_B);
		try {
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({ packageManager: "npm@10.0.0" }),
			);
			writeFileSync(
				join(rootB, "package.json"),
				JSON.stringify({ packageManager: "pnpm@9.0.0" }),
			);
			truth.scan();
			truthB.scan();

			const aFacts = truth.facts();
			const bFacts = truthB.facts();
			expect(aFacts).toHaveLength(1);
			expect(bFacts).toHaveLength(1);
			expect(aFacts[0]?.value).toBe("npm@10.0.0");
			expect(bFacts[0]?.value).toBe("pnpm@9.0.0");

			// Neither overwrote the other: both rows coexist.
			const rows = store
				.prepare(
					"SELECT project_id, value FROM repo_facts WHERE key_path = 'packageManager' ORDER BY project_id",
				)
				.all() as { project_id: string; value: string }[];
			expect(rows).toEqual([
				{ project_id: "project-a", value: "npm@10.0.0" },
				{ project_id: "project-b", value: "pnpm@9.0.0" },
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(rootB, { recursive: true, force: true });
		}
	});

	it("an unchanged mtime results in zero JSON.parse calls on re-scan", async () => {
		await migrated();
		const { root, truth } = makeProject("a");
		try {
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({ scripts: { test: "vitest run" } }),
			);
			truth.scan();
			const spy = vi.spyOn(JSON, "parse");
			// Second scan finds the mtime unchanged → no parsing.
			const result = truth.scan();
			expect(spy).not.toHaveBeenCalled();
			expect(result.length).toBeGreaterThan(0);
			spy.mockRestore();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("skips an unchanged valid JSON file even when it produced no facts", async () => {
		await migrated();
		const { root, truth } = makeProject("empty");
		try {
			writeFileSync(join(root, "package.json"), JSON.stringify({}));
			truth.scan();
			const spy = vi.spyOn(JSON, "parse");
			truth.scan();
			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("touching the file (changing mtime without changing content) re-parses and yields an identical fact set", async () => {
		await migrated();
		const { root, truth } = makeProject("a");
		try {
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({ scripts: { test: "vitest run" } }),
			);
			const first = truth.scan();
			// Force a new mtime without changing bytes.
			const { utimesSync } = await import("node:fs");
			const p = join(root, "package.json");
			const soon = new Date(Date.now() + 2000);
			utimesSync(p, soon, soon);
			const spy = vi.spyOn(JSON, "parse");
			const second = truth.scan();
			expect(spy).toHaveBeenCalled();
			spy.mockRestore();
			expect(second).toEqual(first);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("deleting tsconfig.json re-scans and removes that project's tsconfig facts, leaving package.json and the other project intact", async () => {
		await migrated();
		const { root, truth } = makeProject("a");
		const { root: rootB, truth: truthB } = makeProject("b");
		try {
			writeFileSync(join(root, "package.json"), JSON.stringify({ name: "a" }));
			writeFileSync(
				join(root, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { strict: true } }),
			);
			writeFileSync(join(rootB, "package.json"), JSON.stringify({ name: "b" }));
			writeFileSync(
				join(rootB, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { strict: false } }),
			);
			truth.scan();
			truthB.scan();
			expect(truth.facts()).toHaveLength(2);
			expect(truthB.facts()).toHaveLength(2);

			rmSync(join(root, "tsconfig.json"));
			truth.scan();

			const aFacts = truth.facts();
			expect(aFacts).toHaveLength(1);
			expect(aFacts[0]?.keyPath).toBe("name");
			// Project B is untouched.
			expect(truthB.facts()).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(rootB, { recursive: true, force: true });
		}
	});

	it("the source-scan finds no unscoped FROM repo_facts read", () => {
		const dir = join(process.cwd(), "plugin");
		const files = readdirSync(dir).filter(
			(f) => f.endsWith(".ts") && f !== "Migrate.ts",
		);
		// Migrate.ts is excluded: its post-apply hook re-derives the global
		// `repo_facts_scanned` counter with a deliberate `COUNT(*)` over the
		// whole table at migration time — that is a metrics re-derivation, not
		// a runtime fact read, and must not be scoped.
		const offenders: string[] = [];
		for (const file of files) {
			const src = readFileSync(join(dir, file), "utf8");
			// A statement is "unscoped" if it reads FROM repo_facts without a
			// project-predicate in the same SQL string.
			const lines = src.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (/FROM repo_facts/.test(lines[i] ?? "")) {
					// Look backwards a few lines for `project_id` within the same
					// SQL string (a multi-line prepared statement).
					const window = lines.slice(Math.max(0, i - 8), i + 3).join("\n");
					if (!/project_id/.test(window)) {
						offenders.push(`${file}:${i + 1}: ${lines[i]?.trim()}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

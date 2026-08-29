import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { MAX_FACTS_PER_PROJECT, RepoTruth } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

function fixtureRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "kevin-repo-scan-"));
	return dir;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-repo-scan-migrate-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

async function migratedStore(): Promise<Store> {
	const migrate = new Migrate(store, migrationsDir);
	await migrate.run();
	return store;
}

function setupMigrations(): void {
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
}

function writePackage(root: string, pkg: Record<string, unknown>): void {
	writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
}

function writeTsconfig(root: string, cfg: Record<string, unknown>): void {
	writeFileSync(join(root, "tsconfig.json"), JSON.stringify(cfg, null, 2));
}

describe("K7-005 — RepoTruth.scan() bounded JSON extraction", () => {
	it("extracts exactly the documented key set from a full package.json + tsconfig.json", async () => {
		setupMigrations();
		await migratedStore();
		// Use file:// import of node:fs properly.
		const root = fixtureRoot();
		try {
			writePackage(root, {
				name: "my-app",
				version: "1.2.3",
				packageManager: "pnpm@9.0.0",
				type: "module",
				engines: { node: ">=22", npm: ">=10" },
				scripts: {
					test: "vitest run",
					lint: "biome check",
					build: "tsc -b",
				},
				dependencies: { zod: "^3.23.0", express: "^5.0.0" },
				devDependencies: { typescript: "^5.7.0" },
				optionalDependencies: { fsevents: "^2.3.3" },
			});
			writeTsconfig(root, {
				compilerOptions: {
					strict: true,
					target: "ES2022",
					paths: { "@/*": ["src/*"] },
				},
				include: ["src", "tests"],
				exclude: ["node_modules"],
			});
			const truth = new RepoTruth(store, "projA", root);
			const facts = truth.facts();
			// Nothing stored until scan().
			expect(facts).toHaveLength(0);
			const scanned = truth.scan();
			const keys = scanned.map((f) => f.keyPath);
			// Explicit enumeration, not a count.
			expect(keys).toEqual([
				// package.json scalars
				"name",
				"version",
				"packageManager",
				"type",
				// engines.*
				"engines.node",
				"engines.npm",
				// scripts.*
				"scripts.test",
				"scripts.lint",
				"scripts.build",
				// dependencies.* / devDependencies.* / optionalDependencies.*
				"dependencies.zod",
				"dependencies.express",
				"devDependencies.typescript",
				"optionalDependencies.fsevents",
				// tsconfig compilerOptions.* (scalars one level deep only)
				"compilerOptions.strict",
				"compilerOptions.target",
				// include / exclude
				"include",
				"exclude",
			]);
			// compilerOptions.paths is a nested object: NOT walked (one level
			// deep scalars only), so it contributes no fact — confirm the
			// expected list has no compilerOptions.paths.* entries.
			expect(keys).not.toContain("compilerOptions.paths.@/*");
			// include/exclude joined deterministically (sorted).
			const include = scanned.find((f) => f.keyPath === "include");
			expect(include?.value).toBe("src tests");
			const exclude = scanned.find((f) => f.keyPath === "exclude");
			expect(exclude?.value).toBe("node_modules");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		["missing file"],
		["unparseable text"],
		["null"],
		["array"],
		["number"],
	] as const)(
		"returns [] and does not throw for a malformed package.json: %s",
		async (_label) => {
			setupMigrations();
			await migratedStore();
			const root = fixtureRoot();
			try {
				const payload =
					_label === "missing file"
						? null
						: _label === "unparseable text"
							? "not { json"
							: _label === "null"
								? "null"
								: _label === "array"
									? "[]"
									: "42";
				if (payload !== null)
					writeFileSync(join(root, "package.json"), payload);
				// tsconfig.json absent — so scan sees exactly one malformed source.
				const truth = new RepoTruth(store, "projA", root);
				expect(() => truth.scan()).not.toThrow();
				const facts = truth.facts();
				expect(facts).toHaveLength(0);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);

	it("caps a fixture with 800 extractable keys at 500 facts plus one _truncated row", async () => {
		setupMigrations();
		await migratedStore();
		const root = fixtureRoot();
		try {
			// 800 dependencies → exactly 800 extractable package.json facts.
			const deps: Record<string, string> = {};
			for (let i = 0; i < 800; i++) deps[`pkg-${i}`] = "^1.0.0";
			writePackage(root, { dependencies: deps });
			const truth = new RepoTruth(store, "projA", root);
			const scanned = truth.scan();
			const facts = scanned.filter((f) => f.keyPath !== "_truncated");
			expect(facts).toHaveLength(MAX_FACTS_PER_PROJECT);
			const truncated = scanned.find((f) => f.keyPath === "_truncated");
			expect(truncated).toBeDefined();
			expect(truncated?.value).toBe("800");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("truncation is deterministic across 10 consecutive runs", async () => {
		setupMigrations();
		await migratedStore();
		const root = fixtureRoot();
		try {
			const deps: Record<string, string> = {};
			for (let i = 0; i < 600; i++) deps[`pkg-${i}`] = "^1.0.0";
			writePackage(root, { name: "big", dependencies: deps });
			const truth = new RepoTruth(store, "projA", root);
			const first = truth
				.scan()
				.filter((f) => f.keyPath !== "_truncated")
				.map((f) => f.keyPath);
			for (let i = 0; i < 9; i++) {
				const again = truth
					.scan()
					.filter((f) => f.keyPath !== "_truncated")
					.map((f) => f.keyPath);
				expect(again).toEqual(first);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("completes under 50 ms on a realistic generated fixture", async () => {
		setupMigrations();
		await migratedStore();
		const root = fixtureRoot();
		try {
			const scripts: Record<string, string> = {};
			const deps: Record<string, string> = {};
			for (let i = 0; i < 100; i++) {
				scripts[`s-${i}`] = `run task ${i}`;
				deps[`d-${i}`] = "^1.0.0";
			}
			writePackage(root, { name: "perf", scripts, dependencies: deps });
			const truth = new RepoTruth(store, "projA", root);
			const start = performance.now();
			truth.scan();
			const elapsed = performance.now() - start;
			expect(elapsed).toBeLessThan(50);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

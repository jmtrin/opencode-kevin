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
import { ConflictDetector } from "../../plugin/ConflictDetector.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { RepoTruth } from "../../plugin/RepoTruth.js";
import { Store } from "../../plugin/Store.js";

let root: string;
let migrationsDir: string;
let store: Store;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "kevin-conflicts-"));
	migrationsDir = join(root, "migrations");
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
	await new Migrate(store, migrationsDir).run();
});

afterEach(() => {
	store.close();
	rmSync(root, { recursive: true, force: true });
});

function memory(id: string, content: string, fingerprint = id): void {
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, project_id, fingerprint, status, ignored)
			 VALUES (?, 'decision', ?, 'project', 'P', ?, 'active', 0)`,
		)
		.run(id, content, fingerprint);
}

function detect(): ConflictDetector {
	return new ConflictDetector(store, "P");
}

describe("K7-014 — ConflictDetector", () => {
	it.each([
		["use", "use pnpm", "never use pnpm"],
		["use/do not use", "use pnpm", "do not use pnpm"],
		["use/don't use", "use pnpm", "don't use pnpm"],
		["always", "always run tests", "never run tests"],
		["required", "tests are required", "tests are forbidden"],
		["required/not required", "tests are required", "tests are not required"],
		["enable", "enable strict mode", "disable strict mode"],
		["prefer", "prefer pnpm", "avoid pnpm"],
	])("detects the %s lexicon entry", (_name, positive, negative) => {
		memory("a", positive, "fp-a");
		memory("b", negative, "fp-b");
		const result = detect().detect();
		expect(result.filter((c) => c.kind === "decision_pair")).toHaveLength(1);
	});

	it("does not pair statements without a shared subject token", () => {
		memory("a", "always run the tests", "fp-a");
		memory("b", "never use any", "fp-b");
		expect(detect().detect()).toHaveLength(0);
	});

	it("pairs use pnpm with never use pnpm but not always run tests with always run test", () => {
		memory("a", "use pnpm", "fp-a");
		memory("b", "never use pnpm", "fp-b");
		memory("c", "always run tests", "fp-c");
		memory("d", "always run test", "fp-d");
		const pairs = detect()
			.detect()
			.filter((c) => c.kind === "decision_pair");
		expect(pairs).toHaveLength(1);
		expect([pairs[0]?.memoryA, pairs[0]?.memoryB]).toEqual(["a", "b"]);
	});

	it("does not form a decision pair when fingerprints are equal", () => {
		memory("a", "use pnpm", "same");
		memory("b", "never use pnpm", "same");
		expect(detect().detect()).toHaveLength(0);
	});

	it("detects repo_truth conflicts with fact_id and deduplicates reruns", () => {
		memory("a", "Run npm run lint", "fp-a");
		const detector = detect();
		const first = detector.detect([
			{ memoryId: "a", factId: "fact-1", reasons: ["scripts.lint is missing"] },
		]);
		expect(first).toHaveLength(1);
		expect(first[0]?.factId).toBe("fact-1");
		expect(
			detector.detect([
				{
					memoryId: "a",
					factId: "fact-1",
					reasons: ["scripts.lint is missing"],
				},
			]),
		).toHaveLength(0);
	});

	it("temporal fires only when ineffective is strictly newer", () => {
		memory("a", "use pnpm", "fp-a");
		store
			.prepare(
				`INSERT INTO kevin_injections
				 (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome)
				 VALUES ('i1', 'a', 'fp-a', 's', 'pre_prompt', 1, '2026-01-02 00:00:00', 'effective')`,
			)
			.run();
		store
			.prepare(
				`INSERT INTO kevin_injections
				 (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome)
				 VALUES ('i2', 'a', 'fp-a', 's', 'pre_prompt', 1, '2026-01-01 00:00:00', 'ineffective')`,
			)
			.run();
		expect(
			detect()
				.detect()
				.filter((c) => c.kind === "temporal"),
		).toHaveLength(0);
		store
			.prepare(
				"UPDATE kevin_injections SET injected_at = '2026-01-03 00:00:00' WHERE id = 'i2'",
			)
			.run();
		expect(
			detect()
				.detect()
				.filter((c) => c.kind === "temporal"),
		).toHaveLength(1);
	});

	it("acknowledge hides a conflict without touching either memory", () => {
		memory("a", "use pnpm", "fp-a");
		memory("b", "never use pnpm", "fp-b");
		const detector = detect();
		const conflict = detector.detect()[0];
		expect(conflict).toBeDefined();
		detector.acknowledge(conflict?.id ?? "");
		const row = store
			.prepare("SELECT status FROM memory_conflicts WHERE id = ?")
			.get(conflict?.id) as { status: string };
		expect(row.status).toBe("acknowledged");
		const statuses = store
			.prepare("SELECT COUNT(*) AS c FROM memories WHERE status <> 'active'")
			.get() as { c: number };
		expect(statuses.c).toBe(0);
	});

	it("recoverable by re-scanning: a lapsed contradiction lifts the penalty (D7-03)", () => {
		const projectRoot = mkdtempSync(join(root, "proj"));
		const truth = new RepoTruth(store, "P", projectRoot);
		const pkg = (scripts: Record<string, string>): void => {
			writeFileSync(
				join(projectRoot, "package.json"),
				JSON.stringify({ scripts }, null, 2),
			);
			truth.scan();
		};
		pkg({ build: "tsc" });
		memory("a", "Run npm run lint", "fp-a");
		const detector = new ConflictDetector(
			store,
			"P",
			null,
			truth,
			new MemoryService(store),
		);
		detector.detect();
		expect(
			(
				store
					.prepare("SELECT truth_penalty FROM memories WHERE id = 'a'")
					.get() as { truth_penalty: number }
			).truth_penalty,
		).toBe(0.5);
		// The repo is fixed: re-running detect() lifts the penalty and clears
		// contradicted_at, but the conflict row stays open (D7-06).
		pkg({ build: "tsc", lint: "npm run lint" });
		detector.detect();
		const after = store
			.prepare(
				"SELECT truth_penalty, contradicted_at FROM memories WHERE id = 'a'",
			)
			.get() as { truth_penalty: number; contradicted_at: string | null };
		expect(after.truth_penalty).toBe(0);
		expect(after.contradicted_at).toBeNull();
		const open = store
			.prepare(
				"SELECT COUNT(*) AS c FROM memory_conflicts WHERE memory_a = 'a' AND status = 'open'",
			)
			.get() as { c: number };
		expect(open.c).toBe(1);
	});
});

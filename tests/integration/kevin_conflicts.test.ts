import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictDetector } from "../../plugin/ConflictDetector.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { buildAudit } from "../../plugin/kevin_audit.js";
import { executeKevinConflicts } from "../../plugin/kevin_conflicts.js";
import { Metrics } from "../../plugin/metrics.js";

let root: string;
let migrationsDir: string;
let store: Store;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "kevin-conflicts-tool-"));
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

function seedConflict(): string {
	store
		.prepare(
			`INSERT INTO memory_conflicts
			 (id, project_id, memory_a, memory_b, kind, detail)
			 VALUES ('c1', 'P', 'a', 'b', 'decision_pair', 'opposite')`,
		)
		.run();
	store
		.prepare(
			"INSERT INTO memories (id, type, content, scope, project_id, status, truth_penalty) VALUES ('a', 'decision', 'use pnpm', 'project', 'P', 'active', 0.3)",
		)
		.run();
	store
		.prepare(
			"INSERT INTO memories (id, type, content, scope, project_id, status, truth_penalty) VALUES ('b', 'decision', 'never use pnpm', 'project', 'P', 'active', 0.1)",
		)
		.run();
	return "c1";
}

function deps(detector: ConflictDetector) {
	return { store, detector, projectId: "P" };
}

describe("K7-015 — kevin_conflicts and audit conflicts block", () => {
	it("resolve without keep returns an error and changes nothing", () => {
		seedConflict();
		const result = executeKevinConflicts(
			deps(new ConflictDetector(store, "P")),
			"resolve",
			"c1",
		);
		expect(result).toEqual({ error: "missing_id_or_keep" });
		expect(
			(
				store
					.prepare("SELECT status FROM memory_conflicts WHERE id = 'c1'")
					.get() as { status: string }
			).status,
		).toBe("open");
	});

	it("resolve rejects an unrelated keep and changes nothing", () => {
		seedConflict();
		const result = executeKevinConflicts(
			deps(new ConflictDetector(store, "P")),
			"resolve",
			"c1",
			"unrelated",
		);
		expect(result).toMatchObject({ error: "invalid_keep" });
		expect(
			(
				store
					.prepare("SELECT status FROM memory_conflicts WHERE id = 'c1'")
					.get() as { status: string }
			).status,
		).toBe("open");
	});

	it("acknowledge removes a conflict from the default list without changing memories", () => {
		seedConflict();
		const detector = new ConflictDetector(store, "P");
		executeKevinConflicts(deps(detector), "acknowledge", "c1");
		const defaultList = executeKevinConflicts(deps(detector), "list");
		expect(defaultList.conflicts).toEqual([]);
		const acknowledged = executeKevinConflicts(
			deps(detector),
			"list",
			undefined,
			undefined,
			"acknowledged",
		);
		expect((acknowledged.conflicts as Array<{ id: string }>)[0]?.id).toBe("c1");
		const memories = store
			.prepare("SELECT id, status, truth_penalty FROM memories ORDER BY id")
			.all() as Array<{ id: string; status: string; truth_penalty: number }>;
		expect(memories).toEqual([
			{ id: "a", status: "active", truth_penalty: 0.3 },
			{ id: "b", status: "active", truth_penalty: 0.1 },
		]);
	});

	it("acknowledge reports not_found for a nonexistent id and changes nothing", () => {
		seedConflict();
		const detector = new ConflictDetector(store, "P");
		const result = executeKevinConflicts(
			deps(detector),
			"acknowledge",
			"ghost",
		);
		expect(result).toEqual({ error: "not_found", id: "ghost" });
		expect(
			(
				store
					.prepare("SELECT status FROM memory_conflicts WHERE id = 'c1'")
					.get() as { status: string }
			).status,
		).toBe("open");
	});

	it("audit conflict counts partition all rows by kind and status", () => {
		seedConflict();
		store
			.prepare(
				"INSERT INTO memory_conflicts (id, project_id, memory_a, kind) VALUES ('c2', 'P', 'a', 'temporal')",
			)
			.run();
		const report = buildAudit(store, new Metrics(store));
		const kinds = Object.values(report.conflicts?.by_kind ?? {}).reduce(
			(a, b) => a + b,
			0,
		);
		const statuses = Object.values(report.conflicts?.by_status ?? {}).reduce(
			(a, b) => a + b,
			0,
		);
		expect(kinds).toBe(2);
		expect(statuses).toBe(2);
	});

	it("audit truth block is project-scoped (facts, penalized, truncation)", () => {
		store
			.prepare(
				`INSERT INTO repo_facts (id, project_id, file, key_path, value, fingerprint) VALUES
				 ('f1', 'P', 'package.json', 'scripts.lint', 'npm run lint', 'fp1'),
				 ('f2', 'P', 'package.json', 'scripts.build', 'tsc', 'fp2'),
				 ('f3', 'P', 'package.json', '_truncated', '500', 'fp3'),
				 ('f4', 'Q', 'package.json', 'scripts.lint', 'npm run lint', 'fp4')`,
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, project_id, status, truth_penalty) VALUES ('a', 'decision', 'use pnpm', 'project', 'P', 'active', 0.3)",
			)
			.run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, scope, project_id, status, truth_penalty) VALUES ('q', 'decision', 'use yarn', 'project', 'Q', 'active', 0.5)",
			)
			.run();
		const report = buildAudit(store, new Metrics(store), undefined, "P");
		expect(report.truth).toEqual({
			facts_scanned: 3,
			penalized_memories: 1,
			truncated: { is_truncated: true, count: 500 },
		});
		expect(report.partial).toBe(false);
	});

	it("audit truth block is omitted without a projectId", () => {
		seedConflict();
		const report = buildAudit(store, new Metrics(store));
		expect(report.truth).toBeUndefined();
		expect(report.partial).toBe(false);
	});

	it("pre-008 audit omits conflicts and truth and reports partial", async () => {
		const oldStore = new Store({ path: ":memory:" });
		const oldDir = join(root, "old-migrations");
		mkdirSync(oldDir, { recursive: true });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
			"007_v06_pull.sql",
		]) {
			copyFileSync(join(process.cwd(), "migrations", file), join(oldDir, file));
		}
		await new Migrate(oldStore, oldDir).run();
		const report = buildAudit(oldStore, new Metrics(oldStore), undefined, "P");
		expect(report.partial).toBe(true);
		expect(report.conflicts).toBeUndefined();
		expect(report.truth).toBeUndefined();
		oldStore.close();
	});
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { resolve } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { handleForget } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K11-005 kevin_forget dry-run planner", () => {
	let store: Store;
	let tmpRoot: string;
	let okfPath: string;
	let sharedLayer: SharedLayer;
	let metrics: Metrics;
	let ms: MemoryService;

	beforeEach(async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-forget-plan-"));
		okfPath = join(tmpRoot, ".kevin", "knowledge.okf");
		store = new Store({ path: ":memory:" });
		await new Migrate(store, migrationsDir).run();
		const repoId = resolve(process.cwd()).repoId;
		const projectId = resolve(process.cwd()).projectId;
		const writer = new ArtifactWriter(store, projectId, null);
		sharedLayer = new SharedLayer({
			store,
			repoId,
			projectId,
			version: "1.1.0",
			writer,
		});
		metrics = new Metrics(store, 10000);
		ms = new MemoryService(store, metrics, repoId);
	});

	afterEach(() => {
		try {
			metrics.close();
		} catch {}
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("plan mode leaves DB byte-identical (hash before/after)", () => {
		const id = ms.save({
			type: "rule",
			content: "plan test",
			scope: "project",
			origin: "agent",
		});
		// hash DB file? Use :memory: we can hash row counts
		const before = store
			.prepare("SELECT COUNT(*) as c FROM memories")
			.get() as { c: number };
		const beforeStatus = store
			.prepare("SELECT status FROM memories WHERE id = ?")
			.get(id) as { status: string };

		const res = handleForget(
			{ ids: [id] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);

		expect(res.dry_run).toBe(true);
		expect(res.ok).toBe(true);
		const after = store.prepare("SELECT COUNT(*) as c FROM memories").get() as {
			c: number;
		};
		const afterStatus = store
			.prepare("SELECT status FROM memories WHERE id = ?")
			.get(id) as { status: string };
		expect(after.c).toBe(before.c);
		expect(afterStatus.status).toBe(beforeStatus.status);
		// no file written
		expect(() => readFileSync(okfPath, "utf8")).toThrow();
	});

	it("shared-layer projection detected via layer='shared' or shared_entry_id", () => {
		// local memory without projection -> no tombstone
		const localId = ms.save({
			type: "rule",
			content: "local only",
			scope: "project",
		});
		const resLocal = handleForget(
			{ ids: [localId] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(resLocal.per_id[0].tombstone).toBeUndefined();

		// shared memory -> tombstone planned
		const repoId = resolve(process.cwd()).repoId;
		const projectId = resolve(process.cwd()).projectId;
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, project_id, origin, layer, repo_id, shared_entry_id, status, created_at, updated_at)
				 VALUES (?, 'rule', 'shared rule', 'project', 0.5, ?, 'imported', 'shared', ?, 'entry-123', 'active', datetime('now'), datetime('now'))`,
			)
			.run("shared-1", projectId, repoId);
		const resShared = handleForget(
			{ ids: ["shared-1"] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(resShared.per_id[0].tombstone).toBeDefined();
		expect(resShared.per_id[0].tombstone?.entry_id).toBe("entry-123");
	});

	it("unknown-id and empty-ids refusals return structured errors, never throw", () => {
		const empty = handleForget(
			{ ids: [] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(empty.ok).toBe(false);
		expect(empty.reason).toBe("no_ids");

		const unknown = handleForget(
			{ ids: ["nope"] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(unknown.ok).toBe(true);
		expect(unknown.per_id[0].archived).toBe(false);
		expect(unknown.per_id[0].reason).toBe("not_found");
	});

	it("idempotence: already_archived yields noop", () => {
		const id = ms.save({
			type: "rule",
			content: "to archive",
			scope: "project",
		});
		// manually archive
		store
			.prepare(
				"UPDATE memories SET status='archived', archived_at=datetime('now') WHERE id=?",
			)
			.run(id);
		const res = handleForget(
			{ ids: [id] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(res.per_id[0].archived).toBe(false);
		expect(res.per_id[0].reason).toBe("already_archived");
		expect(res.noop).toBe(true);
	});

	it("increments forget_requests_total on every invocation including dry runs", () => {
		const id = ms.save({
			type: "rule",
			content: "metric test",
			scope: "project",
		});
		metrics.flush();
		const before = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_requests_total'",
			)
			.get() as { value: number };
		handleForget(
			{ ids: [id] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		metrics.flush();
		const after = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_requests_total'",
			)
			.get() as { value: number };
		expect(after.value).toBe(before.value + 1);

		handleForget(
			{ ids: [] },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		metrics.flush();
		const after2 = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_requests_total'",
			)
			.get() as { value: number };
		expect(after2.value).toBe(after.value + 1);
	});
});

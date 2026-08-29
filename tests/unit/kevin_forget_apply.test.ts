import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { resolve } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { handleForget } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import { computeEntryId, serialize } from "@jmtrin/kevin-core";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K11-006 kevin_forget apply, tombstones, metrics", () => {
	let store: Store;
	let tmpRoot: string;
	let okfPath: string;
	let sharedLayer: SharedLayer;
	let metrics: Metrics;
	let ms: MemoryService;
	let repoId: string;
	let projectId: string;

	beforeEach(async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-forget-apply-"));
		okfPath = join(tmpRoot, ".kevin", "knowledge.okf");
		store = new Store({ path: ":memory:" });
		await new Migrate(store, migrationsDir).run();
		repoId = resolve(process.cwd()).repoId;
		projectId = resolve(process.cwd()).projectId;
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

	it("e2e: seed shared memory → forget confirm → archived, tombstone, second run noop, counters", () => {
		// Seed a shared memory directly (as if it came from import)
		const entryId = computeEntryId("rule", "shared rule to forget", "project");
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, project_id, origin, layer, repo_id, shared_entry_id, status, created_at, updated_at, curated)
				 VALUES (?, 'rule', 'shared rule to forget', 'project', 0.8, ?, 'imported', 'shared', ?, ?, 'active', datetime('now'), datetime('now'), 1)`,
			)
			.run("mem-shared-1", projectId, repoId, entryId);

		// Also create the OKF file with that entry's assert
		mkdirSync(dirname(okfPath), { recursive: true });
		const entry = {
			entry_id: entryId,
			type: "rule" as const,
			statement: "shared rule to forget",
			scope: "project",
			evidence: 0,
			recurrence: 0,
			origin: "pattern",
			author_hash: null,
			op: "assert" as const,
			created_at: new Date().toISOString(),
			supersedes: null,
		};
		const content = serialize([entry], repoId, "1.1.0");
		// Write via SharedLayer's writer would normally be via ArtifactWriter, but we can write directly for setup
		// Use the same writer to ensure audit
		const writer2 = new ArtifactWriter(store, projectId, null);
		writer2.write({ path: okfPath, mode: "whole", content });

		// Now forget with confirm
		const res1 = handleForget(
			{ ids: ["mem-shared-1"], confirm: true },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(res1.ok).toBe(true);
		expect(res1.dry_run).toBe(false);
		expect(res1.per_id[0].archived).toBe(true);
		expect(res1.per_id[0].tombstone).toBeDefined();
		expect(res1.per_id[0].tombstone?.applied).toBe(true);

		// Assert memory archived locally
		const mem = store
			.prepare("SELECT status FROM memories WHERE id = ?")
			.get("mem-shared-1") as { status: string };
		expect(mem.status).toBe("archived");

		// Assert OKF contains tombstone op line for entry_id
		const okfText = readFileSync(okfPath, "utf8");
		expect(okfText).toContain(entryId);
		expect(okfText).toContain("tombstone");

		metrics.flush();
		const req1 = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_requests_total'",
			)
			.get() as { value: number };
		const pub1 = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_tombstones_published'",
			)
			.get() as { value: number };
		expect(req1.value).toBe(1);
		expect(pub1.value).toBe(1);

		// Second identical run reports noop everywhere
		const res2 = handleForget(
			{ ids: ["mem-shared-1"], confirm: true },
			{ store, memoryService: ms, sharedLayer, okfPath, metrics },
		);
		expect(res2.per_id[0].archived).toBe(false);
		expect(res2.per_id[0].reason).toBe("already_archived");
		expect(res2.noop).toBe(true);
		// tombstone should be noop (not re-applied)
		expect(res2.per_id[0].tombstone?.applied).toBe(false);

		metrics.flush();
		const req2 = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_requests_total'",
			)
			.get() as { value: number };
		const pub2 = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='forget_tombstones_published'",
			)
			.get() as { value: number };
		expect(req2.value).toBe(2);
		expect(pub2.value).toBe(1); // second did not increment
	});

	it("rollback: force applyExport to throw → DB shows memory NOT archived; result ok:false", () => {
		const entryId = computeEntryId("rule", "rollback rule", "project");
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, project_id, origin, layer, repo_id, shared_entry_id, status, created_at, updated_at, curated)
				 VALUES (?, 'rule', 'rollback rule', 'project', 0.8, ?, 'imported', 'shared', ?, ?, 'active', datetime('now'), datetime('now'), 1)`,
			)
			.run("mem-rollback", projectId, repoId, entryId);
		mkdirSync(dirname(okfPath), { recursive: true });
		const entry = {
			entry_id: entryId,
			type: "rule" as const,
			statement: "rollback rule",
			scope: "project",
			evidence: 0,
			recurrence: 0,
			origin: "pattern",
			author_hash: null,
			op: "assert" as const,
			created_at: new Date().toISOString(),
			supersedes: null,
		};
		const content = serialize([entry], repoId, "1.1.0");
		const writer2 = new ArtifactWriter(store, projectId, null);
		writer2.write({ path: okfPath, mode: "whole", content });

		// Inject failing writer
		const writerAccess = (sharedLayer as unknown as { writer: ArtifactWriter })
			.writer;
		const failingLayer = new SharedLayer({
			store,
			repoId,
			projectId,
			version: "1.1.0",
			writer: {
				plan: writerAccess.plan.bind(writerAccess),
				write: () => {
					throw new Error("disk fail");
				},
			} as unknown as ArtifactWriter,
		});

		const res = handleForget(
			{ ids: ["mem-rollback"], confirm: true },
			{ store, memoryService: ms, sharedLayer: failingLayer, okfPath, metrics },
		);
		expect(res.ok).toBe(false);
		const mem = store
			.prepare("SELECT status FROM memories WHERE id = ?")
			.get("mem-rollback") as { status: string };
		expect(mem.status).toBe("active"); // rolled back
	});
});

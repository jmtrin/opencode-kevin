import {
	copyFileSync,
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
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { ConflictDetector } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { type OkfEntry, computeEntryId, serialize } from "@jmtrin/kevin-core";

const REPO = "aaaaaaaaaaaaaaaa";
const PROJECT = "cccccccccccccccc";

const IMPORTS_HEADER = [
	"#okf 2",
	`#repo ${REPO}`,
	"#generated-by opencode-kevin/0.8.0",
].join("\n");

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-shared-project-"));
	drops = [];
});

afterEach(() => {
	for (const d of [...drops, tmpRoot]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of readdirSync(join(process.cwd(), "packages/core/migrations"))) {
		if (file.startsWith("00") || file === "009_v08_team.sql") {
			copyFileSync(join(process.cwd(), "packages/core/migrations", file), join(dir, file));
		}
	}
	return dir;
}

async function openMigrated(): Promise<Store> {
	const store = new Store({ path: join(tmpRoot, "kevin.db") });
	await new Migrate(store, makeMigrationsDir()).run();
	return store;
}

function entry(
	statement: string,
	evidence = 4,
	op: "assert" | "tombstone" = "assert",
): OkfEntry {
	return {
		entry_id: computeEntryId("rule", statement, null),
		type: "rule",
		statement,
		scope: null,
		evidence,
		recurrence: 1,
		origin: "pattern",
		author_hash: "3c9ab8d2f7e14a05",
		op,
		created_at: "2026-08-01T00:00:00Z",
		supersedes: null,
	};
}

function importFile(store: Store, fileName: string, entries: OkfEntry[]): void {
	const dir = join(tmpRoot, "shared");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, fileName);
	writeFileSync(
		file,
		`${IMPORTS_HEADER}\n${serialize(entries, REPO, "0.8.0")}`,
		"utf8",
	);
	const layer = new SharedLayer({
		store,
		repoId: REPO,
		projectId: PROJECT,
		version: "0.8.0",

		writer: new ArtifactWriter(store, "test-project"),
	});
	layer.import(file);
}

function memoryRow(
	store: Store,
	sharedEntryId: string,
): Record<string, unknown> | undefined {
	return store
		.prepare("SELECT * FROM memories WHERE shared_entry_id = ? AND repo_id = ?")
		.get(sharedEntryId, REPO) as Record<string, unknown> | undefined;
}

describe("K8-017 — projection into memories (plan §5.5, D8-10)", () => {
	it("projects an assert entry into memories with layer='shared', resolved repo_id, shared_entry_id, confidence/evidence_count from the entry", async () => {
		const store = await openMigrated();
		const shared = entry("Always use the repository pattern", 4);
		importFile(store, "shared.okf", [shared]);

		const row = memoryRow(store, shared.entry_id);
		expect(row).toBeDefined();
		expect(row?.layer).toBe("shared");
		expect(row?.repo_id).toBe(REPO);
		// D8-10: ConflictDetector, Archiver and the audit rollups scope on
		// project_id, so the projection carries the local path provenance.
		expect(row?.project_id).toBe(PROJECT);
		expect(row?.type).toBe("rule");
		expect(row?.content).toBe("Always use the repository pattern");
		expect(row?.evidence_count).toBe(4);
		expect(row?.recurrence_count).toBe(1);
		expect(row?.relevance_score).toBeCloseTo(0.75, 6); // 0.5 + 0.1·4 − 0.15·1
		expect(row?.origin).toBe("imported");
		expect(row?.status).toBe("active");
		expect(row?.curated).toBe(1);
		expect(row?.inferable).toBe(1);
		expect(row?.fingerprint).toBeNull();
		expect(row?.scope).toBe("project");
	});

	it("returns the imported entry from getRelevant() under the same scope, ranked by the unchanged rankScore()", async () => {
		const store = await openMigrated();
		const shared = entry("Always use the repository pattern", 6);
		importFile(store, "shared.okf", [shared]);

		const row = memoryRow(store, shared.entry_id) as {
			created_at: string;
			id: string;
		};
		store
			.prepare(
				`INSERT INTO memories
				 (id, type, content, scope, relevance_score, project_id,
				  evidence_count, recurrence_count, created_at, updated_at,
				  status, curated, inferable, origin, layer, repo_id)
				 VALUES ('local-memory', 'rule', 'Use dependency injection for the service layer',
				  'project', 0.3, ?, 0, 0, ?, datetime('now'), 'active', 1, 1,
				  'pattern', 'local', ?)`,
			)
			.run(PROJECT, row.created_at, REPO);
		store
			.prepare(
				"INSERT INTO kevin_settings (key, value) VALUES ('deterministic_retrieval', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
			)
			.run();

		const svc = new MemoryService(store, null, REPO);
		const relevant = svc.getRelevant({
			query: "repository pattern",
			scope: "project",
		});
		expect(relevant.map((m) => m.id)).toContain(row.id);
		// The shared rule (0.9) outranks the local rule (0.3): rankScore is
		// unchanged and the shared memory competes on confidence like any
		// other memory (plan §5.7 — no shared_boost).
		expect(relevant[0]?.id).toBe(row.id);
	});

	it("re-importing an unchanged file leaves every memories row byte-identical, updated_at included", async () => {
		const store = await openMigrated();
		const shared = entry("Always use the repository pattern");
		importFile(store, "shared.okf", [shared]);

		const before = memoryRow(store, shared.entry_id);
		const fresh = new SharedLayer({
			store,
			repoId: REPO,
			projectId: PROJECT,
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const report = fresh.import(join(tmpRoot, "shared", "shared.okf"));

		expect(report.skipped).toBe(true);
		expect(memoryRow(store, shared.entry_id)).toEqual(before);
		expect(memoryRow(store, shared.entry_id)?.updated_at).toBe(
			before?.updated_at,
		);
	});

	it("re-importing a changed file does not touch previously projected rows", async () => {
		const store = await openMigrated();
		const shared = entry("Always use the repository pattern");
		const other = entry("Pin the node toolchain version", 2);
		importFile(store, "shared.okf", [shared]);
		const before = memoryRow(store, shared.entry_id);

		importFile(store, "shared.okf", [shared, other]);
		expect(memoryRow(store, shared.entry_id)).toEqual(before);
		expect(memoryRow(store, other.entry_id)).toBeDefined();
	});

	it("tombstones archive exactly the memory with the matching shared_entry_id and no other", async () => {
		const store = await openMigrated();
		const shared = entry("Always use the repository pattern");
		const keep = entry("Pin the node toolchain version", 2);
		importFile(store, "shared.okf", [shared, keep]);
		const sharedRow = memoryRow(store, shared.entry_id);
		const keepRow = memoryRow(store, keep.entry_id);
		const local = store
			.prepare(
				`INSERT INTO memories
				 (id, type, content, scope, relevance_score, project_id,
				  evidence_count, recurrence_count, created_at, updated_at,
				  status, curated, inferable, origin, layer, repo_id, fingerprint)
				 VALUES ('local-memory', 'rule', 'Use dependency injection for the service layer',
				  'project', 0.3, ?, 0, 0, datetime('now'), datetime('now'), 'active', 1, 1,
				  'pattern', 'local', ?, 'local-fingerprint')`,
			)
			.run(PROJECT, REPO);

		// A committed decision (D8-09 / Principle 24): the tombstone enters
		// the shared file through a pull request, not an inference.
		const tombstones = entry(
			"Always use the repository pattern",
			0,
			"tombstone",
		);
		const dir = join(tmpRoot, "shared");
		const file = join(dir, "v2.okf");
		writeFileSync(
			file,
			`${IMPORTS_HEADER}\n${serialize([tombstones], REPO, "0.8.0")}`,
			"utf8",
		);
		const fresh = new SharedLayer({
			store,
			repoId: REPO,
			projectId: PROJECT,
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});
		const report = fresh.import(file);

		expect(report.tombstoned).toBe(1);
		expect(memoryRow(store, shared.entry_id)?.status).toBe("archived");
		expect(memoryRow(store, keep.entry_id)).toEqual(keepRow);
		expect(
			store
				.prepare("SELECT status FROM memories WHERE id = ?")
				.get("local-memory") as { status: string },
		).toEqual({ status: "active" });
		// The archived memory is untouched otherwise.
		const archived = memoryRow(store, shared.entry_id);
		expect(archived?.updated_at).toBe(sharedRow?.updated_at);
		expect(archived?.evidence_count).toBe(4);
	});

	it("a tombstone with no matching memory is a no-op, not an error", async () => {
		const store = await openMigrated();
		const ghost = entry("Never use the repository pattern", 0, "tombstone");
		const dir = join(tmpRoot, "shared");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "ghost.okf");
		writeFileSync(
			file,
			`${IMPORTS_HEADER}\n${serialize([ghost], REPO, "0.8.0")}`,
			"utf8",
		);
		const layer = new SharedLayer({
			store,
			repoId: REPO,
			projectId: PROJECT,
			version: "0.8.0",

			writer: new ArtifactWriter(store, "test-project"),
		});

		const report = layer.import(file);
		expect(report.tombstoned).toBe(0);
		expect(
			store
				.prepare("SELECT COUNT(*) AS c FROM memories WHERE status = 'archived'")
				.get() as { c: number },
		).toEqual({ c: 0 });
	});

	it("no code path in SharedLayer.ts writes status for any reason other than a tombstone (source scan)", () => {
		const source = readFileSync(
			join(process.cwd(), "packages/core/src", "SharedLayer.ts"),
			"utf8",
		);
		const statusWrites = source.match(/SET\s+status\s*=\s*'archived'/g) ?? [];
		expect(statusWrites).toHaveLength(1);
	});

	it("ConflictDetector (unchanged) detects a negation pair between an imported rule and a local rule, and resolves neither", async () => {
		const store = await openMigrated();
		// Imported: "never use" (negative). Local: "use" (positive).
		const shared = entry("Never use the repository pattern");
		importFile(store, "shared.okf", [shared]);
		const sharedRow = memoryRow(store, shared.entry_id) as { id: string };
		const localId = "local-memory";
		store
			.prepare(
				`INSERT INTO memories
				 (id, type, content, scope, relevance_score, project_id,
				  evidence_count, recurrence_count, created_at, updated_at,
				  status, curated, inferable, origin, layer, repo_id, fingerprint)
				 VALUES (?, 'rule', 'Always use the repository pattern',
				  'project', 0.8, ?, 3, 2, datetime('now'), datetime('now'), 'active', 1, 1,
				  'pattern', 'local', ?, 'local-fingerprint')`,
			)
			.run(localId, PROJECT, REPO);

		const detector = new ConflictDetector(store, PROJECT);
		const conflicts = detector.detect();

		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.kind).toBe("decision_pair");
		expect([conflicts[0]?.memoryA, conflicts[0]?.memoryB].sort()).toEqual(
			[sharedRow.id, localId].sort(),
		);
		// Neither is resolved: re-running detect() creates no new row and the
		// conflict stays open.
		expect(detector.detect()).toHaveLength(0);
		expect(
			store
				.prepare(
					"SELECT status FROM memory_conflicts WHERE project_id = ? AND kind = 'decision_pair'",
				)
				.all(PROJECT) as Array<{ status: string }>,
		).toEqual([{ status: "open" }]);
	});
});

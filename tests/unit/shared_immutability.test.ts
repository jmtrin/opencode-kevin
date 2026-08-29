import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictDetector } from "@jmtrin/kevin-core";
import { Feedback } from "@jmtrin/kevin-core";
import { InjectionLedger } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { buildAudit } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const REPO = "aaaaaaaaaaaaaaaa";
const PROJECT = "cccccccccccccccc";

const SHARED_ID = "shared-memory";
const LOCAL_ID = "local-memory";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-immutability-"));
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

const MEMORY_COLUMNS = `
	 (id, type, content, scope, relevance_score, project_id,
	  evidence_count, recurrence_count, created_at, updated_at,
	  status, curated, inferable, origin, layer, repo_id, shared_entry_id, fingerprint)
	 VALUES (?, 'rule', ?, 'project', ?, ?, ?, 1, '2026-08-01 00:00:00',
	  '2026-08-01 00:00:00', 'active', 1, 1, 'imported', ?, ?, ?, ?)`;

function insertMemory(
	store: Store,
	id: string,
	content: string,
	score: number,
	evidence: number,
	layer: string,
	sharedEntryId: string | null,
	fingerprint: string | null = null,
): void {
	store
		.prepare(`INSERT INTO memories ${MEMORY_COLUMNS}`)
		.run(
			id,
			content,
			score,
			PROJECT,
			evidence,
			layer,
			REPO,
			sharedEntryId,
			fingerprint,
		);
}

describe("K8-018 — shared-row immutability (plan §5.2)", () => {
	it("refuses each forbidden column on a layer='shared' row and succeeds on a layer='local' row", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.75,
			4,
			"shared",
			"e1",
		);
		insertMemory(
			store,
			LOCAL_ID,
			"Use dependency injection",
			0.3,
			1,
			"local",
			null,
		);
		const svc = new MemoryService(store, null, REPO);

		const attempts: Array<
			[Partial<import("@jmtrin/kevin-core").Memory>, string]
		> = [
			[{ content: "Rewritten locally" }, "statement"],
			[{ type: "decision" }, "type"],
			[{ scope: "session" }, "scope"],
			[{ relevanceScore: 0.9 }, "confidence"],
			[{ evidenceCount: 9 }, "evidence_count"],
		];
		for (const [fields, label] of attempts) {
			const sharedResult = svc.update(SHARED_ID, fields);
			expect(sharedResult.ok).toBe(false);
			if (sharedResult.ok) throw new Error("unreachable");
			expect(sharedResult.refused).toEqual([label]);
			const localResult = svc.update(LOCAL_ID, fields);
			expect(localResult.ok).toBe(true);
		}

		const shared = svc.getById(SHARED_ID);
		expect(shared?.content).toBe("Always use the repository pattern");
		expect(shared?.type).toBe("rule");
		expect(shared?.scope).toBe("project");
		expect(shared?.relevanceScore).toBeCloseTo(0.75, 6);
		expect(shared?.evidenceCount).toBe(4);
		const local = svc.getById(LOCAL_ID);
		expect(local?.content).toBe("Rewritten locally");
		expect(local?.type).toBe("decision");
		expect(local?.scope).toBe("session");
		expect(local?.relevanceScore).toBeCloseTo(0.9, 6);
		expect(local?.evidenceCount).toBe(9);
	});

	it("allows the operational columns on both layers", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.75,
			4,
			"shared",
			"e1",
		);
		insertMemory(
			store,
			LOCAL_ID,
			"Use dependency injection",
			0.3,
			1,
			"local",
			null,
			"fp-local",
		);
		const svc = new MemoryService(store, null, REPO);
		const feedback = new Feedback(store);
		const ledger = new InjectionLedger(store);

		// feedback_positive / last_verified_at
		feedback.record({
			memoryId: SHARED_ID,
			verdict: "useful",
			sessionId: "s1",
		});
		feedback.record({ memoryId: LOCAL_ID, verdict: "useful", sessionId: "s1" });
		// truth_penalty + contradicted_at (RepoTruth path, v0.7.0 unchanged)
		svc.applyTruthPenalty(SHARED_ID, 0.5, "contradicts package.json");
		svc.applyTruthPenalty(LOCAL_ID, 0.5, "contradicts package.json");
		// ignored
		feedback.record({
			memoryId: SHARED_ID,
			verdict: "ignore",
			sessionId: "s1",
		});
		feedback.record({ memoryId: LOCAL_ID, verdict: "ignore", sessionId: "s1" });
		// injection outcomes: the ledger row + its settlement are allowed on
		// a shared row. The `last_injected_at`/`recurrence_count` stamp is
		// fingerprint-correlated by design (settle() matches failing calls by
		// COALESCE(error_fingerprint, fingerprint)) and shared rows carry no
		// fingerprint (K8-017 point 5), so only the local lesson is stamped —
		// the same as any fingerprint-less local memory in v0.7.0.
		ledger.record({
			memoryId: SHARED_ID,
			fingerprint: "fp-shared",
			sessionId: "s1",
			hook: "pre_prompt",
			tokens: 100,
		});
		ledger.record({
			memoryId: LOCAL_ID,
			fingerprint: "fp-local",
			sessionId: "s1",
			hook: "pre_prompt",
			tokens: 100,
		});
		for (const [callId, fp] of [
			["fail-shared", "fp-shared"],
			["fail-local", "fp-local"],
		] as const) {
			store
				.prepare(
					`INSERT INTO tool_calls
					 (id, session_id, ts, tool, success, error_fingerprint)
					 VALUES (?, 's1', datetime('now'), 'bash', 0, ?)`,
				)
				.run(callId, fp);
		}
		ledger.settle("s1");

		for (const id of [SHARED_ID, LOCAL_ID]) {
			const row = store
				.prepare(
					`SELECT feedback_positive, truth_penalty, contradicted_at, ignored,
					        last_injected_at
					 FROM memories WHERE id = ?`,
				)
				.get(id) as {
				feedback_positive: number;
				truth_penalty: number | null;
				contradicted_at: string | null;
				ignored: number;
				last_injected_at: string | null;
			};
			expect(row.feedback_positive).toBe(1);
			expect(row.truth_penalty).toBe(0.5);
			expect(row.contradicted_at).not.toBeNull();
			expect(row.ignored).toBe(1);
		}
		// The shared row's write was ALLOWED (no refusal counter moved)…
		expect(
			store
				.prepare(
					"SELECT COALESCE((SELECT value FROM kevin_metrics WHERE key = 'shared_write_refusals'), 0) AS n",
				)
				.get() as { n: number },
		).toEqual({ n: 0 });
		// …the ledger row exists and settled for both layers…
		const outcomes = store
			.prepare(
				"SELECT outcome FROM kevin_injections WHERE memory_id IN (?, ?) ORDER BY memory_id",
			)
			.all(SHARED_ID, LOCAL_ID) as Array<{ outcome: string }>;
		expect(outcomes.map((r) => r.outcome)).toEqual([
			"ineffective",
			"ineffective",
		]);
		// …and only the fingerprint-bearing local lesson is stamped.
		expect(
			store
				.prepare("SELECT last_injected_at FROM memories WHERE id = ?")
				.get(SHARED_ID) as { last_injected_at: string | null },
		).toEqual({ last_injected_at: null });
		expect(
			store
				.prepare("SELECT last_injected_at FROM memories WHERE id = ?")
				.get(LOCAL_ID) as { last_injected_at: string | null },
		).not.toEqual({ last_injected_at: null });
	});

	it("kevin_feedback against a shared memory records normally and truth-penalty changes ranking locally", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.5,
			4,
			"shared",
			"e1",
		);
		insertMemory(
			store,
			LOCAL_ID,
			"Use dependency injection",
			0.4,
			1,
			"local",
			null,
		);
		const svc = new MemoryService(store, null, REPO);
		store
			.prepare(
				"INSERT INTO kevin_settings (key, value) VALUES ('deterministic_retrieval', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
			)
			.run();

		const before = svc.getRelevant({ scope: "project" }).map((m) => m.id);
		expect(before[0]).toBe(SHARED_ID);

		svc.applyTruthPenalty(SHARED_ID, 0.5, "contradicts package.json");
		const after = svc.getRelevant({ scope: "project" }).map((m) => m.id);
		expect(after[0]).toBe(LOCAL_ID);
	});

	it("RepoTruth (v0.7.0, unchanged) applies a truth penalty to a shared row", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.75,
			4,
			"shared",
			"e1",
		);
		const svc = new MemoryService(store, null, REPO);
		const detector = new ConflictDetector(
			store,
			PROJECT,
			undefined,
			undefined,
			svc,
		);

		const conflicts = detector.detect([
			{
				memoryId: SHARED_ID,
				reasons: ["contradicts package.json"],
				factId: "f-1",
			},
		]);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.kind).toBe("repo_truth");
		const row = store
			.prepare("SELECT truth_penalty FROM memories WHERE id = ?")
			.get(SHARED_ID) as { truth_penalty: number | null };
		expect(row.truth_penalty).toBe(0.5);
		// The penalty never writes status (Principle 24).
		expect(
			store
				.prepare("SELECT status FROM memories WHERE id = ?")
				.get(SHARED_ID) as { status: string },
		).toEqual({ status: "active" });
	});

	it("a refusal is counted, not thrown, and the counter is visible in kevin_audit", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.75,
			4,
			"shared",
			"e1",
		);
		const svc = new MemoryService(store, null, REPO);

		expect(() => svc.update(SHARED_ID, { content: "x" })).not.toThrow();
		expect(() => svc.update(SHARED_ID, { relevanceScore: 0.9 })).not.toThrow();
		expect(() => svc.update(SHARED_ID, { evidenceCount: 9 })).not.toThrow();

		const metrics = new Metrics(store);
		const report = buildAudit(store, metrics, undefined, PROJECT, REPO);
		expect(report.team?.write_refusals).toBe(3);
	});

	it("BUG-007: getById observes the layer column like loadAll does", async () => {
		const store = await openMigrated();
		insertMemory(
			store,
			SHARED_ID,
			"Always use the repository pattern",
			0.75,
			4,
			"shared",
			"e1",
		);
		insertMemory(
			store,
			LOCAL_ID,
			"Use dependency injection",
			0.3,
			1,
			"local",
			null,
		);
		const svc = new MemoryService(store, null, REPO);

		expect(svc.getById(SHARED_ID)?.layer).toBe("shared");
		expect(svc.getById(LOCAL_ID)?.layer).toBe("local");
		// The bulk path agrees with the single-row path.
		const all = svc.getRelevant({ scope: "all" });
		expect(all.find((m) => m.id === SHARED_ID)?.layer).toBe("shared");
		expect(all.find((m) => m.id === LOCAL_ID)?.layer).toBe("local");
	});
});

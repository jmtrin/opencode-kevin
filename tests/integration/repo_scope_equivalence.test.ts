import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import type { Memory } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = (name: string) =>
	readFileSync(join(__dirname, "..", "..", "migrations", name), "utf8");

// The v0.7.0 snapshot is built from the migrations up to 008 (002 has been
// absent from the repository since v0.2.0 — same PRIOR_FILES as the 009 tests).
const V07_MIGRATIONS = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
	"008_v07_truth.sql",
];

// The fixture represents two repositories, each in the single-machine
// configuration the plan §5.7 equivalence claim covers: no remote, so
// repo_id === project_id (resolve() source "path"). A third set of rows
// carries project_id NULL — the global rows of PatternMiner's nullPid
// convention.
const REPO_A = "aaaaaaaaaaaaaaaa";
const REPO_B = "bbbbbbbbbbbbbbbb";

const TYPES: ("error" | "pattern" | "decision" | "context")[] = [
	"error",
	"pattern",
	"decision",
	"context",
];

function makeV07Store(): Store {
	const s = new Store({ path: ":memory:" });
	for (const m of V07_MIGRATIONS) s.exec(SQL(m));
	return s;
}

function seed(
	store: Store,
	projectId: string | null | undefined,
	base: string,
	count: number,
	start: number,
): void {
	const svc = new MemoryService(store);
	for (let i = 0; i < count; i++) {
		const n = start + i;
		svc.save({
			type: TYPES[n % TYPES.length],
			content: `seed-${base}-${n} queue ${base}-token-${n} ${"x".repeat((n % 7) + 1)}`,
			scope: "project",
			relevanceScore: 0.05 + (n % 41) / 100,
			sourceTool: "equivalence-test",
			sourceSession: "fixture",
			projectId: projectId ?? undefined,
			metadata: { fixture: true, seed: n },
		});
	}
}

// Stable projection of the retrieval result: id, content and every field
// that participates in ordering or scores. JSON.stringify of a plain array
// is deterministic, so equality here is the byte-identical claim.
function fingerprint(memories: Memory[]): string {
	return JSON.stringify(
		memories.map((m) => [
			m.id,
			m.type,
			m.content,
			m.scope,
			m.relevanceScore,
			m.origin,
			m.projectId,
			m.status,
			(m.metadata as Record<string, unknown> | null)?.score ?? null,
		]),
	);
}

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-reqscope-"));
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K8-007 — retrieval scoped on repo_id + equivalence proof (plan §5.7)", () => {
	it("a 009-migrated snapshot returns byte-identical getRelevant() to the recorded v0.7.0 output", async () => {
		const store = makeV07Store();
		seed(store, REPO_A, "a", 30, 0);
		seed(store, REPO_B, "b", 20, 100);
		seed(store, null, "g", 10, 200);
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'deterministic_retrieval'",
			)
			.run();

		// O1: the v0.7.0 reader (no repo_id anywhere) — recorded before the
		// migration, exactly as the task's fixture would ship it.
		const v07 = new MemoryService(store);
		const query = "queue";
		const recordedQuery = fingerprint(
			v07.getRelevant({ query, scope: "project", bump: false }),
		);
		const recordedAll = fingerprint(
			v07.getRelevant({ scope: "project", bump: false }),
		);

		// Migrate the snapshot to 009 through the real Migrate (back-fill hook
		// included) — the production path.
		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const f of [...V07_MIGRATIONS, "009_v08_team.sql"]) {
			writeFileSync(join(migrationsDir, f), SQL(f));
		}
		const result = await new Migrate(store, migrationsDir).run();
		expect(result.applied).toContain("009");

		// The hook back-filled repo_id from project_id.
		const rows = store
			.prepare(
				"SELECT project_id, repo_id FROM memories WHERE project_id IS NOT NULL",
			)
			.all() as { project_id: string; repo_id: string | null }[];
		expect(rows.length).toBe(50);
		for (const r of rows) expect(r.repo_id).toBe(r.project_id);

		// O2: the same (identity-less) reader on the migrated snapshot.
		const v08Legacy = new MemoryService(store);
		expect(
			fingerprint(
				v08Legacy.getRelevant({ query, scope: "project", bump: false }),
			),
		).toBe(recordedQuery);
		expect(
			fingerprint(v08Legacy.getRelevant({ scope: "project", bump: false })),
		).toBe(recordedAll);
		store.close();
	});

	it("single-machine claim: repoId === projectId sees the same rows v0.7.0 saw", async () => {
		const store = makeV07Store();
		seed(store, REPO_A, "a", 30, 0);
		seed(store, null, "g", 10, 200);
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'deterministic_retrieval'",
			)
			.run();
		const v07 = new MemoryService(store);
		const recorded = fingerprint(
			v07.getRelevant({ query: "queue", scope: "project", bump: false }),
		);

		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const f of [...V07_MIGRATIONS, "009_v08_team.sql"]) {
			writeFileSync(join(migrationsDir, f), SQL(f));
		}
		await new Migrate(store, migrationsDir).run();

		// The v0.8.0 reader with the resolved identity (repoId === projectId
		// for a no-remote repository) must return the identical set.
		const scoped = new MemoryService(store, null, REPO_A);
		const after = fingerprint(
			scoped.getRelevant({ query: "queue", scope: "project", bump: false }),
		);
		expect(after).toBe(recorded);
		store.close();
	});

	it("NULL-repo_id rows are returned under every scope; scoped rows are not returned under another scope", async () => {
		const store = makeV07Store();
		seed(store, REPO_A, "a", 30, 0);
		seed(store, REPO_B, "b", 20, 100);
		seed(store, null, "g", 10, 200);
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'deterministic_retrieval'",
			)
			.run();
		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const f of [...V07_MIGRATIONS, "009_v08_team.sql"]) {
			writeFileSync(join(migrationsDir, f), SQL(f));
		}
		await new Migrate(store, migrationsDir).run();

		const scopedA = new MemoryService(store, null, REPO_A);
		const scopedB = new MemoryService(store, null, REPO_B);
		const a = scopedA.getRelevant({
			query: "queue",
			scope: "project",
			bump: false,
		});
		const b = scopedB.getRelevant({
			query: "queue",
			scope: "project",
			bump: false,
		});
		expect(a.length).toBe(40);
		expect(b.length).toBe(30);
		// NULL-repo_id (global) rows legitimately appear in both result
		// sets; a scoped row must never appear under the other scope.
		for (const m of a) {
			expect(m.projectId === REPO_A || m.projectId === null).toBe(true);
		}
		for (const m of b) {
			expect(m.projectId === REPO_B || m.projectId === null).toBe(true);
		}
		expect(a.some((m) => m.projectId === REPO_B)).toBe(false);
		expect(b.some((m) => m.projectId === REPO_A)).toBe(false);

		// query() scopes identically (slim rows carry no projectId, so the
		// assertion is on the snippet prefix of the other scope's rows).
		const qA = scopedA.query({ text: "queue", limit: 100 });
		expect(qA.length).toBe(40);
		for (const m of qA) {
			expect(m.snippet.startsWith("seed-b-")).toBe(false);
		}
		store.close();
	});

	it("new memories are written with both repo_id and project_id populated", async () => {
		const store = makeV07Store();
		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const f of [...V07_MIGRATIONS, "009_v08_team.sql"]) {
			writeFileSync(join(migrationsDir, f), SQL(f));
		}
		await new Migrate(store, migrationsDir).run();
		const svc = new MemoryService(store, null, REPO_A);
		const id = svc.save({
			type: "decision",
			content: "scoped memory with identity",
			scope: "project",
			projectId: "p-a",
		});
		const row = store
			.prepare("SELECT repo_id, project_id FROM memories WHERE id = ?")
			.get(id) as { repo_id: string | null; project_id: string | null };
		expect(row.repo_id).toBe(REPO_A);
		expect(row.project_id).toBe("p-a");

		// A NULL projectId (the nullPid convention) stays NULL-scoped:
		// global, matching every scope.
		const gid = svc.save({
			type: "context",
			content: "global memory",
			scope: "project",
		});
		const grow = store
			.prepare("SELECT repo_id, project_id FROM memories WHERE id = ?")
			.get(gid) as { repo_id: string | null; project_id: string | null };
		expect(grow.repo_id).toBeNull();
		expect(grow.project_id).toBeNull();
		store.close();
	});

	it("supersession is scoped on repo_id once the identity is resolved", async () => {
		const store = makeV07Store();
		const migrationsDir = join(tmpRoot, "migrations");
		mkdirSync(migrationsDir, { recursive: true });
		for (const f of [...V07_MIGRATIONS, "009_v08_team.sql"]) {
			writeFileSync(join(migrationsDir, f), SQL(f));
		}
		await new Migrate(store, migrationsDir).run();
		const svcA = new MemoryService(store, null, REPO_A);
		const svcB = new MemoryService(store, null, REPO_B);
		const fp = "supersede-9f1c2e4a";
		svcA.save({
			type: "decision",
			content: "a version",
			scope: "project",
			projectId: "p-a",
			fingerprint: fp,
		});
		svcB.save({
			type: "decision",
			content: "b version",
			scope: "project",
			projectId: "p-b",
			fingerprint: fp,
		});
		expect(svcA.countSupersedeCandidates("decision", fp, "p-a")).toBe(1);
		expect(svcB.countSupersedeCandidates("decision", fp, "p-b")).toBe(1);
		// Saving the same fingerprint under A supersedes only A's row.
		svcA.save({
			type: "decision",
			content: "a fresh version",
			scope: "project",
			projectId: "p-a",
			fingerprint: fp,
		});
		const rows = store
			.prepare(
				"SELECT id, status, project_id FROM memories WHERE fingerprint = ? ORDER BY project_id",
			)
			.all(fp) as { id: string; status: string; project_id: string | null }[];
		expect(rows.length).toBe(3);
		expect(rows.filter((r) => r.status === "active").length).toBe(2);
		expect(rows.find((r) => r.project_id === "p-b")?.status).toBe("active");
		store.close();
	});

	it("no retrieval path filters on project_id (source scan) and rankScore is v0.7.0's", () => {
		const src = readFileSync(
			join(__dirname, "..", "..", "plugin", "MemoryService.ts"),
			"utf8",
		);
		// The acceptance scan: `project_id = ?` inside a SELECT. Every
		// remaining project_id predicate uses the legacy `IS ?` form.
		expect(src).not.toMatch(/project_id = \?/);

		// rankScore source byte-equality against the recorded v0.7.0 text.
		// Whitespace is stripped entirely so the comparison is over tokens and
		// punctuation, not indentation.
		const rankScoreSource = src.match(/function rankScore\([\s\S]*?\n\}/)?.[0];
		const recorded = `function rankScore(mem: Memory, nowMs: number, deterministic: boolean): number {
	// FTS5 bm25 returns a negative score (more negative = better match).
	// For non-FTS rows (loadAll path), fall back to -relevance_score so
	// higher-relevance memories also come first under the same sign convention.
	const rawScore = (mem.metadata as Record<string, unknown> | null)?.score;
	const base = typeof rawScore === "number" ? rawScore : -mem.relevanceScore;
	const ageDays = Math.max(
		0,
		(nowMs - sqliteUtcToMs(mem.createdAt)) / 86_400_000,
	);
	// v0.5.0 (K5-008 / plan §5.6, D5-10) — deterministic retrieval freezes
	// the recency factor at 1.0 so ordering depends only on content
	// relevance and origin boost, never on the wall clock.
	const recencyDecay = deterministic ? 1 : RECENCY_DECAY_PER_DAY ** ageDays;
	// v0.7.0 (K7-008 / plan §5.3, D7-04) — trailing multiplicative factor,
	// applied AFTER the existing chain. At the default (truthPenalty = 0) the
	// expression reduces to the v0.6.0 one exactly. rankScore returns a
	// NEGATIVE score for BM25 rows (more negative = better), so scaling by a
	// factor in (0.5, 1] moves a row toward zero — i.e. toward worse — which
	// is the intended de-ranking direction.
	return base * originBoost(mem) * recencyDecay * (1 - (mem.truthPenalty ?? 0));
}`;
		expect(rankScoreSource?.replace(/\s+/g, "")).toBe(
			recorded.replace(/\s+/g, ""),
		);
	});
});

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-rank-truth-"));
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
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
});

function makeService(): { store: Store; svc: MemoryService; metrics: Metrics } {
	const store = new Store({ path: ":memory:" });
	const metrics = new Metrics(store);
	return { store, svc: new MemoryService(store, metrics), metrics };
}

async function migrate(store: Store): Promise<void> {
	await new Migrate(store, migrationsDir).run();
}

interface Seed {
	id: string;
	origin: "reflector" | "pattern" | "agent";
	relevance: number;
	created: string;
}

// Deterministic 20-memory fixture over the loadAll path (no FTS scores), so
// ordering is a pure, hand-computable function of (origin, relevance) folded
// as `-(relevance) * originBoost`, then TYPE_PRIORITY, then created_at.
function seeds(): Seed[] {
	const created = (h: number): string => {
		const d = new Date(Date.UTC(2026, 0, 1, h, 0, 0));
		return d.toISOString();
	};
	return [
		{ id: "m01", origin: "reflector", relevance: 1.0, created: created(1) },
		{ id: "m02", origin: "reflector", relevance: 0.9, created: created(2) },
		{ id: "m03", origin: "reflector", relevance: 0.8, created: created(3) },
		{ id: "m04", origin: "reflector", relevance: 0.7, created: created(4) },
		{ id: "m05", origin: "reflector", relevance: 0.6, created: created(5) },
		{ id: "m06", origin: "reflector", relevance: 0.5, created: created(6) },
		{ id: "m07", origin: "reflector", relevance: 0.4, created: created(7) },
		{ id: "m08", origin: "reflector", relevance: 0.3, created: created(8) },
		{ id: "m09", origin: "reflector", relevance: 0.2, created: created(9) },
		{ id: "m10", origin: "reflector", relevance: 0.1, created: created(10) },
		{ id: "m11", origin: "pattern", relevance: 0.9, created: created(11) },
		{ id: "m12", origin: "pattern", relevance: 0.7, created: created(12) },
		{ id: "m13", origin: "pattern", relevance: 0.5, created: created(13) },
		{ id: "m14", origin: "pattern", relevance: 0.3, created: created(14) },
		{ id: "m15", origin: "pattern", relevance: 0.1, created: created(15) },
		{ id: "m16", origin: "agent", relevance: 0.8, created: created(16) },
		{ id: "m17", origin: "agent", relevance: 0.6, created: created(17) },
		{ id: "m18", origin: "agent", relevance: 0.4, created: created(18) },
		{ id: "m19", origin: "agent", relevance: 0.2, created: created(19) },
		{ id: "m20", origin: "agent", relevance: 0.0, created: created(20) },
	];
}

// Independent, hand-computed golden ranking for the v0.6.0 formula with
// truth_penalty = 0: `-(relevance) * originBoost * recencyDecay` where
// recencyDecay = 1 in deterministic mode. More negative = better.
function expectedOrder(seeds_: Seed[]): string[] {
	const boost = (o: Seed["origin"]): number =>
		o === "reflector" ? 2 : o === "pattern" ? 1.5 : 1;
	const typePriority = {
		error: 0,
		pattern: 1,
		rule: 1,
		solution: 1,
		decision: 2,
		context: 3,
	} as const;
	const sc = seeds_.map((s) => ({
		id: s.id,
		score: -s.relevance * boost(s.origin),
		prio: typePriority.pattern,
		created: Date.parse(s.created),
	}));
	sc.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		if (a.prio !== b.prio) return a.prio - b.prio;
		return b.created - a.created;
	});
	return sc.map((s) => s.id);
}

async function seedAll(store: Store, svc: MemoryService): Promise<string[]> {
	store
		.prepare(
			"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('deterministic_retrieval', '1')",
		)
		.run();
	const ids: string[] = [];
	for (const s of seeds()) {
		const id = svc.save({
			id: s.id,
			type: "rule",
			content: `Memory ${s.id} about the project`,
			scope: "project",
			relevanceScore: s.relevance,
			origin: s.origin,
			projectId: "proj",
		});
		// SaveInput has no createdAt; stamp the deterministic times directly.
		store
			.prepare(
				"UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?",
			)
			.run(s.created, s.created, id);
		ids.push(id);
	}
	return ids;
}

function rankedIds(store: Store, svc: MemoryService): string[] {
	return svc
		.getRelevant({
			scope: "all",
			maxTokens: 100000,
			now: new Date("2099-01-01T00:00:00.000Z"),
			bump: false,
		})
		.map((m) => m.id);
}

describe("K7-008 — truth_penalty in rankScore()", () => {
	it("reproduces the v0.6.0 ordering exactly when all penalties are 0 (golden array)", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		const ids = await seedAll(store, svc);
		const golden = expectedOrder(seeds());
		const got = rankedIds(store, svc);
		expect(got).toEqual(golden);
		expect(got).toHaveLength(ids.length);
		metrics.close();
		store.close();
	});

	it("a penalty of 0.5 moves a memory strictly toward worse rank; a penalty of 0 does not", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		await seedAll(store, svc);
		const golden = expectedOrder(seeds());
		const baseline = rankedIds(store, svc);
		expect(baseline).toEqual(golden);

		// m06 is best of the pattern tier; penalize it.
		const idx = baseline.indexOf("m06");
		svc.applyTruthPenalty("m06", 0.5, "reason");
		const after = rankedIds(store, svc);
		const afterIdx = after.indexOf("m06");
		expect(afterIdx).toBeGreaterThan(idx);

		// A zero penalty leaves the ordering untouched (bit-identical at 0).
		svc.applyTruthPenalty("m11", 0, "zero");
		const afterZero = rankedIds(store, svc);
		expect(afterZero.indexOf("m11")).toBe(baseline.indexOf("m11"));
		metrics.close();
		store.close();
	});

	it("applyTruthPenalty clamps -1 to 0 and 0.9 to 0.5", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		await seedAll(store, svc);
		svc.applyTruthPenalty("m01", -1, "neg");
		expect(svc.getById("m01")?.truthPenalty).toBe(0);
		svc.applyTruthPenalty("m02", 0.9, "high");
		expect(svc.getById("m02")?.truthPenalty).toBe(0.5);
		metrics.close();
		store.close();
	});

	it("memories_contradicted increments on the first penalty but not the second", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		await seedAll(store, svc);
		expect(metrics.get("memories_contradicted")).toBe(0);
		svc.applyTruthPenalty("m03", 0.3, "r");
		expect(metrics.get("memories_contradicted")).toBe(1);
		svc.applyTruthPenalty("m03", 0.2, "r2");
		expect(metrics.get("memories_contradicted")).toBe(1);
		// A different memory is a new contradiction.
		svc.applyTruthPenalty("m04", 0.1, "r3");
		expect(metrics.get("memories_contradicted")).toBe(2);
		metrics.close();
		store.close();
	});

	it("a penalty lifted back to 0 decrements memories_contradicted and re-penalizing counts again", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		await seedAll(store, svc);
		svc.applyTruthPenalty("m03", 0.3, "r");
		expect(metrics.get("memories_contradicted")).toBe(1);
		svc.applyTruthPenalty("m03", 0, "recovered");
		expect(metrics.get("memories_contradicted")).toBe(0);
		expect(svc.getById("m03")?.contradictedAt).toBeNull();
		svc.applyTruthPenalty("m03", 0.3, "r2");
		expect(metrics.get("memories_contradicted")).toBe(1);
		metrics.close();
		store.close();
	});

	it("never changes status: status <> 'active' count is unchanged after penalties", async () => {
		const { store, svc, metrics } = makeService();
		await migrate(store);
		await seedAll(store, svc);
		const before = (
			store
				.prepare("SELECT COUNT(*) AS c FROM memories WHERE status <> 'active'")
				.get() as {
				c: number;
			}
		).c;
		svc.applyTruthPenalty("m01", 0.4, "a");
		svc.applyTruthPenalty("m02", 0.5, "b");
		svc.applyTruthPenalty("m03", 0.5, "c");
		const after = (
			store
				.prepare("SELECT COUNT(*) AS c FROM memories WHERE status <> 'active'")
				.get() as {
				c: number;
			}
		).c;
		expect(after).toBe(before);
		metrics.close();
		store.close();
	});

	it("applyTruthPenalty contains no UPDATE memories SET status (source scan)", () => {
		const src = readFileSync(
			join(process.cwd(), "plugin", "MemoryService.ts"),
			"utf8",
		);
		const methodStart = src.indexOf("applyTruthPenalty(");
		// Locate the method body: from the doc comment before it, up to the
		// next `\n\t}` at method indentation.
		const body = src.slice(methodStart - 400, methodStart + 1200);
		// The only UPDATE in the method is the truth_penalty one (no `status`).
		const statusUpdates = body.match(/UPDATE memories SET\s*status/);
		expect(statusUpdates).toBeNull();
	});
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DATE_NOW, MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages/core/migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function makeStore(): Store {
	const store = new Store({ path: ":memory:" });
	for (const name of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
	]) {
		store.exec(sql(name));
	}
	return store;
}

describe("K5-008 — injectable clock + deterministic_retrieval (D5-10)", () => {
	let store: Store;
	let svc: MemoryService;

	beforeEach(() => {
		store = makeStore();
		svc = new MemoryService(store);
	});

	it("DATE_NOW sentinel is the fixed future instant", () => {
		expect(Date.parse(DATE_NOW)).toBe(Date.parse("2099-01-01T00:00:00.000Z"));
	});

	it("frozen clock: identical results and scores for repeated queries", () => {
		svc.save({ type: "error", content: "typecheck fails with tsc-1" });
		svc.save({ type: "error", content: "typecheck fails with tsc-2" });
		const frozen = new Date("2026-08-01T00:00:00.000Z");
		const first = svc.getRelevant({
			query: "typecheck",
			bump: false,
			now: frozen,
		});
		const second = svc.getRelevant({
			query: "typecheck",
			bump: false,
			now: frozen,
		});
		expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
	});

	it("deterministic_retrieval=1 freezes the clock and never bumps", () => {
		svc.save({ type: "error", content: "typecheck fails with tsc-1" });
		// Migration 006 seeds the key with '0'; flip it on.
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'deterministic_retrieval'",
			)
			.run();

		const at2026 = svc.getRelevant({ query: "typecheck" });
		expect(at2026.length).toBe(1);
		const scoreAfter2026 = (
			store
				.prepare("SELECT relevance_score FROM memories WHERE id = ?")
				.get(at2026[0].id) as {
				relevance_score: number;
			}
		).relevance_score;

		const at2030 = svc.getRelevant({ query: "typecheck" });
		expect(at2030.map((m) => m.id)).toEqual(at2026.map((m) => m.id));

		const scoreAfter2030 = (
			store
				.prepare("SELECT relevance_score FROM memories WHERE id = ?")
				.get(at2030[0].id) as {
				relevance_score: number;
			}
		).relevance_score;
		// No bump: deterministic retrieval is a pure read.
		expect(scoreAfter2030).toBe(scoreAfter2026);
		expect(scoreAfter2026).toBeCloseTo(0.5, 10);
	});

	it("deterministic_retrieval=0 (default) still bumps", () => {
		svc.save({ type: "error", content: "typecheck fails with tsc-1" });
		const out = svc.getRelevant({ query: "typecheck" });
		expect(out.length).toBe(1);
		const row = store
			.prepare("SELECT relevance_score FROM memories WHERE id = ?")
			.get(out[0].id) as { relevance_score: number };
		expect(row.relevance_score).toBeCloseTo(0.55, 10);
	});

	it("ignored=1 rows are excluded from retrieval (D5-07)", () => {
		const id = svc.save({
			type: "error",
			content: "typecheck fails with tsc-1",
		});
		store.prepare("UPDATE memories SET ignored = 1 WHERE id = ?").run(id);
		expect(svc.getRelevant({})).toHaveLength(0);
		store.prepare("UPDATE memories SET ignored = 0 WHERE id = ?").run(id);
		expect(svc.getRelevant({})).toHaveLength(1);
	});
});

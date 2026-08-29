import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Feedback } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

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

describe("K5-009 — Feedback component + mapRow fields (D5-02)", () => {
	let store: Store;
	let metrics: Metrics;
	let feedback: Feedback;
	let svc: MemoryService;

	beforeEach(() => {
		store = makeStore();
		metrics = new Metrics(store);
		feedback = new Feedback(store, metrics);
		svc = new MemoryService(store);
	});

	it("record('useful') bumps the positive counter and metric", () => {
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		feedback.record({ memoryId: id, verdict: "useful", note: "worked" });
		expect(feedback.countsFor(id)).toEqual({ positive: 1, negative: 0 });
		expect(metrics.get("feedback_positive_total")).toBe(1);
		expect(metrics.get("feedback_negative_total")).toBe(0);
	});

	it("wrong and outdated both count as negative", () => {
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		feedback.record({ memoryId: id, verdict: "wrong" });
		feedback.record({ memoryId: id, verdict: "outdated" });
		expect(feedback.countsFor(id)).toEqual({ positive: 0, negative: 2 });
		expect(metrics.get("feedback_negative_total")).toBe(2);
	});

	it("verdict 'ignore' stamps memories.ignored = 1 (D5-07)", () => {
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		feedback.record({ memoryId: id, verdict: "ignore", note: "noise" });
		expect(svc.getById(id)?.ignored).toBe(true);
		// The ignored memory is excluded from retrieval (K5-008 filter).
		expect(svc.getRelevant({})).toHaveLength(0);
	});

	it("counters are recomputed from the table, not drifted", () => {
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		feedback.record({ memoryId: id, verdict: "useful" });
		feedback.record({ memoryId: id, verdict: "useful" });
		feedback.record({ memoryId: id, verdict: "wrong" });
		expect(feedback.countsFor(id)).toEqual({ positive: 2, negative: 1 });
		// A third 'useful' must recompute from rows, not += 1 on a stale read.
		feedback.record({ memoryId: id, verdict: "useful" });
		expect(feedback.countsFor(id)).toEqual({ positive: 3, negative: 1 });
	});

	it("list() returns verdict history newest first and can filter by memory", () => {
		const a = svc.save({ type: "error", content: "bash fails with tsc-1" });
		const b = svc.save({ type: "pattern", content: "pattern for tsc-1" });
		feedback.record({ memoryId: a, verdict: "useful", note: "ok" });
		feedback.record({ memoryId: b, verdict: "wrong" });
		const all = feedback.list();
		expect(all).toHaveLength(2);
		expect(all[0]).toMatchObject({
			memoryId: b,
			verdict: "wrong",
			sessionId: null,
			note: null,
		});
		expect(all[0].createdAt).toBeTruthy();
		expect(all[1].memoryId).toBe(a);
		const onlyA = feedback.list(a);
		expect(onlyA).toHaveLength(1);
		expect(onlyA[0].verdict).toBe("useful");
	});

	it("mapRow exposes ignored and supersedes (K5-009)", () => {
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		const fresh = svc.getById(id);
		expect(fresh?.ignored).toBe(false);
		expect(fresh?.supersedes).toBeNull();
	});

	it("countsFor on an unknown memory is zeros", () => {
		expect(feedback.countsFor("missing")).toEqual({ positive: 0, negative: 0 });
	});
});

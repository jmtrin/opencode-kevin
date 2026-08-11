import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Feedback } from "../../plugin/Feedback.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import {
	FEEDBACK_NEGATIVE_STEP,
	FEEDBACK_POSITIVE_STEP,
	computeConfidence,
} from "../../plugin/confidence.js";
import { kevinWhy } from "../../plugin/kevin_why.js";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

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

describe("K5-010 — feedback terms in computeConfidence (D5-02)", () => {
	it("formula: positive feedback nudges up, negative feedback nudges down", () => {
		expect(computeConfidence(0, 0)).toBe(0.5);
		expect(computeConfidence(0, 0, 1, 0)).toBeCloseTo(
			0.5 + FEEDBACK_POSITIVE_STEP,
			10,
		);
		expect(computeConfidence(0, 0, 0, 1)).toBeCloseTo(
			0.5 - FEEDBACK_NEGATIVE_STEP,
			10,
		);
		// One confirmed fix (0.1) plus one 'wrong' verdict (0.1) cancel out.
		expect(computeConfidence(1, 0, 0, 1)).toBeCloseTo(0.5, 10);
	});

	it("feedback is clamped like every other term", () => {
		expect(computeConfidence(100, 0, 100, 0)).toBe(0.95);
		expect(computeConfidence(0, 100, 0, 100)).toBe(0.05);
	});

	it("mapRow folds feedback counters into the memory confidence", () => {
		const store = makeStore();
		const svc = new MemoryService(store);
		const feedback = new Feedback(store);
		const id = svc.save({ type: "error", content: "bash fails with tsc-1" });
		// Seed causal evidence: 2 confirmed fixes → base 0.5 + 0.2.
		svc.update(id, { evidenceCount: 2 });
		expect(svc.getById(id)?.confidence).toBeCloseTo(0.7, 10);
		// A 'wrong' verdict (0.1 penalty) → 0.6.
		feedback.record({ memoryId: id, verdict: "wrong" });
		const afterWrong = svc.getById(id);
		expect(afterWrong?.feedbackNegative).toBe(1);
		expect(afterWrong?.confidence).toBeCloseTo(0.6, 10);
		// An 'useful' verdict (+0.05) → 0.65.
		feedback.record({ memoryId: id, verdict: "useful" });
		const afterUseful = svc.getById(id);
		expect(afterUseful?.feedbackPositive).toBe(1);
		expect(afterUseful?.confidence).toBeCloseTo(0.65, 10);
	});

	it("kevin_why uses the same feedback-aware formula", () => {
		const store = makeStore();
		const svc = new MemoryService(store);
		const feedback = new Feedback(store);
		const id = svc.save({
			type: "pattern",
			content: "Causal pattern: tsc-1 fails with unknown exports",
			fingerprint: "fp-why",
			origin: "causal",
			evidenceCount: 1,
		});
		feedback.record({ memoryId: id, verdict: "wrong" });
		const why = kevinWhy(store, "tsc-1");
		expect(why).not.toBeNull();
		expect(why?.confidence).toBeCloseTo(0.5, 10);
	});
});

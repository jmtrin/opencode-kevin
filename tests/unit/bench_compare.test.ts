import { describe, expect, it } from "vitest";
import {
	type BenchPoint,
	compareResults,
} from "../../scripts/bench-compare.js";

function pt(overrides: Partial<BenchPoint> & { arm: string }): BenchPoint {
	return {
		arm: overrides.arm,
		precision_at_k: overrides.precision_at_k ?? 0.95,
		recall_at_k: overrides.recall_at_k ?? 0.55,
		mrr: overrides.mrr ?? 1.0,
	};
}

describe("K11-008 compareResults", () => {
	it("identical → ok", () => {
		const prev: BenchPoint[] = [pt({ arm: "kevin" })];
		const curr: BenchPoint[] = [pt({ arm: "kevin" })];
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(true);
		expect(res.failures).toEqual([]);
	});

	it("p drop 0.03 → fail", () => {
		const prev: BenchPoint[] = [pt({ arm: "kevin", precision_at_k: 0.95 })];
		const curr: BenchPoint[] = [pt({ arm: "kevin", precision_at_k: 0.92 })]; // drop 0.03 > 0.02
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(false);
		expect(res.failures.some((f) => f.includes("precision"))).toBe(true);
	});

	it("r drop 0.06 → fail", () => {
		const prev: BenchPoint[] = [pt({ arm: "kevin", recall_at_k: 0.55 })];
		const curr: BenchPoint[] = [pt({ arm: "kevin", recall_at_k: 0.49 })]; // 0.06 >0.05
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(false);
		expect(res.failures.some((f) => f.includes("recall"))).toBe(true);
	});

	it("mrr drop 0.04 → ok (threshold 0.05)", () => {
		const prev: BenchPoint[] = [pt({ arm: "kevin", mrr: 1.0 })];
		const curr: BenchPoint[] = [pt({ arm: "kevin", mrr: 0.96 })]; // 0.04 <0.05
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(true);
	});

	it("other arms degraded → still ok (informational)", () => {
		const prev: BenchPoint[] = [
			pt({ arm: "kevin" }),
			pt({ arm: "recent-k", precision_at_k: 0.1 }),
		];
		const curr: BenchPoint[] = [
			pt({ arm: "kevin" }),
			pt({ arm: "recent-k", precision_at_k: 0.01 }),
		]; // big drop but not kevin
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(true);
		expect(res.failures.length).toBe(0);
	});

	it("missing prev arm → ok with warning", () => {
		const prev: BenchPoint[] = [];
		const curr: BenchPoint[] = [pt({ arm: "kevin" })];
		const res = compareResults(prev, curr);
		expect(res.ok).toBe(true);
		expect(res.failures[0]).toMatch(/warning/);
	});
});

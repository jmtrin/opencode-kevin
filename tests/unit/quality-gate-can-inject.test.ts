import { describe, expect, it } from "vitest";
import { QualityGate } from "../../plugin/QualityGate.js";

function mem(
	over: Partial<{
		id: string;
		status: string;
		strength: "strong" | "weak";
		isActionable: boolean;
	}>,
) {
	return {
		id: over.id ?? "mem-1",
		status: over.status ?? "active",
		strength: over.strength ?? "strong",
		isActionable: over.isActionable ?? true,
	};
}

const freshCtx = (recurrenceCount = 0, seen = new Set<string>()) => ({
	seenThisSession: seen,
	recurrenceCount,
});

describe("K4-004 — QualityGate.canInject", () => {
	it("admits a strong actionable lesson once", () => {
		expect(QualityGate.canInject(mem({}), freshCtx())).toBe(true);
	});

	it("rejects a memory id already seen this session", () => {
		const seen = new Set(["mem-1"]);
		expect(QualityGate.canInject(mem({}), freshCtx(0, seen))).toBe(false);
	});

	it("admits a second distinct id in the same session", () => {
		const seen = new Set(["mem-1"]);
		expect(QualityGate.canInject(mem({ id: "mem-2" }), freshCtx(0, seen))).toBe(
			true,
		);
	});

	it("rejects stale memories", () => {
		expect(QualityGate.canInject(mem({ status: "stale" }), freshCtx())).toBe(
			false,
		);
	});

	it("rejects archived and superseded memories too", () => {
		expect(QualityGate.canInject(mem({ status: "archived" }), freshCtx())).toBe(
			false,
		);
		expect(
			QualityGate.canInject(mem({ status: "superseded" }), freshCtx()),
		).toBe(false);
	});

	it("rejects a fingerprint that recurred after injection (recurrenceCount >= 1)", () => {
		expect(QualityGate.canInject(mem({}), freshCtx(1))).toBe(false);
		expect(QualityGate.canInject(mem({}), freshCtx(3))).toBe(false);
	});

	it("admits again after recurrence resets to 0 (new fix observed)", () => {
		expect(QualityGate.canInject(mem({}), freshCtx(0))).toBe(true);
	});

	it("rejects weak non-actionable lessons when the gate is on (default)", () => {
		expect(
			QualityGate.canInject(
				mem({ strength: "weak", isActionable: false }),
				freshCtx(),
			),
		).toBe(false);
		expect(
			QualityGate.canInject(
				mem({ strength: "weak", isActionable: false }),
				freshCtx(),
				true,
			),
		).toBe(false);
	});

	it("admits weak non-actionable lessons in debug mode (quality_gate_enabled = 0)", () => {
		expect(
			QualityGate.canInject(
				mem({ strength: "weak", isActionable: false }),
				freshCtx(),
				false,
			),
		).toBe(true);
	});

	it("still enforces seen-set, stale and recurrence in debug mode", () => {
		const seen = new Set(["mem-1"]);
		expect(QualityGate.canInject(mem({}), freshCtx(0, seen), false)).toBe(
			false,
		);
		expect(
			QualityGate.canInject(mem({ status: "stale" }), freshCtx(), false),
		).toBe(false);
		expect(QualityGate.canInject(mem({}), freshCtx(2), false)).toBe(false);
	});
});

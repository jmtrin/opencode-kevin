import { describe, expect, it } from "vitest";
import {
	type GateReason,
	type GateVerdict,
	QualityGate,
} from "@jmtrin/kevin-core";

interface MemoryArg {
	id: string;
	status?: string;
	strength?: "strong" | "weak";
	isActionable?: boolean;
	ignored?: boolean;
}

function mem(over: Partial<MemoryArg> = {}): MemoryArg {
	return {
		id: over.id ?? "mem-1",
		status: over.status ?? "active",
		strength: over.strength ?? "strong",
		isActionable: over.isActionable ?? true,
		ignored: over.ignored ?? false,
	};
}

const freshCtx = (recurrenceCount = 0, seen = new Set<string>()) => ({
	seenThisSession: seen,
	recurrenceCount,
});

describe("K5-006 — canInjectVerdict (v0.5.0 Glass Box)", () => {
	it("returns ok for an admissible memory", () => {
		expect(QualityGate.canInjectVerdict(mem(), freshCtx())).toEqual({
			allowed: true,
			reason: "ok",
		});
	});

	it.each<
		[
			string,
			MemoryArg,
			() => { seenThisSession: Set<string>; recurrenceCount: number },
			GateReason,
		]
	>([
		[
			"seen_this_session",
			mem(),
			() => freshCtx(0, new Set(["mem-1"])),
			"seen_this_session",
		],
		["ignored", mem({ ignored: true }), freshCtx, "ignored"],
		["not_active", mem({ status: "stale" }), freshCtx, "not_active"],
		["recurrence", mem(), () => freshCtx(1), "recurrence"],
		["weak", mem({ strength: "weak", isActionable: false }), freshCtx, "weak"],
	])(
		"rejects %s with { allowed: false, reason: '%s' }",
		(_name, memory, ctx, expectedReason) => {
			const verdict = QualityGate.canInjectVerdict(memory, ctx());
			expect(verdict).toEqual({ allowed: false, reason: expectedReason });
		},
	);

	it("with qualityGateEnabled=false a weak memory is admitted but an ignored one is still rejected", () => {
		const weak = QualityGate.canInjectVerdict(
			mem({ strength: "weak", isActionable: false }),
			freshCtx(),
			false,
		);
		expect(weak).toEqual({ allowed: true, reason: "ok" });
		const ignored = QualityGate.canInjectVerdict(
			mem({ ignored: true }),
			freshCtx(),
			false,
		);
		expect(ignored).toEqual({ allowed: false, reason: "ignored" });
	});

	it("canInject(...) === canInjectVerdict(...).allowed for every branch", () => {
		const cases: Array<{
			name: string;
			memory: MemoryArg;
			ctx: { seenThisSession: Set<string>; recurrenceCount: number };
			gateEnabled?: boolean;
		}> = [
			{ name: "admitted", memory: mem(), ctx: freshCtx() },
			{ name: "seen", memory: mem(), ctx: freshCtx(0, new Set(["mem-1"])) },
			{ name: "ignored", memory: mem({ ignored: true }), ctx: freshCtx() },
			{ name: "stale", memory: mem({ status: "stale" }), ctx: freshCtx() },
			{ name: "recurred", memory: mem(), ctx: freshCtx(2) },
			{ name: "weak", memory: mem({ strength: "weak" }), ctx: freshCtx() },
			{
				name: "weak debug",
				memory: mem({ strength: "weak" }),
				ctx: freshCtx(),
				gateEnabled: false,
			},
			{
				name: "ignored debug",
				memory: mem({ ignored: true }),
				ctx: freshCtx(),
				gateEnabled: false,
			},
		];
		for (const c of cases) {
			const expected = QualityGate.canInjectVerdict(
				c.memory,
				c.ctx,
				c.gateEnabled ?? true,
			);
			expect(
				QualityGate.canInject(c.memory, c.ctx, c.gateEnabled ?? true),
				c.name,
			).toBe(expected.allowed);
		}
	});
});

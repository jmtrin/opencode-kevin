import { describe, expect, it } from "vitest";
import type { HookReport } from "../../plugin/HookLiveness.js";
import { reduceVerdict } from "../../plugin/HookLiveness.js";

// v0.9.0 (K9-012 / plan §5.5, D9-09) — pure reducer tests over literal
// HookReport[] arrays: any dead → degraded; all live → healthy; anything
// else → unknown, never rounded to healthy.

function report(
	hook: HookReport["hook"],
	state: HookReport["state"],
	deadSince: string | null = null,
): HookReport {
	return {
		hook,
		experimental: hook.startsWith("experimental."),
		state,
		firstSeenAt: state === "live" ? "2026-08-19T07:00:00.000Z" : null,
		lastSeenAt: state === "live" ? "2026-08-19T07:05:00.000Z" : null,
		fireCount: state === "live" ? 1 : 0,
		expectedCount: state === "unknown" ? 1 : 3,
		deadSince,
	};
}

const REASON_CHARSET = /^[\w .,:;()+-]+$/;

describe("K9-012 — reduceVerdict", () => {
	it("all hooks live → healthy", () => {
		const reports: HookReport[] = [
			report("tool.execute.before", "live"),
			report("tool.execute.after", "live"),
			report("chat.message", "live"),
			report("experimental.chat.system.transform", "live"),
			report("experimental.session.compacting", "live"),
			report("event", "live"),
		];
		const out = reduceVerdict(reports);
		expect(out.verdict).toBe("healthy");
		expect(out.reason).toBe("all hooks live");
		expect(out.reason).toMatch(REASON_CHARSET);
	});

	it("any dead hook → degraded, reason names the hook and dead_since", () => {
		const deadSince = "2026-08-19T06:00:00.000Z";
		const reports: HookReport[] = [
			report("tool.execute.before", "live"),
			report("tool.execute.after", "live"),
			report("experimental.chat.system.transform", "dead", deadSince),
		];
		const out = reduceVerdict(reports);
		expect(out.verdict).toBe("degraded");
		expect(out.reason).toContain("experimental.chat.system.transform");
		expect(out.reason).toContain(deadSince);
		expect(out.reason).toContain("1 affected hook");
		expect(out.reason).toMatch(REASON_CHARSET);
	});

	it("two dead hooks → degraded naming both", () => {
		const reports: HookReport[] = [
			report(
				"experimental.chat.system.transform",
				"dead",
				"2026-08-19T06:00:00.000Z",
			),
			report("event", "dead", "2026-08-19T06:30:00.000Z"),
			report("chat.message", "live"),
		];
		const out = reduceVerdict(reports);
		expect(out.verdict).toBe("degraded");
		expect(out.reason).toContain("experimental.chat.system.transform");
		expect(out.reason).toContain("event");
		expect(out.reason).toContain("2 affected hook");
		expect(out.reason).toMatch(REASON_CHARSET);
	});

	it("mix live + unknown, no dead → unknown (never rounded to healthy)", () => {
		const reports: HookReport[] = [
			report("tool.execute.before", "live"),
			report("chat.message", "unknown"),
		];
		const out = reduceVerdict(reports);
		expect(out.verdict).toBe("unknown");
		expect(out.reason).toContain("1 hook(s) without checkpoint");
		expect(out.reason).toMatch(REASON_CHARSET);
	});

	it("all unknown → unknown with full pending count", () => {
		const reports: HookReport[] = [
			report("tool.execute.before", "unknown"),
			report("chat.message", "unknown"),
			report("event", "unknown"),
		];
		const out = reduceVerdict(reports);
		expect(out.verdict).toBe("unknown");
		expect(out.reason).toContain("3 hook(s) without checkpoint");
		expect(out.reason).toMatch(REASON_CHARSET);
	});

	it("empty report list → unknown, not healthy (vacuous truth guard)", () => {
		const out = reduceVerdict([]);
		expect(out.verdict).toBe("unknown");
		expect(out.reason).toMatch(REASON_CHARSET);
	});
});

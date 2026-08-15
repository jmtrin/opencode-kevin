import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextInjector } from "../../plugin/ContextInjector.js";
import type { Memory, MemoryService } from "../../plugin/MemoryService.js";
import { QualityGate } from "../../plugin/QualityGate.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

function mem(confidence: number): Memory {
	return {
		id: "mem-1",
		type: "error",
		content:
			"When bash fails with TS2304\nSuggestion: Import the missing module",
		scope: "project",
		relevanceScore: 0.8,
		status: "active",
		fingerprint: "fp-1",
		confidence,
	} as Memory;
}

function makeService(memory: Memory): MemoryService {
	return {
		getRelevant: vi.fn(() => [memory]),
		bumpRelevance: vi.fn(),
		getSetting: vi.fn((key: string, fallback?: string) => {
			if (key === "injection_confidence_floor") return "0.6";
			if (key === "pre_prompt_budget_tokens") return "400";
			if (key === "quality_gate_enabled") return "1";
			return fallback ?? "1";
		}),
	} as unknown as MemoryService;
}

function liveTransform(
	service: MemoryService,
	injector: ContextInjector,
): { system: string[] } {
	const output = { system: [] as string[] };
	injector.onSystemTransform(
		{ messages: [{ role: "user", content: "fix typecheck" }] },
		output,
	);
	return output;
}

let store: Store;
let metrics: Metrics;

beforeEach(() => {
	store = new Store({ path: ":memory:" });
	metrics = new Metrics(store);
});

describe("K6-022 — low_confidence gate + injections_blocked_confidence (plan §5.8)", () => {
	it("a memory below the floor yields low_confidence, even when its id is already in the seen-set (branch zero)", () => {
		const verdict = QualityGate.canInjectVerdict(
			{
				id: "mem-1",
				status: "active",
				strength: "strong",
				isActionable: true,
				confidence: 0.3,
			},
			{
				seenThisSession: new Set(["mem-1"]),
				recurrenceCount: 0,
				confidenceFloor: 0.6,
			},
		);
		expect(verdict).toEqual({
			allowed: false,
			reason: "low_confidence",
		});
	});

	it("a memory exactly at the floor is admitted (>=, not >)", () => {
		const verdict = QualityGate.canInjectVerdict(
			{
				id: "mem-1",
				status: "active",
				strength: "strong",
				isActionable: true,
				confidence: 0.6,
			},
			{
				seenThisSession: new Set(),
				recurrenceCount: 0,
				confidenceFloor: 0.6,
			},
		);
		expect(verdict).toEqual({ allowed: true, reason: "ok" });
	});

	it("a floor of '0' admits everything the other five branches allow", () => {
		const verdict = QualityGate.canInjectVerdict(
			{
				id: "mem-1",
				status: "active",
				strength: "strong",
				isActionable: true,
				confidence: 0,
			},
			{
				seenThisSession: new Set(),
				recurrenceCount: 0,
				confidenceFloor: 0,
			},
		);
		expect(verdict).toEqual({ allowed: true, reason: "ok" });
	});

	it("without a computed confidence the branch is disabled (legacy rows pass)", () => {
		const verdict = QualityGate.canInjectVerdict(
			{ id: "mem-1", status: "active", strength: "strong", isActionable: true },
			{
				seenThisSession: new Set(),
				recurrenceCount: 0,
				confidenceFloor: 0.6,
			},
		);
		expect(verdict).toEqual({ allowed: true, reason: "ok" });
	});

	it("canInject() remains the thin v0.5.0 wrapper (arity 2, no confidence in its public shape)", () => {
		expect(QualityGate.canInject.length).toBe(2);
		expect(
			QualityGate.canInject(
				{
					id: "mem-1",
					status: "active",
					strength: "strong",
					isActionable: true,
				},
				{
					seenThisSession: new Set(),
					recurrenceCount: 0,
					confidenceFloor: 0.6,
				},
			),
		).toBe(true);
		expect(QualityGate.canInject.toString().includes("canInjectVerdict")).toBe(
			true,
		);
	});

	it("the counter increments in live mode; the dry run (kevin_trace) leaves it untouched", () => {
		const service = makeService(mem(0.3));
		const live = new ContextInjector(service, metrics);
		liveTransform(service, live);
		expect(metrics.blockedSnapshot().confidence).toBe(1);

		// A fresh injector, plan() only — the read-only path must not
		// move the counter (D5-08).
		const service2 = makeService(mem(0.3));
		const dry = new ContextInjector(service2, metrics);
		const plan = dry.plan("fix typecheck", { sessionId: "s-dry" });
		expect(plan.blocked.some((b) => b.reason === "low_confidence")).toBe(true);
		expect(metrics.blockedSnapshot().confidence).toBe(1);
	});

	it("blockedSnapshot().confidence reflects the counter after a live block", () => {
		const service = makeService(mem(0.3));
		const injector = new ContextInjector(service, metrics);
		liveTransform(service, injector);
		expect(metrics.blockedSnapshot()).toMatchObject({
			confidence: 1,
		});
		expect(metrics.get("injections_blocked_confidence")).toBe(1);
	});
});

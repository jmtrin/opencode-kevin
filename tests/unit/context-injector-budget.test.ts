import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextInjector } from "../../plugin/ContextInjector.js";
import type { Memory, MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

function mem(): Memory {
	return {
		id: "mem-1",
		type: "error",
		content: "When bash fails with typecheck: Verify types and imports.",
		scope: "project",
		relevanceScore: 0.8,
		createdAt: "2026-01-01 00:00:00",
		updatedAt: "2026-01-01 00:00:00",
		status: "active",
		fingerprint: "fp-1",
	} as Memory;
}

function makeInjector(
	budgetValue: string | null,
	metrics?: Metrics,
): {
	injector: ContextInjector;
	service: MemoryService;
} {
	const service = {
		getRelevant: vi.fn(() => [mem()]),
		bumpRelevance: vi.fn(),
		// null = the key is absent from kevin_settings → fallback path.
		getSetting: vi.fn((key: string, fallback?: string) =>
			key === "pre_prompt_budget_tokens"
				? (budgetValue ?? fallback ?? "400")
				: (fallback ?? "1"),
		),
	} as unknown as MemoryService;
	return {
		injector: new ContextInjector(service, metrics ?? null),
		service,
	};
}

function transformCap(injector: ContextInjector): number {
	const service = (injector as unknown as { memoryService: MemoryService })
		.memoryService;
	const calls: unknown[] = [];
	(service.getRelevant as ReturnType<typeof vi.fn>).mockImplementation(
		(input: { maxTokens: number }) => {
			calls.push(input.maxTokens);
			return [mem()];
		},
	);
	const output = { system: [] as string[] };
	injector.onSystemTransform(
		{ messages: [{ role: "user", content: "fix typecheck error" }] },
		output,
	);
	return calls[0] as number;
}

function transformOnce(injector: ContextInjector): {
	service: MemoryService;
	output: { system: string[] };
} {
	const service = (injector as unknown as { memoryService: MemoryService })
		.memoryService;
	const output = { system: [] as string[] };
	injector.onSystemTransform(
		{ messages: [{ role: "user", content: "fix typecheck error" }] },
		output,
	);
	return { service, output };
}

let store: Store;
let metrics: Metrics;

beforeEach(() => {
	store = new Store({ path: ":memory:" });
	metrics = new Metrics(store);
});

describe("K6-021 — push budget 900 → 400; clamp [0, 4000]; 0 means off (D5-11)", () => {
	it("with no setting present the effective cap is 400", () => {
		const { injector, service } = makeInjector(null);
		expect(service.getSetting("pre_prompt_budget_tokens", "400")).toBe("400");
		expect(transformCap(injector)).toBe(400);
	});

	it("setting '1500' restores exactly the v0.4.0 behaviour", () => {
		const { injector } = makeInjector("1500");
		expect(transformCap(injector)).toBe(1500);
	});

	it("'99999' clamps to 4000; 'abc' falls back to 400", () => {
		expect(transformCap(makeInjector("99999").injector)).toBe(4000);
		expect(transformCap(makeInjector("abc").injector)).toBe(400);
	});

	it("cap 0 is off: retrieval never runs and no injections_* metric moves", () => {
		const { injector, service } = makeInjector("0", metrics);
		const { output } = transformOnce(injector);
		expect(output.system).toEqual([]);
		expect(service.getRelevant).not.toHaveBeenCalled();
		const snapshot = metrics.snapshot();
		expect(snapshot.tokens_injected_pre_prompt).toBe(0);
		expect(snapshot.injections_total).toBe(0);
		expect(snapshot.injections_blocked_seen).toBe(0);
		expect(snapshot.injections_blocked_confidence).toBe(0);
	});

	it("a user override of '1200' still reads 1200", () => {
		const { injector } = makeInjector("1200");
		expect(transformCap(injector)).toBe(1200);
	});

	it("the compacting cap remains 2000 and still injects even with budget '0'", () => {
		const { injector } = makeInjector("0");
		const output = { context: [] as string[] };
		injector.onCompacting(
			{
				sessionID: "s-1",
				messages: [{ role: "user", content: "fix typecheck" }],
			},
			output,
		);
		const service = (injector as unknown as { memoryService: MemoryService })
			.memoryService;
		const calls = (service.getRelevant as ReturnType<typeof vi.fn>).mock
			.calls as [{ maxTokens: number }][];
		expect(calls[0][0].maxTokens).toBe(2000);
		expect(output.context.length).toBeGreaterThan(0);
	});

	it("plan() without cap reports the effective cap (kevin_trace contract)", () => {
		const { injector } = makeInjector("1500");
		const plan = injector.plan("fix typecheck error", { sessionId: "s-1" });
		expect(plan.cap).toBe(1500);
		const planDefault = makeInjector(null).injector.plan("x", {
			sessionId: "s-1",
		});
		expect(planDefault.cap).toBe(400);
	});
});

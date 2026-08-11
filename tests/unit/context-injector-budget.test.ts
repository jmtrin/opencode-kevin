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

function makeInjector(budgetValue: string | null): {
	injector: ContextInjector;
	service: MemoryService;
} {
	const service = {
		getRelevant: vi.fn(() => [mem()]),
		bumpRelevance: vi.fn(),
		// null = the key is absent from kevin_settings → fallback path.
		getSetting: vi.fn((key: string, fallback?: string) =>
			key === "pre_prompt_budget_tokens"
				? (budgetValue ?? fallback ?? "900")
				: (fallback ?? "1"),
		),
	} as unknown as MemoryService;
	return { injector: new ContextInjector(service), service };
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

let store: Store;
let metrics: Metrics;

beforeEach(() => {
	store = new Store({ path: ":memory:" });
	metrics = new Metrics(store);
});

describe("K5-017 — configurable pre-prompt budget (D5-11)", () => {
	it("with no setting present the effective cap is 900", () => {
		const { injector, service } = makeInjector(null);
		expect(service.getSetting("pre_prompt_budget_tokens", "900")).toBe("900");
		expect(transformCap(injector)).toBe(900);
	});

	it("setting '1500' restores exactly the v0.4.0 behaviour", () => {
		const { injector } = makeInjector("1500");
		expect(transformCap(injector)).toBe(1500);
	});

	it("'50' clamps to 100; '99999' clamps to 4000; 'abc' falls back to 900", () => {
		expect(transformCap(makeInjector("50").injector)).toBe(100);
		expect(transformCap(makeInjector("99999").injector)).toBe(4000);
		expect(transformCap(makeInjector("abc").injector)).toBe(900);
	});

	it("the compacting cap remains 2000 regardless of the setting", () => {
		const { injector } = makeInjector("50");
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
	});

	it("plan() without cap reports the effective cap (kevin_trace contract)", () => {
		const { injector } = makeInjector("1500");
		const plan = injector.plan("fix typecheck error", { sessionId: "s-1" });
		expect(plan.cap).toBe(1500);
		const planDefault = makeInjector(null).injector.plan("x", {
			sessionId: "s-1",
		});
		expect(planDefault.cap).toBe(900);
	});
});

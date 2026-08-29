import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextInjector } from "@jmtrin/kevin-core";
import { InjectionLedger } from "@jmtrin/kevin-core";
import type { Memory, MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages/core/migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

let store: Store;
let metrics: Metrics;
let ledger: InjectionLedger;

function mem(over: Partial<Memory> = {}): Memory {
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
		...over,
	} as Memory;
}

function makeInjector(returned: Memory[]): ContextInjector {
	const service = {
		getRelevant: vi.fn(() => returned),
		bumpRelevance: vi.fn(),
		getSetting: vi.fn((key: string, fallback?: string) =>
			key === "pre_prompt_budget_tokens" ? "900" : (fallback ?? "1"),
		),
	} as unknown as MemoryService;
	return new ContextInjector(service, metrics, ledger);
}

function injectOnce(injector: ContextInjector): void {
	const output = { system: [] as string[] };
	injector.onSystemTransform(
		{
			sessionID: "s-1",
			messages: [{ role: "user", content: "fix typecheck error" }],
		},
		output,
	);
}

beforeEach(() => {
	store = new Store({ path: ":memory:" });
	for (const name of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
	]) {
		store.exec(sql(name));
	}
	metrics = new Metrics(store);
	ledger = new InjectionLedger(store, metrics);
});

describe("K5-014 — ContextInjector.plan() read-only prediction (D5-08)", () => {
	it("plan() reports what WOULD be injected without injecting", () => {
		const injector = makeInjector([mem()]);
		const plan = injector.plan("fix typecheck error", { sessionId: "s-1" });
		expect(plan.would_inject).toBe(true);
		expect(plan.admitted).toHaveLength(1);
		expect(plan.admitted[0]).toMatchObject({
			id: "mem-1",
			decision: "admitted",
		});
		expect(plan.blocked).toHaveLength(0);
		expect(plan.total_tokens).toBeGreaterThan(0);
		// Nothing was injected: no ledger rows, no token counter.
		expect(metrics.get("injections_total")).toBe(0);
		expect(metrics.get("tokens_injected_pre_prompt")).toBe(0);
	});

	it("plan() is a strict read: repeated plans never touch the seen-set", () => {
		const injector = makeInjector([mem()]);
		injector.plan("fix typecheck error", { sessionId: "s-1" });
		injector.plan("fix typecheck error", { sessionId: "s-1" });
		// The FIRST real injection still admits the memory: plan() never
		// marked it as seen.
		injectOnce(injector);
		expect(metrics.get("injections_blocked_seen")).toBe(0);
		expect(metrics.get("injections_total")).toBe(1);
	});

	it("plan() never bumps relevance scores", () => {
		const injector = makeInjector([mem()]);
		injector.plan("fix typecheck error", { sessionId: "s-1" });
		expect(
			(injector as unknown as { memoryService: MemoryService }).memoryService
				.bumpRelevance,
		).not.toHaveBeenCalled();
	});

	it("plan() classifies a gate rejection with its reason, counters untouched", () => {
		const injector = makeInjector([mem({ status: "stale" })]);
		const plan = injector.plan("fix typecheck error", { sessionId: "s-1" });
		expect(plan.would_inject).toBe(false);
		expect(plan.admitted).toHaveLength(0);
		expect(plan.blocked).toHaveLength(1);
		expect(plan.blocked[0]).toMatchObject({
			id: "mem-1",
			decision: "blocked",
			reason: "not_active",
		});
		expect(plan.total_tokens).toBe(0);
		// Dry prediction must not move the blocked counter; the real path
		// still counts the same rejection afterwards.
		expect(metrics.get("injections_blocked_stale")).toBe(0);
		injectOnce(injector);
		expect(metrics.get("injections_blocked_stale")).toBe(1);
	});

	it("plan() on a real MemoryService leaves scores and counters untouched", () => {
		const realSvc = {
			getRelevant: vi.fn(() => [mem()]),
			bumpRelevance: vi.fn(),
			getSetting: vi.fn((key: string, fallback?: string) =>
				key === "pre_prompt_budget_tokens" ? "900" : (fallback ?? "1"),
			),
		} as unknown as MemoryService;
		const injector = new ContextInjector(realSvc, metrics, ledger);
		const before = metrics.blockedSnapshot();
		injector.plan("anything", { sessionId: "s-9" });
		expect(metrics.blockedSnapshot()).toEqual(before);
		expect(realSvc.bumpRelevance).not.toHaveBeenCalled();
	});

	it("plan() honours tag and cap options", () => {
		const injector = makeInjector([mem()]);
		const compacting = injector.plan("fix typecheck error", {
			tag: "memory",
			cap: 2000,
			sessionId: "s-1",
		});
		expect(compacting.tag).toBe("memory");
		expect(compacting.cap).toBe(2000);
		const context = injector.plan("fix typecheck error");
		expect(context.tag).toBe("context");
		expect(context.cap).toBe(900);
	});

	it("plan() with nothing relevant returns would_inject=false", () => {
		const injector = makeInjector([]);
		const plan = injector.plan("nothing matches", { sessionId: "s-1" });
		expect(plan.would_inject).toBe(false);
		expect(plan.admitted).toHaveLength(0);
		expect(plan.total_tokens).toBe(0);
	});
});

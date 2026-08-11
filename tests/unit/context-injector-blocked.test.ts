import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextInjector } from "../../plugin/ContextInjector.js";
import { InjectionLedger } from "../../plugin/InjectionLedger.js";
import type { Memory, MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(__dirname, "..", "..", "migrations", "006_v05_glassbox.sql"),
	"utf8",
);

let tmpRoot: string;
let store: Store;
let metrics: Metrics;
let ledger: InjectionLedger;

// K5-009 exposes `ignored` on Memory via mapRow; fixtures pass it directly.
function mem(over: Partial<Memory>): Memory {
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

function makeInjector(returned: Memory[], settingValue = "1"): ContextInjector {
	const service = {
		getRelevant: vi.fn(() => returned),
		bumpRelevance: vi.fn(),
		getSetting: vi.fn(() => settingValue),
	} as unknown as MemoryService;
	return new ContextInjector(service, metrics, ledger);
}

function injectOne(injector: ContextInjector, dryRun = false): void {
	// inject() is private; drive it through the production entry point, or
	// through the private method directly when exercising dry-run mode.
	if (dryRun) {
		const priv = injector as unknown as {
			inject(
				query: string,
				tag: "context",
				cap: number,
				metricKey: string,
				sessionId: string,
				dryRun: boolean,
			): string;
		};
		priv.inject(
			"fix typecheck error",
			"context",
			1500,
			"tokens_injected_pre_prompt",
			"s-1",
			true,
		);
		return;
	}
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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-blocked-"));
	store = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006]) {
		store.exec(sql);
	}
	metrics = new Metrics(store);
	ledger = new InjectionLedger(store, metrics);
});

afterEach(() => {
	metrics.close();
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K5-007 — injections_blocked_* counters (D5-04/D5-08)", () => {
	it("injecting the same memory twice increments injections_blocked_seen by exactly 1", () => {
		const injector = makeInjector([mem({})]);
		injectOne(injector);
		expect(metrics.get("injections_blocked_seen")).toBe(0);
		injectOne(injector);
		expect(metrics.get("injections_blocked_seen")).toBe(1);
		expect(metrics.get("injections_total")).toBe(1);
	});

	it("a memory with status='stale' increments injections_blocked_stale", () => {
		const injector = makeInjector([mem({ status: "stale" })]);
		injectOne(injector);
		expect(metrics.get("injections_blocked_stale")).toBe(1);
	});

	it("a weak non-actionable memory increments injections_blocked_weak", () => {
		// Generic fallback suggestion + no dispatched code → weak (BUG-005).
		const injector = makeInjector([
			mem({
				content:
					"When bash fails with unknown: Review the error output for details.\nSuggestion: Review the error output for details.",
			}),
		]);
		injectOne(injector);
		expect(metrics.get("injections_blocked_weak")).toBe(1);
	});

	it("a memory with ignored=1 increments injections_blocked_ignored", () => {
		const injector = makeInjector([mem({ ignored: true })]);
		injectOne(injector);
		expect(metrics.get("injections_blocked_ignored")).toBe(1);
	});

	it("recurrenceCount > 0 increments injections_blocked_recurrence", () => {
		// A real failing tool_call for the fingerprint after an injection
		// makes postInjectionRecurrencesFor return a non-zero count.
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, injected_at, outcome) VALUES ('i1', 'mem-1', 'fp-1', 's-1', 'pre_prompt', 10, '2026-08-08 10:00:00', 'unmeasured')",
			)
			.run();
		store
			.prepare(
				"INSERT INTO tool_calls (id, session_id, ts, tool, success, error_fingerprint) VALUES ('tc-1', 's-1', '2026-08-08 10:01:00', 'bash', 0, 'fp-1')",
			)
			.run();
		const injector = makeInjector([mem({})]);
		injectOne(injector);
		expect(metrics.get("injections_blocked_recurrence")).toBe(1);
	});

	it("an admitted memory increments none of the five", () => {
		const injector = makeInjector([mem({})]);
		injectOne(injector);
		const blocked = metrics.blockedSnapshot();
		expect(blocked).toEqual({
			seen: 0,
			weak: 0,
			recurrence: 0,
			stale: 0,
			ignored: 0,
		});
	});

	it("dry-run mode increments none of the five (D5-08)", () => {
		// A stale memory would be blocked; a second pass would be blocked as
		// seen. Neither may move a counter when dryRun=true.
		const injector = makeInjector([mem({ status: "stale" })]);
		injectOne(injector, true);
		injectOne(injector, true);
		expect(metrics.blockedSnapshot()).toEqual({
			seen: 0,
			weak: 0,
			recurrence: 0,
			stale: 0,
			ignored: 0,
		});
		// The real (non-dry) path still counts the same rejection.
		injectOne(injector);
		expect(metrics.get("injections_blocked_stale")).toBe(1);
	});
});

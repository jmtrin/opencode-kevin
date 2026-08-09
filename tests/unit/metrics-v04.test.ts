import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function makeStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(sql("001_initial.sql"));
	store.exec(sql("003_v02_signal.sql"));
	store.exec(sql("004_v03_knowledge.sql"));
	store.exec(sql("005_v04_signal.sql"));
	return store;
}

describe("K4-008 — v0.4.0 metrics + precision_rate", () => {
	it("seeds the four new metric keys at 0", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		const snap = metrics.snapshot();
		expect(snap.injections_total).toBe(0);
		expect(snap.injections_effective).toBe(0);
		expect(snap.injections_ineffective).toBe(0);
		expect(snap.patterns_promoted_new).toBe(0);
		store.close();
	});

	it("precisionRate() is 0 when the ledger is empty", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		expect(metrics.precisionRate()).toBe(0);
		store.close();
	});

	it("precisionRate() is 1.0 when all injections are effective", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		metrics.incr("injections_total", 2);
		metrics.incr("injections_effective", 2);
		expect(metrics.precisionRate()).toBe(1);
		store.close();
	});

	it("precisionRate() is 0.5 for 1 effective of 2 total", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		metrics.incr("injections_total", 2);
		metrics.incr("injections_effective", 1);
		metrics.incr("injections_ineffective", 1);
		expect(metrics.precisionRate()).toBeCloseTo(0.5);
		store.close();
	});

	it("precisionRate() never exceeds 1 even if effective > total", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		metrics.incr("injections_total", 1);
		metrics.incr("injections_effective", 3);
		expect(metrics.precisionRate()).toBe(1);
		store.close();
	});

	it("precisionRate() is computed from cached counters without flushing", () => {
		const store = makeStore();
		const metrics = new Metrics(store);
		metrics.incr("injections_total", 4);
		metrics.incr("injections_effective", 2);
		expect(metrics.isFlushScheduled()).toBe(true);
		expect(metrics.precisionRate()).toBeCloseTo(0.5);
		// No flush → DB rows untouched.
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'injections_total'")
			.get() as { value: number } | undefined;
		expect(row?.value ?? 0).toBe(0);
		store.close();
	});
});

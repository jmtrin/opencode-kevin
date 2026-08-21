// v1.0.0 (K10-010 / plan §5.2) — measuring the cost.
import type { Store } from "./Store.js";

export type PerfScope =
	| "tool.execute.before"
	| "tool.execute.after"
	| "chat.message"
	| "chat.system.transform"
	| "session.compacting"
	| "event"
	| "session.idle"
	| "dispose";

export interface Budget {
	readonly scope: PerfScope;
	readonly p95Ms: number;
	readonly maxMs: number;
}

export const BUDGETS: readonly Budget[] = [
	{ scope: "tool.execute.before", p95Ms: 2, maxMs: 10 },
	{ scope: "tool.execute.after", p95Ms: 5, maxMs: 25 },
	{ scope: "chat.message", p95Ms: 2, maxMs: 10 },
	{ scope: "chat.system.transform", p95Ms: 15, maxMs: 50 },
	{ scope: "session.compacting", p95Ms: 15, maxMs: 50 },
	{ scope: "event", p95Ms: 5, maxMs: 25 },
	{ scope: "session.idle", p95Ms: 150, maxMs: 600 },
	{ scope: "dispose", p95Ms: 50, maxMs: 250 },
] as const;

export interface PerfStat {
	readonly scope: PerfScope;
	readonly count: number;
	readonly p50: number;
	readonly p95: number;
	readonly max: number;
	readonly budget: Budget;
	readonly withinBudget: boolean;
}

function clampCapacity(raw: string | null | undefined): number {
	if (raw === null || raw === undefined || raw === "") return 512;
	const n = Number.parseInt(raw, 10);
	if (Number.isNaN(n)) return 512;
	return Math.min(8192, Math.max(64, n));
}

export class Perf {
	private readonly enabled: boolean;
	private readonly capacity: number;
	private readonly rings: Map<PerfScope, Float64Array>;
	private readonly cursors: Map<PerfScope, number>;
	private readonly counts: Map<PerfScope, number>;

	constructor(opts: { enabled: boolean; capacity?: number | string }) {
		this.enabled = opts.enabled;
		if (typeof opts.capacity === "string") {
			this.capacity = clampCapacity(opts.capacity);
		} else if (typeof opts.capacity === "number") {
			this.capacity = Math.min(8192, Math.max(64, Math.floor(opts.capacity)));
		} else {
			this.capacity = 512;
		}
		this.rings = new Map();
		this.cursors = new Map();
		this.counts = new Map();
		const scopes: PerfScope[] = BUDGETS.map((b) => b.scope);
		for (const s of scopes) {
			this.rings.set(s, new Float64Array(this.capacity));
			this.cursors.set(s, 0);
			this.counts.set(s, 0);
		}
	}

	static fromSettings(
		settings: Record<string, string | null | undefined>,
	): Perf {
		const enabled = settings.perf_enabled === "1";
		const cap = clampCapacity(
			settings.perf_ring_capacity as string | undefined,
		);
		return new Perf({ enabled, capacity: cap });
	}

	measure<T>(scope: PerfScope, fn: () => T): T {
		if (!this.enabled) return fn();
		const start = performance.now();
		try {
			return fn();
		} finally {
			const dur = performance.now() - start;
			this.record(scope, dur);
		}
	}

	async measureAsync<T>(scope: PerfScope, fn: () => Promise<T>): Promise<T> {
		if (!this.enabled) return fn();
		const start = performance.now();
		try {
			return await fn();
		} finally {
			const dur = performance.now() - start;
			this.record(scope, dur);
		}
	}

	private record(scope: PerfScope, ms: number): void {
		const ring = this.rings.get(scope);
		if (!ring) return;
		const cur = this.cursors.get(scope) ?? 0;
		ring[cur % this.capacity] = ms;
		this.cursors.set(scope, (cur + 1) % this.capacity);
		this.counts.set(scope, (this.counts.get(scope) ?? 0) + 1);
	}

	stats(): readonly PerfStat[] {
		const out: PerfStat[] = [];
		for (const b of BUDGETS) {
			const ring = this.rings.get(b.scope);
			if (!ring) continue;
			const count = this.counts.get(b.scope) ?? 0;
			if (count === 0) {
				out.push({
					scope: b.scope,
					count: 0,
					p50: 0,
					p95: 0,
					max: 0,
					budget: b,
					withinBudget: true,
				});
				continue;
			}
			const n = Math.min(count, this.capacity);
			// Copy live samples: need to reconstruct in insertion order but for percentiles order doesn't matter.
			// Take last n entries from ring (wrap-aware).
			const samples: number[] = [];
			const cur = this.cursors.get(b.scope) ?? 0;
			// If count < capacity, samples are ring[0..count-1]; else ring[0..capacity-1] all valid but order is cur..cur+cap
			if (count < this.capacity) {
				for (let i = 0; i < count; i++) samples.push(ring[i]);
			} else {
				for (let i = 0; i < this.capacity; i++) samples.push(ring[i]);
			}
			const sorted = [...samples].sort((a, b) => a - b);
			// Percentile method: nearest-rank — p is the value at index ceil(p/100 * n) - 1
			// of the ascending-sorted copy. Stated here so an implementer comparing against
			// another percentile definition can see which one was chosen.
			const p50 = sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)];
			const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
			const max = sorted[sorted.length - 1];
			out.push({
				scope: b.scope,
				count,
				p50,
				p95,
				max,
				budget: b,
				withinBudget: p95 <= b.p95Ms,
			});
		}
		return out;
	}

	flush(store: Store): void {
		if (!this.enabled) return;
		const stats = this.stats();
		let recorded = 0;
		let breaches = 0;
		for (const s of stats) {
			if (s.count === 0) continue;
			store
				.prepare(
					"INSERT INTO perf_samples (scope, sample_count, p50_ms, p95_ms, max_ms, budget_p95_ms, within_budget) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					s.scope,
					s.count,
					s.p50,
					s.p95,
					s.max,
					s.budget.p95Ms,
					s.withinBudget ? 1 : 0,
				);
			recorded++;
			if (!s.withinBudget) breaches++;
		}
		if (recorded > 0) {
			store
				.prepare(
					`UPDATE kevin_metrics SET value = value + ? WHERE key = 'perf_samples_recorded'`,
				)
				.run(recorded);
		}
		if (breaches > 0) {
			store
				.prepare(
					`UPDATE kevin_metrics SET value = value + ? WHERE key = 'perf_budget_breaches'`,
				)
				.run(breaches);
		}
		this.reset();
	}

	reset(): void {
		for (const b of BUDGETS) {
			// Zero the ring too: cursors and counts alone would let the next
			// period's stats() read stale pre-reset samples whenever
			// count < capacity (review fix, v1.0.0).
			this.rings.get(b.scope)?.fill(0);
			this.cursors.set(b.scope, 0);
			this.counts.set(b.scope, 0);
		}
	}
}

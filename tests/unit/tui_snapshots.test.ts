import { readFileSync, readdirSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import { flushSnapshots } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

describe("K12-003 — flushSnapshots writer", () => {
	it("writes 4 files valid JSON, re-flush replaces atomically, truncation fits cap, counter increments", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-snap-"));
		const health = {
			verdict: "healthy",
			reason: "ok",
			hooks: [
				{
					hook: "tool.execute.before",
					state: "live",
					fire_count: 1,
					expected_count: 1,
				},
			],
			perf: [
				{
					scope: "tool.execute.before",
					p95: 1,
					budget_p95: 2,
					within_budget: true,
				},
			],
			contract_digest: "abc123",
			counters: { a: 1 },
		};
		const proposals = [
			{
				id: "p1",
				kind: "agents_md",
				target_path: "AGENTS.md",
				diff: "diff --git a/AGENTS.md\n+hello",
				memory_ids: ["m1"],
				created_at: new Date().toISOString(),
			},
		];
		const conflicts: never[] = [];
		const store = new Store({ path: ":memory:" });
		const metrics = new Metrics(store, 0);

		const res1 = flushSnapshots({
			root,
			proposals,
			conflicts,
			health,
			metrics,
		});
		expect(res1.written).toEqual([
			"proposals.json",
			"conflicts.json",
			"health.json",
			"meta.json",
		]);
		// No .tmp leftovers
		const tuiDir = join(root, "tui");
		const files = readdirSync(tuiDir) as string[];
		expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
		// Valid JSON
		for (const name of res1.written) {
			const raw = readFileSync(join(tuiDir, name), "utf8");
			expect(() => JSON.parse(raw)).not.toThrow();
		}
		metrics.flush();
		let row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='tui_snapshots_flushed'",
			)
			.get() as { value: number } | undefined;
		expect(row?.value).toBe(1);

		// Re-flush replaces atomically
		const res2 = flushSnapshots({
			root,
			proposals,
			conflicts,
			health,
			metrics,
		});
		expect(res2.written.length).toBe(4);
		metrics.flush();
		row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='tui_snapshots_flushed'",
			)
			.get() as { value: number } | undefined;
		expect(row?.value).toBe(2);

		// Truncation path: huge diff
		const huge = "x".repeat(700 * 1024);
		const bigProposals = [
			{
				id: "p-big",
				kind: "agents_md",
				target_path: "AGENTS.md",
				diff: huge,
				memory_ids: ["m2"],
				created_at: new Date().toISOString(),
			},
		];
		flushSnapshots({
			root,
			proposals: bigProposals,
			conflicts,
			health,
			metrics,
		});
		metrics.flush();
		const raw = readFileSync(join(tuiDir, "proposals.json"), "utf8");
		const parsed = JSON.parse(raw) as Array<{
			truncated?: boolean;
			diff: string;
		}>;
		expect(parsed[0].truncated).toBe(true);
		expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(512 * 1024);
		row = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key='tui_snapshots_flushed'",
			)
			.get() as { value: number } | undefined;
		expect(row?.value).toBe(3);

		rmSync(root, { recursive: true, force: true });
		store.close();
	});
});

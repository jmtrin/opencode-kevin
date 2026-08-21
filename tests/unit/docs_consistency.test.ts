/**
 * K10-025 — cross-version consistency pass v0.5.0 → v1.0.0.
 *
 * The six release document sets drift independently; this test parses them
 * instead of trusting a manual review. Four checks:
 *   1. the cumulative ladders recorded in the Roadmap are exact and monotone;
 *   2. every DN-NN decision referenced by a Task exists in a Plan of its
 *      own or an earlier release (decisions accumulate forward);
 *   3. every K N-NNN task id named in a Plan's task section exists in the
 *      paired Task document, and Task §1 phase totals equal the stanza count;
 *   4. the superseded v0.5.0 Suggest files stay deleted.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS = join(process.cwd(), "docs");

function doc(name: string): string {
	return readFileSync(join(DOCS, name), "utf8");
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
	["Kevin_Plan.md", "Kevin_Task.md"],
	["Kevin_v0.4.0_Plan.md", "Kevin_v0.4.0_Task.md"],
	["Kevin_v0.5.0_Plan.md", "Kevin_v0.5.0_Task.md"],
	["Kevin_v0.6.0_Plan.md", "Kevin_v0.6.0_Task.md"],
	["Kevin_v0.7.0_Plan.md", "Kevin_v0.7.0_Task.md"],
	["Kevin_v0.8.0_Plan.md", "Kevin_v0.8.0_Task.md"],
	["Kevin_v0.9.0_Plan.md", "Kevin_v0.9.0_Task.md"],
	["Kevin_v1.0.0_Plan.md", "Kevin_v1.0.0_Task.md"],
];

const LADDER_TOOLS = [10, 13, 16, 18, 21, 23, 25];
const LADDER_METRICS = [13, 22, 28, 33, 39, 45, 51];
const LADDER_SETTINGS = [6, 9, 14, 18, 23, 27, 31];

describe("K10-025 — cross-version consistency pass", () => {
	it("the Roadmap cumulative ladders are monotone with the declared values", () => {
		const t = doc("Kevin_Roadmap.md");
		const i = t.indexOf("**Cumulative ladders**");
		expect(i).toBeGreaterThan(-1);
		const block = t.slice(i, i + 600);
		const grab = (label: string): number[] => {
			const m = block.match(new RegExp(`${label} ([\\d\\s→]+)`));
			expect(m, `ladder for ${label}`).toBeTruthy();
			return (m?.[1] ?? "")
				.split("→")
				.map((s) => Number.parseInt(s.trim(), 10))
				.filter((n) => !Number.isNaN(n));
		};
		const monotone = (l: number[]): boolean =>
			l.every((v, idx) => idx === 0 || v > l[idx - 1]);
		const tools = grab("tools");
		const metrics = grab("metric keys");
		const settings = grab("setting keys");
		expect(tools).toEqual(LADDER_TOOLS);
		expect(metrics).toEqual(LADDER_METRICS);
		expect(settings).toEqual(LADDER_SETTINGS);
		expect(monotone(tools)).toBe(true);
		expect(monotone(metrics)).toBe(true);
		expect(monotone(settings)).toBe(true);
		// The last rung must match the shipped surface, not the prose.
		expect(tools.at(-1)).toBe(25);
		expect(metrics.at(-1)).toBe(51);
		expect(settings.at(-1)).toBe(31);
		// Migrations ladder and principles range as declared.
		expect(t).toMatch(/migrations `00\d` → `011`/);
		expect(t).toMatch(/principles 1[15] → 38/);
	});

	it("every DN-NN referenced in a Task exists in its own or an earlier Plan", () => {
		for (const [plan, task] of PAIRS) {
			const idx = PAIRS.findIndex(([p]) => p === plan);
			const priorPlans = PAIRS.slice(0, idx + 1).map(([p]) => doc(p));
			const refs = new Set(doc(task).match(/\bD\d+-\d{2}\b/g) ?? []);
			for (const ref of refs) {
				const known = priorPlans.some((p) => p.includes(ref));
				expect(
					known,
					`${task} references ${ref} but no Plan up to ${plan} defines it`,
				).toBe(true);
			}
		}
	});

	it("every task id in a Plan's §9 exists in the paired Task, and stanza counts match the summary table", () => {
		for (const [plan, task] of PAIRS) {
			const planText = doc(plan);
			const taskText = doc(task);
			// A Plan's task section may cross-reference earlier releases'
			// ids in prose; only the ids of THIS release must have stanzas.
			const rel = plan.match(/v0\.(\d+)\./);
			const prefix = rel ? `K${rel[1]}-` : "K2-";
			const sec = planText.search(/^## 9\. /m);
			if (sec !== -1) {
				const ids = new Set(
					(planText.slice(sec).match(/\bK\d+-\d{3}\b/g) ?? []).filter((id) =>
						id.startsWith(prefix),
					),
				);
				for (const id of ids) {
					expect(
						taskText.includes(id),
						`${plan} §9 names ${id} but ${task} has no such stanza`,
					).toBe(true);
				}
			}
			// Task §1 summary table rows vs ### stanzas — one duplicate id
			// is allowed for the Status Legend example. Earlier Task
			// documents (v0.4.0 era) have no summary table; they organize
			// by phase headings instead, so the check only applies when
			// the table exists.
			const summaryRows = (taskText.match(/\| K\d+-\d{3} \|[^\n]*\|\n/g) ?? [])
				.length;
			if (summaryRows === 0) continue;
			const stanzas = (taskText.match(/^### K\d+-\d{3} /gm) ?? []).length;
			expect(
				stanzas === summaryRows || stanzas === summaryRows + 1,
				`${task}: ${stanzas} stanzas vs ${summaryRows} summary rows`,
			).toBe(true);
		}
	});

	it("the superseded v0.5.0 Suggest documents stay deleted", () => {
		expect(existsSync(join(DOCS, "Kevin_v0.5.0_Suggest_Plan.md"))).toBe(false);
		expect(existsSync(join(DOCS, "Kevin_v0.5.0_Suggest_Task.md"))).toBe(false);
	});

	it("no orphaned release documents: every Plan has a Task pair where both exist", () => {
		const files = readdirSync(DOCS);
		const plans = files.filter((f) => f.endsWith("_Plan.md"));
		for (const p of plans) {
			const task = p.replace("_Plan.md", "_Task.md");
			// Kevin_v0.3.0_Plan.md predates per-release Task documents.
			if (p === "Kevin_v0.3.0_Plan.md") continue;
			expect(files, `${p} lacks ${task}`).toContain(task);
		}
	});
});

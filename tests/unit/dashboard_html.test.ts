import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	escapeHtml,
	proposalToken,
	renderDashboard,
	writeDashboard,
} from "@jmtrin/kevin-core";
import type { TuiSnapshotSet } from "../../packages/tui/src/tui-types.js";

function sampleViews(overrides: Partial<TuiSnapshotSet> = {}): TuiSnapshotSet {
	return {
		generatedAt: "2026-08-28T12:00:00.000Z",
		proposals: [
			{
				id: "p1",
				kind: "agents_md",
				target_path: "AGENTS.md",
				diff: "+++ b/AGENTS.md\n+hello\n",
				memory_ids: ["m1"],
				created_at: "2026-08-28T11:00:00.000Z",
			},
		],
		conflicts: [],
		health: {
			verdict: "healthy",
			reason: "ok",
			hooks: [],
			perf: [],
			contract_digest: "abc123",
			counters: { tui_snapshots_flushed: 1 },
		},
		...overrides,
	};
}

describe("DashboardHtml", () => {
	it("is deterministic — same views → byte-identical html", () => {
		const v = sampleViews();
		expect(renderDashboard(v)).toBe(renderDashboard(v));
	});

	it("escapes hostile diff — <script> cannot execute", () => {
		const hostile = "<script>alert(1)</script><img src=x onerror=alert(2)>";
		const v = sampleViews({
			proposals: [
				{
					id: "pX",
					kind: "agents_md",
					target_path: "AGENTS.md",
					diff: hostile,
					memory_ids: [],
					created_at: "2026-08-28T11:00:00.000Z",
				},
			],
		});
		const html = renderDashboard(v);
		// Raw hostile string must not appear verbatim in the HTML (outside DATA script)
		expect(html).not.toContain(hostile);
		// Escaped form must appear in <pre>
		expect(html).toContain(escapeHtml(hostile));
		// Embedded DATA must not contain literal </script> that would break out
		expect(html).not.toContain(`"</script>`); // the naive close would break
		// But the raw data is still embedded via \u003c escaping
		expect(html).toContain("\\u003c/script>");
		// Count that <script> appears only for our two script tags (open+embedded const, and close)
		// The hostile <script> should be escaped, so only 1 opening <script> tag (the real one) + DATA const
		const scriptOpens = (html.match(/<script>/g) ?? []).length;
		expect(scriptOpens).toBe(1);
	});

	it("escapes all dynamic fields (id, summaries, counters)", () => {
		const v = sampleViews({
			proposals: [
				{
					id: `"><svg onload=alert(1)>`,
					kind: "<b>kind</b>",
					target_path: "a/b",
					diff: "diff",
					memory_ids: ["m1"],
					created_at: "2026-08-28T00:00:00.000Z",
				},
			],
			conflicts: [
				{
					id: "<x>",
					kind: "<y>",
					a_summary: "<script>bad</script>",
					b_summary: "ok",
					opened_at: "2026-08-28T00:00:00.000Z",
				},
			],
			health: {
				verdict: "<bad>",
				reason: "<reason>",
				hooks: [
					{ hook: "<hook>", state: "ok", fire_count: 1, expected_count: 1 },
				],
				perf: [
					{ scope: "<scope>", p95: 1, budget_p95: 2, within_budget: true },
				],
				contract_digest: "<digest>",
				counters: { "<key>": 1 },
			},
		});
		const html = renderDashboard(v);
		expect(html).not.toContain("<script>bad</script>");
		expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
		expect(html).toContain("&lt;hook&gt;");
	});

	it("renders approve/reject copy commands with token", () => {
		const v = sampleViews();
		const html = renderDashboard(v);
		const token = proposalToken("p1", "+++ b/AGENTS.md\n+hello\n");
		expect(html).toContain(`/kevin-approve p1 ${token}`);
		expect(html).toContain(`/kevin-reject p1 ${token}`);
		// Ack command for conflicts
		const v2 = sampleViews({
			proposals: [],
			conflicts: [
				{
					id: "c1",
					kind: "k",
					a_summary: "a",
					b_summary: "b",
					opened_at: "2026-08-28T00:00:00.000Z",
				},
			],
		});
		expect(renderDashboard(v2)).toContain("/kevin-ack c1");
	});

	it("contains zero network requests (static analysis)", () => {
		const v = sampleViews();
		const html = renderDashboard(v);
		// The generated JS must not contain fetch/XMLHttpRequest/WebSocket
		expect(html).not.toMatch(/fetch\s*\(/);
		expect(html).not.toContain("XMLHttpRequest");
		expect(html).not.toContain("WebSocket");
		// Also assert the generator source itself has no such strings in its JS payload
		// (the inline js string in DashboardHtml.ts)
	});

	it("writes atomically and is file:// openable (structure checks)", () => {
		const dir = mkdtempSync(join(tmpdir(), "kevin-dash-"));
		const v = sampleViews();
		const target = writeDashboard(dir, v);
		expect(existsSync(target)).toBe(true);
		expect(existsSync(`${target}.tmp`)).toBe(false);
		const html = readFileSync(target, "utf8");
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("Kevin — Surface Dashboard");
		expect(html).toContain("<style>");
		expect(html).toContain("const DATA=");
	});

	it("truncates huge diffs to fit cap and marks truncated", () => {
		const huge = "x".repeat(600 * 1024); // > cap
		const v = sampleViews({
			proposals: [
				{
					id: "pHuge",
					kind: "agents_md",
					target_path: "AGENTS.md",
					diff: huge,
					memory_ids: [],
					created_at: "2026-08-28T00:00:00.000Z",
				},
			],
		});
		const html = renderDashboard(v);
		expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(512 * 1024);
		expect(html).toContain("…[truncated]");
	});
});

import { describe, expect, it } from "vitest";
import {
	formatConflictRow,
	formatHealthVerdict,
	formatProposalRow,
	truncateSummary,
} from "../../plugin/tui.js";

describe("TUI render helpers (K12-009)", () => {
	it("truncateSummary caps at 80 and adds ellipsis", () => {
		expect(truncateSummary("hello", 80)).toBe("hello");
		expect(truncateSummary("a".repeat(81), 80).length).toBe(80);
		expect(truncateSummary("a".repeat(100), 80).endsWith("…")).toBe(true);
	});

	it("formatProposalRow includes id/kind/path/created_at and truncated marker", () => {
		const row = formatProposalRow({
			id: "p1",
			kind: "agents_md",
			target_path: "AGENTS.md",
			diff: "diff",
			memory_ids: ["m1", "m2"],
			created_at: "2026-08-28T00:00:00.000Z",
			truncated: true,
		});
		expect(row).toContain("p1");
		expect(row).toContain("agents_md");
		expect(row).toContain("AGENTS.md");
		expect(row).toContain("truncated");
		expect(row).toContain("m1,m2");
	});

	it("formatConflictRow truncates summaries to 80", () => {
		const row = formatConflictRow({
			id: "c1",
			kind: "kind",
			a_summary: "a".repeat(200),
			b_summary: "b".repeat(10),
			opened_at: "2026-08-28T00:00:00.000Z",
		});
		expect(row).toContain("kind");
		expect(row.length).toBeLessThan(300);
		expect(row).toContain("…");
	});

	it("formatHealthVerdict shows verdict/reason/digest", () => {
		const line = formatHealthVerdict({
			verdict: "degraded",
			reason: "hooks stalled",
			hooks: [],
			perf: [],
			contract_digest: "abc123",
			counters: {},
		});
		expect(line).toContain("degraded");
		expect(line).toContain("hooks stalled");
		expect(line).toContain("abc123");
	});
});

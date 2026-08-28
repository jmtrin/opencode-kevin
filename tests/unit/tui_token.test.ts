import { describe, expect, it } from "vitest";
import { proposalToken, verifyFresh } from "../../plugin/TuiActions.js";

describe("K12-006 — token scheme + stale detection", () => {
	it("deterministic token vectors", () => {
		const t1 = proposalToken("p1", "hello");
		const t2 = proposalToken("p1", "hello");
		expect(t1).toBe(t2);
		expect(t1).toMatch(/^[0-9a-f]{16}$/);
		const t3 = proposalToken("p1", "hello ");
		expect(t1).not.toBe(t3);
		const t4 = proposalToken("p2", "hello");
		expect(t1).not.toBe(t4);
		// Known vector: sha256("p1\\0hello") first 16
		// Compute manually to ensure stability: we can assert length and hex
		expect(t1.length).toBe(16);
	});

	it("tamper yields stale_skipped", () => {
		const pending = [{ id: "p1", proposedText: "original text" }];
		const goodToken = proposalToken("p1", "original text");
		const action = {
			type: "approve" as const,
			proposalId: "p1",
			token: goodToken,
		};
		expect(verifyFresh(action, pending)).toEqual({ ok: true });
		// After text edited
		const tamperedPending = [{ id: "p1", proposedText: "edited text" }];
		expect(verifyFresh(action, tamperedPending)).toEqual({
			ok: false,
			reason: "content_changed_or_absent",
		});
	});

	it("absent id yields stale_skipped", () => {
		const pending = [{ id: "p1", proposedText: "text" }];
		const action = {
			type: "approve" as const,
			proposalId: "p2",
			token: proposalToken("p2", "text"),
		};
		expect(verifyFresh(action, pending)).toEqual({
			ok: false,
			reason: "content_changed_or_absent",
		});
		// Empty pending
		expect(verifyFresh(action, [])).toEqual({
			ok: false,
			reason: "content_changed_or_absent",
		});
	});

	it("acknowledge never stale", () => {
		const action = { type: "acknowledge" as const, conflictId: "c1" };
		expect(verifyFresh(action, [])).toEqual({ ok: true });
	});
});

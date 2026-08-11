import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseTranscript,
	replayTranscriptSchema,
} from "../../plugin/replay-types.js";

const fixturePath = join(__dirname, "fixtures", "basic-typescript-loop.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
const fixtureBase = fixture as {
	version: 1;
	name: string;
	events: readonly unknown[];
};

describe("K5-018 — replay transcript format", () => {
	it("the shipped fixture parses", () => {
		const transcript = parseTranscript(fixture);
		expect(transcript.version).toBe(1);
		expect(transcript.name).toBe("basic-typescript-loop");
		expect(transcript.events.length).toBeGreaterThanOrEqual(14);
	});

	it("fixture has a failing tool.after, a transform, a linked fix and two idles", () => {
		const transcript = parseTranscript(fixture);
		const events = transcript.events;
		expect(
			events.filter(
				(e): e is Extract<typeof e, { kind: "tool.after" }> =>
					e.kind === "tool.after" && !e.success,
			).length,
		).toBeGreaterThan(0);
		expect(events.some((e) => e.kind === "system.transform")).toBe(true);
		// linked fix: a non-bash tool.before whose matching tool.after succeeds.
		const fixBefore = events.find(
			(e): e is Extract<typeof e, { kind: "tool.before" }> =>
				e.kind === "tool.before" && e.tool !== "bash",
		);
		expect(fixBefore).toBeDefined();
		const fixAfter = events.find(
			(e): e is Extract<typeof e, { kind: "tool.after" }> =>
				e.kind === "tool.after" && e.callId === fixBefore?.callId,
		);
		expect(fixAfter?.success).toBe(true);
		expect(events.filter((e) => e.kind === "session.idle").length).toBe(2);
	});

	it("rejects an unknown kind", () => {
		const bad = {
			...fixtureBase,
			events: [
				{
					kind: "tool.sideways",
					at: "2026-08-11T10:00:00.000Z",
					sessionId: "s",
				},
			],
		} as unknown;
		expect(() => parseTranscript(bad)).toThrow();
	});

	it("rejects a missing at and a non-ISO at", () => {
		const noAt = {
			...fixtureBase,
			events: [{ kind: "chat.message", sessionId: "s", text: "x" }],
		} as unknown;
		expect(() => parseTranscript(noAt)).toThrow();
		const badAt = {
			...fixtureBase,
			events: [
				{
					kind: "chat.message",
					at: "yesterday at noon",
					sessionId: "s",
					text: "x",
				},
			],
		} as unknown;
		expect(() => parseTranscript(badAt)).toThrow();
	});

	it("schema rejects an empty event list", () => {
		const result = replayTranscriptSchema.safeParse({
			version: 1,
			name: "empty",
			events: [],
		});
		expect(result.success).toBe(false);
	});
});

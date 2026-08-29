import { describe, expect, it } from "vitest";
import type { MemoryService, SaveInput } from "@jmtrin/kevin-core";
import { Reflector } from "@jmtrin/kevin-core";
import type { Metrics } from "@jmtrin/kevin-core";

function createMock() {
	const saved: SaveInput[] = [];
	let counter = 0;
	const service = {
		save(input: SaveInput): string {
			saved.push(input);
			counter++;
			return `id-${counter}`;
		},
	} as unknown as MemoryService;
	return { saved, service };
}

const noopService = {} as unknown as MemoryService;

describe("K4-005 — Reflector dispatch metadata + rescued errorType", () => {
	it("rescues the errorType to the dispatched code in the lesson content", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr: "src/a.ts:1:1 - error TS2304: Cannot find name 'x'.",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].content).toContain(
			"When bash fails with TS2304: src/a.ts:1:1 - error TS2304: Cannot find name 'x'.",
		);
		expect(saved[0].content).not.toContain("fails with typecheck:");
		expect(saved[0].content).toContain(
			"Suggestion: Verify types and imports before running.",
		);
		expect(saved[0].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
	});

	it("persists metadata.dispatch with code and hint", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "npm test",
			stderr: "error TS2322: Type 'string' is not assignable.",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s1",
		});
		const metadata = saved[0].metadata as Record<string, unknown>;
		expect(metadata.dispatch).toEqual({
			code: "TS2322",
			hint: "type mismatch",
		});
	});

	it("persists metadata.dispatch with nulls when no code matched", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "run",
			stderr: "some weird output that matches nothing",
			stdout: "",
			errorType: "unknown",
			sessionId: "s1",
		});
		const metadata = saved[0].metadata as Record<string, unknown>;
		expect(metadata.dispatch).toEqual({ code: null, hint: null });
		expect(saved[0].content).toContain("fails with unknown:");
	});

	it("keeps the coarse errorType when it is not unknown and no code matched", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "run",
			stderr: "Process exited with code 1.",
			stdout: "",
			errorType: "runtime",
			sessionId: "s1",
		});
		expect(saved[0].content).toContain("fails with runtime:");
		const metadata = saved[0].metadata as Record<string, unknown>;
		expect(metadata.dispatch).toEqual({ code: null, hint: null });
	});

	it("still stores origin_call_id alongside dispatch", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "run",
			stderr: "error TS2740: Missing property 'x'.",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s1",
			callID: "call-42",
		});
		const metadata = saved[0].metadata as Record<string, unknown>;
		expect(metadata.origin_call_id).toBe("call-42");
		expect(metadata.dispatch).toEqual({
			code: "TS2740",
			hint: "missing or wrong property",
		});
	});

	it("is unaffected by the throttle when fingerprint repeats (no crash)", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 60_000 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "a",
			stderr: "error TS2304: Cannot find name 'x'.",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s1",
		});
		const second = await r.invoke({
			toolName: "bash",
			argsSummary: "b",
			stderr: "error TS2304: Cannot find name 'x'.",
			stdout: "",
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(second).toBeNull();
		expect(saved.length).toBe(1);
	});
});

describe("K4-005 — generateHeuristicLesson displayErrorType", () => {
	const r = new Reflector(noopService);

	it("uses displayErrorType in the fails-with slot, errorType for suggestion", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			displayErrorType: "TS2304",
			firstErrorLine: "error TS2304: Cannot find name 'x'.",
		});
		expect(lesson).toContain("fails with TS2304:");
		expect(lesson).toContain(
			"Suggestion: Verify types and imports before running.",
		);
	});

	it("defaults to errorType when displayErrorType is absent", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "runtime",
			firstErrorLine: "boom",
		});
		expect(lesson).toContain("fails with runtime:");
	});
});

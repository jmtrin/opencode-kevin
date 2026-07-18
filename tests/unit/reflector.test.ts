import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryService, SaveInput } from "../../plugin/MemoryService.js";
import { Reflector } from "../../plugin/Reflector.js";
import type { Metrics } from "../../plugin/metrics.js";

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

function createMockMetrics() {
	const incr = vi.fn();
	const snapshot = vi.fn(() => ({}));
	const get = vi.fn(() => 0);
	const flush = vi.fn();
	const close = vi.fn();
	const metrics = {
		incr,
		snapshot,
		get,
		flush,
		close,
	} as unknown as Metrics;
	return { metrics, incr, snapshot, get, flush, close };
}

const noopService = {} as unknown as MemoryService;

describe("Reflector.generateHeuristicLesson", () => {
	const r = new Reflector(noopService);

	it("builds template with suggestion for each known error type", () => {
		const cases: Array<{ errorType: string; suggestion: string }> = [
			{
				errorType: "typecheck",
				suggestion: "Verify types and imports before running.",
			},
			{
				errorType: "lint",
				suggestion: "Run linter and fix warnings before committing.",
			},
			{
				errorType: "test",
				suggestion: "Run tests and fix failures before proceeding.",
			},
			{
				errorType: "runtime",
				suggestion: "Check error message and stack trace for root cause.",
			},
			{
				errorType: "timeout",
				suggestion: "Check for infinite loops or long-running operations.",
			},
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
		];
		for (const c of cases) {
			const lesson = r.generateHeuristicLesson({
				toolName: "bash",
				errorType: c.errorType,
				firstErrorLine: "error something failed",
			});
			expect(lesson).toBe(
				`When bash fails with ${c.errorType}: error something failed\nSuggestion: ${c.suggestion}`,
			);
		}
	});

	it("uses unknown suggestion for unrecognized error type", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "weird",
			firstErrorLine: "boom",
		});
		expect(lesson).toContain("Review the error output for details.");
	});

	it("truncates firstErrorLine longer than 500 chars", () => {
		const long = "error ".repeat(200);
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			firstErrorLine: long,
		});
		expect(lesson).toContain("...");
		expect(lesson.length).toBeLessThan(long.length);
	});
});

describe("Reflector.redactPaths", () => {
	const r = new Reflector(noopService);

	it("redacts Windows absolute paths", () => {
		expect(r.redactPaths("error at C:\\Users\\dev\\proj\\auth.ts")).toBe(
			"error at <path>",
		);
	});

	it("redacts Windows paths case-insensitively", () => {
		expect(r.redactPaths("at c:\\users\\dev\\x.ts here")).toBe(
			"at <path> here",
		);
	});

	it("preserves trailing :line number", () => {
		expect(r.redactPaths("error at C:\\Users\\dev\\proj\\auth.ts:10")).toBe(
			"error at <path>:10",
		);
	});

	it("redacts Unix paths under common roots", () => {
		expect(r.redactPaths("fail /home/user/x.ts and /var/log/y")).toBe(
			"fail <path> and <path>",
		);
		expect(r.redactPaths("at /Users/dev/proj/z.ts:5")).toBe("at <path>:5");
	});

	it("leaves text without paths untouched", () => {
		expect(r.redactPaths("plain error message no paths")).toBe(
			"plain error message no paths",
		);
	});
});

describe("Reflector.redactSecrets", () => {
	const r = new Reflector(noopService);

	it("redacts KEY=value style secrets preserving label", () => {
		expect(r.redactSecrets("API_KEY=abc123 boom")).toBe(
			"API_KEY=<redacted> boom",
		);
		expect(r.redactSecrets("SECRET=xyz")).toBe("SECRET=<redacted>");
		expect(r.redactSecrets("PASSWORD=p@ss")).toBe("PASSWORD=<redacted>");
		expect(r.redactSecrets("TOKEN=tok123")).toBe("TOKEN=<redacted>");
	});

	it("redacts Bearer and token bare values", () => {
		expect(r.redactSecrets("Authorization: Bearer abc123")).toBe(
			"Authorization: Bearer <redacted>",
		);
		expect(r.redactSecrets("token abc123 here")).toBe("token <redacted> here");
	});
});

describe("Reflector.invoke", () => {
	it("persists a memory with type error, sourceTool and sourceSession", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		const id = await r.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-1",
		});
		expect(id).not.toBeNull();
		expect(saved.length).toBe(1);
		expect(saved[0].type).toBe("error");
		expect(saved[0].scope).toBe("project");
		expect(saved[0].sourceTool).toBe("bash");
		expect(saved[0].sourceSession).toBe("sess-1");
	});

	it("includes the heuristic lesson and context in content", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].content).toContain(
			"When bash fails with typecheck: error TS2304",
		);
		expect(saved[0].content).toContain("Suggestion: Verify types and imports");
		expect(saved[0].content).toContain("Context:");
	});

	it("redacts paths and secrets in persisted content", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error at C:\\Users\\dev\\secret.ts:10 API_KEY=abc123 boom",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].content).not.toContain("C:\\Users");
		expect(saved[0].content).not.toContain("abc123");
		expect(saved[0].content).toContain("<path>:10");
		expect(saved[0].content).toContain("API_KEY=<redacted>");
	});

	it("truncates context > 4KB but keeps lesson searchable", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		const longStderr = `error TS2304: ${"x".repeat(5000)}`;
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: longStderr,
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].content).toContain("[truncated]");
		expect(saved[0].content.length).toBeLessThanOrEqual(
			4096 + "... [truncated]".length,
		);
		expect(saved[0].metadata?.truncated).toBe(true);
		expect(saved[0].metadata?.not_searchable).toBeUndefined();
		expect(saved[0].content).toContain("When bash fails with typecheck");
	});

	it("does not set not_searchable when content is small", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error small",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].metadata?.not_searchable).toBeUndefined();
	});

	it("falls back to stdout when stderr is empty", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "",
			stdout: "Error: something broke",
			exitCode: 1,
			errorType: "runtime",
			sessionId: "s1",
		});
		expect(saved[0].content).toContain("something broke");
	});

	describe("throttle", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it("returns null on second invoke within throttleMs", async () => {
			const { service } = createMock();
			const r = new Reflector(service, { throttleMs: 1000 });
			vi.setSystemTime(10000);
			const first = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(first).not.toBeNull();
			vi.setSystemTime(10500);
			const second = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(second).toBeNull();
			vi.setSystemTime(11001);
			const third = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(third).not.toBeNull();
		});
	});
});

describe("Reflector.invoke — v0.2.0 (K2-007)", () => {
	it("passes origin='reflector' and explicit fingerprint to save", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
			projectId: "proj-A",
		});
		expect(saved.length).toBe(1);
		expect(saved[0].origin).toBe("reflector");
		expect(saved[0].projectId).toBe("proj-A");
		expect(typeof saved[0].fingerprint).toBe("string");
		expect(saved[0].fingerprint?.length).toBe(16); // FNV-1a 64-bit hex
	});

	it("defaults projectId to null when not provided", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved[0].projectId).toBeUndefined();
		expect(typeof saved[0].fingerprint).toBe("string");
	});

	describe("per-fingerprint throttle", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it("throttles identical fingerprint within window and bumps reflections_throttled", async () => {
			const { service } = createMock();
			const { metrics, incr } = createMockMetrics();
			const r = new Reflector(service, { throttleMs: 1000 }, metrics);
			vi.setSystemTime(10000);
			const first = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(first).not.toBeNull();
			vi.setSystemTime(10500);
			const second = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(second).toBeNull();
			expect(incr).toHaveBeenCalledWith("reflections_throttled", 1);
		});

		it("does NOT throttle distinct fingerprints within the same window", async () => {
			const { service } = createMock();
			const { metrics, incr } = createMockMetrics();
			const r = new Reflector(service, { throttleMs: 1000 }, metrics);
			vi.setSystemTime(10000);
			const first = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304: cannot find foo",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			vi.setSystemTime(10100);
			const second = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2322: type mismatch bar",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
			});
			expect(first).not.toBeNull();
			expect(second).not.toBeNull();
			expect(incr).not.toHaveBeenCalled();
		});

		it("treats same error text under different projectId as distinct fingerprints", async () => {
			const { service } = createMock();
			const { metrics, incr } = createMockMetrics();
			const r = new Reflector(service, { throttleMs: 1000 }, metrics);
			vi.setSystemTime(10000);
			const a = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304: cannot find foo",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
				projectId: "proj-A",
			});
			vi.setSystemTime(10100);
			const b = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "error TS2304: cannot find foo",
				stdout: "",
				exitCode: 1,
				errorType: "typecheck",
				sessionId: "s1",
				projectId: "proj-B",
			});
			expect(a).not.toBeNull();
			expect(b).not.toBeNull();
			expect(incr).not.toHaveBeenCalled();
		});

		it("keeps the throttle map entry on skip, so third after window passes", async () => {
			const { service } = createMock();
			const { metrics } = createMockMetrics();
			const r = new Reflector(service, { throttleMs: 1000 }, metrics);
			vi.setSystemTime(10000);
			const first = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "boom TS9999",
				stdout: "",
				exitCode: 1,
				errorType: "runtime",
				sessionId: "s1",
			});
			vi.setSystemTime(10500);
			const second = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "boom TS9999",
				stdout: "",
				exitCode: 1,
				errorType: "runtime",
				sessionId: "s1",
			});
			vi.setSystemTime(11001);
			const third = await r.invoke({
				toolName: "bash",
				argsSummary: "",
				stderr: "boom TS9999",
				stdout: "",
				exitCode: 1,
				errorType: "runtime",
				sessionId: "s1",
			});
			expect(first).not.toBeNull();
			expect(second).toBeNull();
			expect(third).not.toBeNull();
		});
	});

	it("does not throw when metrics is null (backward-compat)", async () => {
		const { service } = createMock();
		const r = new Reflector(service, { throttleMs: 1000 }); // no metrics
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		vi.setSystemTime(10500);
		const second = await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(second).toBeNull();
		vi.useRealTimers();
	});
});

describe("Reflector.invoke — v0.2.0 (K2-020) per-key throttle + lesson v2 combo", () => {
	it("first invoke of a TS error saves a lesson v2 with 'Likely cause:' line", async () => {
		const { saved, service } = createMock();
		const r = new Reflector(service, { throttleMs: 0 });
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		expect(saved.length).toBe(1);
		expect(saved[0].content).toContain(
			"Suggestion: Verify types and imports before running.",
		);
		expect(saved[0].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
	});

	it("two distinct TS errors within the same window BOTH save with their own dispatched hints", async () => {
		const { saved, service } = createMock();
		const { metrics, incr } = createMockMetrics();
		const r = new Reflector(service, { throttleMs: 1000 }, metrics);
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		vi.setSystemTime(10100);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2322: Type 'string' is not assignable to 'number'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		vi.useRealTimers();
		expect(saved.length).toBe(2);
		expect(saved[0].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
		expect(saved[1].content).toContain(
			"Likely cause: type mismatch (code TS2322)",
		);
		expect(incr).not.toHaveBeenCalled();
	});

	it("identical fingerprint second invoke within window is throttled AND the first lesson already had 'Likely cause:'", async () => {
		const { saved, service } = createMock();
		const { metrics, incr } = createMockMetrics();
		const r = new Reflector(service, { throttleMs: 1000 }, metrics);
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		const first = await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		vi.setSystemTime(10500);
		const second = await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
		});
		vi.useRealTimers();
		expect(first).not.toBeNull();
		expect(second).toBeNull();
		expect(saved.length).toBe(1);
		expect(saved[0].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
		expect(incr).toHaveBeenCalledWith("reflections_throttled", 1);
	});

	it("lesson v2 dispatch is computed on the throttled skip path too (visible in metrics only; no save)", async () => {
		// On a throttle skip the dispatch is computed (because generateHeuristicLesson
		// runs before the throttle check), but the result is discarded since we
		// return null without saving. We assert only via the side-effect: metrics
		// `reflections_throttled` is bumped exactly once.
		const { service } = createMock();
		const { metrics, incr } = createMockMetrics();
		const r = new Reflector(service, { throttleMs: 1000 }, metrics);
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "Error: listen EADDRINUSE",
			stdout: "",
			exitCode: 1,
			errorType: "runtime",
			sessionId: "s1",
		});
		vi.setSystemTime(10500);
		const second = await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "Error: listen EADDRINUSE",
			stdout: "",
			exitCode: 1,
			errorType: "runtime",
			sessionId: "s1",
		});
		vi.useRealTimers();
		expect(second).toBeNull();
		expect(incr).toHaveBeenCalledWith("reflections_throttled", 1);
	});

	it("two same-content errors under different projectIds BOTH save with dispatched hints (no throttle collision)", async () => {
		const { saved, service } = createMock();
		const { metrics, incr } = createMockMetrics();
		const r = new Reflector(service, { throttleMs: 1000 }, metrics);
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
			projectId: "proj-A",
		});
		vi.setSystemTime(10100);
		await r.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "s1",
			projectId: "proj-B",
		});
		vi.useRealTimers();
		expect(saved.length).toBe(2);
		expect(saved[0].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
		expect(saved[1].content).toContain(
			"Likely cause: import or typo (code TS2304)",
		);
		expect(saved[0].fingerprint).not.toBe(saved[1].fingerprint);
		expect(incr).not.toHaveBeenCalled();
	});
});

import { describe, expect, it } from "vitest";
import type { MemoryService } from "../../plugin/MemoryService.js";
import { Reflector } from "../../plugin/Reflector.js";

const noopService = {} as unknown as MemoryService;

describe("Reflector.dispatchLesson — v0.2.0 (K2-018/K2-019)", () => {
	const r = new Reflector(noopService);

	describe("TypeScript codes (5 known + 1 unknown)", () => {
		it("TS2304 → import or typo", () => {
			const d = r.dispatchLesson(
				"error TS2304: Cannot find name 'foo'",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2304");
			expect(d.hint).toBe("import or typo");
		});

		it("TS2322 → type mismatch", () => {
			const d = r.dispatchLesson(
				"error TS2322: Type 'string' is not assignable to type 'number'",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2322");
			expect(d.hint).toBe("type mismatch");
		});

		it("TS2740 → missing or wrong property", () => {
			const d = r.dispatchLesson(
				"error TS2740: Property 'foo' is missing in type 'X'",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2740");
			expect(d.hint).toBe("missing or wrong property");
		});

		it("TS2552 → undefined identifier", () => {
			const d = r.dispatchLesson(
				"error TS2552: Cannot find name 'x'",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2552");
			expect(d.hint).toBe("undefined identifier");
		});

		it("TS18047 → possibly null", () => {
			const d = r.dispatchLesson(
				"error TS18047: 'x' is possibly 'null'",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS18047");
			expect(d.hint).toBe("possibly null");
		});

		it("unknown TS code falls back to generic 'review TS<N>' hint while still producing a code", () => {
			const d = r.dispatchLesson("error TS9999", "", "typecheck");
			expect(d.code).toBe("TS9999");
			expect(d.hint).toBe("review TS9999");
		});

		it("TS code detected in stdout when stderr is empty", () => {
			const d = r.dispatchLesson("", "Error: TS2304 things", "typecheck");
			expect(d.code).toBe("TS2304");
			expect(d.hint).toBe("import or typo");
		});
	});

	describe("Python lint", () => {
		it("ELIF code is dispatched", () => {
			const d = r.dispatchLesson("file.py:5:1: ELIF100", "", "lint");
			expect(d.code).toBe("ELIF100");
			expect(d.hint).toBe("review python lint: ELIF100");
		});

		it("Flake8 F-code is dispatched", () => {
			const d = r.dispatchLesson(
				"file.py:5:1: F401 'os' imported but unused",
				"",
				"lint",
			);
			expect(d.code).toBe("F401");
			expect(d.hint).toBe("review python lint: F401");
		});

		it("flake8: rule-token form is dispatched", () => {
			const d = r.dispatchLesson("flake8: E501 line too long", "", "lint");
			expect(d.code).toBe("E501");
			expect(d.hint).toBe("review python lint: E501");
		});
	});

	describe("Syscall codes", () => {
		it("EADDRINUSE", () => {
			const d = r.dispatchLesson("Error: listen EADDRINUSE", "", "runtime");
			expect(d.code).toBe("EADDRINUSE");
			expect(d.hint).toBe("review syscall: EADDRINUSE");
		});

		it("ENOENT", () => {
			const d = r.dispatchLesson(
				"Error: ENOENT: no such file or directory",
				"",
				"runtime",
			);
			expect(d.code).toBe("ENOENT");
			expect(d.hint).toBe("review syscall: ENOENT");
		});

		it("EACCES", () => {
			const d = r.dispatchLesson(
				"Error: EACCES: permission denied",
				"",
				"runtime",
			);
			expect(d.code).toBe("EACCES");
			expect(d.hint).toBe("review syscall: EACCES");
		});

		it("EPERM", () => {
			const d = r.dispatchLesson(
				"Error: EPERM: operation not permitted",
				"",
				"runtime",
			);
			expect(d.code).toBe("EPERM");
			expect(d.hint).toBe("review syscall: EPERM");
		});
	});

	describe("Generic Error / Command failed", () => {
		it("Error: <Name> → review error class", () => {
			const d = r.dispatchLesson(
				"Error: SyntaxError unexpected token",
				"",
				"runtime",
			);
			expect(d.code).toBe("SyntaxError");
			expect(d.hint).toBe("review error class: SyntaxError");
		});

		it('Command "<cmd>" failed → review failing command', () => {
			const d = r.dispatchLesson(
				'Command "npm run build" failed',
				"",
				"runtime",
			);
			expect(d.code).toBe("npm run build");
			expect(d.hint).toBe("review failing command: npm run build");
		});
	});

	describe("Fallback (no code matches)", () => {
		it("returns {code:null, hint:null} for plain text", () => {
			const d = r.dispatchLesson("error something failed", "", "typecheck");
			expect(d.code).toBeNull();
			expect(d.hint).toBeNull();
		});

		it("returns fallback for empty input", () => {
			const d = r.dispatchLesson("", "", "weird");
			expect(d.code).toBeNull();
			expect(d.hint).toBeNull();
		});

		it("returns fallback for lowercase 'error:' without capital E (regex is case-sensitive)", () => {
			const d = r.dispatchLesson("error: something", "", "runtime");
			expect(d.code).toBeNull();
			expect(d.hint).toBeNull();
		});
	});

	describe("Dispatch precedence (priority order per plan §B6.4)", () => {
		it("TS code wins over Python/syscall/generic", () => {
			const d = r.dispatchLesson(
				"Error: TS2304 cannot find name",
				"ELIF100",
				"typecheck",
			);
			expect(d.code).toBe("TS2304");
			expect(d.hint).toBe("import or typo");
		});

		it("Python wins over syscall/generic (no TS in input)", () => {
			const d = r.dispatchLesson(
				"Error: F401 unused import",
				"EADDRINUSE note",
				"lint",
			);
			// F401 (Python) wins over EADDRINUSE (syscall) per dispatch order
			expect(d.code).toBe("F401");
			expect(d.hint).toBe("review python lint: F401");
		});

		it("Syscall wins over generic Error (no TS/Python in input)", () => {
			const d = r.dispatchLesson(
				"Error: EACCES permission denied",
				"",
				"runtime",
			);
			expect(d.code).toBe("EACCES");
			expect(d.hint).toBe("review syscall: EACCES");
		});

		it("Generic Error wins over Command failed when both present", () => {
			const d = r.dispatchLesson(
				'Error: BuildError something\nCommand "x" failed',
				"",
				"runtime",
			);
			expect(d.code).toBe("BuildError");
			expect(d.hint).toBe("review error class: BuildError");
		});
	});
});

describe("Reflector.generateHeuristicLesson — v0.2.0 composition (K2-018)", () => {
	const r = new Reflector(noopService);

	it("appends 'Likely cause:' line when a TS code is dispatched", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			firstErrorLine: "error TS2304: Cannot find name 'foo'",
			dispatched: { code: "TS2304", hint: "import or typo" },
		});
		expect(lesson).toContain(
			"Suggestion: Verify types and imports before running.",
		);
		expect(lesson).toContain("Likely cause: import or typo (code TS2304)");
		// substring 'Verify types and imports' still present (backward-compat)
		expect(lesson).toContain("Verify types and imports");
	});

	it("does NOT append 'Likely cause:' when dispatched is null (fallback)", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			firstErrorLine: "error something failed",
			dispatched: { code: null, hint: null },
		});
		expect(lesson).toBe(
			"When bash fails with typecheck: error something failed\nSuggestion: Verify types and imports before running.",
		);
		expect(lesson).not.toContain("Likely cause:");
	});

	it("auto-dispatches on firstErrorLine when dispatched not provided (TS code path)", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			firstErrorLine: "error TS2304: cannot find name 'x'",
		});
		expect(lesson).toContain("Likely cause: import or typo (code TS2304)");
		expect(lesson).toContain(
			"Suggestion: Verify types and imports before running.",
		);
	});

	it("auto-dispatches fallback when firstErrorLine lacks any code", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "runtime",
			firstErrorLine: "boom",
		});
		expect(lesson).toBe(
			"When bash fails with runtime: boom\nSuggestion: Check error message and stack trace for root cause.",
		);
		expect(lesson).not.toContain("Likely cause:");
	});

	it("uses composed suggestion with errorType='runtime' base for a syscall dispatch", () => {
		const lesson = r.generateHeuristicLesson({
			toolName: "node",
			errorType: "runtime",
			firstErrorLine: "Error: listen EADDRINUSE",
			dispatched: { code: "EADDRINUSE", hint: "review syscall: EADDRINUSE" },
		});
		expect(lesson).toContain(
			"Suggestion: Check error message and stack trace for root cause.",
		);
		expect(lesson).toContain(
			"Likely cause: review syscall: EADDRINUSE (code EADDRINUSE)",
		);
	});

	it("truncates long firstErrorLine before composing (still appends Likely cause when dispatched)", () => {
		const long = "error ".repeat(200);
		const lesson = r.generateHeuristicLesson({
			toolName: "bash",
			errorType: "typecheck",
			firstErrorLine: long,
			dispatched: { code: "TS2304", hint: "import or typo" },
		});
		expect(lesson).toContain("...");
		expect(lesson.length).toBeLessThan(long.length + 200);
		expect(lesson).toContain("Likely cause: import or typo (code TS2304)");
	});
});

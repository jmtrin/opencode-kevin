import { describe, expect, it } from "vitest";
import { QualityGate, isGenericSuggestion } from "../../plugin/QualityGate.js";

describe("K4-003 — QualityGate.evaluate + rescueErrorType", () => {
	it("rescues the errorType when a code was dispatched", () => {
		const q = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Verify types and imports before running.",
			},
			{ code: "TS2304", hint: "import or typo" },
			"unknown",
		);
		expect(q.errorType).toBe("TS2304");
		expect(q.strength).toBe("strong");
		expect(q.isActionable).toBe(true);
	});

	it("keeps the coarse errorType when no code matched", () => {
		const q = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: null, hint: null },
			"unknown",
		);
		expect(q.errorType).toBe("unknown");
		expect(q.strength).toBe("weak");
		expect(q.isActionable).toBe(false);
	});

	it("treats a non-generic suggestion as actionable even without a code", () => {
		const q = QualityGate.evaluate(
			{ errorType: "runtime", suggestion: "Install the tool first." },
			{ code: null, hint: null },
			"runtime",
		);
		expect(q.isActionable).toBe(true);
		expect(q.strength).toBe("strong");
	});

	it("marks a code-matched lesson with a generic suggestion as actionable", () => {
		// Dispatch matched, so the lesson has a hint — the generic-suggestion
		// fallback no longer applies.
		const q = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: "EADDRINUSE", hint: "free the port or change it" },
			"unknown",
		);
		expect(q.isActionable).toBe(true);
		expect(q.strength).toBe("strong");
	});

	it("isGenericSuggestion detects all fallback suggestions", () => {
		expect(isGenericSuggestion("Review the error output for details.")).toBe(
			true,
		);
		expect(
			isGenericSuggestion("Verify types and imports before running."),
		).toBe(true);
		expect(
			isGenericSuggestion("Run linter and fix warnings before committing."),
		).toBe(true);
		expect(
			isGenericSuggestion("Run tests and fix failures before proceeding."),
		).toBe(true);
		expect(isGenericSuggestion("Install the tool first.")).toBe(false);
	});

	it("rescues from null dispatch without crashing", () => {
		expect(QualityGate.rescueErrorType(null, "unknown")).toBe("unknown");
		expect(QualityGate.rescueErrorType(null, "typecheck")).toBe("typecheck");
	});

	it("classifies the five observed §3.3 cases correctly", () => {
		// 1. E0433 rust — code matched (K4-022 will provide the rule) → actionable.
		const e0433 = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: "E0433", hint: "cannot find item" },
			"unknown",
		);
		expect(e0433.isActionable).toBe(true);
		expect(e0433.errorType).toBe("E0433");

		// 2. "[connect] starting jcode runtime..." — no code, generic → NOT actionable.
		const fragment = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: null, hint: null },
			"unknown",
		);
		expect(fragment.isActionable).toBe(false);

		// 3. "could not compile 'jcode-harness-api'" — no code yet → weak.
		const compile = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: null, hint: null },
			"unknown",
		);
		expect(compile.strength).toBe("weak");

		// 4. "rg: The term 'rg' is not recognized" — code via K4-022 rule → actionable.
		const rg = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion:
					"Install the tool (e.g. npm i -g <name>) or call it by its full path.",
			},
			{
				code: "command-not-found",
				hint: "install the tool or use a full path",
			},
			"unknown",
		);
		expect(rg.isActionable).toBe(true);
		expect(rg.errorType).toBe("command-not-found");

		// 5. "[build]" — no code, generic → NOT actionable.
		const build = QualityGate.evaluate(
			{
				errorType: "unknown",
				suggestion: "Review the error output for details.",
			},
			{ code: null, hint: null },
			"unknown",
		);
		expect(build.isActionable).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import type { MemoryService } from "../../plugin/MemoryService.js";
import { Reflector } from "../../plugin/Reflector.js";

const noopService = {} as unknown as MemoryService;

describe("Reflector.dispatchLesson — v0.4.0 (K4-022) expanded rules", () => {
	const r = new Reflector(noopService);

	describe("TypeScript", () => {
		it("TS2307 (cannot find module) → install/add to package.json", () => {
			const d = r.dispatchLesson(
				"src/app.ts:1:19 - error TS2307: Cannot find module 'lodash' or its corresponding type declarations.",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2307");
			expect(d.hint).toBe(
				"install the dependency or add it to package.json before importing",
			);
		});

		it("TS2339 (property does not exist) → check import surface", () => {
			const d = r.dispatchLesson(
				"error TS2339: Property 'toUpper' does not exist on type 'String'.",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2339");
			expect(d.hint).toBe(
				"check the imported surface for the correct member name",
			);
		});

		it("TS2305 (no exported member) → check import surface", () => {
			const d = r.dispatchLesson(
				"error TS2305: Module '\"@types/foo\"' has no exported member 'bar'.",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2305");
			expect(d.hint).toBe(
				"check the imported surface for the correct member name",
			);
		});

		it("TS6133 (declared but never used) → remove or use", () => {
			const d = r.dispatchLesson(
				"error TS6133: 'unusedVar' is declared but its value is never read.",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS6133");
			expect(d.hint).toBe("remove the declaration or use it");
		});

		it("matches lowercase ts(2307) style output", () => {
			const d = r.dispatchLesson(
				"src/app.ts(1,19): error TS2307: Cannot find module 'x'. (ts(2307))",
				"",
				"typecheck",
			);
			expect(d.code).toBe("TS2307");
		});
	});

	describe("Rust", () => {
		it("E0433 (undeclared crate/module) → add dependency or use path", () => {
			const d = r.dispatchLesson(
				"error[E0433]: failed to resolve: use of undeclared crate or module `serde`",
				"",
				"unknown",
			);
			expect(d.code).toBe("E0433");
			expect(d.hint).toBe(
				"add the dependency to Cargo.toml or use a full path (crate::...)",
			);
		});

		it("E0432 (unresolved import) → add dependency or use path", () => {
			const d = r.dispatchLesson(
				"error[E0432]: unresolved import `foo::bar`",
				"",
				"unknown",
			);
			expect(d.code).toBe("E0432");
			expect(d.hint).toBe(
				"add the dependency to Cargo.toml or use a full path (crate::...)",
			);
		});
	});

	describe("Shell command not found", () => {
		it("rg: command not found → install the tool", () => {
			const d = r.dispatchLesson("rg: command not found", "", "runtime");
			expect(d.code).toBe("rg");
			expect(d.hint).toBe(
				"install the tool (e.g. npm i -g rg) or call it by its full path",
			);
		});

		it("The term 'rg' is not recognized (PowerShell) → install the tool", () => {
			const d = r.dispatchLesson(
				"rg: The term 'rg' is not recognized as the name of a cmdlet, function, script file, or operable program.",
				"",
				"runtime",
			);
			expect(d.code).toBe("rg");
			expect(d.hint).toBe(
				"install the tool (e.g. npm i -g rg) or call it by its full path",
			);
		});
	});

	describe("Syscall", () => {
		it("EADDRINUSE → free the port or change it", () => {
			const d = r.dispatchLesson(
				"Error: listen EADDRINUSE: address already in use :::3000",
				"",
				"runtime",
			);
			expect(d.code).toBe("EADDRINUSE");
			expect(d.hint).toBe(
				"free the port (netstat -ano | findstr :PORT) or change the port",
			);
		});
	});

	describe("F#28 false-positive guard (unchanged)", () => {
		it("bare error/fail words still dispatch to null", () => {
			const d = r.dispatchLesson(
				"something went wrong: error handling the request",
				"",
				"unknown",
			);
			expect(d.code).toBeNull();
			expect(d.hint).toBeNull();
		});
	});
});

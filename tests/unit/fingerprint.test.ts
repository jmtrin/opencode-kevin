import { describe, expect, it } from "vitest";
import { fingerprint, fnv1a64, normalize } from "../../plugin/fingerprint.js";

describe("fingerprint — normalize", () => {
	it("strips ANSI CSI sequences", () => {
		expect(normalize("\x1b[31merror\x1b[0m")).toBe("error");
		expect(normalize("\x1b[1;33mFAIL\x1b[0m line")).toBe("fail line");
	});

	it("lowercases the input", () => {
		expect(normalize("ERROR Cannot find name 'Foo'")).toBe(
			"error cannot find name 'foo'",
		);
	});

	it("strips line numbers from path:line[:col] references, keeps extension", () => {
		expect(normalize("src/foo.ts:42:7")).toBe(".ts");
		expect(normalize("src/bar.ts:7")).toBe(".ts");
		// `///` is part of the path prefix that the regex swallows along
		// with `src/index` because none of those chars are whitespace or `:`.
		expect(normalize("at baz (webpack:///src/index.ts:101:5)")).toBe(
			"at baz (webpack:.ts)",
		);
	});

	it("makes src/foo.ts:42 and src/bar.ts:7 collide by extension", () => {
		// After normalization both reduce to ".ts".
		expect(normalize("src/foo.ts:42")).toBe(normalize("src/bar.ts:7"));
	});

	it("collapses whitespace and trims", () => {
		expect(normalize("  error\n\n  in\tfunc  ")).toBe("error in func");
	});

	it("is the identity on simple plain text", () => {
		expect(normalize("hello world")).toBe("hello world");
	});
});

describe("fingerprint — fnv1a64", () => {
	it("returns a 16-char lowercase hex string for any input", () => {
		for (const s of [
			"",
			"a",
			"error TS2304 cannot find name",
			"x".repeat(1000),
		]) {
			const h = fnv1a64(s);
			expect(h).toMatch(/^[0-9a-f]{16}$/);
		}
	});

	it("is deterministic — same input always hashes the same", () => {
		const a = fnv1a64("error TS2304 cannot find name 'Foo'");
		const b = fnv1a64("error TS2304 cannot find name 'Foo'");
		expect(a).toBe(b);
	});

	it("is sensitive to single-byte changes", () => {
		expect(fnv1a64("error foo")).not.toBe(fnv1a64("error food"));
	});

	it("known small-vector anchors (smoke-level, no cross-impl portability claims)", () => {
		// Empty input FNV-1a 64-bit = offset basis 0xcbf29ce484222325.
		expect(fnv1a64("")).toBe("cbf29ce484222325");
	});
});

describe("fingerprint — fingerprint (with salt)", () => {
	it("is stable for identical content without salt", () => {
		const a = fingerprint("error TS2304 cannot find name 'Foo'");
		const b = fingerprint("error TS2304 cannot find name 'Foo'");
		expect(a).toBe(b);
	});

	it("normalizes before hashing — whitespace/ANSI/case/path differences collide", () => {
		const a = fingerprint(
			"\x1b[31mERROR cannot find name 'Foo'  in src/foo.ts:42:7\x1b[0m",
		);
		const b = fingerprint("error cannot find name 'foo' in src/bar.ts:7");
		expect(a).toBe(b);
	});

	it("salts with project_id so two projects with identical error text diverge", () => {
		const body = "error TS2304 cannot find name 'Foo' in src/foo.ts:42";
		const a = fingerprint(body, "proj-A");
		const b = fingerprint(body, "proj-B");
		expect(a).not.toBe(b);
		expect(a).not.toBe(fingerprint(body));
	});

	it("does not collide across projects when project_id is a prefix of the other", () => {
		// proj-A is a prefix of proj-AB; NUL separator prevents prefix collisions.
		const body = "error TS2322 type mismatch";
		const a = fingerprint(body, "proj-A");
		const ab = fingerprint(body, "proj-AB");
		expect(a).not.toBe(ab);
	});

	it("same project_id + same body produces same hash across calls", () => {
		const body = "error cannot find module '../utils'";
		expect(fingerprint(body, "proj-A")).toBe(fingerprint(body, "proj-A"));
	});

	it("returns 16 hex chars", () => {
		expect(fingerprint("x")).toMatch(/^[0-9a-f]{16}$/);
	});
});

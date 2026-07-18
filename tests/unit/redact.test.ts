import { describe, expect, it } from "vitest";
import { redactPaths, stripPrivate } from "../../plugin/redact.js";

describe("stripPrivate (K2-008)", () => {
	it("replaces a single-line <private> block with a redacted marker", () => {
		const text = "before <private>my secret</private> after";
		expect(stripPrivate(text)).toBe("before <private: redacted 9 chars> after");
	});

	it("redacts the inner content length, not the visible text", () => {
		const text = "<private>abc</private>";
		expect(stripPrivate(text)).toBe("<private: redacted 3 chars>");
	});

	it("handles multiline inner content (s flag via [\\s\\S])", () => {
		const inner = "line1\nline2\nline3";
		const text = `<private>${inner}</private>`;
		expect(stripPrivate(text)).toBe(
			`<private: redacted ${inner.length} chars>`,
		);
	});

	it("is case-insensitive on the tag names", () => {
		const text = "<PRIVATE>secret</PRIVATE>";
		expect(stripPrivate(text)).toBe("<private: redacted 6 chars>");
	});

	it("is case-insensitive mixed (lower open, upper close)", () => {
		const text = "<Private>x</PRIVATE>";
		expect(stripPrivate(text)).toBe("<private: redacted 1 chars>");
	});

	it("allows arbitrary attributes on the opening tag", () => {
		const text = '<private scope="user" ttl="3600">payload</private>';
		expect(stripPrivate(text)).toBe("<private: redacted 7 chars>");
	});

	it("handles multiple blocks in the same text", () => {
		const text = "<private>aa</private> mid <private>bbbb</private>";
		expect(stripPrivate(text)).toBe(
			"<private: redacted 2 chars> mid <private: redacted 4 chars>",
		);
	});

	it("preserves surrounding content", () => {
		const text =
			"log line one\n<private>\nstack trace lines\n</private>\nlog line two";
		const expected = "log line one\n<private: redacted 19 chars>\nlog line two";
		expect(stripPrivate(text)).toBe(expected);
	});

	it("leaves a lone opening tag untouched (no closing match)", () => {
		const text = "<private>abc";
		expect(stripPrivate(text)).toBe("<private>abc");
	});

	it("leaves a lone closing tag untouched", () => {
		const text = "abc</private>";
		expect(stripPrivate(text)).toBe("abc</private>");
	});

	it("is non-greedy: first <private> matches first </private>, leaving outer close bare", () => {
		// Standard lazy regex semantics: once the first <private> commits,
		// the lazy inner extends until the first </private> it sees,
		// which happens to be the inner one. The trailing </private>
		// has no opening partner and is left untouched.
		const text = "<private>aa<private>bbb</private>cc</private>";
		expect(stripPrivate(text)).toBe("<private: redacted 14 chars>cc</private>");
	});

	it("returns input unchanged when no <private> tags are present", () => {
		const text = "just a normal log line with no markers";
		expect(stripPrivate(text)).toBe(text);
	});

	it("returns empty string unchanged", () => {
		expect(stripPrivate("")).toBe("");
	});

	it("treats whitespace-only inner content by its real length", () => {
		const text = "<private>   </private>";
		expect(stripPrivate(text)).toBe("<private: redacted 3 chars>");
	});

	it("does not touch <private-ish> tags that are not exactly 'private'", () => {
		const text = "<privatex>x</privatex>";
		expect(stripPrivate(text)).toBe("<privatex>x</privatex>");
	});

	it("composes with redactPaths without interference", () => {
		const text =
			"at C:\\Users\\me\\secret.ts <private>PASSWORD=hunter2</private>";
		const step1 = redactPaths(text);
		expect(step1).toBe("at <path> <private>PASSWORD=hunter2</private>");
		const step2 = stripPrivate(step1);
		expect(step2).toBe("at <path> <private: redacted 16 chars>");
	});
});

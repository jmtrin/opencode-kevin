import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MAX_ENTRIES,
	MAX_LINE_BYTES,
	OKF_VERSION,
	type OkfEntry,
	canonicalize,
	serialize,
} from "@jmtrin/kevin-core";

function entry(overrides: Partial<OkfEntry> = {}): OkfEntry {
	return {
		entry_id: "0a1b2c3d4e5f6071",
		type: "rule",
		statement: "always run tests",
		scope: "src/",
		evidence: 4,
		recurrence: 0,
		origin: "pattern",
		author_hash: "3c9ab8d2f7e14a05",
		op: "assert",
		created_at: "2026-08-11T09:14:22Z",
		supersedes: null,
		...overrides,
	};
}

const REPO = "8f3a2c1d9e7b6045";
const VERSION = "0.8.0";

describe("K8-011 — canonicalize + serialize (plan §5.3/§5.4)", () => {
	it("emits each entry line with alphabetically ordered keys (asserted by regex over raw text)", () => {
		const out = serialize([entry()], REPO, VERSION);
		const lines = out.split("\n");
		const line = lines[3];
		const keys = [...line.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
		expect(keys).toEqual([
			"author_hash",
			"created_at",
			"entry_id",
			"evidence",
			"op",
			"origin",
			"recurrence",
			"scope",
			"statement",
			"supersedes",
			"type",
		]);
		// Raw-text assertion: exactly these keys, alphabetical, no more.
		expect(line).toMatch(
			/^\{("(author_hash|created_at|entry_id|evidence|op|origin|recurrence|scope|statement|supersedes|type)":(.*?)(,|}))+$/,
		);
	});

	it("round-trips byte-identically: serialize(reparse(serialize(e))) === serialize(e), including a 500-entry corpus", () => {
		const entries = Array.from({ length: 500 }, (_, i) =>
			entry({
				entry_id: ((i * 2654435761) % 0xffffffff)
					.toString(16)
					.padStart(16, "0"),
				statement: `statement ${i} with some path src/routes/api.ts:12`,
				evidence: i % 7,
				recurrence: i % 3,
			}),
		);
		const once = serialize(entries, REPO, VERSION);
		// A local reparse (parse() itself lands in K8-012): JSON each line.
		const reparsed = once
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.map((l) => JSON.parse(l) as OkfEntry);
		expect(serialize(reparsed, REPO, VERSION)).toBe(once);
	});

	it("shuffling the input array does not change a single byte of the output", () => {
		const entries = Array.from({ length: 50 }, (_, i) =>
			entry({
				entry_id: ((i * 997) % 0xffffffff).toString(16).padStart(16, "0"),
				statement: `statement ${i}`,
			}),
		);
		const base = serialize(entries, REPO, VERSION);
		for (let round = 0; round < 5; round++) {
			const shuffled = [...entries].sort(() => ((round * 31 + 7) % 3) - 1);
			expect(serialize(shuffled, REPO, VERSION)).toBe(base);
		}
	});

	it("writes no float anywhere: evidence/recurrence are integers and confidence is never serialized", () => {
		const out = serialize(
			[entry({ evidence: 2, recurrence: 1 })],
			REPO,
			VERSION,
		);
		expect(out).not.toMatch(/:\s*"?\d+\.\d+/);
		expect(out).not.toContain("confidence");
		expect(out).toContain('"evidence":2');
		expect(out).toContain('"recurrence":1');
	});

	it("rejects a multi-byte statement over MAX_LINE_BYTES even when its .length is under 4096", () => {
		// 1400 Japanese chars: 1400 UTF-16 code units (.length < 4096) but
		// 4200+ bytes in UTF-8 — the byte check is what must fire.
		const statement = "あ".repeat(1400);
		expect(statement.length).toBeLessThan(MAX_LINE_BYTES);
		const huge = entry({ statement });
		expect(Buffer.byteLength(canonicalize(huge), "utf8")).toBeGreaterThan(
			MAX_LINE_BYTES,
		);
		expect(() => serialize([huge], REPO, VERSION)).toThrow(/MAX_LINE_BYTES/);
		// A statement that fits both ways serializes fine.
		expect(() =>
			serialize([entry({ statement: "あ".repeat(100) })], REPO, VERSION),
		).not.toThrow();
	});

	it("refuses a corpus over MAX_ENTRIES", () => {
		const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) =>
			entry({
				entry_id: ((i * 31) % 0xffffffff).toString(16).padStart(16, "0"),
				statement: `s${i}`,
			}),
		);
		expect(() => serialize(entries, REPO, VERSION)).toThrow(/MAX_ENTRIES/);
		expect(() =>
			serialize(entries.slice(0, MAX_ENTRIES), REPO, VERSION),
		).not.toThrow();
	});

	it("emits exactly three headers, LF endings, no CR, exactly one terminating newline", () => {
		const out = serialize(
			[entry({ entry_id: "f".repeat(16) }), entry()],
			REPO,
			VERSION,
		);
		expect(out.startsWith(`#okf ${OKF_VERSION}\n#repo ${REPO}\n`)).toBe(true);
		expect(out).toContain(`#generated-by opencode-kevin/${VERSION}\n`);
		expect(out).not.toContain("\r");
		expect(out.endsWith("\n")).toBe(true);
		expect(out.endsWith("\n\n")).toBe(false);
		// Exactly one header block, entries sorted ascending by entry_id.
		expect(out.match(/#generated-by/g)).toHaveLength(1);
		const entryLines = out
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.map((l) => (JSON.parse(l) as OkfEntry).entry_id);
		expect(entryLines).toEqual([...entryLines].sort());
	});

	it("plan §11.2 check 17: no float reaches the file, and serialize never derives confidence", () => {
		// A corpus whose derived confidences would hit the 0.1 + 0.2
		// float trap (e.g. evidence 3 → 0.5 + 0.30000000000000004).
		const out = serialize(
			[
				entry({ evidence: 3, recurrence: 0, entry_id: "a".repeat(16) }),
				entry({ evidence: 5, recurrence: 3, entry_id: "b".repeat(16) }),
				entry({ evidence: 7, recurrence: 2, entry_id: "c".repeat(16) }),
			],
			REPO,
			VERSION,
		);
		// No digit followed by a decimal point inside any JSON number:
		// the file is integer-only (evidence/recurrence are the only
		// numbers, and confidence is never serialized). The assertion is
		// scoped to the entry lines — the `0.8.0` version header is a
		// string, not a JSON number.
		const entryLines = out.split("\n").filter((l) => l.startsWith("{"));
		expect(entryLines.length).toBeGreaterThan(0);
		for (const line of entryLines) {
			expect(line).not.toMatch(/\d\.\d/);
		}
		// The deriveConfidence contract: exported, called on read, never
		// inside serialize's body.
		const okfSrc = readFileSync(
			join(process.cwd(), "plugin", "okf.ts"),
			"utf8",
		);
		const serializeBody = okfSrc
			.slice(okfSrc.indexOf("export function serialize"))
			.slice(
				0,
				okfSrc
					.slice(okfSrc.indexOf("export function serialize"))
					.indexOf("\nexport "),
			);
		expect(serializeBody).not.toContain("deriveConfidence");
	});
});

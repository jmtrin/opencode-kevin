import { describe, expect, it } from "vitest";
import {
	MAX_ENTRIES,
	OKF_VERSION,
	type OkfEntry,
	canonicalize,
	computeEntryId,
	parse,
	serialize,
} from "@jmtrin/kevin-core";

function entry(overrides: Partial<OkfEntry> = {}): OkfEntry {
	return {
		// Default to the real recomputed id so the tamper-evident check
		// passes unless the test overrides it.
		entry_id: computeEntryId(
			overrides.type ?? "rule",
			overrides.statement ?? "always run tests",
			overrides.scope ?? "src/",
		),
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

function makeEntry(statement: string, i: number): OkfEntry {
	const id = computeEntryId("rule", statement, "src/");
	return entry({
		entry_id: id,
		statement,
		evidence: i % 5,
	});
}

function header(repoId = "8f3a2c1d9e7b6045", version = OKF_VERSION): string {
	return `#okf ${version}\n#repo ${repoId}\n#generated-by opencode-kevin/0.8.0\n`;
}

describe("K8-012 — parse(): total function + rejection taxonomy (plan §5.4, D8-14)", () => {
	it("never throws, on any input, including binary", () => {
		const cases = [
			"",
			"\u0000",
			Buffer.alloc(4 * 1024 * 1024, 0x61).toString("utf8"), // 4 MB of 'a'
			"#okf 3\n#repo x\n",
			"not okf at all",
			'{"bad": json}\n',
		];
		for (const c of cases) {
			expect(() => parse(c)).not.toThrow();
		}
	});

	it("reports not_okf for a file whose first line is not a header", () => {
		const r = parse("hello world\n{...}");
		expect(r.entries).toEqual([]);
		expect(r.rejected).toEqual([{ line: 1, reason: "not_okf" }]);
	});

	it("refuses a version-ahead header with a single version_ahead reject and no best-effort parse", () => {
		const r = parse(`${header("r", 3)}{"entry_id":"x"}`);
		expect(r.version).toBe(3);
		expect(r.entries).toEqual([]);
		expect(r.rejected).toEqual([{ line: 1, reason: "version_ahead" }]);
	});

	it("strips a UTF-8 BOM and parses CRLF endings like LF ones", () => {
		const body = `${header() + canonicalize(entry())}\r\n`;
		const withBom = `\uFEFF${body}`;
		const withCrlf = `\uFEFF${header().replace(/\n/g, "\r\n")}${canonicalize(entry())}\r\n`;
		for (const text of [withBom, withCrlf, body]) {
			const r = parse(text);
			expect(r.rejected).toEqual([]);
			expect(r.entries).toHaveLength(1);
			expect(r.entries[0].statement).toBe("always run tests");
		}
	});

	it("tolerates a truncated final line as a single bad_json reject", () => {
		const good = canonicalize(entry());
		const r = parse(`${header() + good}\n${good.slice(0, 40)}\n`);
		expect(r.rejected).toHaveLength(1);
		expect(r.rejected[0].reason).toBe("bad_json");
		expect(r.entries).toHaveLength(1);
	});

	it("skips git conflict markers around valid entries: exactly three bad_json rejects, the rest survive", () => {
		const a = makeEntry("rule one", 1);
		const b = makeEntry("rule two", 2);
		const text = `${
			header() + canonicalize(a)
		}\n<<<<<<< HEAD\n=======\n>>>>>>> branch\n${canonicalize(b)}\n`;
		const r = parse(text);
		expect(r.rejected).toHaveLength(3);
		for (const rej of r.rejected) expect(rej.reason).toBe("bad_json");
		expect(r.entries).toHaveLength(2);
	});

	it("rejects a hand-edited statement as id_mismatch — the tamper-evident check", () => {
		const e = entry();
		const tampered = JSON.parse(canonicalize(e)) as Record<string, unknown>;
		tampered.statement = "always run tests -- now with a tweak";
		const r = parse(`${header() + JSON.stringify(tampered)}\n`);
		expect(r.rejected).toEqual([{ line: 4, reason: "id_mismatch" }]);
		expect(r.entries).toEqual([]);
	});

	it("round-trips serialize() output with rejected.length === 0 and folded === 0, sorted by entry_id", () => {
		const entries = Array.from({ length: 120 }, (_, i) =>
			makeEntry(`statement number ${i}`, i),
		);
		const shuffled = [...entries].sort(() => ((i) => (i % 2) - 0.5)(0));
		const text = serialize(shuffled, "8f3a2c1d9e7b6045", "0.8.0");
		const r = parse(text);
		expect(r.rejected).toEqual([]);
		expect(r.folded).toBe(0);
		expect(r.version).toBe(OKF_VERSION);
		expect(r.repoId).toBe("8f3a2c1d9e7b6045");
		expect(r.entries).toHaveLength(120);
		const ids = r.entries.map((e) => e.entry_id);
		expect(ids).toEqual([...ids].sort());
		// Byte-identical reserialize.
		expect(serialize(r.entries, "8f3a2c1d9e7b6045", "0.8.0")).toBe(text);
	});

	it("folds duplicate entry_ids through join() and reports the count", () => {
		const id = computeEntryId("rule", "dup rule", null);
		const v1 = entry({
			entry_id: id,
			statement: "dup rule",
			scope: null,
			evidence: 2,
			op: "assert",
			created_at: "2026-08-01T00:00:00Z",
		});
		const v2 = entry({
			entry_id: id,
			statement: "dup rule",
			scope: null,
			evidence: 5,
			op: "tombstone",
			created_at: "2026-08-02T00:00:00Z",
		});
		const text = `${header() + canonicalize(v1)}\n${canonicalize(v2)}\n`;
		const r = parse(text);
		expect(r.folded).toBe(1);
		expect(r.entries).toHaveLength(1);
		expect(r.entries[0].evidence).toBe(5);
		expect(r.entries[0].op).toBe("tombstone");
		expect(r.entries[0].created_at).toBe("2026-08-01T00:00:00Z");
	});

	it("rejects a valid file with 2001 entries as corpus_too_large without throwing", () => {
		const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) =>
			makeEntry(`corpus entry ${i}`, i),
		);
		const text = `${
			serialize(entries.slice(0, MAX_ENTRIES), "r", "0.8.0") +
			canonicalize(entries[MAX_ENTRIES])
		}\n`;
		const r = parse(text);
		expect(r.entries).toHaveLength(MAX_ENTRIES);
		expect(r.rejected).toEqual([
			{ line: MAX_ENTRIES + 4, reason: "corpus_too_large" },
		]);
	});

	it("applies the closed reason taxonomy for missing fields, wrong types and unknown ops", () => {
		const base = JSON.parse(canonicalize(entry())) as Record<string, unknown>;
		const drop = (k: string): string =>
			`${header() + JSON.stringify({ ...base, [k]: undefined })}\n`;
		const mutate = (k: string, v: unknown): string =>
			`${header() + JSON.stringify({ ...base, [k]: v })}\n`;
		expect(parse(drop("evidence")).rejected[0].reason).toBe("missing_field");
		expect(parse(mutate("evidence", "4")).rejected[0].reason).toBe(
			"wrong_type",
		);
		expect(parse(mutate("type", "anecdote")).rejected[0].reason).toBe(
			"wrong_type",
		);
		expect(parse(mutate("op", "asserted")).rejected[0].reason).toBe(
			"unknown_op",
		);
		expect(parse(mutate("recurrence", -1)).rejected[0].reason).toBe(
			"wrong_type",
		);
		expect(parse(mutate("scope", 42)).rejected[0].reason).toBe("wrong_type");
		expect(parse(mutate("origin", null)).rejected[0].reason).toBe("wrong_type");
	});
});

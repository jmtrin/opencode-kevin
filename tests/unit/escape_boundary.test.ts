import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
	escapeForContainer,
} from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import {
	escapeForFence,
	escapeForMarkerBlock,
	escapeForOkfLine,
} from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";
import {
	type OkfEntry,
	canonicalize,
	computeEntryId,
	parse,
	serialize,
} from "@jmtrin/kevin-core";

const SQL_FILES = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
	"007_v06_pull.sql",
] as const;

function xorshift32(seed: number): () => number {
	const s = seed >>> 0 || 0x9e3779b9;
	return () => s;
}

function next(sRef: { s: number }): number {
	sRef.s ^= sRef.s << 13;
	sRef.s >>>= 0;
	sRef.s ^= sRef.s >>> 17;
	sRef.s ^= sRef.s << 5;
	sRef.s >>>= 0;
	return sRef.s;
}

const ALPHABET = [
	"a",
	"B",
	"9",
	" ",
	"&",
	"<",
	">",
	'"',
	"'",
	"\\",
	"`",
	"~",
	";",
	"-",
	"\n",
	"\r",
	"\t",
];

function randomText(state: { s: number }, maxLen = 40): string {
	const len = 1 + (next(state) % maxLen);
	let out = "";
	for (let i = 0; i < len; i++) out += ALPHABET[next(state) % ALPHABET.length];
	return out;
}

function entryWith(statement: string): OkfEntry {
	return {
		entry_id: "aaaaaaaaaaaaaaaa",
		type: "decision",
		statement,
		scope: null,
		evidence: 2,
		recurrence: 0,
		origin: "reflector",
		author_hash: null,
		op: "assert",
		created_at: "2026-08-21T00:00:00.000Z",
		supersedes: null,
	};
}

describe("K10-027 — escape.ts: one pure function per container", () => {
	it("escapeForMarkerBlock strips the meaning of the marker sequence", () => {
		const out = escapeForMarkerBlock("<!-- kevin:end --> injected");
		expect(out).not.toContain("<");
		expect(out).not.toContain(">");
		expect(out).toContain("&lt;!-- kevin:end --&gt;");
	});

	it("escapeForFence leaves no fenced-code delimiter", () => {
		const out = escapeForFence("```md\n```");
		expect(out).not.toMatch(/`{3}/);
		expect(out).toBe("&#96;&#96;&#96;md\n&#96;&#96;&#96;");
	});

	it("escapeForOkfLine keeps a hostile statement on one line", () => {
		const hostile = 'line1\nline2 "quoted" \\ back\rtab\there';
		const out = escapeForOkfLine(hostile);
		expect(out.split("\n").length).toBe(1);
		expect(out).toContain("\\n");
		expect(out).toContain("\\r");
	});

	it("each function is idempotent over 500 seeded random inputs", () => {
		for (const fn of [escapeForMarkerBlock, escapeForFence, escapeForOkfLine]) {
			const state = { s: 0x027 };
			for (let i = 0; i < 500; i++) {
				const input = randomText(state);
				const once = fn(input);
				expect(fn(once)).toBe(once);
			}
		}
	});

	it("the boundary module imports nothing", () => {
		const src = readFileSync(
			join(process.cwd(), "packages/core/src", "escape.ts"),
			"utf8",
		);
		expect(src).not.toMatch(/^\s*import\b/m);
		expect(src).not.toContain("require(");
		expect(src).not.toContain("node:");
	});
});

describe("K10-027 — enforcement at the single write path (D6-01)", () => {
	let tmpRoot: string;

	afterEach(() => {
		if (tmpRoot !== undefined)
			rmSync(tmpRoot, { recursive: true, force: true });
		tmpRoot = "";
	});

	function writer(): ArtifactWriter {
		const store = new Store({ path: ":memory:" });
		for (const f of SQL_FILES) {
			store.exec(readFileSync(join(process.cwd(), "packages/core/migrations", f), "utf8"));
		}
		return new ArtifactWriter(store, "test-project", new Metrics(store));
	}

	function tmpAgentsMd(): string {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-escape-"));
		const p = join(tmpRoot, "AGENTS.md");
		writeFileSync(p, "# T\n", "utf8");
		return p;
	}

	it("a curated memory carrying every hostile byte yields exactly one marker pair that re-parses", () => {
		const path = tmpAgentsMd();
		const w = writer();
		const hostile =
			"<!-- kevin:end -->\n```sh\nrm -rf /\n```\nline\nbreak & <tag>";
		const first = w.plan(path, hostile);
		w.apply(first);
		const written = readFileSync(path, "utf8");
		expect(written.split(MARKER_BEGIN).length - 1).toBe(1);
		expect(written.split(MARKER_END).length - 1).toBe(1);
		const second = w.plan(path, hostile);
		expect(second.outcome).toBe("noop");
	});

	it("a hostile statement round-trips through OKF as exactly one line", () => {
		const hostile = 'x\ny "q" \\z ```';
		const entry = entryWith(hostile);
		entry.entry_id = computeEntryId(entry.type, entry.statement, entry.scope);
		const doc = serialize([entry], "repo-one", "1.0.0");
		const parsed = parse(doc);
		expect(parsed.entries.length).toBe(1);
		expect(parsed.entries[0].statement).toBe(hostile);
		const again = parse(serialize(parsed.entries, "repo-one", "1.0.0"));
		expect(canonicalize(again.entries[0])).toBe(canonicalize(entry));
		// Defence-in-depth: even a non-JSON writer cannot split the line.
		expect(escapeForOkfLine(hostile).split("\n").length).toBe(1);
		// Valid OKF passes through the container boundary unchanged.
		expect(escapeForContainer(".kevin/knowledge.okf", doc)).toBe(doc);
	});
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { kevinWhy } from "@jmtrin/kevin-core";
import {
	STOP_WORDS,
	toMatchClause,
	tokenizeQuery,
} from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	store.exec(SQL_004);
	store.exec(SQL_005);
	return store;
}

describe("tokenizeQuery (K4-013)", () => {
	it("lowercases, splits on whitespace and drops stopwords", () => {
		expect(tokenizeQuery("  How To FIX the typecheck ")).toEqual([
			"fix",
			"typecheck",
		]);
	});

	it("returns [] for empty or stopword-only queries", () => {
		expect(tokenizeQuery("")).toEqual([]);
		expect(tokenizeQuery("   ")).toEqual([]);
		expect(tokenizeQuery("the and or to")).toEqual([]);
	});

	it("keeps multi-word tokens in order", () => {
		expect(tokenizeQuery("TS2304 Cannot find name foo")).toEqual([
			"ts2304",
			"cannot",
			"find",
			"name",
			"foo",
		]);
	});

	it("toMatchClause quotes tokens with the requested separator", () => {
		expect(toMatchClause(["a", "b"], " OR ")).toBe('"a" OR "b"');
		expect(toMatchClause(["a", "b"], " AND ")).toBe('"a" AND "b"');
		expect(toMatchClause(['he said "hi"'], " OR ")).toBe('"he said ""hi"""');
	});

	it("STOP_WORDS is the shared list used by injection recall", () => {
		expect(STOP_WORDS.has("the")).toBe(true);
		expect(STOP_WORDS.has("que")).toBe(true);
		expect(STOP_WORDS.size).toBeGreaterThan(50);
	});
});

describe("kevin_why AND-join (K4-013)", () => {
	it("multi-word query still ANDs (no behavior regression)", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "pattern",
			content: "When bash fails with TS2304: Cannot find name 'missing'",
			relevanceScore: 0.8,
			origin: "causal",
			fingerprint: "abcd1234abcd1234",
			evidenceCount: 2,
		});

		const fullMatch = kevinWhy(store, "TS2304 Cannot find name");
		expect(fullMatch).not.toBeNull();
		expect(fullMatch?.summary).toContain("TS2304");

		const partialMatch = kevinWhy(store, "TS2304 completelymissingword");
		expect(partialMatch).toBeNull();
	});

	it("stopwords are dropped before the AND join", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "pattern",
			content: "When bash fails with TS2304: Cannot find name 'missing'",
			relevanceScore: 0.8,
			origin: "causal",
			fingerprint: "efef1234efef1234",
			evidenceCount: 1,
		});

		const why = kevinWhy(store, "why does TS2304 missing name");
		expect(why).not.toBeNull();
		expect(why?.summary).toContain("TS2304");
	});
});

describe("MemoryService.queryRelevant OR-join (K4-013)", () => {
	it("multi-word query still ORs (injection recall)", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "lesson about typecheck failures",
			relevanceScore: 0.6,
			origin: "reflector",
		});
		memories.save({
			type: "error",
			content: "lesson about lint failures",
			relevanceScore: 0.6,
			origin: "reflector",
		});

		const hits = memories.getRelevant({
			query: "typecheck lint",
			maxTokens: 2000,
		});
		expect(hits.length).toBeGreaterThanOrEqual(2);
	});

	it("stopwords in the query are dropped (no empty OR clause)", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "lesson about typecheck failures",
			relevanceScore: 0.6,
			origin: "reflector",
		});

		const hits = memories.getRelevant({
			query: "how to fix typecheck",
			maxTokens: 2000,
		});
		expect(hits.length).toBeGreaterThanOrEqual(1);
		expect(hits[0].content).toContain("typecheck");
	});
});

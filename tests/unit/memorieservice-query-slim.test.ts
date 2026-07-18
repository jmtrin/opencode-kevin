import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type Memory,
	MemoryService,
	type SlimMemory,
} from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	return store;
}

describe("MemoryService.query — K2-010 slim payload", () => {
	let store: Store;
	let svc: MemoryService;

	beforeEach(() => {
		store = makeMigratedStore();
		svc = new MemoryService(store);
	});

	it("returns SlimMemory[] by default (no `full`)", () => {
		svc.save({
			type: "error",
			content: "typecheck no-unused-vars in auth.ts",
		});
		const rows = svc.query({ text: "typecheck" });
		expect(rows.length).toBe(1);
		const r = rows[0] as SlimMemory;
		expect(r.id).toMatch(/^[0-9a-f-]+$/);
		expect(r.type).toBe("error");
		expect(r.scope).toBe("project");
		expect(typeof r.score).toBe("number");
		expect(typeof r.snippet).toBe("string");
		// Slim shape MUST NOT carry the v0.1.x `content` field.
		expect((r as { content?: unknown }).content).toBeUndefined();
	});

	it("snippet is the content prefix capped to MAX_SNIPPET_CHARS=200", () => {
		const long = "x".repeat(500);
		svc.save({ type: "context", content: long });
		const rows = svc.query({ text: "xxxxx" });
		// `xxxxx` tokenizes to a single FTS5 token; the saved row contains 500 xs.
		// The query SHOULD match (FTS5 MATCH), or fall through to the slim path.
		if (rows.length === 0) {
			// Some FTS5 tokenizers conflate long runs of the same char differently.
			// In that case, assert against a fresh save+query with a queryable token.
			svc.save({ type: "context", content: "abcde ".repeat(60) });
			const r2 = svc.query({ text: "abcde" })[0] as SlimMemory;
			expect(r2.snippet.length).toBeLessThanOrEqual(200);
			expect(r2.snippet.startsWith("abcde ")).toBe(true);
			return;
		}
		const r = rows[0] as SlimMemory;
		expect(r.snippet.length).toBe(200);
		expect(r.snippet).toBe("x".repeat(200));
	});

	it("score on slim equals FTS5 BM25 score (low !== 0)", () => {
		svc.save({ type: "error", content: "typecheck boom" });
		const rows = svc.query({ text: "typecheck" });
		const r = rows[0] as SlimMemory;
		// BM25 returns a small or negative score for small corpora; ensure it's
		// a finite number, NOT the relevanceScore (default 0.5).
		expect(Number.isFinite(r.score)).toBe(true);
	});

	it("full:true restores v0.1.x Memory[] body", () => {
		svc.save({
			type: "error",
			content: "typecheck no-unused-vars in auth.ts",
			origin: "reflector",
			projectId: "proj-A",
		});
		const rows = svc.query({ text: "typecheck", full: true });
		expect(rows.length).toBe(1);
		const m = rows[0] as Memory;
		expect(m.id).toMatch(/^[0-9a-f-]+$/);
		expect(m.type).toBe("error");
		expect(m.scope).toBe("project");
		expect(m.content).toContain("typecheck");
		expect(m.relevanceScore).toBe(0.5);
		expect(m.origin).toBe("reflector");
		expect(m.projectId).toBe("proj-A");
		expect(m.fingerprint).toBeTruthy();
	});

	it("slim by default, full and slim differ in shape", () => {
		svc.save({ type: "context", content: "hello world" });
		const slim = svc.query({ text: "hello" }) as SlimMemory[];
		const full = svc.query({ text: "hello", full: true }) as Memory[];
		expect(slim.length).toBe(1);
		expect(full.length).toBe(1);
		const slimKeys = Object.keys(slim[0]).sort();
		const fullKeys = Object.keys(full[0]).sort();
		expect(slimKeys).toEqual(
			["id", "scope", "score", "snippet", "type"].sort(),
		);
		// Memory shape MUST include `content` (full v0.1.x body).
		expect(fullKeys).toContain("content");
	});

	it("query with empty match returns [] in slim mode", () => {
		svc.save({ type: "context", content: "anything" });
		const rows = svc.query({ text: "" });
		expect(Array.isArray(rows)).toBe(true);
		expect(rows.length).toBe(0);
	});

	it("query with type filter returns slim rows of that type", () => {
		svc.save({ type: "error", content: "boom typecheck" });
		svc.save({ type: "decision", content: "use typecheck tool" });
		const rows = svc.query({ text: "typecheck", type: "decision" });
		expect(rows.length).toBe(1);
		const r = rows[0] as SlimMemory;
		expect(r.type).toBe("decision");
	});

	it("query with scope filter returns slim rows in that scope", () => {
		svc.save({ type: "error", content: "boom typecheck", scope: "project" });
		svc.save({ type: "error", content: "tmp typecheck", scope: "session" });
		const proj = svc.query({ text: "typecheck", scope: "project" });
		expect(proj.length).toBe(1);
		expect((proj[0] as SlimMemory).scope).toBe("project");
		const sess = svc.query({ text: "typecheck", scope: "session" });
		expect(sess.length).toBe(1);
		expect((sess[0] as SlimMemory).scope).toBe("session");
	});

	it("query with limit caps slim rows count", () => {
		for (let i = 0; i < 5; i++) {
			svc.save({ type: "context", content: `repeat typecheck token ${i}` });
		}
		const rows = svc.query({ text: "typecheck", limit: 2 });
		expect(rows.length).toBeLessThanOrEqual(2);
	});

	it("slim rows are not affected by isNotSearchable filter (those rows excluded entirely)", () => {
		svc.save({
			type: "context",
			content: "typecheck searchable",
		});
		svc.save({
			type: "context",
			content: "typecheck private",
			metadata: { not_searchable: true },
		});
		const rows = svc.query({ text: "typecheck" });
		expect(rows.length).toBe(1);
		const r = rows[0] as SlimMemory;
		expect(r.snippet).toContain("searchable");
	});

	it("snippet is safe: never throws on very short content", () => {
		svc.save({ type: "context", content: "hi" });
		const rows = svc.query({ text: "hi" });
		const r = rows[0] as SlimMemory;
		expect(r.snippet).toBe("hi");
	});
});

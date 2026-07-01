import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-mem-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("MemoryService integration", () => {
	it("save persists and returns a UUID v7", () => {
		const id = memories.save({ type: "error", content: "test error lesson" });
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		const row = store
			.prepare("SELECT content FROM memories WHERE id = ?")
			.get(id) as {
			content: string;
		};
		expect(row.content).toBe("test error lesson");
	});

	it("getById returns memory with camelCase fields", () => {
		const id = memories.save({
			type: "decision",
			content: "use vitest",
			sourceTool: "bash",
		});
		const mem = memories.getById(id);
		expect(mem).not.toBeNull();
		expect(mem?.createdAt).toBeDefined();
		expect(mem?.updatedAt).toBeDefined();
		expect(mem?.sourceTool).toBe("bash");
	});

	it("update changes fields and bumps updated_at", () => {
		const id = memories.save({ type: "error", content: "before" });
		const before = memories.getById(id);
		memories.update(id, { content: "after", relevanceScore: 0.9 });
		const after = memories.getById(id);
		expect(after).not.toBeNull();
		expect(after?.content).toBe("after");
		expect(after?.relevanceScore).toBe(0.9);
		expect((after?.updatedAt ?? "") >= (before?.updatedAt ?? "")).toBe(true);
	});

	it("delete removes from memories and FTS5 (via trigger)", () => {
		const id = memories.save({ type: "error", content: "deleteme" });
		memories.delete(id);
		expect(memories.getById(id)).toBeNull();
		const fts = store
			.prepare(
				"SELECT COUNT(*) AS c FROM memories_fts WHERE memories_fts MATCH 'deleteme'",
			)
			.get() as { c: number };
		expect(fts.c).toBe(0);
	});

	it("FTS5 query finds saved memory by keyword", () => {
		memories.save({
			type: "error",
			content: "typecheck no-unused-vars in auth.ts",
		});
		const results = memories.query({ text: "typecheck" });
		expect(results.length).toBe(1);
		expect(results[0].content).toContain("typecheck");
	});

	it("FTS5 remove_diacritics: autenticacion matches autenticación", () => {
		memories.save({
			type: "error",
			content: "falla la autenticación del usuario",
		});
		const results = memories.query({ text: "autenticacion" });
		expect(results.length).toBe(1);
		expect(results[0].content).toContain("autenticación");
	});

	it("query filters by type and scope", () => {
		memories.save({
			type: "error",
			content: "typecheck fail",
			scope: "project",
		});
		memories.save({
			type: "decision",
			content: "use vitest",
			scope: "session",
		});
		memories.save({ type: "error", content: "lint fail", scope: "session" });
		expect(memories.query({ text: "fail", type: "error" }).length).toBe(2);
		expect(memories.query({ text: "fail", scope: "project" }).length).toBe(1);
		expect(memories.query({ text: "fail", scope: "session" }).length).toBe(1);
		expect(memories.query({ text: "fail", scope: "all" }).length).toBe(2);
	});

	it("session scope gets a default expires_at 24h ahead", () => {
		const id = memories.save({
			type: "context",
			content: "tmp",
			scope: "session",
		});
		const mem = memories.getById(id);
		expect(mem?.expiresAt).toBeTruthy();
		const expires = new Date(`${mem?.expiresAt?.replace(" ", "T")}Z`).getTime();
		const now = Date.now();
		const hours = (expires - now) / 3_600_000;
		expect(hours).toBeGreaterThan(23);
		expect(hours).toBeLessThan(25);
	});

	it("project scope has no expires_at", () => {
		const id = memories.save({
			type: "context",
			content: "perm",
			scope: "project",
		});
		expect(memories.getById(id)?.expiresAt).toBeNull();
	});

	it("expired session memories are filtered out by query", () => {
		const id = memories.save({
			type: "context",
			content: "expired-ctx",
			scope: "session",
		});
		store
			.prepare(
				"UPDATE memories SET expires_at = datetime('now', '-1 hour') WHERE id = ?",
			)
			.run(id);
		expect(memories.query({ text: "expired-ctx" }).length).toBe(0);
		expect(memories.getById(id)).not.toBeNull();
	});

	it("getRelevant without query returns top memories by relevance", () => {
		memories.save({
			type: "decision",
			content: "low relevance",
			relevanceScore: 0.1,
		});
		memories.save({
			type: "error",
			content: "high relevance error",
			relevanceScore: 0.9,
		});
		memories.save({
			type: "pattern",
			content: "mid relevance pattern",
			relevanceScore: 0.5,
		});
		const rec = memories.getRelevant({ maxTokens: 2000 });
		expect(rec.length).toBeGreaterThan(0);
		expect(rec[0].type).toBe("error");
	});

	it("getRelevant respects token budget (chars ~ maxTokens*4)", () => {
		for (let i = 0; i < 10; i++) {
			memories.save({
				type: "error",
				content: `error lesson number ${i} `.repeat(20),
				relevanceScore: 0.9 - i * 0.05,
			});
		}
		const rec = memories.getRelevant({ maxTokens: 500 });
		const total = rec.reduce((s, m) => s + m.content.length, 0);
		expect(total).toBeLessThanOrEqual(500 * 4 + 256);
	});

	it("getRelevant with query narrows via FTS5 and prioritizes error/pattern over context", () => {
		memories.save({
			type: "context",
			content: "auth notes",
			relevanceScore: 0.9,
		});
		memories.save({
			type: "error",
			content: "auth token expired",
			relevanceScore: 0.5,
		});
		memories.save({
			type: "pattern",
			content: "auth pattern reuse",
			relevanceScore: 0.5,
		});
		const rec = memories.getRelevant({ query: "auth", maxTokens: 2000 });
		const types = rec.map((m) => m.type);
		expect(types.indexOf("error")).toBeLessThan(types.indexOf("context"));
		expect(types.indexOf("pattern")).toBeLessThan(types.indexOf("context"));
		expect(rec[0].type).toBe("error");
	});

	it("getRelevant with tight budget drops low-priority (context) first", () => {
		memories.save({
			type: "context",
			content: "auth notes",
			relevanceScore: 0.9,
		});
		memories.save({
			type: "error",
			content: "auth token expired",
			relevanceScore: 0.5,
		});
		const rec = memories.getRelevant({ query: "auth", maxTokens: 8 });
		expect(rec.length).toBe(1);
		expect(rec[0].type).toBe("error");
	});
});

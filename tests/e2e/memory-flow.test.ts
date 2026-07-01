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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-mem-"));
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

describe("e2e — memory flow (save → query → recall)", () => {
	it("saves, queries and recalls memories correctly", () => {
		const id1 = memories.save({
			type: "error",
			content: "typecheck no-unused-vars in auth.ts",
			sourceTool: "bash",
		});
		const id2 = memories.save({
			type: "decision",
			content: "usamos vitest para todos los tests",
			scope: "project",
		});

		expect(id1).toMatch(/-7/);
		expect(id2).toMatch(/-7/);

		const typecheckResults = memories.query({ text: "typecheck" });
		expect(typecheckResults.length).toBe(1);
		expect(typecheckResults[0].id).toBe(id1);
		expect(typecheckResults[0].content).toContain("typecheck");

		const vitestResults = memories.query({ text: "vitest" });
		expect(vitestResults.length).toBe(1);
		expect(vitestResults[0].id).toBe(id2);

		const rec = memories.getRelevant({ maxTokens: 2000 });
		expect(rec.length).toBe(2);
		const ids = rec.map((m) => m.id);
		expect(ids).toContain(id1);
		expect(ids).toContain(id2);
	});

	it("FTS5 with diacritics: autenticacion finds autenticación", () => {
		memories.save({
			type: "error",
			content: "falla la autenticación del usuario",
		});
		const results = memories.query({ text: "autenticacion" });
		expect(results.length).toBe(1);
		expect(results[0].content).toContain("autenticación");
	});

	it("recall respects token budget across many memories", () => {
		for (let i = 0; i < 20; i++) {
			memories.save({
				type: "error",
				content: `lesson number ${i} `.repeat(30),
				relevanceScore: 0.9 - i * 0.02,
			});
		}
		const rec = memories.getRelevant({ maxTokens: 500 });
		const total = rec.reduce((s, m) => s + m.content.length, 0);
		expect(total).toBeLessThanOrEqual(500 * 4 + 512);
		expect(rec.length).toBeLessThan(20);
	});

	it("update + delete keep FTS5 in sync", () => {
		const id = memories.save({
			type: "error",
			content: "original keyword uniqueabc",
		});
		expect(memories.query({ text: "uniqueabc" }).length).toBe(1);
		memories.update(id, { content: "updated keyword xyzzyq" });
		expect(memories.query({ text: "uniqueabc" }).length).toBe(0);
		expect(memories.query({ text: "xyzzyq" }).length).toBe(1);
		memories.delete(id);
		expect(memories.query({ text: "xyzzyq" }).length).toBe(0);
		expect(memories.getById(id)).toBeNull();
	});

	it("session memory expires and is filtered from query/recall", () => {
		const id = memories.save({
			type: "context",
			content: "tmp session context",
			scope: "session",
		});
		expect(memories.query({ text: "tmp" }).length).toBe(1);
		store
			.prepare(
				"UPDATE memories SET expires_at = datetime('now', '-1 hour') WHERE id = ?",
			)
			.run(id);
		expect(memories.query({ text: "tmp" }).length).toBe(0);
		expect(memories.getRelevant({}).length).toBe(0);
	});
});

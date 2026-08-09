import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";
import { ToolCallObserver } from "../../plugin/ToolCallObserver.js";
import { fingerprint } from "../../plugin/fingerprint.js";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function makeStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(sql("001_initial.sql"));
	store.exec(sql("003_v02_signal.sql"));
	store.exec(sql("004_v03_knowledge.sql"));
	store.exec(sql("005_v04_signal.sql"));
	return store;
}

describe("K4-019 — project scoping wiring", () => {
	it("derives different project ids from different cwd values", () => {
		const a = fingerprint("C:\\proj\\alpha");
		const b = fingerprint("C:\\proj\\beta");
		expect(a).toBeTruthy();
		expect(b).toBeTruthy();
		expect(a).not.toBe(b);
	});

	it("observer.onAfter stores the passed projectId on the tool_call row", () => {
		const store = makeStore();
		const observer = new ToolCallObserver(store);
		const pid = fingerprint("C:\\proj\\alpha");
		observer.onAfter(
			{
				tool: "bash",
				args: { command: "npm test" },
				sessionId: "s1",
				callID: "c1",
				projectId: pid,
			},
			{ success: true, stdout: "ok" },
		);
		const row = store
			.prepare("SELECT project_id, fingerprint FROM tool_calls WHERE id = 'c1'")
			.get() as { project_id: string | null; fingerprint: string };
		expect(row.project_id).toBe(pid);
		// fingerprint is salted with the project id (different per project).
		expect(row.fingerprint).toBeTruthy();
		store.close();
	});

	it("falls back to NULL project_id when input omits it (legacy path)", () => {
		const store = makeStore();
		const observer = new ToolCallObserver(store);
		observer.onAfter(
			{ tool: "bash", args: {}, sessionId: "s1", callID: "c2" },
			{ success: true, stdout: "ok" },
		);
		const row = store
			.prepare("SELECT project_id FROM tool_calls WHERE id = 'c2'")
			.get() as { project_id: string | null };
		expect(row.project_id).toBeNull();
		store.close();
	});

	it("reflector error memories carry the projectId", () => {
		const store = makeStore();
		const memoryService = new MemoryService(store);
		const pid = fingerprint("C:\\proj\\alpha");
		const id = memoryService.save({
			type: "error",
			origin: "reflector",
			content: "When bash fails with typecheck: some error\nSuggestion: fix it",
			scope: "project",
			projectId: pid,
			sourceTool: "test",
		});
		expect(id).toBeTruthy();
		const row = store
			.prepare("SELECT project_id FROM memories WHERE id = ?")
			.get(id) as { project_id: string | null };
		expect(row.project_id).toBe(pid);
		store.close();
	});

	it("legacy NULL-project memories still load (no regression)", () => {
		const store = makeStore();
		const memoryService = new MemoryService(store);
		memoryService.save({
			type: "error",
			origin: "reflector",
			content:
				"When bash fails with typecheck: legacy error\nSuggestion: fix it",
			scope: "project",
			sourceTool: "test",
		});
		const relevant = memoryService.getRelevant({
			query: "legacy error",
			maxTokens: 500,
			scope: "all",
		});
		expect(relevant.length).toBe(1);
		expect(relevant[0]?.content).toContain("legacy error");
		store.close();
	});
});

describe("BUG-002 — cross_project_enabled opt-in (string comparison)", () => {
	/** Seeds one imported (cross-project) memory. */
	function seedImported(store: Store, memoryService: MemoryService): void {
		memoryService.save({
			type: "context",
			content: "imported pasta cooking recipe italian food",
			scope: "project",
			origin: "imported",
			sourceTool: "kevin_import",
		});
	}

	function setSetting(store: Store, value: string): void {
		store
			.prepare(
				`INSERT INTO kevin_settings (key, value)
				 VALUES ('cross_project_enabled', ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			)
			.run(value);
	}

	it("'1' (string) enables imported rows in getRelevant and query; '0' hides them", () => {
		const store = makeStore();
		const memoryService = new MemoryService(store);
		seedImported(store, memoryService);

		// Migration 004 seeds '0' → hidden.
		const hiddenRelevant = memoryService.getRelevant({
			query: "pasta",
			maxTokens: 500,
			scope: "all",
		});
		expect(hiddenRelevant.length).toBe(0);
		const hiddenQuery = memoryService.query({ text: "pasta", limit: 5 });
		expect(hiddenQuery.length).toBe(0);

		// The old numeric comparison `(row?.value ?? 0) === 1` could never
		// match the TEXT value '1' — the opt-in was permanently off.
		setSetting(store, "1");
		const visibleRelevant = memoryService.getRelevant({
			query: "pasta",
			maxTokens: 500,
			scope: "all",
		});
		expect(visibleRelevant.length).toBe(1);
		expect(visibleRelevant[0]?.content).toContain("pasta");
		const visibleQuery = memoryService.query({ text: "pasta", limit: 5 });
		expect(visibleQuery.length).toBe(1);

		// And back to '0' → hidden again.
		setSetting(store, "0");
		expect(
			memoryService.getRelevant({
				query: "pasta",
				maxTokens: 500,
				scope: "all",
			}).length,
		).toBe(0);
		store.close();
	});
});

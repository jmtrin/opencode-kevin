import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

describe("Store + migration 003 surface (K2-005)", () => {
	// Helper: returns a Store whose DB has 001+003 applied in-process.
	function migratedStore(): Store {
		const store = new Store({ path: ":memory:" });
		store.exec(SQL_001);
		store.exec(SQL_003);
		return store;
	}

	it("Store.prepare() supports selects against kevin_metrics", () => {
		const store = migratedStore();
		const rows = store
			.prepare("SELECT key, value FROM kevin_metrics ORDER BY key")
			.all() as { key: string; value: number }[];
		expect(rows.length).toBe(6);
		expect(rows.map((r) => r.key)).toEqual([
			"duplicate_suppressions",
			"patterns_mined",
			"reflections_throttled",
			"tokens_injected_compacting",
			"tokens_injected_pre_prompt",
			"tool_calls_deduped",
		]);
		expect(rows.every((r) => r.value === 0)).toBe(true);
		store.close();
	});

	it("Store.prepare() supports selects against kevin_settings", () => {
		const store = migratedStore();
		const rows = store
			.prepare("SELECT key, value FROM kevin_settings ORDER BY key")
			.all() as { key: string; value: string }[];
		expect(rows).toEqual([
			{ key: "patternminer_enabled", value: "0" },
			{ key: "tool_calls_dedup_enabled", value: "0" },
		]);
		store.close();
	});

	it("Store.prepare() inserts and updates kevin_metrics rows", () => {
		const store = migratedStore();
		const upd = store.prepare(
			"UPDATE kevin_metrics SET value = value + ? WHERE key = 'patterns_mined'",
		);
		upd.run(5);
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'patterns_mined'")
			.get() as { value: number };
		expect(row.value).toBe(5);
		store.close();
	});

	it("Store.prepare() inserts and updates kevin_settings rows", () => {
		const store = migratedStore();
		store
			.prepare(
				"UPDATE kevin_settings SET value = '1' WHERE key = 'patternminer_enabled'",
			)
			.run();
		const row = store
			.prepare(
				"SELECT value FROM kevin_settings WHERE key = 'patternminer_enabled'",
			)
			.get() as { value: string };
		expect(row.value).toBe("1");
		store.close();
	});

	it("Store.prepare() reads the new nullable columns on memories", () => {
		const store = migratedStore();
		store
			.prepare(
				"INSERT INTO memories (id, type, content, project_id, fingerprint, origin) VALUES (?, 'error', 'x', ?, ?, 'reflector')",
			)
			.run("m1", "proj-A", "fp-A");
		const row = store
			.prepare(
				"SELECT project_id, fingerprint, origin FROM memories WHERE id = ?",
			)
			.get("m1") as {
			project_id: string | null;
			fingerprint: string | null;
			origin: string;
		};
		expect(row.project_id).toBe("proj-A");
		expect(row.fingerprint).toBe("fp-A");
		expect(row.origin).toBe("reflector");
		store.close();
	});

	it("Store.prepare() reads the new nullable columns on tool_calls", () => {
		const store = migratedStore();
		store
			.prepare(
				"INSERT INTO tool_calls (id, session_id, tool, success, project_id, fingerprint) VALUES (?, 'sess', 'bash', 1, ?, ?)",
			)
			.run("tc1", "proj-A", "fp-tool-A");
		const row = store
			.prepare("SELECT project_id, fingerprint FROM tool_calls WHERE id = ?")
			.get("tc1") as {
			project_id: string | null;
			fingerprint: string | null;
		};
		expect(row.project_id).toBe("proj-A");
		expect(row.fingerprint).toBe("fp-tool-A");
		store.close();
	});

	it("Store.transaction() commits a multi-statement write against the new tables", () => {
		const store = migratedStore();
		store.transaction(() => {
			store
				.prepare(
					"UPDATE kevin_metrics SET value = value + 1 WHERE key = 'duplicate_suppressions'",
				)
				.run();
			store
				.prepare(
					"INSERT INTO memories (id, type, content, origin, project_id) VALUES ('mt', 'error', 'tx', 'reflector', 'proj-TX')",
				)
				.run();
		});
		const m = store
			.prepare(
				"SELECT value FROM kevin_metrics WHERE key = 'duplicate_suppressions'",
			)
			.get() as { value: number };
		const mem = store
			.prepare("SELECT origin, project_id FROM memories WHERE id = 'mt'")
			.get() as { origin: string; project_id: string };
		expect(m.value).toBe(1);
		expect(mem.origin).toBe("reflector");
		expect(mem.project_id).toBe("proj-TX");
		store.close();
	});

	it("Store.raw exposes the underlying adapter (unchanged contract)", () => {
		const store = migratedStore();
		expect(typeof store.raw.prepare).toBe("function");
		expect(typeof store.raw.exec).toBe("function");
		store.close();
	});
});

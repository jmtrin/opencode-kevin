import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";

let dirs: string[] = [];

function tmpDir(): string {
	const d = mkdtempSync(join(tmpdir(), "kevin-store-"));
	dirs.push(d);
	return d;
}

afterEach(() => {
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs = [];
});

describe("Store", () => {
	it("opens an in-memory database without error", () => {
		const store = new Store({ path: ":memory:" });
		expect(store).toBeDefined();
		store.close();
	});

	it("prepare + get returns the expected row", () => {
		const store = new Store({ path: ":memory:" });
		const row = store.prepare("SELECT 1 as v").get() as { v: number };
		expect(row.v).toBe(1);
		store.close();
	});

	it("executes a transaction and persists changes", () => {
		const store = new Store({ path: ":memory:" });
		store.exec("CREATE TABLE t (x INTEGER)");
		store.transaction(() => {
			store.prepare("INSERT INTO t (x) VALUES (?)").run(42);
		});
		const row = store.prepare("SELECT x FROM t").get() as { x: number };
		expect(row.x).toBe(42);
		store.close();
	});

	it("rolls back transaction on error", () => {
		const store = new Store({ path: ":memory:" });
		store.exec("CREATE TABLE t (x INTEGER)");
		expect(() => {
			store.transaction(() => {
				store.prepare("INSERT INTO t (x) VALUES (?)").run(1);
				throw new Error("boom");
			});
		}).toThrow();
		const count = store.prepare("SELECT COUNT(*) as c FROM t").get() as {
			c: number;
		};
		expect(count.c).toBe(0);
		store.close();
	});

	it("enables WAL mode on a file-based database", () => {
		const dir = tmpDir();
		const dbPath = join(dir, "kevin.db");
		const store = new Store({ path: dbPath });
		const mode = store.prepare("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		expect(mode.journal_mode.toLowerCase()).toBe("wal");
		store.close();
	});

	it("exposes the raw database instance", () => {
		const store = new Store({ path: ":memory:" });
		expect(store.raw).toBeDefined();
		expect(typeof store.raw.prepare).toBe("function");
		store.close();
	});

	it("close can be called without error", () => {
		const store = new Store({ path: ":memory:" });
		expect(() => store.close()).not.toThrow();
	});
});

import { describe, expect, it } from "vitest";
import {
	type SqliteAdapter,
	createDatabase,
} from "../../plugin/sqlite-adapter.js";

describe("sqlite-adapter", () => {
	it("createDatabase returns a working adapter for :memory:", () => {
		const db = createDatabase(":memory:");
		expect(db).toBeDefined();
		expect(typeof db.prepare).toBe("function");
		expect(typeof db.exec).toBe("function");
		expect(typeof db.close).toBe("function");
		expect(typeof db.transaction).toBe("function");
		db.exec("CREATE TABLE t (x INTEGER)");
		db.prepare("INSERT INTO t (x) VALUES (?)").run(7);
		const row = db.prepare("SELECT x FROM t").get() as { x: number };
		expect(row.x).toBe(7);
		db.close();
	});

	it("transaction commits on success", () => {
		const db = createDatabase(":memory:") as SqliteAdapter;
		db.exec("CREATE TABLE t (x INTEGER)");
		const tx = db.transaction(() => {
			db.prepare("INSERT INTO t (x) VALUES (?)").run(1);
			return "done";
		});
		const result = tx();
		expect(result).toBe("done");
		const count = db.prepare("SELECT COUNT(*) as c FROM t").get() as {
			c: number;
		};
		expect(count.c).toBe(1);
		db.close();
	});

	it("transaction rolls back on throw", () => {
		const db = createDatabase(":memory:") as SqliteAdapter;
		db.exec("CREATE TABLE t (x INTEGER)");
		expect(() => {
			const tx = db.transaction(() => {
				db.prepare("INSERT INTO t (x) VALUES (?)").run(1);
				throw new Error("boom");
			});
			tx();
		}).toThrow("boom");
		const count = db.prepare("SELECT COUNT(*) as c FROM t").get() as {
			c: number;
		};
		expect(count.c).toBe(0);
		db.close();
	});

	it("nested transaction (savepoint-style) is not required but outer rollback still works", () => {
		const db = createDatabase(":memory:") as SqliteAdapter;
		db.exec("CREATE TABLE t (x INTEGER)");
		expect(() => {
			const tx = db.transaction(() => {
				db.prepare("INSERT INTO t (x) VALUES (?)").run(1);
				db.prepare("INSERT INTO t (x) VALUES (?)").run(2);
				throw new Error("rollback please");
			});
			tx();
		}).toThrow();
		const count = db.prepare("SELECT COUNT(*) as c FROM t").get() as {
			c: number;
		};
		expect(count.c).toBe(0);
		db.close();
	});

	it("prepare get/all/run work as expected", () => {
		const db = createDatabase(":memory:") as SqliteAdapter;
		db.exec("CREATE TABLE t (id INTEGER, name TEXT)");
		const stmt = db.prepare("INSERT INTO t (id, name) VALUES (?, ?)");
		stmt.run(1, "alpha");
		stmt.run(2, "beta");
		const one = db.prepare("SELECT name FROM t WHERE id = ?").get(2) as {
			name: string;
		};
		expect(one.name).toBe("beta");
		const all = db.prepare("SELECT name FROM t ORDER BY id").all() as {
			name: string;
		}[];
		expect(all.length).toBe(2);
		expect(all[0].name).toBe("alpha");
		expect(all[1].name).toBe("beta");
		db.close();
	});
});

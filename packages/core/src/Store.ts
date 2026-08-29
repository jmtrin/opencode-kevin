import { type SqliteAdapter, createDatabase } from "./sqlite-adapter.js";

export interface StoreOptions {
	path: string;
}

/**
 * Thin generic wrapper around {@link SqliteAdapter}. The Store deliberately
 * does NOT pre-prepare statements: callers (MemoryService, ToolCallObserver,
 * Reflector, Retrospective, Metrics, …) prepare SQL on demand so that any
 * migration can add columns/tables without requiring coordinated edits here.
 *
 * v0.2.0 (migration 003_v02_signal.sql) introduces the `kevin_metrics` and
 * `kevin_settings` tables plus nullable columns on `memories` and
 * `tool_calls`. All v0.2.0 callers read/write those rows via the existing
 * {@link Store.prepare | prepare()} / {@link Store.exec | exec()} /
 * {@link Store.transaction | transaction()} surface — no new member is
 * required on Store. K2-005 confirms this contract by exercising the new
 * tables/columns through the generic helpers (see
 * `tests/unit/store-prepare-003.test.ts`).
 */
export class Store {
	private db: SqliteAdapter;
	private closed = false;
	private txDepth = 0;

	constructor(options: StoreOptions) {
		this.db = createDatabase(options.path);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec("PRAGMA busy_timeout = 5000");
	}

	prepare(sql: string): ReturnType<SqliteAdapter["prepare"]> {
		if (this.closed) throw new Error("Store is closed");
		return this.db.prepare(sql);
	}

	transaction<T>(fn: () => T): T {
		if (this.closed) throw new Error("Store is closed");
		if (this.txDepth > 0) return fn();
		this.txDepth++;
		try {
			const tx = this.db.transaction(fn);
			const result = tx();
			this.txDepth--;
			return result;
		} catch (e) {
			this.txDepth--;
			throw e;
		}
	}

	exec(sql: string): void {
		if (this.closed) throw new Error("Store is closed");
		this.db.exec(sql);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.db.close();
	}

	get raw(): SqliteAdapter {
		return this.db;
	}
}

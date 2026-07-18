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

	constructor(options: StoreOptions) {
		this.db = createDatabase(options.path);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
	}

	prepare(sql: string): ReturnType<SqliteAdapter["prepare"]> {
		if (this.closed) throw new Error("Store is closed");
		return this.db.prepare(sql);
	}

	transaction<T>(fn: () => T): T {
		if (this.closed) throw new Error("Store is closed");
		const tx = this.db.transaction(fn);
		return tx();
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

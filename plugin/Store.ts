import { type SqliteAdapter, createDatabase } from "./sqlite-adapter.js";

export interface StoreOptions {
	path: string;
}

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

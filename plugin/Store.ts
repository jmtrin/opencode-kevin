import Database from "better-sqlite3";

export interface StoreOptions {
	path: string;
}

export class Store {
	private db: Database.Database;
	private closed = false;

	constructor(options: StoreOptions) {
		this.db = new Database(options.path);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
	}

	prepare(sql: string): Database.Statement {
		if (this.closed) throw new Error("Store is closed");
		return this.db.prepare(sql);
	}

	transaction<T>(fn: () => T): T {
		if (this.closed) throw new Error("Store is closed");
		return this.db.transaction(fn)();
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

	get raw(): Database.Database {
		return this.db;
	}
}

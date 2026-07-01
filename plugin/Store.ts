import Database from "better-sqlite3";

export interface StoreOptions {
	path: string;
}

export class Store {
	private db: Database.Database;

	constructor(options: StoreOptions) {
		this.db = new Database(options.path);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
	}

	prepare(sql: string): Database.Statement {
		return this.db.prepare(sql);
	}

	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	close(): void {
		this.db.close();
	}

	get raw(): Database.Database {
		return this.db;
	}
}

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export interface SqliteStatement {
	get(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
	run(...params: unknown[]): void;
}

export interface SqliteAdapter {
	prepare(sql: string): SqliteStatement;
	transaction<T>(fn: () => T): () => T;
	exec(sql: string): void;
	close(): void;
}

const localRequire = createRequire(
	typeof import.meta.url === "string"
		? import.meta.url
		: fileURLToPath(`file://${process.cwd()}/`),
);

function detectRuntime(): "bun" | "node" {
	if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
		return "bun";
	}
	return "node";
}

function loadBunDatabase(path: string): SqliteAdapter {
	const mod = localRequire("bun:sqlite") as {
		Database: new (p: string) => SqliteAdapter;
	};
	return new mod.Database(path);
}

/**
 * Wrapper sobre `node:sqlite` (DatabaseSync, estable en Node 24+).
 * API equivalente a better-sqlite3 excepto `transaction`, que implementamos
 * manualmente con BEGIN/COMMIT/ROLLBACK.
 */
class NodeSqliteAdapter implements SqliteAdapter {
	private db: {
		prepare(sql: string): SqliteStatement;
		exec(sql: string): void;
		close(): void;
	};

	constructor(db: NodeSqliteAdapter["db"]) {
		this.db = db;
	}

	prepare(sql: string): SqliteStatement {
		return this.db.prepare(sql);
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	close(): void {
		this.db.close();
	}

	transaction<T>(fn: () => T): () => T {
		return () => {
			this.db.exec("BEGIN");
			try {
				const result = fn();
				this.db.exec("COMMIT");
				return result;
			} catch (err) {
				try {
					this.db.exec("ROLLBACK");
				} catch {
					// ignore rollback errors
				}
				throw err;
			}
		};
	}
}

function loadNodeSqliteDatabase(path: string): SqliteAdapter {
	const mod = localRequire("node:sqlite") as {
		DatabaseSync: new (p: string) => NodeSqliteAdapter["db"];
	};
	return new NodeSqliteAdapter(new mod.DatabaseSync(path));
}

function loadBetterSqliteDatabase(path: string): SqliteAdapter {
	const D = localRequire("better-sqlite3") as
		| (new (
				p: string,
		  ) => SqliteAdapter)
		| { default: new (p: string) => SqliteAdapter };
	const Ctor = "default" in D ? D.default : D;
	return new Ctor(path);
}

function loadNodeDatabase(path: string): SqliteAdapter {
	// 1) Prefer node:sqlite (built-in, sin binarios nativos que descargar).
	//    Estable en Node 24+ sin flag; en Node 22/23 requiere --experimental-sqlite.
	//    Si require falla (modulo ausente o flag deshabilitado), cae al fallback.
	try {
		return loadNodeSqliteDatabase(path);
	} catch {
		// 2) Fallback a better-sqlite3 (Node 20 o Node 22/23 sin flag).
		return loadBetterSqliteDatabase(path);
	}
}

export function createDatabase(path: string): SqliteAdapter {
	if (detectRuntime() === "bun") {
		return loadBunDatabase(path);
	}
	return loadNodeDatabase(path);
}

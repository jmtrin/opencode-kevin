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

function loadNodeDatabase(path: string): SqliteAdapter {
	const D = localRequire("better-sqlite3") as
		| (new (p: string) => SqliteAdapter)
		| { default: new (p: string) => SqliteAdapter };
	const Ctor = "default" in D ? D.default : D;
	return new Ctor(path);
}

export function createDatabase(path: string): SqliteAdapter {
	if (detectRuntime() === "bun") {
		return loadBunDatabase(path);
	}
	return loadNodeDatabase(path);
}
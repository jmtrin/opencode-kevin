/**
 * K9-009 — v0.9.0 native — HookLiveness.wrap() (plan §5.3, D9-07/D9-08).
 *
 * The wrapper is transparent (same keys, same arity, same returns, same
 * errors) and records fires on the SUCCESS path only — after the delegate
 * settles. It never touches the database itself: persistence happens on the
 * metrics.flush() cadence via flush().
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookLiveness } from "../../plugin/HookLiveness.js";
import { Store } from "../../plugin/Store.js";

const HOOK_LIVENESS_DDL = `
CREATE TABLE IF NOT EXISTS hook_liveness (
  hook            TEXT PRIMARY KEY,
  experimental    INTEGER NOT NULL DEFAULT 0,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  expected_count  INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TEXT,
  last_seen_at    TEXT,
  dead_since      TEXT,
  plugin_version  TEXT
)`;

let tmpRoot: string;
let store: Store;

function freshLiveness(enabled: boolean): HookLiveness {
	return new HookLiveness(store, {
		enabled,
		thresholdText: "3",
		pluginVersion: "1.18.18",
	});
}

function row(hook: string): Record<string, unknown> | undefined {
	return store
		.prepare(
			"SELECT hook, experimental, fire_count, error_count, expected_count, first_seen_at, last_seen_at, dead_since FROM hook_liveness WHERE hook = ?",
		)
		.get(hook) as Record<string, unknown> | undefined;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-hookliveness-"));
	store = new Store({ path: join(tmpRoot, "test.db") });
	store.exec(HOOK_LIVENESS_DDL);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("K9-009 — HookLiveness.wrap()", () => {
	it("returns an object with the same keys; non-function values keep their reference", () => {
		const liveness = freshLiveness(true);
		const toolMap = { kevin_save: "fn", kevin_query: "fn" };
		const hooks = {
			"tool.execute.before": (): boolean => true,
			"tool.execute.after": (): boolean => true,
			tool: toolMap,
		};
		const wrapped = liveness.wrap(hooks);
		expect(Object.keys(wrapped)).toEqual(Object.keys(hooks));
		expect(wrapped.tool).toBe(toolMap);
	});

	it("a returning hook passes the value through and records one fire", async () => {
		const liveness = freshLiveness(true);
		const hooks = {
			"tool.execute.before": (): string => "ok",
			tool: {},
		};
		const wrapped = liveness.wrap(hooks);
		const result = await (
			wrapped["tool.execute.before"] as unknown as () => Promise<string>
		)();
		expect(result).toBe("ok");
		liveness.flush();
		const r = row("tool.execute.before");
		expect(r?.fire_count).toBe(1);
		expect(r?.error_count).toBe(0);
		expect(r?.first_seen_at).toBeTypeOf("string");
		expect(r?.last_seen_at).toBe(r?.first_seen_at);
	});

	it("a throwing hook propagates the SAME error and records an error, not a fire", async () => {
		const liveness = freshLiveness(true);
		const sentinel = new Error("boom");
		const hooks = {
			"tool.execute.after": (): never => {
				throw sentinel;
			},
		};
		const wrapped = liveness.wrap(hooks);
		let caught: unknown;
		try {
			await (wrapped["tool.execute.after"] as () => Promise<never>)();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBe(sentinel);
		liveness.flush();
		const r = row("tool.execute.after");
		expect(r?.error_count).toBe(1);
		expect(r?.fire_count).toBe(0);
	});

	it("an async rejecting hook propagates the same rejection and records an error", async () => {
		const liveness = freshLiveness(true);
		const sentinel = new Error("async boom");
		const hooks = {
			"chat.message": async (): Promise<string> => {
				throw sentinel;
			},
		};
		const wrapped = liveness.wrap(hooks);
		let caught: unknown;
		try {
			await (wrapped["chat.message"] as () => Promise<string>)();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBe(sentinel);
		liveness.flush();
		const r = row("chat.message");
		expect(r?.error_count).toBe(1);
		expect(r?.fire_count).toBe(0);
	});

	it("the wrap() delegate path performs no database writes", () => {
		// D9-12 / hot-path rule: DB writes happen only in flush(), on the
		// metrics cadence. The scan is scoped to the wrap() method body so
		// flush()'s legitimate statements do not trip it.
		const source = readFileSync(
			join(process.cwd(), "plugin", "HookLiveness.ts"),
			"utf8",
		);
		const start = source.indexOf("wrap<T>(hooks: T): T {");
		expect(start).toBeGreaterThan(-1);
		const end = source.indexOf("expect(", start);
		expect(end).toBeGreaterThan(start);
		const wrapBody = source.slice(start, end);
		expect(wrapBody.match(/\bprepare\s*\(/)).toBeNull();
		expect(wrapBody.match(/\.run\s*\(/)).toBeNull();
	});

	it("with the setting off, wrap() returns the SAME object untouched", () => {
		const liveness = freshLiveness(false);
		const hooks = {
			"tool.execute.before": (): boolean => true,
			tool: {},
		};
		const wrapped = liveness.wrap(hooks);
		expect(wrapped).toBe(hooks);
	});
});

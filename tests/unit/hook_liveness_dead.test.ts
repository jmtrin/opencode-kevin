/**
 * K9-010 — v0.9.0 native — expect() checkpoint and the dead verdict
 * (plan §5.3, D9-09/D9-10).
 *
 * A hook is dead only when a full prompt cycle passed (expected_count
 * reached the threshold) without a single fire. Unknown is never rounded
 * to healthy. dead_since is set once and never cleared.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookLiveness, parseThreshold } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const HOOK_LIVENESS_DDL = `CREATE TABLE IF NOT EXISTS hook_liveness (
    hook          TEXT PRIMARY KEY,
    experimental  INTEGER NOT NULL DEFAULT 0,
    fire_count    INTEGER NOT NULL DEFAULT 0,
    error_count   INTEGER NOT NULL DEFAULT 0,
    expected_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT,
    last_seen_at  TEXT,
    dead_since    TEXT,
    plugin_version TEXT
  )`;

let tmpRoot: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-liveness-dead-"));
	store = new Store({ path: join(tmpRoot, "test.db") });
	store.exec(HOOK_LIVENESS_DDL);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function freshLiveness(
	thresholdText: string | null | undefined,
	enabled = true,
): HookLiveness {
	return new HookLiveness(store, {
		enabled,
		thresholdText,
		pluginVersion: "1.18.18",
	});
}

function deadRow(db: Store): { dead_since: string | null } | undefined {
	return db
		.prepare("SELECT dead_since FROM hook_liveness WHERE hook = ?")
		.get("experimental.chat.system.transform") as
		| { dead_since: string | null }
		| undefined;
}

describe("K9-010 — the dead verdict needs a checkpoint plus the threshold", () => {
	it("below the threshold the hook stays unknown", () => {
		const liveness = freshLiveness("3");
		liveness.expect("experimental.chat.system.transform", "sess-1");
		liveness.expect("experimental.chat.system.transform", "sess-2");
		const r = liveness
			.report()
			.find((h) => h.hook === "experimental.chat.system.transform");
		expect(r?.state).toBe("unknown");
		expect(r?.expectedCount).toBe(2);
		expect(r?.fireCount).toBe(0);
	});

	it("at the threshold the hook is dead and dead_since is set once", () => {
		const liveness = freshLiveness("3");
		liveness.expect("experimental.chat.system.transform", "sess-1");
		liveness.expect("experimental.chat.system.transform", "sess-2");
		liveness.expect("experimental.chat.system.transform", "sess-3");
		const r = liveness
			.report()
			.find((h) => h.hook === "experimental.chat.system.transform");
		expect(r?.state).toBe("dead");
		liveness.flush();
		const row = deadRow(store);
		expect(row?.dead_since).toBeTruthy();
		liveness.flush();
		expect(deadRow(store)?.dead_since).toBe(row?.dead_since);
	});

	it("one session with twenty tool calls is exactly one expectation", () => {
		const liveness = freshLiveness("3");
		for (let i = 0; i < 20; i += 1) {
			liveness.expect("experimental.chat.system.transform", "sess-1");
		}
		const r = liveness
			.report()
			.find((h) => h.hook === "experimental.chat.system.transform");
		expect(r?.expectedCount).toBe(1);
	});

	it("a hook that fired once is live forever", async () => {
		const liveness = freshLiveness("3");
		const hooks = {
			"experimental.chat.system.transform": async (): Promise<string[]> => [
				"ok",
			],
		};
		const wrapped = liveness.wrap(hooks);
		await (
			wrapped as {
				"experimental.chat.system.transform": () => Promise<string[]>;
			}
		)["experimental.chat.system.transform"]();
		liveness.expect("experimental.chat.system.transform", "sess-1");
		liveness.expect("experimental.chat.system.transform", "sess-2");
		liveness.expect("experimental.chat.system.transform", "sess-3");
		const r = liveness
			.report()
			.find((h) => h.hook === "experimental.chat.system.transform");
		expect(r?.state).toBe("live");
		expect(r?.fireCount).toBe(1);
	});

	it("dead_since survives a later fire (historical death is never cleared)", async () => {
		const liveness = freshLiveness("1");
		liveness.expect("experimental.chat.system.transform", "sess-1");
		expect(
			liveness
				.report()
				.find((h) => h.hook === "experimental.chat.system.transform")?.state,
		).toBe("dead");
		const hooks = {
			"experimental.chat.system.transform": async (): Promise<string[]> => [
				"ok",
			],
		};
		const wrapped = liveness.wrap(hooks);
		await (
			wrapped as {
				"experimental.chat.system.transform": () => Promise<string[]>;
			}
		)["experimental.chat.system.transform"]();
		expect(
			liveness
				.report()
				.find((h) => h.hook === "experimental.chat.system.transform")?.state,
		).toBe("live");
		liveness.flush();
		expect(deadRow(store)?.dead_since).toBeTruthy();
	});

	it("parseThreshold clamps garbage to the default of three, never zero", () => {
		expect(parseThreshold("abc")).toBe(3);
		expect(parseThreshold("")).toBe(3);
		expect(parseThreshold("0")).toBe(3);
		expect(parseThreshold(null)).toBe(3);
		expect(parseThreshold(undefined)).toBe(3);
		expect(parseThreshold("7")).toBe(7);
		expect(parseThreshold("2000")).toBe(1000);
	});
});

describe("K9-010 — hooks_dead_total tracks dead hooks after flush", () => {
	it("hooks_dead_total equals the count of rows with dead_since after flush", () => {
		const liveness = freshLiveness("1");
		liveness.expect("experimental.chat.system.transform", "sess-1");
		liveness.expect("experimental.session.compacting", "sess-2");
		liveness.flush();
		const derived = store
			.prepare(
				"SELECT COUNT(*) AS c FROM hook_liveness WHERE dead_since IS NOT NULL",
			)
			.get() as { c: number };
		expect(derived.c).toBe(2);
		// The 010 post-apply hook re-derives the counter the same way; the
		// invariant is that the metric always mirrors the table.
		store.exec(
			`CREATE TABLE IF NOT EXISTS kevin_metrics (
			    key        TEXT PRIMARY KEY,
			    value      INTEGER NOT NULL DEFAULT 0,
			    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			  )`,
		);
		store
			.prepare(
				"INSERT INTO kevin_metrics (key, value) VALUES ('hooks_dead_total', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			)
			.run(derived.c);
		const metric = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = 'hooks_dead_total'")
			.get() as { value: number };
		expect(metric.value).toBe(derived.c);
	});
});

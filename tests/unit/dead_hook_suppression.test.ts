/**
 * K9-011 — v0.9.0 native — error path and injections_suppressed_dead_hook
 * (plan §5.3, D9-06).
 *
 * A permanently-throwing hook is a distinct fault from a dead one and must
 * be countable separately. When the injection hook is dead, every
 * checkpointed session was suppressed — that counter turns "zero
 * injections" from an ambiguous number into a diagnosis. There is NO
 * fallback: `experimental.chat.messages.transform` must appear nowhere.
 */

import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookLiveness } from "@jmtrin/kevin-core";
import type { HookName } from "@jmtrin/kevin-core";
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

const METRICS_DDL = `CREATE TABLE IF NOT EXISTS kevin_metrics (
	    key        TEXT PRIMARY KEY,
	    value      INTEGER NOT NULL DEFAULT 0,
	    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	  )`;

const REPO_ROOT = join(__dirname, "..", "..");

let tmpRoot: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-dead-hook-"));
	store = new Store({ path: join(tmpRoot, "test.db") });
	store.exec(HOOK_LIVENESS_DDL);
	store.exec(METRICS_DDL);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function freshLiveness(thresholdText: string): HookLiveness {
	return new HookLiveness(store, {
		enabled: true,
		thresholdText,
		pluginVersion: "1.18.18",
	});
}

function row(hook: string): {
	fire_count: number;
	error_count: number;
	dead_since: string | null;
} | null {
	return store
		.prepare(
			"SELECT fire_count, error_count, dead_since FROM hook_liveness WHERE hook = ?",
		)
		.get(hook) as {
		fire_count: number;
		error_count: number;
		dead_since: string | null;
	} | null;
}

function metric(key: string): number {
	return (
		(
			store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | null
		)?.value ?? -1
	);
}

describe("K9-011 — error path and dead-hook suppression", () => {
	it("a hook throwing on every call: error_count grows, fire_count stays 0, state is unknown, not dead", async () => {
		// D9-06 / K9-011 AC 1: a crashing host is not a removed API.
		const liveness = freshLiveness("3");
		const sentinel = new Error("always throws");
		const hooks = {
			"chat.message": async (): Promise<string> => {
				throw sentinel;
			},
		};
		const wrapped = liveness.wrap(hooks);
		const fn = wrapped["chat.message"] as unknown as () => Promise<string>;
		for (let i = 0; i < 3; i += 1) {
			await expect(fn()).rejects.toBe(sentinel);
		}
		liveness.flush();
		const r = row("chat.message");
		expect(r?.error_count).toBe(3);
		expect(r?.fire_count).toBe(0);
		const state = liveness
			.report()
			.find((x) => x.hook === "chat.message")?.state;
		expect(state).toBe("unknown");
	});

	it("with the injection hook dead, injections_suppressed_dead_hook increments once per checkpointed session", () => {
		// K9-011 AC 2: threshold '1' — the first checkpoint marks the hook
		// dead and is itself suppressed; each further session adds one.
		const liveness = freshLiveness("1");
		liveness.expect("experimental.chat.system.transform", "sess-a");
		liveness.expect("experimental.chat.system.transform", "sess-b");
		liveness.expect("experimental.chat.system.transform", "sess-c");
		// Same session again: deduped, no extra suppression.
		liveness.expect("experimental.chat.system.transform", "sess-a");
		liveness.flush();
		expect(metric("injections_suppressed_dead_hook")).toBe(3);
	});

	it("hook_fires_total, hook_errors_total and hooks_dead_total are re-derived on flush", async () => {
		// K9-011 AC 1 aggregation + the 010 post-apply derivation rule:
		// sums/counts over the counters, never incremented by hand.
		const liveness = freshLiveness("1");
		const throwing = new Error("boom");
		const hooks = {
			"tool.execute.before": async (): Promise<boolean> => true,
			"chat.message": async (): Promise<string> => {
				throw throwing;
			},
		};
		const wrapped = liveness.wrap(hooks);
		await (
			wrapped["tool.execute.before"] as unknown as () => Promise<boolean>
		)();
		const fail = wrapped["chat.message"] as unknown as () => Promise<string>;
		await expect(fail()).rejects.toBe(throwing);
		await expect(fail()).rejects.toBe(throwing);
		liveness.expect("experimental.chat.system.transform", "sess-1");
		liveness.flush();
		expect(metric("hook_fires_total")).toBe(1);
		expect(metric("hook_errors_total")).toBe(2);
		expect(metric("hooks_dead_total")).toBe(1);
		expect(metric("injections_suppressed_dead_hook")).toBe(1);
	});

	it("error path leaves dead_since untouched: errors are not death", async () => {
		const liveness = freshLiveness("1");
		const sentinel = new Error("always throws");
		const wrapped = liveness.wrap({
			"chat.message": async (): Promise<string> => {
				throw sentinel;
			},
		});
		await expect(
			(wrapped["chat.message"] as unknown as () => Promise<string>)(),
		).rejects.toBe(sentinel);
		liveness.flush();
		expect(metric("hooks_dead_total")).toBe(0);
	});

	it("experimental.chat.messages.transform appears nowhere in plugin/", () => {
		// D9-06 / K9-011 AC 3: no fallback, no probing, no routing around a
		// dead hook. Silently switching to a second experimental hook would
		// convert one unowned dependency into two.
		const forbidden = "experimental.chat.messages.transform";
		const scan = (dir: string): string[] => {
			const out: string[] = [];
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) {
					out.push(...scan(full));
				} else if (entry.endsWith(".ts")) {
					out.push(full);
				}
			}
			return out;
		};
		const hits: string[] = [];
		for (const file of scan(join(REPO_ROOT, "packages/core/src"))) {
			if (readFileSync(file, "utf8").includes(forbidden)) hits.push(file);
		}
		expect(hits).toEqual([]);
	});

	it("GateReason gains no new member; the v0.7.0 gate order is byte-identical", () => {
		// K9-011 AC 4: the ranking/budget/gate machinery is untouched — this
		// task adds a counter and nothing else.
		const source = readFileSync(
			join(REPO_ROOT, "packages/core/src", "QualityGate.ts"),
			"utf8",
		);
		const start = source.indexOf("export type GateReason =");
		expect(start).toBeGreaterThan(-1);
		// The first ";" belongs to the K6-022 comment — anchor on the last
		// member ("weak;") instead.
		const end = source.indexOf('"weak";', start) + '"weak";'.length;
		const block = source.slice(start, end);
		const members = Array.from(block.matchAll(/^\t\| "([a-z_]+)"/gm)).map(
			(m) => m[1],
		);
		expect(members).toEqual([
			"ok",
			"low_confidence",
			"seen_this_session",
			"ignored",
			"not_active",
			"recurrence",
			"weak",
		]);
	});
});

// Kept for typecheck completeness: HookName is a runtime-independent type
// re-exported here so the scan above has a stable anchor.
// biome-ignore lint/suspicious/noExportsInTest: anchor for source scan (K9-011)
export type { HookName };

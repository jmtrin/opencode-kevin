import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import type { HostSurface } from "../../plugin/host.js";
import { buildDoctor } from "../../plugin/kevin_doctor.js";
import type { SettingsReader } from "../../plugin/native.js";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

// K10-021 — dispose joins the hook report and a p95 budget breach
// degrades the verdict (a slow plugin is not healthy even when every
// hook is live). `unknown` is still never rounded to healthy.

let tmpRoot: string;
let store: Store;

const host: HostSurface = {
	pluginVersion: "1.18.18",
	flavour: "v1-only",
	project: { id: null, worktree: null, directory: null },
	hasShell: true,
	v2: { skill: false, reference: false },
	notes: [],
};

const settings: SettingsReader = { getSetting: () => "0" };

function seedPerf(
	scope: string,
	withinBudget: 0 | 1,
	p95 = withinBudget ? 5 : 999,
): void {
	store
		.prepare(
			`INSERT INTO perf_samples (scope, sample_count, p50_ms, p95_ms, max_ms, budget_p95_ms, within_budget)
			 VALUES (?, 10, 2, ?, ?, 50, ?)`,
		)
		.run(scope, p95, p95 + 20, withinBudget);
}

describe("K10-021 — kevin_doctor dispose row and budget degradation", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-doctor-verdict-"));
		store = new Store({ path: join(tmpRoot, "doctor.db") });
	});

	afterEach(() => {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("seven hook rows appear after migration 011", async () => {
		await new Migrate(store, MIGRATIONS_DIR).run();
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.hooks).toHaveLength(7);
		expect(report.hooks.map((h) => h.hook)).toContain("dispose");
		expect(report.perf).toEqual({ scopes_over_budget: [] });
	});

	it("all hooks live plus one scope over budget yields degraded naming that scope", async () => {
		await new Migrate(store, MIGRATIONS_DIR).run();
		store.prepare("UPDATE hook_liveness SET fire_count = 3").run();
		seedPerf("chat.system.transform", 0);
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("degraded");
		expect(report.reason).toContain("chat.system.transform");
		expect(report.perf?.scopes_over_budget).toEqual(["chat.system.transform"]);
	});

	it("all hooks live and all scopes within budget yields healthy", async () => {
		await new Migrate(store, MIGRATIONS_DIR).run();
		store.prepare("UPDATE hook_liveness SET fire_count = 3").run();
		seedPerf("chat.system.transform", 1);
		seedPerf("dispose", 1);
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("healthy");
		expect(report.reason).toBe("all hooks live");
		expect(report.perf?.scopes_over_budget).toEqual([]);
	});

	it("an unknown hook still prevents healthy, with or without a breach", async () => {
		await new Migrate(store, MIGRATIONS_DIR).run();
		store
			.prepare(
				"UPDATE hook_liveness SET fire_count = 3 WHERE hook != 'dispose'",
			)
			.run();
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("unknown");
		seedPerf("session.idle", 0);
		const breached = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(breached.verdict).not.toBe("healthy");
	});

	it("a dead hook keeps its own degradation reason over a breach", async () => {
		await new Migrate(store, MIGRATIONS_DIR).run();
		store
			.prepare(
				"UPDATE hook_liveness SET dead_since = datetime('now') WHERE hook = 'dispose'",
			)
			.run();
		seedPerf("event", 0);
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("degraded");
		expect(report.reason).toContain("dead");
	});

	it("pre-011 store omits the perf block and v0.9.0 behaviour is unchanged", () => {
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.perf).toBeUndefined();
		expect(report.verdict).toBe("unknown");
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

let store: Store;

beforeEach(() => {
	// fresh memory DB for each test
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
});

describe("K11-001 migration 012_v11_drift", () => {
	it("applies 012 and seeds metrics and indexes", async () => {
		const migrate = new Migrate(store, migrationsDir);
		const result = await migrate.run();
		expect(result.to).toBe("012");
		expect(result.applied).toContain("012");

		const version = store
			.prepare(
				"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
			)
			.get() as { version: string };
		expect(version.version).toBe("012");

		// indexes exist
		const idx = store
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_tool_calls_ts_ms','idx_injections_injected_ms')",
			)
			.all() as { name: string }[];
		const names = idx.map((r) => r.name);
		expect(names).toContain("idx_tool_calls_ts_ms");
		expect(names).toContain("idx_injections_injected_ms");

		// metric seeds
		for (const key of [
			"bench_regression_failures",
			"forget_requests_total",
			"forget_tombstones_published",
		]) {
			const row = store
				.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
				.get(key) as { value: number } | undefined;
			expect(row, `metric ${key} should exist`).toBeDefined();
			expect(row?.value).toBe(0);
		}
	});

	it("is idempotent on second run", async () => {
		const migrate = new Migrate(store, migrationsDir);
		await migrate.run();
		const second = await migrate.run();
		expect(second.applied).toEqual([]);
		expect(second.from).toBe("012");
		expect(second.to).toBe("012");

		// no duplicate metric rows
		const count = store
			.prepare(
				"SELECT COUNT(*) as c FROM kevin_metrics WHERE key IN ('bench_regression_failures','forget_requests_total','forget_tombstones_published')",
			)
			.get() as { c: number };
		expect(count.c).toBe(3);
	});

	it("backfills ts_ms for legacy tool_calls rows", async () => {
		// create a DB at 011, insert legacy row, then migrate to 012
		const tmp = mkdtempSync(join(tmpdir(), "kevin-m012-"));
		const legacyStore = new Store({ path: ":memory:" });
		try {
			const m011 = new Migrate(legacyStore, migrationsDir);
			// Run only up to 011 by using a filtered migrationsDir that excludes 012
			// We achieve this by running migrate on a clone that we control:
			// Instead, manually run migrations 001-011 via Migrate with a temp dir copy stripped of 012
			// Simpler: run full migrate then rollback? Instead we test backfill by inserting before 012 is applied.
			// We'll do: create store, apply migrations up to 011 using real dir but mocking file list:
			// Use Migrate with custom postApply that stops? Easier: directly create tables then insert legacy row before 012's ALTER.
			// Approach: run migrate normally to get schema up to 012, then manually reset to 011 state for test.
			// Instead we test backfill logic directly: insert a legacy row with old schema before 012, then run 012.

			// To simulate legacy DB, we create a separate store with 011 only by copying migrations without 012 to a temp dir
			const { mkdirSync, readdirSync, copyFileSync } = await import("node:fs");
			const tmpMig = join(tmp, "migs");
			mkdirSync(tmpMig, { recursive: true });
			const files = readdirSync(migrationsDir).filter(
				(f) => f !== "012_v11_drift.sql",
			);
			for (const f of files)
				copyFileSync(join(migrationsDir, f), join(tmpMig, f));

			const store011 = new Store({ path: ":memory:" });
			await new Migrate(store011, tmpMig).run();
			// Insert legacy tool_calls row with second-granularity ts
			const ts = "2026-08-25 10:00:00";
			store011
				.prepare(
					"INSERT INTO tool_calls (id, session_id, ts, tool, success) VALUES (?, ?, ?, ?, ?)",
				)
				.run("legacy-id-1", "s1", ts, "bash", 1);

			// Also insert legacy kevin_injections row if table exists (migration 005)
			try {
				store011
					.prepare(
						"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome, injected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
					)
					.run(
						"inj-1",
						"mem1",
						"fp1",
						"s1",
						"pre_prompt",
						10,
						"unmeasured",
						ts,
					);
			} catch {
				// ignore if table not yet
			}

			// Now run 012 on this DB by pointing to full migrationsDir
			await new Migrate(store011, migrationsDir).run();

			// Verify ts_ms was backfilled as seconds*1000 from strftime
			const row = store011
				.prepare("SELECT ts, ts_ms FROM tool_calls WHERE id = ?")
				.get("legacy-id-1") as { ts: string; ts_ms: number } | undefined;
			expect(row).toBeDefined();
			expect(row?.ts_ms).not.toBeNull();

			// Derive expected via SQLite's strftime('%s', ts) same as migration does
			const expected = store011
				.prepare("SELECT CAST(strftime('%s', ?) AS INTEGER) * 1000 as v")
				.get(ts) as { v: number };
			expect(row?.ts_ms).toBe(expected.v);

			const injRow = (() => {
				try {
					return store011
						.prepare(
							"SELECT injected_at, injected_at_ms FROM kevin_injections WHERE id = ?",
						)
						.get("inj-1") as
						| { injected_at: string; injected_at_ms: number }
						| undefined;
				} catch {
					return undefined;
				}
			})();
			if (injRow) {
				const exp2 = store011
					.prepare("SELECT CAST(strftime('%s', ?) AS INTEGER) * 1000 as v")
					.get(ts) as { v: number };
				expect(injRow.injected_at_ms).toBe(exp2.v);
			}

			store011.close();
			legacyStore.close();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
			legacyStore.close();
		}
	});
});

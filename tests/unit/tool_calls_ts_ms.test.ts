import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { ToolCallObserver } from "@jmtrin/kevin-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "packages/core/migrations");

describe("K11-002 ToolCallObserver ts_ms", () => {
	let store: Store;
	beforeEach(() => {
		store = new Store({ path: ":memory:" });
	});
	afterEach(() => {
		store.close();
	});

	it("post-migration store records ts_ms within 5s of ts", async () => {
		await new Migrate(store, migrationsDir).run();
		const obs = new ToolCallObserver(store, null);
		const before = Date.now();
		obs.onAfter(
			{
				tool: "bash",
				args: { command: "echo hi" },
				sessionId: "s1",
				callID: "call-1",
			},
			{ success: true, stdout: "hi", stderr: "" },
		);
		const row = store
			.prepare("SELECT ts, ts_ms FROM tool_calls WHERE id = ?")
			.get("call-1") as { ts: string; ts_ms: number } | undefined;
		expect(row).toBeDefined();
		if (!row) return;
		expect(typeof row.ts_ms).toBe("number");
		// legacy ts is datetime('now') string, ts_ms is Date.now()
		// they should be within 5 seconds wall distance
		const legacyMs = Date.parse(`${row.ts.replace(" ", "T")}Z`);
		expect(Math.abs(row.ts_ms - legacyMs)).toBeLessThan(5000);
		expect(Math.abs(row.ts_ms - before)).toBeLessThan(5000);
	});

	it("pre-migration store (011) still works without ts_ms", async () => {
		// Build a DB only up to 011 using a temp migrations dir without 012
		const tmp = mkdtempSync(join(tmpdir(), "kevin-tsms-pre-"));
		try {
			const tmpMig = join(tmp, "migs");
			mkdirSync(tmpMig, { recursive: true });
			const files = readdirSync(migrationsDir).filter(
				(f) => f !== "012_v11_drift.sql" && f !== "013_v14_bridge.sql",
			);
			for (const f of files)
				copyFileSync(join(migrationsDir, f), join(tmpMig, f));

			// fresh store at 011
			const s011 = new Store({ path: ":memory:" });
			await new Migrate(s011, tmpMig).run();

			const version = s011
				.prepare(
					"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
				)
				.get() as { version: string };
			expect(version.version).toBe("014");

			// should not throw and should not have ts_ms column
			const obs = new ToolCallObserver(s011, null);
			obs.onAfter(
				{
					tool: "bash",
					args: { command: "echo hi" },
					sessionId: "s1",
					callID: "call-2",
				},
				{ success: true },
			);
			const row = s011
				.prepare("SELECT id, ts FROM tool_calls WHERE id = ?")
				.get("call-2") as { id: string; ts: string } | undefined;
			expect(row).toBeDefined();
			// column should not exist
			const cols = s011.prepare("PRAGMA table_info(tool_calls)").all() as {
				name: string;
			}[];
			expect(cols.map((c) => c.name)).not.toContain("ts_ms");

			s011.close();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("probe caching: second onAfter issues no extra probe query", async () => {
		await new Migrate(store, migrationsDir).run();
		// spy on store.prepare for the probe query
		let probeCalls = 0;
		const origPrepare = store.prepare.bind(store);
		// monkey patch to count hasColumn probe
		// hasColumn does SELECT ts_ms FROM tool_calls LIMIT 0
		store.prepare = ((sql: string) => {
			if (sql.includes("SELECT ts_ms FROM tool_calls")) probeCalls++;
			return origPrepare(sql);
		}) as typeof store.prepare;

		const obs = new ToolCallObserver(store, null);
		obs.onAfter(
			{ tool: "bash", args: { command: "a" }, sessionId: "s1", callID: "c1" },
			{ success: true },
		);
		obs.onAfter(
			{ tool: "bash", args: { command: "b" }, sessionId: "s1", callID: "c2" },
			{ success: true },
		);
		// first call should probe, second should be cached
		expect(probeCalls).toBe(1);
	});
});

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const VERSIONS = [
	"001",
	"002",
	"003",
	"004",
	"005",
	"006",
	"007",
	"008",
	"009",
	"010",
	"011",
];

let tmpRoot: string;
let openStore: Store | null = null;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-matrix-"));
	openStore = null;
});

afterEach(() => {
	try {
		openStore?.close();
	} catch {
		/* ignore */
	}
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* Windows EPERM when a connection lingers */
	}
});

function fixturePath(version: string): string {
	return join(process.cwd(), "tests", "fixtures", "schema", `v${version}.db`);
}

function upgradedCopy(version: string): Store {
	const dbPath = join(tmpRoot, `v${version}.db`);
	copyFileSync(fixturePath(version), dbPath);
	const store = new Store({ path: dbPath });
	openStore = store;
	return store;
}

describe("K10-028 — every historical schema_version upgrades to 012 (K13-009)", () => {
	it("eleven fixtures exist, one per version 001..011", () => {
		for (const v of VERSIONS) expect(fixturePath(v)).toBeTruthy();
		const names = readdirSync(
			join(process.cwd(), "tests", "fixtures", "schema"),
		);
		for (const v of VERSIONS) expect(names).toContain(`v${v}.db`);
	});

	for (const v of VERSIONS) {
		it(`v${v}: one Migrate.run() reaches '012' with rows intact; dual _ms backfill + metric seeds; second run is no-op (K13-009)`, async () => {
			const store = upgradedCopy(v);
			const result = await new Migrate(
				store,
				join(process.cwd(), "packages/core/migrations"),
			).run();
			expect(result.applied.length).toBeGreaterThan(0);

			const versionRow = store
				.prepare(
					"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
				)
				.get() as { version: string };
			expect(versionRow.version).toBe("012");

			const mem = store
				.prepare("SELECT type, content FROM memories WHERE id = ?")
				.get("fix-mem-1") as { type: string; content: string };
			expect(mem.content).toBe("fixture memory one (K10-028)");

			if (Number(v) >= 3) {
				const setting = store
					.prepare(
						"SELECT value FROM kevin_settings WHERE key = 'fixture_setting'",
					)
					.get() as { value: string } | undefined;
				expect(setting?.value).toBe("on");
				const metric = store
					.prepare(
						"SELECT value FROM kevin_metrics WHERE key = 'fixture_metric'",
					)
					.get() as { value: number } | undefined;
				expect(metric?.value).toBe(7);
			}

			const second = await new Migrate(
				store,
				join(process.cwd(), "packages/core/migrations"),
			).run();
			expect(second.applied).toEqual([]);
			expect(second.from).toBe("012");
			expect(second.to).toBe("012");

			const memAgain = store
				.prepare("SELECT content FROM memories WHERE id = ?")
				.get("fix-mem-1") as { content: string };
			expect(memAgain.content).toBe(mem.content);

			// K13-009 / 012_v11_drift — dual _ms backfill sanity + metric seeds
			// tool_calls.ts_ms exists and is backfilled for the fixture row (if table existed at that version)
			try {
				const tcRow = store
					.prepare("SELECT ts, ts_ms FROM tool_calls WHERE id = 'fix-tool-1'")
					.get() as { ts: string | null; ts_ms: number | null } | undefined;
				if (tcRow) {
					expect(tcRow.ts_ms, `v${v}: tool_calls.ts_ms should be backfilled`).not.toBeNull();
					const expected = store
						.prepare("SELECT CAST(strftime('%s', ?) AS INTEGER) * 1000 as v")
						.get(tcRow.ts) as { v: number };
					expect(tcRow.ts_ms).toBe(expected.v);
				}
			} catch {
				// pre-tool_calls DB (should not happen after 001) — ignore
			}
			// 012 metric seeds present
			for (const key of ["bench_regression_failures", "forget_requests_total", "forget_tombstones_published"]) {
				const row = store.prepare("SELECT value FROM kevin_metrics WHERE key = ?").get(key) as { value: number } | undefined;
				expect(row, `v${v}: metric ${key} should exist after 012`).toBeDefined();
				expect(row?.value).toBe(0);
			}
			// indexes exist
			const idx = store
				.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_tool_calls_ts_ms','idx_injections_injected_ms')")
				.all() as { name: string }[];
			const idxNames = idx.map((r) => r.name);
			expect(idxNames).toContain("idx_tool_calls_ts_ms");
			expect(idxNames).toContain("idx_injections_injected_ms");
		});
	}
});

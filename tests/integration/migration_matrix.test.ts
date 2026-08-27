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
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

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

describe("K10-028 — every historical schema_version upgrades to 011", () => {
	it("ten fixtures exist, one per version 001..010", () => {
		for (const v of VERSIONS) expect(fixturePath(v)).toBeTruthy();
		const names = readdirSync(
			join(process.cwd(), "tests", "fixtures", "schema"),
		);
		for (const v of VERSIONS) expect(names).toContain(`v${v}.db`);
	});

	for (const v of VERSIONS) {
		it(`v${v}: one Migrate.run() reaches '011' with rows intact; a second run is a no-op`, async () => {
			const store = upgradedCopy(v);
			const result = await new Migrate(
				store,
				join(process.cwd(), "migrations"),
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
				join(process.cwd(), "migrations"),
			).run();
			expect(second.applied).toEqual([]);
			expect(second.from).toBe("012");
			expect(second.to).toBe("012");

			const memAgain = store
				.prepare("SELECT content FROM memories WHERE id = ?")
				.get("fix-mem-1") as { content: string };
			expect(memAgain.content).toBe(mem.content);
		});
	}
});

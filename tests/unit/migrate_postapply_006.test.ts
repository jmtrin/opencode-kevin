import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-postapply006-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function metric(key: string): number {
	const row = store
		.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
		.get(key) as { value: number };
	return row.value;
}

// The four UPDATEs the 006 hook executes (D5-13: re-derivation, no INSERTs).
const HOOK_UPDATES = [
	"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections) WHERE key = 'injections_total'",
	"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'effective') WHERE key = 'injections_effective'",
	"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'ineffective') WHERE key = 'injections_ineffective'",
	"UPDATE kevin_metrics SET value = (SELECT COUNT(*) FROM kevin_injections WHERE outcome = 'inconclusive') WHERE key = 'injections_inconclusive'",
] as const;

function runHookSql(): void {
	for (const sql of HOOK_UPDATES) store.prepare(sql).run();
}

describe("Migration 006 post-apply hook (K5-002, D5-13)", () => {
	it("re-derives the four injection counters from the ledger", async () => {
		// Apply up to 005, seed 5 effective + 2 ineffective rows, and set a
		// deliberately stale counter value (99), then apply 006.
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		await new Migrate(store, migrationsDir).run();
		for (let i = 0; i < 5; i++) {
			store
				.prepare(
					"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES (?, 'm', 'fp', 's', 'pre_prompt', 10, 'effective')",
				)
				.run(`eff-${i}`);
		}
		for (let i = 0; i < 2; i++) {
			store
				.prepare(
					"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES (?, 'm', 'fp', 's', 'pre_prompt', 10, 'ineffective')",
				)
				.run(`ineff-${i}`);
		}
		store
			.prepare(
				"UPDATE kevin_metrics SET value = 99 WHERE key = 'injections_effective'",
			)
			.run();

		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();

		// 5 effective rows were remapped to inconclusive by the rebuild,
		// then the hook re-derives every counter from the table.
		expect(metric("injections_total")).toBe(7);
		expect(metric("injections_effective")).toBe(0);
		expect(metric("injections_ineffective")).toBe(2);
		expect(metric("injections_inconclusive")).toBe(5);
	});

	it("invoking the hook twice in a row produces identical counter values", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO kevin_injections (id, memory_id, fingerprint, session_id, hook, tokens, outcome) VALUES ('a', 'm', 'fp', 's', 'pre_prompt', 10, 'inconclusive'), ('b', 'm', 'fp2', 's', 'pre_prompt', 10, 'ineffective')",
			)
			.run();
		// The migration's own run already invoked the hook; invoke the same
		// statements twice more and check the second pass changes nothing.
		runHookSql();
		const first = [
			metric("injections_total"),
			metric("injections_effective"),
			metric("injections_ineffective"),
			metric("injections_inconclusive"),
		];
		runHookSql();
		const second = [
			metric("injections_total"),
			metric("injections_effective"),
			metric("injections_ineffective"),
			metric("injections_inconclusive"),
		];
		expect(second).toEqual(first);
		expect(second).toEqual([2, 0, 1, 1]);
	});
});

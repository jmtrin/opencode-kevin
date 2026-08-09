import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InjectionLedger } from "../../plugin/InjectionLedger.js";
import { Store } from "../../plugin/Store.js";
import { Metrics } from "../../plugin/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(__dirname, "..", "..", "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(__dirname, "..", "..", "migrations", "005_v04_signal.sql"),
	"utf8",
);

let tmpRoot: string;

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	store.exec(SQL_004);
	store.exec(SQL_005);
	return store;
}

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-injledger-"));
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

const INPUT = {
	memoryId: "mem-1",
	fingerprint: "fp-1",
	sessionId: "sess-1",
	hook: "pre_prompt",
	tokens: 42,
} as const;

describe("InjectionLedger.record", () => {
	it("inserts a row with outcome 'unmeasured' and all passed values", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		ledger.record(INPUT);

		const rows = ledger.rowsForSession("sess-1");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			memory_id: "mem-1",
			fingerprint: "fp-1",
			session_id: "sess-1",
			hook: "pre_prompt",
			tokens: 42,
			outcome: "unmeasured",
		});
		expect(rows[0].id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("accumulates multiple rows and scopes by session", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		ledger.record(INPUT);
		ledger.record({ ...INPUT, memoryId: "mem-2", sessionId: "sess-2" });

		expect(ledger.rowsForSession("sess-1")).toHaveLength(1);
		expect(ledger.rowsForSession("sess-2")).toHaveLength(1);
	});

	it("increments the injections_total metric", () => {
		const store = makeMigratedStore();
		const metrics = new Metrics(store);
		const ledger = new InjectionLedger(store, metrics);

		ledger.record(INPUT);
		ledger.record({ ...INPUT, memoryId: "mem-2" });

		expect(metrics.get("injections_total")).toBe(2);
	});

	it("works without a metrics instance (nullable)", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store, null);

		expect(() => ledger.record(INPUT)).not.toThrow();
	});

	it("rejects an invalid hook value via the CHECK constraint", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		expect(() =>
			ledger.record({
				...INPUT,
				// @ts-expect-error -- deliberately invalid hook for the CHECK
				hook: "mid_prompt",
			}),
		).toThrow();
	});
});

describe("InjectionLedger stubs (K4-006 skeleton)", () => {
	it("settle() is callable and safe on an empty ledger", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		expect(() => ledger.settle("sess-1")).not.toThrow();
		expect(ledger.unsettledForSession("sess-1")).toBe(0);
	});

	it("unsettledForSession counts only 'unmeasured' rows", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		ledger.record(INPUT);
		ledger.record({ ...INPUT, memoryId: "mem-2" });
		store
			.prepare(
				"UPDATE kevin_injections SET outcome = 'effective' WHERE memory_id = 'mem-2'",
			)
			.run();

		expect(ledger.unsettledForSession("sess-1")).toBe(1);
	});

	it("recurrencesFor() returns an empty map when no failing calls exist", () => {
		const store = makeMigratedStore();
		const ledger = new InjectionLedger(store);

		ledger.record(INPUT);
		expect(ledger.recurrencesFor("sess-1")).toEqual(new Map());
	});
});

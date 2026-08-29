import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "packages/core/migrations");

function sql(name: string): string {
	return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function makeStore(names: string[]): Store {
	const store = new Store({ path: ":memory:" });
	for (const name of names) store.exec(sql(name));
	return store;
}

describe("K5-013 — superseded_by populated by save() (D5-06)", () => {
	let store: Store;
	let svc: MemoryService;

	beforeEach(() => {
		store = makeStore([
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
			"006_v05_glassbox.sql",
		]);
		svc = new MemoryService(store);
	});

	it("a second decision with the same fingerprint points the first at itself", () => {
		const first = svc.save({
			type: "decision",
			content: "Decision v1: use tsx for scripts",
			fingerprint: "fp-decision",
		});
		const second = svc.save({
			type: "decision",
			content: "Decision v2: use vitest node runner",
			fingerprint: "fp-decision",
		});
		expect(second).not.toBe(first);

		const oldRow = svc.getById(first);
		expect(oldRow?.status).toBe("superseded");
		expect(oldRow?.supersedes).toBe(second);

		const newRow = svc.getById(second);
		expect(newRow?.status).toBe("active");
		expect(newRow?.supersedes).toBeNull();
	});

	it("rules supersede rules with the same fingerprint", () => {
		const first = svc.save({
			type: "rule",
			content: "Rule v1: tabs for indentation",
			fingerprint: "fp-rule",
		});
		const second = svc.save({
			type: "rule",
			content: "Rule v2: tabs, never spaces",
			fingerprint: "fp-rule",
		});
		expect(svc.getById(first)?.supersedes).toBe(second);
	});

	it("a different fingerprint does not supersede", () => {
		const first = svc.save({
			type: "decision",
			content: "Decision A",
			fingerprint: "fp-a",
		});
		svc.save({
			type: "decision",
			content: "Decision B",
			fingerprint: "fp-b",
		});
		expect(svc.getById(first)?.status).toBe("active");
		expect(svc.getById(first)?.supersedes).toBeNull();
	});

	it("pre-006 DBs keep the old supersession shape (no column crash)", () => {
		const pre = makeStore([
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
		]);
		const preSvc = new MemoryService(pre);
		const first = preSvc.save({
			type: "decision",
			content: "Decision v1",
			fingerprint: "fp-decision",
		});
		const second = preSvc.save({
			type: "decision",
			content: "Decision v2",
			fingerprint: "fp-decision",
		});
		const row = pre
			.prepare("SELECT status FROM memories WHERE id = ?")
			.get(first) as { status: string };
		expect(row.status).toBe("superseded");
		expect(second).not.toBe(first);
		pre.close();
	});
});

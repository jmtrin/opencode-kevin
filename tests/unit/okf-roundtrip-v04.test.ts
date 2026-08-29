import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { exportMarkdown, exportOkf } from "@jmtrin/kevin-core";
import { importOkf } from "@jmtrin/kevin-core";

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

function makeStore(with005: boolean): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	store.exec(SQL_004);
	if (with005) store.exec(SQL_005);
	return store;
}

function seedPattern(memoryService: MemoryService, projectId?: string): string {
	return memoryService.save({
		type: "pattern",
		content:
			'Causal pattern: the rg command is missing\n\nEvidence: 2 confirmed fix(es)\nConfidence: 55%\n\nFixed by: bash with args "command: npm i -g rg"',
		scope: "project",
		origin: "causal",
		fingerprint: "abcd1234abcd1234",
		evidenceCount: 2,
		recurrenceCount: 1,
		lastVerifiedAt: "2026-08-01 10:00:00",
		projectId,
	});
}

describe("BUG-008 — OKF export/import round-trip fidelity", () => {
	it("exports the two-sided confidence and recurrence_count, and the round-trip restores them", () => {
		const storeA = makeStore(true);
		const serviceA = new MemoryService(storeA);
		const id = seedPattern(serviceA, "proj-a");

		const bundle = exportOkf(storeA, "proj-a");
		// computeConfidence(2, 1) = 0.55 — the legacy one-sided formula
		// would have printed 0.70 (the bug).
		expect(bundle).toContain("confidence: 0.55");
		expect(bundle).toContain("recurrence_count: 1");
		expect(bundle).toContain(`id: ${id}`);

		const storeB = makeStore(true);
		const serviceB = new MemoryService(storeB);
		const result = importOkf(bundle, serviceB);
		expect(result.imported).toBe(1);

		const mem = serviceB.getById(id);
		expect(mem).not.toBeNull();
		expect(mem?.evidenceCount).toBe(2);
		expect(mem?.recurrenceCount).toBe(1);
		expect(mem?.lastVerifiedAt).toBe("2026-08-01 10:00:00");
		expect(mem?.confidence).toBeCloseTo(0.55, 5);
		storeA.close();
		storeB.close();
	});

	it("markdown export carries the recurrence count too (round-trip via headings parser)", () => {
		const storeA = makeStore(true);
		const serviceA = new MemoryService(storeA);
		const id = seedPattern(serviceA, "proj-a");

		const md = exportMarkdown(storeA, "proj-a");
		expect(md).toContain("**Confidence:** 0.55");
		expect(md).toContain("**Recurrence count:** 1");

		const storeB = makeStore(true);
		const serviceB = new MemoryService(storeB);
		const result = importOkf(md, serviceB);
		expect(result.imported).toBe(1);
		const mem = serviceB.getById(id);
		expect(mem).not.toBeNull();
		expect(mem?.recurrenceCount).toBe(1);
		expect(mem?.evidenceCount).toBe(2);
		storeA.close();
		storeB.close();
	});

	it("pre-005 DBs keep the legacy one-sided formula and no recurrence line", () => {
		const store = makeStore(false);
		const service = new MemoryService(store);
		seedPattern(service, "proj-a");

		const bundle = exportOkf(store, "proj-a");
		expect(bundle).toContain("confidence: 0.70"); // legacy formula
		expect(bundle).not.toContain("recurrence_count");
		store.close();
	});
});

describe("BUG-009 — imported content is the bundle body verbatim", () => {
	it("does not embed the evidence marker into content (typed fields carry the values)", () => {
		const store = makeStore(true);
		const service = new MemoryService(store);
		const id = seedPattern(service, "proj-a");
		const bundle = exportOkf(store, "proj-a");

		const storeB = makeStore(true);
		const serviceB = new MemoryService(storeB);
		importOkf(bundle, serviceB);

		const mem = serviceB.getById(id);
		expect(mem?.content).not.toContain("[imported evidence_count=");
		expect(mem?.content).not.toContain("last_verified_at=");
		expect(mem?.content).toContain("rg command is missing");
		expect(mem?.content).toContain(
			'Fixed by: bash with args "command: npm i -g rg"',
		);
		// The evidence fields still arrive via the typed payload.
		expect(mem?.evidenceCount).toBe(2);
		expect(mem?.lastVerifiedAt).toBe("2026-08-01 10:00:00");
		store.close();
		storeB.close();
	});
});

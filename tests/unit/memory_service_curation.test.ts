import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const SQL_001 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);

function freshService(): { store: Store; svc: MemoryService } {
	const store = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
		store.exec(sql);
	}
	return { store, svc: new MemoryService(store) };
}

describe("K6-011 — MemoryService curation fields (plan §5.3/§5.4)", () => {
	it("decision/rule/solution/pattern save and read back inferable === 'non_inferable'", () => {
		const { svc } = freshService();
		for (const type of ["decision", "rule", "solution", "pattern"] as const) {
			const id = svc.save({ type, content: `${type} memory` });
			expect(svc.getById(id)?.inferable).toBe("non_inferable");
		}
	});

	it("an error with a self-describing dispatch code reads back inferable === 'inferable'", () => {
		const { svc } = freshService();
		const id = svc.save({
			type: "error",
			content: "Cannot find name 'x'",
			origin: "reflector",
			projectId: "proj-a",
			metadata: { dispatch: { code: "TS2304", hint: null } },
		});
		expect(svc.getById(id)?.inferable).toBe("inferable");
	});

	it("an unclassified error reads back inferable === null and is included by `inferable != 1`", () => {
		const { store, svc } = freshService();
		const id = svc.save({
			type: "error",
			content: "odd failure",
			origin: "reflector",
			projectId: "proj-a",
			metadata: { dispatch: { code: "TS9999", hint: null } },
		});
		expect(svc.getById(id)?.inferable).toBeNull();
		const row = store
			.prepare(
				"SELECT COUNT(*) AS n FROM memories WHERE inferable IS NULL OR inferable != 1",
			)
			.get() as { n: number };
		expect(row.n).toBe(1);
	});

	it("curated defaults to false and curated_at to null on fresh saves", () => {
		const { svc } = freshService();
		const id = svc.save({ type: "rule", content: "fresh" });
		const mem = svc.getById(id);
		expect(mem?.curated).toBe(false);
		expect(mem?.curatedAt).toBeNull();
	});

	it("markCurated sets curated and curated_at on all three ids and returns 3", () => {
		const { svc } = freshService();
		const ids = [1, 2, 3].map(() => svc.save({ type: "rule", content: "x" }));
		const at = "2026-08-13T08:00:00.000Z";
		expect(svc.markCurated(ids, at)).toBe(3);
		for (const id of ids) {
			const mem = svc.getById(id);
			expect(mem?.curated).toBe(true);
			expect(mem?.curatedAt).toBe(at);
		}
	});

	it("a second markCurated with the same ids re-matches them (documented: no internal re-filter)", () => {
		const { svc } = freshService();
		const ids = [1, 2, 3].map(() => svc.save({ type: "rule", content: "x" }));
		expect(svc.markCurated(ids, "t0")).toBe(3);
		// The statement matches rows, not changed values; the caller must
		// re-filter the id list to observe 0 on a second call.
		expect(svc.markCurated(ids, "t1")).toBe(3);
		expect(svc.markCurated([], "t2")).toBe(0);
	});

	it("markCurated([]) is a no-op that executes no statement", () => {
		const { store, svc } = freshService();
		const spy = vi.spyOn(store, "prepare");
		expect(svc.markCurated([], "t0")).toBe(0);
		expect(spy).not.toHaveBeenCalled();
	});

	it("dedup path leaves the stored classification alone unless it is NULL", () => {
		const { store, svc } = freshService();
		const input = {
			type: "error" as const,
			content: "Cannot find name 'x'",
			origin: "reflector" as const,
			projectId: "proj-a",
			metadata: { dispatch: { code: "TS2304", hint: null } },
		};
		const id = svc.save(input);
		expect(svc.getById(id)?.inferable).toBe("inferable");
		// A later, different verdict must survive the dedup path untouched.
		store.prepare("UPDATE memories SET inferable = 0 WHERE id = ?").run(id);
		expect(svc.save(input)).toBe(id);
		expect(svc.getById(id)?.inferable).toBe("non_inferable");
		// A NULL classification is lazily back-filled on the dedup path.
		store.prepare("UPDATE memories SET inferable = NULL WHERE id = ?").run(id);
		expect(svc.save(input)).toBe(id);
		expect(svc.getById(id)?.inferable).toBe("inferable");
	});
});

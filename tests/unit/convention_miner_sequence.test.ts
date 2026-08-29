import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConventionMiner } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-conv-seq-"));
	migrationsDir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
});

function makeStore(): Promise<Store> {
	const store = new Store({ path: ":memory:" });
	return new Migrate(store, migrationsDir).run().then(() => store);
}

function addCall(
	store: Store,
	p: {
		id: string;
		projectId: string;
		sessionId: string;
		tool: string;
		args?: string;
		success?: number;
		ts?: string;
	},
): void {
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, project_id, session_id, tool, args_summary, success, ts)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			p.id,
			p.projectId,
			p.sessionId,
			p.tool,
			p.args ?? null,
			p.success ?? 1,
			p.ts ?? "2026-01-01 00:00:00",
		);
}

function minerOf(store: Store): ConventionMiner {
	return new ConventionMiner(store, new MemoryService(store), "P");
}

/** The classic read:src → write:src 2-gram, once per session. */
function seedReadWriteSession(
	store: Store,
	sessionId: string,
	projectId = "P",
): void {
	addCall(store, {
		id: `s-${sessionId}-a`,
		projectId,
		sessionId,
		tool: "read",
		args: JSON.stringify({ file_path: "src/a.ts" }),
		ts: "2026-01-01 00:00:00",
	});
	addCall(store, {
		id: `s-${sessionId}-b`,
		projectId,
		sessionId,
		tool: "write",
		args: JSON.stringify({ file_path: "src/b.ts" }),
		ts: "2026-01-01 00:00:01",
	});
}

describe("K7-010 — ConventionMiner sequence miner", () => {
	it("emits a 2-gram in 5 distinct sessions but not one in 4", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) {
				seedReadWriteSession(store, s);
			}
			const at5 = minerOf(store).mineSequence(5);
			expect(at5).toHaveLength(1);
			expect(at5[0]?.support).toBe(5);
			expect(at5[0]?.kind).toBe("sequence");
			expect(at5[0]?.statement).toContain("read:src");

			// A 4-session fixture → not emitted at minSupport 5, emitted at 4.
			const store4 = await makeStore();
			for (const s of ["s1", "s2", "s3", "s4"]) {
				seedReadWriteSession(store4, s);
			}
			const m4 = minerOf(store4);
			expect(m4.mineSequence(5)).toHaveLength(0);
			expect(m4.mineSequence(4)).toHaveLength(1);
			store4.close();
		} finally {
			store.close();
		}
	});

	it("a 2-gram repeated 40 times in one session has support 1 and is not emitted", async () => {
		const store = await makeStore();
		try {
			for (let i = 0; i < 40; i++) {
				addCall(store, {
					id: `a-${i}`,
					projectId: "P",
					sessionId: "only-session",
					tool: i % 2 === 0 ? "read" : "write",
					args: JSON.stringify({ file_path: `src/x${i}.ts` }),
					ts: `2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
				});
			}
			const out = minerOf(store).mineSequence(5);
			// 40 alternating read/write calls = 20 read→write 2-grams, all in ONE
			// session → support 1 → not emitted.
			expect(out).toHaveLength(0);
		} finally {
			store.close();
		}
	});

	it("failed tool calls are excluded even when they form the only qualifying sequence", async () => {
		const store = await makeStore();
		try {
			for (const s of ["f1", "f2", "f3", "f4", "f5"]) {
				addCall(store, {
					id: `f-${s}-a`,
					projectId: "P",
					sessionId: s,
					tool: "grep",
					args: JSON.stringify({ path: "src/a.ts" }),
					success: 0,
					ts: "2026-01-01 00:00:00",
				});
				addCall(store, {
					id: `f-${s}-b`,
					projectId: "P",
					sessionId: s,
					tool: "edit",
					args: JSON.stringify({ path: "src/b.ts" }),
					success: 1,
					ts: "2026-01-01 00:00:01",
				});
			}
			// The only potential "grep:src → edit:src" pair has 5 sessions but its
			// leading call is a failure, so it must not count.
			expect(minerOf(store).mineSequence(1)).toHaveLength(0);
		} finally {
			store.close();
		}
	});

	it("calls from another project never contribute support", async () => {
		const store = await makeStore();
		try {
			// 5 sessions of the read→write pattern but ALL in project 'OTHER'.
			for (const s of ["o1", "o2", "o3", "o4", "o5"]) {
				seedReadWriteSession(store, s, "OTHER");
			}
			expect(minerOf(store).mineSequence(5)).toHaveLength(0);
			// A single legit pattern in project P alongside the OTHER noise.
			seedReadWriteSession(store, "p1", "P");
			expect(minerOf(store).mineSequence(1)).toHaveLength(1);
		} finally {
			store.close();
		}
	});

	it("finds 3-grams and does not double-count them as inflated 2-grams", async () => {
		const store = await makeStore();
		try {
			// Each session: read:src → write:src → run:src. A 3-gram in 5
			// sessions yields one 3-gram and two 2-grams, each with support 5.
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) {
				addCall(store, {
					id: `t-${s}-a`,
					projectId: "P",
					sessionId: s,
					tool: "read",
					args: JSON.stringify({ file_path: "src/a.ts" }),
					ts: "2026-01-01 00:00:00",
				});
				addCall(store, {
					id: `t-${s}-b`,
					projectId: "P",
					sessionId: s,
					tool: "write",
					args: JSON.stringify({ file_path: "src/b.ts" }),
					ts: "2026-01-01 00:00:01",
				});
				addCall(store, {
					id: `t-${s}-c`,
					projectId: "P",
					sessionId: s,
					tool: "run",
					args: JSON.stringify({ file_path: "src/c.ts" }),
					ts: "2026-01-01 00:00:02",
				});
			}
			const out = minerOf(store).mineSequence(5);
			const threeGrams = out.filter((c) => c.statement.includes("and then"));
			expect(threeGrams).toHaveLength(1);
			expect(threeGrams[0]?.support).toBe(5);
			// The 2-grams have support 5, not inflated by the 3-gram's existence.
			const twoGrams = out.filter((c) => !c.statement.includes("and then"));
			for (const g of twoGrams) expect(g.support).toBe(5);
		} finally {
			store.close();
		}
	});

	it("ten consecutive runs return identical results in identical order", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) {
				seedReadWriteSession(store, s);
			}
			const miner = minerOf(store);
			const first = miner.mineSequence(5).map((c) => c.statement);
			for (let i = 0; i < 9; i++) {
				const again = miner.mineSequence(5).map((c) => c.statement);
				expect(again).toEqual(first);
			}
		} finally {
			store.close();
		}
	});
});

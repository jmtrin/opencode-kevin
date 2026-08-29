import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	ConventionMiner,
	type MinedConvention,
} from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { fingerprint } from "@jmtrin/kevin-core";

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-conv-emit-"));
	migrationsDir = join(tmpRoot, "migrations");
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

function mineSession(store: Store, sessionId: string): void {
	store
		.prepare(
			`INSERT INTO tool_calls (id, project_id, session_id, tool, args_summary, success, ts)
			 VALUES (?, 'P', ?, ?, ?, 1, ?)`,
		)
		.run(
			`m-${sessionId}-1`,
			sessionId,
			"write",
			JSON.stringify({ file_path: "src/routes/u.ts" }),
			"2026-01-01 00:00:00",
		);
	store
		.prepare(
			`INSERT INTO tool_calls (id, project_id, session_id, tool, args_summary, success, ts)
			 VALUES (?, 'P', ?, ?, ?, 1, ?)`,
		)
		.run(
			`m-${sessionId}-2`,
			sessionId,
			"write",
			JSON.stringify({ file_path: "tests/routes/u.test.ts" }),
			"2026-01-01 00:00:01",
		);
}

describe("K7-012 — rule emission (type='rule', origin='pattern')", () => {
	it("emitted memories carry exactly type=rule, origin=pattern, scope=project", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) mineSession(store, s);
			const svc = new MemoryService(store);
			const miner = new ConventionMiner(store, svc, "P");
			const conv = miner.mine(5).filter((c) => c.kind === "co_edit");
			expect(conv.length).toBeGreaterThan(0);
			const emitted = miner.emit(conv);
			expect(emitted).toBe(conv.length);

			const row = store
				.prepare(
					"SELECT type, origin, scope, project_id, inferable FROM memories WHERE source_tool = 'ConventionMiner' LIMIT 1",
				)
				.get() as {
				type: string;
				origin: string;
				scope: string;
				project_id: string;
				inferable: number | null;
			};
			expect(row.type).toBe("rule");
			expect(row.origin).toBe("pattern");
			expect(row.scope).toBe("project");
			expect(row.project_id).toBe("P");
			expect(row.inferable).toBe(0);
		} finally {
			store.close();
		}
	});

	it("memories.origin CHECK constraint is unchanged (no new origin value)", async () => {
		const store = await makeStore();
		try {
			const ddl = store
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'",
				)
				.get() as { sql: string };
			// The v0.6.0 origin domain: six values, nothing added.
			expect(ddl.sql).toContain(
				"'reflector','agent','pattern','retrospective','causal','imported'",
			);
			expect(ddl.sql).not.toContain("'derived'");
		} finally {
			store.close();
		}
	});

	it("re-mining an unchanged convention emits no duplicate; count stable across three cycles", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) mineSession(store, s);
			const svc = new MemoryService(store);
			const miner = new ConventionMiner(store, svc, "P");
			const conv = miner.mine(5).filter((c) => c.kind === "co_edit");
			const counts: number[] = [];
			for (let i = 0; i < 3; i++) {
				counts.push(miner.emit(conv));
			}
			expect(counts).toEqual([conv.length, conv.length, conv.length]);
			// Only ONE active rule per convention — the supersede path marks the
			// prior row superseded instead of leaving a live duplicate.
			const active = (
				store
					.prepare(
						"SELECT COUNT(*) AS c FROM memories WHERE source_tool = 'ConventionMiner' AND status = 'active'",
					)
					.get() as { c: number }
			).c;
			expect(active).toBe(conv.length);
		} finally {
			store.close();
		}
	});

	it("changing the statement produces a different derived fingerprint", async () => {
		const store = await makeStore();
		try {
			const convA: MinedConvention = {
				fingerprint: fingerprint(
					"every file under src/ has a test under tests/",
					"P",
				),
				statement: "every file under src/ has a test under tests/",
				support: 6,
				kind: "co_edit",
			};
			const svc = new MemoryService(store);
			const miner = new ConventionMiner(store, svc, "P");
			miner.emit([convA]);
			const oldId = (
				store
					.prepare(
						"SELECT id FROM memories WHERE source_tool = 'ConventionMiner' AND fingerprint = ?",
					)
					.get(convA.fingerprint) as { id: string }
			).id;
			// The caller-supplied fingerprint is ignored: emit derives it from the
			// normalized statement, so changing the statement changes identity.
			const convB: MinedConvention = {
				fingerprint: "ignored-input", // emit derives it from the statement
				statement: "every file under src/ has a test under tests/ v2",
				support: 7,
				kind: "co_edit",
			};
			miner.emit([convB]);
			const oldStatus = store
				.prepare("SELECT status FROM memories WHERE id = ?")
				.get(oldId) as { status: string };
			const active = store
				.prepare(
					"SELECT COUNT(*) AS c FROM memories WHERE source_tool = 'ConventionMiner' AND status = 'active'",
				)
				.get() as { c: number };
			expect(oldStatus.status).toBe("active");
			expect(active.c).toBe(2);
		} finally {
			store.close();
		}
	});
});

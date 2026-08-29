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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-conv-coedit-"));
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

function write(
	store: Store,
	id: string,
	projectId: string,
	sessionId: string,
	path: string,
	ts: string,
): void {
	store
		.prepare(
			`INSERT INTO tool_calls
			 (id, project_id, session_id, tool, args_summary, success, ts)
			 VALUES (?, ?, ?, 'write', ?, 1, ?)`,
		)
		.run(id, projectId, sessionId, JSON.stringify({ file_path: path }), ts);
}

function minerOf(store: Store): ConventionMiner {
	return new ConventionMiner(store, new MemoryService(store), "P");
}

/** A session editing one file under src/routes and one under tests/routes. */
function coeditRoutes(store: Store, sessionId: string, projectId = "P"): void {
	write(
		store,
		`r-${sessionId}-a`,
		projectId,
		sessionId,
		"src/routes/user.ts",
		"2026-01-01 00:00:00",
	);
	write(
		store,
		`r-${sessionId}-b`,
		projectId,
		sessionId,
		"tests/routes/user.test.ts",
		"2026-01-01 00:00:01",
	);
}

/** A session editing two files in the SAME directory. */
function coeditSameDir(store: Store, sessionId: string): void {
	write(
		store,
		`sd-${sessionId}-a`,
		"P",
		sessionId,
		"src/thing/a.ts",
		"2026-01-01 00:00:00",
	);
	write(
		store,
		`sd-${sessionId}-b`,
		"P",
		sessionId,
		"src/thing/b.ts",
		"2026-01-01 00:00:01",
	);
}

describe("K7-011 — ConventionMiner co_edit miner", () => {
	it("emits a cross-prefix pair in 5 distinct sessions but not one in 4", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"]) coeditRoutes(store, s);
			const at5 = minerOf(store).mineCoEdit(5);
			const conv = at5.find((c) => c.kind === "co_edit");
			expect(conv).toBeDefined();
			expect(conv?.support).toBe(5);
			// Statement names directory prefixes, not filenames.
			expect(conv?.statement).toContain("src/routes/");
			expect(conv?.statement).toContain("tests/routes/");
			expect(conv?.statement).not.toContain("user.ts");

			const store4 = await makeStore();
			for (const s of ["s1", "s2", "s3", "s4"]) coeditRoutes(store4, s);
			expect(minerOf(store4).mineCoEdit(5)).toHaveLength(0);
			expect(minerOf(store4).mineCoEdit(4)).toHaveLength(1);
			store4.close();
		} finally {
			store.close();
		}
	});

	it("a same-directory pair in 10 distinct sessions is NOT emitted", async () => {
		const store = await makeStore();
		try {
			for (const s of [
				"s1",
				"s2",
				"s3",
				"s4",
				"s5",
				"s6",
				"s7",
				"s8",
				"s9",
				"s10",
			]) {
				coeditSameDir(store, s);
			}
			// Even at minSupport 2 the same-directory truism must never surface.
			expect(minerOf(store).mineCoEdit(2)).toHaveLength(0);
		} finally {
			store.close();
		}
	});

	it("(a, b) and (b, a) accumulate support into a single convention", async () => {
		const store = await makeStore();
		try {
			// s1..s3 write src→tests; s4..s5 write tests→src.
			for (const s of ["s1", "s2", "s3"]) coeditRoutes(store, s);
			for (const s of ["s4", "s5"]) {
				write(
					store,
					`rev-${s}-a`,
					"P",
					s,
					"tests/routes/user.test.ts",
					"2026-01-01 00:00:00",
				);
				write(
					store,
					`rev-${s}-b`,
					"P",
					s,
					"src/routes/user.ts",
					"2026-01-01 00:00:01",
				);
			}
			const out = minerOf(store).mineCoEdit(5);
			expect(out).toHaveLength(1);
			expect(out[0]?.support).toBe(5);
			expect(out[0]?.statement).toContain("src/routes/");
		} finally {
			store.close();
		}
	});

	it("sessions from another project contribute nothing", async () => {
		const store = await makeStore();
		try {
			for (const s of ["s1", "s2", "s3", "s4", "s5"])
				coeditRoutes(store, s, "OTHER");
			expect(minerOf(store).mineCoEdit(5)).toHaveLength(0);
			coeditRoutes(store, "p1", "P");
			expect(minerOf(store).mineCoEdit(1)).toHaveLength(1);
		} finally {
			store.close();
		}
	});

	it("a session touching 50 files does not blow up combinatorially", async () => {
		const store = await makeStore();
		try {
			// A single session writing 50 distinct files across many prefixes.
			for (let i = 0; i < 50; i++) {
				write(
					store,
					`big-${i}`,
					"P",
					"huge",
					`d${i % 10}/f${i}.ts`,
					`2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
				);
			}
			const out = minerOf(store).mineCoEdit(1);
			// 50 distinct files → a cap of 40 prefixes → at most C(40,2)=780 pair
			// keys, FAR below the un-bounded 1225 from all 50 files. None has
			// enough distinct sessions (support 1) to cross the default.
			expect(out.length).toBeLessThan(780);
			expect(out.length).toBeLessThanOrEqual(780);
			expect(out.filter((c) => c.support >= 5)).toEqual([]);
		} finally {
			store.close();
		}
	});
});

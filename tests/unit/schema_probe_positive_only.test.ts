import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Archiver } from "@jmtrin/kevin-core";
import { Feedback } from "@jmtrin/kevin-core";
import { MemoryService } from "@jmtrin/kevin-core";
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
const SQL_007 = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-probe-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

function writeMigrations(through: string): void {
	writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
	writeFileSync(join(migrationsDir, "004_v03_knowledge.sql"), SQL_004);
	if (through >= "005") {
		writeFileSync(join(migrationsDir, "005_v04_signal.sql"), SQL_005);
	}
	if (through >= "006") {
		writeFileSync(join(migrationsDir, "006_v05_glassbox.sql"), SQL_006);
	}
	if (through >= "007") {
		writeFileSync(join(migrationsDir, "007_v06_pull.sql"), SQL_007);
	}
}

describe("K6-001a — positive-only schema probes", () => {
	it("MemoryService.hasIgnoredColumn heals after an in-place migration", async () => {
		const store = new Store({ path: ":memory:" });
		try {
			writeMigrations("004");
			const migrate = new Migrate(store, migrationsDir);
			await migrate.run();
			const memoryService = new MemoryService(store);
			const id = memoryService.save({
				type: "error",
				content: "probe memory for the ignored filter",
				scope: "project",
			});
			// First probe: pre-006 DB, no `ignored` column. Under the old
			// two-way cache this would cache `false` forever.
			const before = memoryService.getRelevant({
				query: undefined,
				scope: "project",
			});
			expect(before.map((m) => m.id)).toContain(id);
			// Migrate in place.
			writeMigrations("007");
			await migrate.run();
			store.prepare("UPDATE memories SET ignored = 1 WHERE id = ?").run(id);
			// Second probe must see the live result: the ignored filter applies.
			const after = memoryService.getRelevant({
				query: undefined,
				scope: "project",
			});
			expect(after.map((m) => m.id)).not.toContain(id);
		} finally {
			store.close();
		}
	});

	it("Feedback.hasFeedbackTable heals after an in-place migration", async () => {
		const store = new Store({ path: ":memory:" });
		try {
			writeMigrations("005");
			const migrate = new Migrate(store, migrationsDir);
			await migrate.run();
			store
				.prepare(
					"INSERT INTO memories (id, type, content) VALUES ('m1', 'decision', 'x')",
				)
				.run();
			const feedback = new Feedback(store);
			// Pre-006: probe fails and must NOT be cached as false.
			expect(() =>
				feedback.record({ memoryId: "m1", verdict: "useful" }),
			).toThrow();
			writeMigrations("007");
			await migrate.run();
			// Post-migration the same instance must recover.
			const id = feedback.record({ memoryId: "m1", verdict: "useful" });
			expect(id).toBeTruthy();
		} finally {
			store.close();
		}
	});

	it("Archiver.hasArchivedColumnCached heals after an in-place migration", async () => {
		const store = new Store({ path: ":memory:" });
		try {
			writeMigrations("005");
			const migrate = new Migrate(store, migrationsDir);
			await migrate.run();
			store
				.prepare(
					"INSERT INTO memories (id, type, content, status, updated_at) VALUES ('m1', 'error', 'x', 'stale', datetime('now', '-60 days'))",
				)
				.run();
			const memoryService = new MemoryService(store);
			const archiver = new Archiver(store, memoryService);
			// Pre-006: no archived_at column → no-op.
			expect(archiver.run()).toBe(0);
			writeMigrations("007");
			await migrate.run();
			// Post-migration the same instance must archive the stale row.
			expect(archiver.run()).toBe(1);
			expect(
				(
					store
						.prepare("SELECT status FROM memories WHERE id = 'm1'")
						.get() as { status: string }
				).status,
			).toBe("archived");
		} finally {
			store.close();
		}
	});
});

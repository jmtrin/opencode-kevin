import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Reflector } from "../../plugin/Reflector.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const MIGRATION_003_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;
let reflector: Reflector;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-refl-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), MIGRATION_003_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	reflector = new Reflector(memories);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("e2e — reflection flow (failure → memory → recall)", () => {
	it("reflects a typecheck failure and recalls it via query and getRelevant", async () => {
		const id = await reflector.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr: "error TS2304: Cannot find name 'foo'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "e2e-sess-1",
		});
		expect(id).not.toBeNull();

		const queryResults = memories.query({ text: "typecheck", full: true });
		expect(queryResults.length).toBe(1);
		expect(queryResults[0].id).toBe(id);
		expect(queryResults[0].content).toContain("Verify types and imports");

		const rec = memories.getRelevant({ query: "typecheck", maxTokens: 2000 });
		const ids = rec.map((m) => m.id);
		expect(ids).toContain(id);
		expect(rec[0].type).toBe("error");
	});

	it("lesson suggestion is present in recalled content", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: Cannot find name 'bar'",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "e2e-sess-2",
		});
		const rec = memories.getRelevant({ query: "typecheck", maxTokens: 2000 });
		expect(rec.length).toBeGreaterThan(0);
		expect(rec[0].content).toContain("When bash fails with typecheck");
		expect(rec[0].content).toContain("Suggestion: Verify types and imports");
	});

	it("runtime failure produces a runtime suggestion", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "Error: Cannot read property of undefined",
			stdout: "",
			exitCode: 1,
			errorType: "runtime",
			sessionId: "e2e-sess-3",
		});
		const rec = memories.getRelevant({ query: "undefined", maxTokens: 2000 });
		expect(rec.length).toBeGreaterThan(0);
		expect(rec[0].content).toContain(
			"Check error message and stack trace for root cause.",
		);
	});
});

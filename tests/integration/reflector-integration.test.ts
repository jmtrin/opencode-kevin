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

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let memories: MemoryService;
let reflector: Reflector;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-refl-int-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	reflector = new Reflector(memories);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Reflector + MemoryService integration", () => {
	it("persists a typecheck failure as searchable memory", async () => {
		const id = await reflector.invoke({
			toolName: "bash",
			argsSummary: "npm run typecheck",
			stderr:
				"error TS2304: Cannot find name 'foo' at C:\\Users\\dev\\proj\\auth.ts:10",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-int-1",
		});
		expect(id).not.toBeNull();

		const results = memories.query({ text: "typecheck" });
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(id);
		expect(results[0].type).toBe("error");
		expect(results[0].sourceTool).toBe("bash");
		expect(results[0].sourceSession).toBe("sess-int-1");
	});

	it("strips absolute paths from persisted content", async () => {
		await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: at C:\\Users\\dev\\proj\\auth.ts:42 boom",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-int-2",
		});
		const results = memories.query({ text: "typecheck" });
		expect(results.length).toBe(1);
		expect(results[0].content).not.toContain("C:\\Users");
		expect(results[0].content).toContain("<path>:42");
	});

	it("returns a UUID v7 as memory id", async () => {
		const id = await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: "error TS2304: foo",
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-int-3",
		});
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("truncated (>4KB) memory keeps lesson searchable and retrievable by id", async () => {
		const longStderr = `error TS2304: ${"z".repeat(5000)}`;
		const id = await reflector.invoke({
			toolName: "bash",
			argsSummary: "",
			stderr: longStderr,
			stdout: "",
			exitCode: 1,
			errorType: "typecheck",
			sessionId: "sess-int-4",
		});
		expect(id).not.toBeNull();
		expect(memories.query({ text: "typecheck" }).length).toBe(1);
		const direct = memories.getById(id as string);
		expect(direct).not.toBeNull();
		expect(direct?.metadata?.truncated).toBe(true);
		expect(direct?.metadata?.not_searchable).toBeUndefined();
		expect(direct?.content).toContain("[truncated]");
		expect(direct?.content).toContain("When bash fails with typecheck");
	});
});

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
import { Retrospective } from "../../plugin/Retrospective.js";
import { Store } from "../../plugin/Store.js";
import { ToolCallObserver } from "../../plugin/ToolCallObserver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);

const SESSION_ID = "retro-sess-1";

let tmpRoot: string;
let migrationsDir: string;
let retroDir: string;
let store: Store;
let memories: MemoryService;
let observer: ToolCallObserver;
let retrospective: Retrospective;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-retro-"));
	migrationsDir = join(tmpRoot, "migrations");
	retroDir = join(tmpRoot, "retrospectives");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	memories = new MemoryService(store);
	observer = new ToolCallObserver(store);
	retrospective = new Retrospective(store, memories, { dir: retroDir });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function callTool(
	tool: string,
	args: Record<string, unknown>,
	success: boolean,
	extra?: { stderr?: string; stdout?: string; exitCode?: number },
) {
	observer.onBefore({ tool, sessionId: SESSION_ID, args }, {});
	observer.onAfter(
		{ tool, sessionId: SESSION_ID, args },
		{ success, ...extra },
	);
}

describe("e2e — session with failures → retrospective.md", () => {
	it("generates a retrospective file and table row when there are failures", async () => {
		callTool("bash", { command: "npm test" }, true);
		callTool("edit", { filePath: "/a.ts" }, true);
		callTool("read", { path: "/b.ts" }, true);
		callTool("write", { path: "/c.ts" }, false, {
			stderr: "error TS2304: Cannot find name 'foo'",
			exitCode: 1,
		});
		callTool("grep", { pattern: "x" }, false, {
			stderr: "TypeError: x is undefined",
			exitCode: 1,
		});

		memories.save({
			type: "error",
			content: "When bash fails with typecheck: TS2304",
			scope: "project",
			sourceTool: "bash",
			sourceSession: SESSION_ID,
		});

		const result = await retrospective.generate(SESSION_ID);

		expect(result).not.toBeNull();
		const filePath = result as string;
		expect(filePath).toBe(join(retroDir, `${SESSION_ID}.md`));

		const content = readFileSync(filePath, "utf8");
		expect(content).toContain("# Retrospective");
		expect(content).toContain("## Resumen");
		expect(content).toContain("5 (3 ok, 2 failed)");
		expect(content).toContain("## Tools que fallaron");
		const failedSection = content.split("## Tools que fallaron")[1];
		expect(failedSection).toContain("write");
		expect(failedSection).toContain("grep");
		expect(content).toContain("## Lecciones generadas");
		expect(content).toContain("When bash fails with typecheck");

		const row = store
			.prepare("SELECT * FROM retrospectives WHERE session_id = ?")
			.get(SESSION_ID) as {
			file_path: string;
			failure_count: number;
			success_count: number;
			lessons_count: number;
		};
		expect(row).toBeTruthy();
		expect(row.file_path).toBe(filePath);
		expect(row.failure_count).toBe(2);
		expect(row.success_count).toBe(3);
		expect(row.lessons_count).toBe(1);
	});

	it("returns null and writes no file when there are no failures", async () => {
		callTool("bash", { command: "echo hi" }, true);
		callTool("edit", { filePath: "/a.ts" }, true);

		const result = await retrospective.generate(SESSION_ID);
		expect(result).toBeNull();

		const rows = store
			.prepare("SELECT * FROM retrospectives WHERE session_id = ?")
			.all(SESSION_ID);
		expect(rows.length).toBe(0);
	});

	it("returns null when session has no tool calls at all", async () => {
		const result = await retrospective.generate("empty-session");
		expect(result).toBeNull();
	});

	it("is idempotent: second generate returns same path without inserting a duplicate row", async () => {
		callTool("write", { path: "/c.ts" }, false, {
			stderr: "error TS2304: Cannot find name 'foo'",
			exitCode: 1,
		});
		memories.save({
			type: "error",
			content: "When write fails with typecheck: TS2304",
			scope: "project",
			sourceSession: SESSION_ID,
		});

		const first = await retrospective.generate(SESSION_ID);
		expect(first).not.toBeNull();

		const second = await retrospective.generate(SESSION_ID);
		expect(second).toBe(first);

		const rows = store
			.prepare("SELECT * FROM retrospectives WHERE session_id = ?")
			.all(SESSION_ID);
		expect(rows.length).toBe(1);
	});
});

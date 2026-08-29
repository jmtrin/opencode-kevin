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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Retrospective } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { ToolCallObserver } from "@jmtrin/kevin-core";
import { METRIC_KEYS, Metrics } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const MIGRATION_003_SQL = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const MIGRATION_004_SQL = readFileSync(
	join(__dirname, "..", "..", "packages/core/migrations", "004_v03_knowledge.sql"),
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
	writeFileSync(join(migrationsDir, "003_v02_signal.sql"), MIGRATION_003_SQL);
	writeFileSync(
		join(migrationsDir, "004_v03_knowledge.sql"),
		MIGRATION_004_SQL,
	);
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
	it("BUG-014 — renders a Spanish label for every metric key (no raw-key fallback)", async () => {
		// Metrics seeds all 13 METRIC_KEYS in its snapshot (zeroed), so
		// the "## Métricas" section must render 13 labelled lines.
		// A failing call is required for generate() to render at all.
		callTool("bash", { command: "npm test" }, false, {
			stderr: "error TS2304: Cannot find name 'foo'",
			exitCode: 1,
		});
		const metrics = new Metrics(store);
		const retroWithMetrics = new Retrospective(
			store,
			memories,
			{
				dir: retroDir,
			},
			metrics,
		);
		const path = await retroWithMetrics.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");
		const metricsSection = content.split("## Métricas")[1] ?? "";
		expect(metricsSection).toContain("Inyecciones totales: 0");
		expect(metricsSection).toContain("Inyecciones efectivas: 0");
		expect(metricsSection).toContain("Inyecciones ineficaces: 0");
		expect(metricsSection).toContain("Patrones promovidos (nuevos): 0");
		expect(metricsSection).toContain("Patrones causales: 0");
		expect(metricsSection).toContain("Enlaces causales: 0");
		expect(metricsSection).toContain("Memorias superadas: 0");
		for (const key of METRIC_KEYS) {
			// No raw key ever leaks into the section.
			expect(metricsSection).not.toContain(`- ${key}:`);
		}
	});

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

describe("e2e — retrospective v0.2.0 (K2-025) origin labels + FP recap + metrics", () => {
	it("tags lesson rows with [agent]/[reflector] labels based on origin", async () => {
		// Save an agent-origin lesson via MemoryService.save (no origin → default 'agent')
		memories.save({
			type: "error",
			content: "agent lesson A",
			scope: "project",
			sourceSession: SESSION_ID,
		});
		// Save a reflector-origin lesson directly via MemoryService.save with origin='reflector'
		memories.save({
			type: "error",
			content: "reflector lesson A",
			scope: "project",
			sourceSession: SESSION_ID,
			origin: "reflector",
			projectId: "proj-A",
			fingerprint: "aaaaaaaaaaaaaaaa",
		});

		// Trigger at least one failure so .generate doesn't return null
		callTool("write", { path: "/c.ts" }, false, {
			stderr: "error TS2304: Cannot find name",
			exitCode: 1,
		});

		const path = await retrospective.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");

		const lessonsSection = content
			.split("## Lecciones generadas")[1]
			.split("## False-positive recap")[0];
		expect(lessonsSection).toContain("- [agent] agent lesson A");
		expect(lessonsSection).toContain("- [reflector] reflector lesson A");
	});

	it("includes a False-positive recap section with no recurrence by default", async () => {
		memories.save({
			type: "error",
			content: "reflector lesson A",
			scope: "project",
			sourceSession: SESSION_ID,
			origin: "reflector",
			projectId: "proj-A",
			fingerprint: "bbbbbbbbbbbbbbbb",
		});
		callTool("write", { path: "/c.ts" }, false, {
			stderr: "error TS2304: Cannot find name",
			exitCode: 1,
		});
		// tool_calls.fingerprint column exists but is NULL since K2-009 doesn't populate it (K2-027 work).
		// So FP recap should report "Ninguna".

		const path = await retrospective.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");

		expect(content).toContain("## False-positive recap");
		const fpSection = content
			.split("## False-positive recap")[1]
			.split("## Métricas")[0];
		expect(fpSection).toContain(
			"Ninguna lección reflector-sourceada recurrrió en tool_calls",
		);
	});

	it("lists a FP when a tool_call carries the lesson's error fingerprint (real wiring)", async () => {
		// BUG-004 — the recap matches `COALESCE(error_fingerprint,
		// fingerprint)`; the production wiring (Reflector.onLinkError)
		// stamps error_fingerprint, so the fixture seeds THAT column, not
		// the legacy tool|args|success hash.
		store.exec(
			`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, error_fingerprint)
       VALUES ('fp-tool-1', '${SESSION_ID}', datetime('now'), 'bash', 'cmd', 0, 5, null, 'typecheck', '{}', 'proj-X', 'cccccccccccccccc')`,
		);
		memories.save({
			type: "error",
			content: "reflector lesson recurrence",
			scope: "project",
			sourceSession: SESSION_ID,
			origin: "reflector",
			projectId: "proj-X",
			fingerprint: "cccccccccccccccc",
		});
		callTool("bash", { command: "build" }, false, {
			stderr: "error runtime: boom",
			exitCode: 1,
		});

		const path = await retrospective.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");

		expect(content).toContain("## False-positive recap");
		const fpSection = content
			.split("## False-positive recap")[1]
			.split("## Métricas")[0];
		expect(fpSection).toContain("reflector lesson recurrence");
		expect(fpSection).toContain("cccccccccccccccc");
		expect(fpSection).toContain("recurrencias: 1");
	});

	it("lists a FP when the recap matches the legacy fingerprint hash too", async () => {
		// BUG-004 — pre-0.3 tool_calls rows have no error_fingerprint; the
		// COALESCE falls back to the legacy `fingerprint` column.
		store.exec(
			`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata, project_id, fingerprint)
       VALUES ('fp-tool-2', '${SESSION_ID}', datetime('now'), 'bash', 'cmd', 0, 5, null, 'typecheck', '{}', 'proj-X', 'dddddddddddddddd')`,
		);
		memories.save({
			type: "error",
			content: "reflector lesson legacy fp",
			scope: "project",
			sourceSession: SESSION_ID,
			origin: "reflector",
			projectId: "proj-X",
			fingerprint: "dddddddddddddddd",
		});
		callTool("bash", { command: "build" }, false, {
			stderr: "error runtime: boom",
			exitCode: 1,
		});

		const path = await retrospective.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");

		const fpSection = content
			.split("## False-positive recap")[1]
			.split("## Métricas")[0];
		expect(fpSection).toContain("reflector lesson legacy fp");
		expect(fpSection).toContain("recurrencias: 1");
	});

	it("does NOT include a Métricas section when metrics is not provided (backward-compat)", async () => {
		memories.save({
			type: "error",
			content: "no metrics section",
			scope: "project",
			sourceSession: SESSION_ID,
		});
		callTool("bash", { command: "echo hi" }, false, {
			stderr: "error runtime: any",
			exitCode: 1,
		});

		const path = await retrospective.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");
		expect(content).not.toContain("## Métricas");
	});

	it("includes the metrics snapshot in markdown when metrics instance is passed", async () => {
		const fakeMetrics = {
			incr: vi.fn(),
			snapshot: vi.fn(() => ({
				tokens_injected_pre_prompt: 42,
				tokens_injected_compacting: 7,
				reflections_throttled: 3,
				duplicate_suppressions: 2,
				tool_calls_deduped: 0,
				patterns_mined: 0,
			})),
			get: vi.fn(() => 0),
			flush: vi.fn(),
			close: vi.fn(),
		} as unknown as Metrics;

		const retroWithMetrics = new Retrospective(
			store,
			memories,
			{ dir: retroDir },
			fakeMetrics,
		);
		memories.save({
			type: "error",
			content: "with metrics",
			scope: "project",
			sourceSession: SESSION_ID,
		});
		callTool("bash", { command: "echo hi" }, false, {
			stderr: "error runtime: any",
			exitCode: 1,
		});

		const path = await retroWithMetrics.generate(SESSION_ID);
		expect(path).not.toBeNull();
		const content = readFileSync(path as string, "utf8");
		expect(content).toContain("## Métricas");
		expect(content).toContain("Tokens inyectados (pre-prompt): 42");
		expect(content).toContain("Reflexiones throttled: 3");
		expect(content).toContain("Patrones minados: 0");
		expect(fakeMetrics.snapshot).toHaveBeenCalled();
	});
});

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;
const ctx: ToolContext = {
	sessionID: "s1",
	messageID: "m1",
	agent: "test",
	directory: "",
	worktree: "",
	abort: new AbortController().signal,
	metadata() {},
	ask() {
		return Promise.resolve();
	},
};

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-tools-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	copyFileSync(
		join(process.cwd(), "migrations", "001_initial.sql"),
		join(migrationsDir, "001_initial.sql"),
	);
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath: ":memory:",
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	ctx.directory = tmpRoot;
	ctx.worktree = tmpRoot;
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

function parse(result: { output: string }): unknown {
	return JSON.parse(result.output);
}

describe("kevin_save", () => {
	it("guarda una memoria y retorna un id", async () => {
		const result = await hooks.tool?.kevin_save.execute(
			{
				type: "error",
				content: "typecheck failed on foo.ts",
				scope: "project",
			},
			ctx,
		);
		expect(result).toBeDefined();
		const parsed = parse(result as { output: string }) as { id: string };
		expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
	});

	it("guarda con scope session", async () => {
		const result = await hooks.tool?.kevin_save.execute(
			{
				type: "decision",
				content: "usamos vitest para tests",
				scope: "session",
			},
			ctx,
		);
		const parsed = parse(result as { output: string }) as { id: string };
		expect(parsed.id).toBeTruthy();
	});
});

describe("kevin_query", () => {
	it("encuentra memorias por texto", async () => {
		await hooks.tool?.kevin_save.execute(
			{
				type: "error",
				content: "typecheck no-unused-vars error",
				scope: "project",
			},
			ctx,
		);
		const result = await hooks.tool?.kevin_query.execute(
			{ query: "typecheck", limit: 10 },
			ctx,
		);
		const parsed = parse(result as { output: string }) as Array<{
			id: string;
			type: string;
			content: string;
		}>;
		expect(parsed.length).toBeGreaterThanOrEqual(1);
		expect(parsed.some((m) => m.content.includes("typecheck"))).toBe(true);
	});

	it("filtra por type", async () => {
		await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "lint error biome", scope: "project" },
			ctx,
		);
		await hooks.tool?.kevin_save.execute(
			{ type: "decision", content: "lint config decision", scope: "project" },
			ctx,
		);
		const result = await hooks.tool?.kevin_query.execute(
			{ query: "lint", type: "decision", limit: 10 },
			ctx,
		);
		const parsed = parse(result as { output: string }) as Array<{
			type: string;
		}>;
		expect(parsed.every((m) => m.type === "decision")).toBe(true);
	});
});

describe("kevin_recall", () => {
	it("retorna memorias relevantes sin query", async () => {
		await hooks.tool?.kevin_save.execute(
			{
				type: "pattern",
				content: "patron de retry con backoff",
				scope: "project",
			},
			ctx,
		);
		const result = await hooks.tool?.kevin_recall.execute({ limit: 5 }, ctx);
		const parsed = parse(result as { output: string }) as Array<{
			content: string;
		}>;
		expect(parsed.length).toBeGreaterThanOrEqual(1);
		expect(parsed.some((m) => m.content.includes("retry"))).toBe(true);
	});

	it("expone scope=session y retorna memorias de session (F#27)", async () => {
		await hooks.tool?.kevin_save.execute(
			{
				type: "decision",
				content: "decision temporal de sesion:",
				scope: "session",
			},
			ctx,
		);
		await hooks.tool?.kevin_save.execute(
			{
				type: "decision",
				content: "decision persistente del proyecto",
				scope: "project",
			},
			ctx,
		);
		const result = await hooks.tool?.kevin_recall.execute(
			{ scope: "session", limit: 5 },
			ctx,
		);
		const parsed = parse(result as { output: string }) as Array<{
			content: string;
		}>;
		expect(parsed.length).toBeGreaterThanOrEqual(1);
		const allSession = parsed.every((m) => m.content.includes("sesion:"));
		expect(allSession).toBe(true);
		expect(parsed.some((m) => m.content.includes("proyecto"))).toBe(false);
	});
});

describe("kevin_status", () => {
	it("retorna conteos de la DB", async () => {
		await hooks.tool?.kevin_save.execute(
			{ type: "context", content: "estado inicial", scope: "project" },
			ctx,
		);
		const result = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(result as { output: string }) as {
			memories: number;
			tool_calls: number;
			retrospectives: number;
		};
		expect(parsed.memories).toBeGreaterThanOrEqual(1);
		expect(parsed.tool_calls).toBeGreaterThanOrEqual(0);
		expect(parsed.retrospectives).toBe(0);
	});
});

describe("kevin_retrospective", () => {
	it("sin session activa retorna mensaje", async () => {
		const result = await hooks.tool?.kevin_retrospective.execute({}, ctx);
		const parsed = parse(result as { output: string }) as { message: string };
		expect(parsed.message).toContain("session_id");
	});

	it("con session sin fallos retorna mensaje de nada que retrospectar", async () => {
		const result = await hooks.tool?.kevin_retrospective.execute(
			{ session_id: "no-failures-sess" },
			ctx,
		);
		const parsed = parse(result as { output: string }) as { message: string };
		expect(parsed.message).toContain("fallos");
	});

	it("con fallos genera archivo retrospective", async () => {
		const sess = "fail-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "c1" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "c1",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr: "error TS2304: Cannot find name 'foo'",
				},
			},
		);
		const result = await hooks.tool?.kevin_retrospective.execute(
			{ session_id: sess },
			ctx,
		);
		const parsed = parse(result as { output: string }) as { file_path: string };
		expect(parsed.file_path).toBeTruthy();
		expect(existsSync(parsed.file_path)).toBe(true);
	});
});

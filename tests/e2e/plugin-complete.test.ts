import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-e2e-"));
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
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

function makeCtx(sess: string): ToolContext {
	return {
		sessionID: sess,
		messageID: "m",
		agent: "test",
		directory: tmpRoot,
		worktree: tmpRoot,
		abort: new AbortController().signal,
		metadata() {},
		ask() {
			return Promise.resolve();
		},
	};
}

async function waitForAsync(
	predicate: () => Promise<boolean>,
	timeoutMs = 1000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`waitForAsync timed out after ${timeoutMs}ms`);
}

async function queryMemories(
	sess: string,
	text: string,
): Promise<
	Array<{ id: string; type: string; content: string; scope: string }>
> {
	const r = await hooks.tool?.kevin_query.execute(
		{ query: text, limit: 50 },
		makeCtx(sess),
	);
	return JSON.parse((r as { output: string }).output) as Array<{
		id: string;
		type: string;
		content: string;
		scope: string;
	}>;
}

describe("ciclo completo Observe -> Learn -> Share", () => {
	it("session.created captura id, tool calls se registran, fallo genera leccion, system.transform inyecta, session.idle genera retrospective", async () => {
		const sess = "complete-sess";
		const ctx = makeCtx(sess);

		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ok-1" },
			{ args: { command: "npm run lint" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "ok-1",
				args: { command: "npm run lint" },
			},
			{ title: "bash", output: "all good", metadata: { success: true } },
		);

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fail-1" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fail-1",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr:
						"error TS2304: Cannot find name 'foo' at C:\\Users\\dev\\src\\bar.ts:42",
					exitCode: 1,
				},
			},
		);

		await waitForAsync(async () => {
			const mems = await queryMemories(sess, "typecheck");
			return mems.some((m) => m.content.includes("Verify types and imports"));
		});

		const memories = await queryMemories(sess, "typecheck");
		const lesson = memories.find((m) =>
			m.content.includes("Verify types and imports"),
		);
		expect(lesson).toBeDefined();
		expect(lesson?.content.includes("C:\\Users")).toBe(false);
		expect(lesson?.content.includes("<path>")).toBe(true);

		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [
					{ type: "text", text: "how do I fix the typecheck error?" },
				] as never,
			},
		);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBeGreaterThanOrEqual(1);
		expect(sysOutput.system[0]).toContain("<kevin-context>");
		expect(sysOutput.system[0]).toContain("Verify types and imports");

		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});
		const retroPath = join(tmpRoot, "retrospectives", `${sess}.md`);
		await waitForAsync(async () => existsSync(retroPath));
		expect(existsSync(retroPath)).toBe(true);
	});

	it("system.transform no inyecta nada cuando no hay memorias", async () => {
		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: "empty", model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBe(0);
	});

	it("session.idle sin fallos no genera retrospective", async () => {
		const sess = "no-fail-e2e";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});
		await hooks["tool.execute.before"]?.(
			{ tool: "read", sessionID: sess, callID: "r1" },
			{ args: {} },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "read", sessionID: sess, callID: "r1", args: {} },
			{ title: "read", output: "ok", metadata: { success: true } },
		);
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});
		const retroPath = join(tmpRoot, "retrospectives", `${sess}.md`);
		await waitForAsync(async () => !existsSync(retroPath), 200);
		expect(existsSync(retroPath)).toBe(false);
	});

	it("chat.message fija lastUserQuery y system.transform inyecta solo lecciones relevantes (context-aware)", async () => {
		const sess = "ctx-sess";
		const ctx = makeCtx(sess);

		await hooks.tool?.kevin_save.execute(
			{
				type: "error",
				content:
					"When bash fails with typecheck: error TS2304\nSuggestion: Verify types and imports before running.",
				scope: "project",
			},
			ctx,
		);
		await hooks.tool?.kevin_save.execute(
			{
				type: "context",
				content: "cooking pasta recipe dinner italian food",
				scope: "project",
			},
			ctx,
		);

		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [
					{ type: "text", text: "how do I fix the typecheck error?" },
				] as never,
			},
		);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBe(1);
		expect(sysOutput.system[0]).toContain("<kevin-context>");
		expect(sysOutput.system[0]).toContain("Verify types and imports");
		expect(sysOutput.system[0]).not.toContain("cooking pasta");
	});

	it("chat.message con query no relacionado no inyecta lecciones irrelevantes", async () => {
		const sess = "ctx-sess-2";
		const ctx = makeCtx(sess);

		await hooks.tool?.kevin_save.execute(
			{
				type: "error",
				content:
					"When bash fails with typecheck: error TS2304\nSuggestion: Verify types and imports before running.",
				scope: "project",
			},
			ctx,
		);

		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [{ type: "text", text: "cook pasta recipe dinner" }] as never,
			},
		);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBe(0);
	});

	it("event session.next.tool.failed dispara reflection via toolCache cuando metadata del tool no marca fallo", async () => {
		const sess = "event-fail-sess";

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ev-fail" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "ev-fail",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "command finished",
				metadata: {},
			},
		);
		expect((await queryMemories(sess, "typecheck")).length).toBe(0);

		await hooks.event?.({
			event: {
				type: "session.next.tool.failed",
				properties: {
					sessionID: sess,
					callID: "ev-fail",
					error: {
						type: "unknown",
						message: "error TS2304: Cannot find name 'foo'",
					},
				},
			} as never,
		});

		await waitForAsync(async () => {
			const mems = await queryMemories(sess, "typecheck");
			return mems.some((m) => m.content.includes("Verify types and imports"));
		});

		const mems = await queryMemories(sess, "typecheck");
		const lesson = mems.find((m) =>
			m.content.includes("Verify types and imports"),
		);
		expect(lesson).toBeDefined();
		expect(lesson?.content).toContain("When bash fails with typecheck");
		expect(lesson?.content).toContain("TS2304: Cannot find name 'foo'");
	});

	it("event session.next.tool.success limpia toolCache sin disparar reflection", async () => {
		const sess = "event-success-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ev-ok" },
			{ args: { command: "echo hi" } },
		);
		await hooks.event?.({
			event: {
				type: "session.next.tool.success",
				properties: { sessionID: sess, callID: "ev-ok" },
			} as never,
		});
		await waitForAsync(
			async () => (await queryMemories(sess, "echo")).length === 0,
			200,
		);
		expect((await queryMemories(sess, "echo")).length).toBe(0);
	});

	it("chat.message con solo stop-words NO dispara bucket statico (lastUserQuery=null)", async () => {
		const sess = "stop-words-sess";
		const ctx = makeCtx(sess);

		await hooks.tool?.kevin_save.execute(
			{
				type: "context",
				content: "typecheck authentication routing completely unrelated xyz",
				scope: "project",
			},
			ctx,
		);

		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [{ type: "text", text: "the the the how what why" }] as never,
			},
		);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBe(0);
	});

	it("heuristica F#28: stdout menciona error pero stderr vacio → success=true, no reflection", async () => {
		const sess = "stderr-empty-sess";
		const ctx = makeCtx(sess);

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ok-only" },
			{ args: { command: "npm run build" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "ok-only",
				args: { command: "npm run build" },
			},
			{
				title: "bash",
				output: "Build succeeded. Note: avoid panic in error paths.",
				metadata: {},
			},
		);

		await waitForAsync(
			async () => (await queryMemories(sess, "panic")).length === 0,
			200,
		);
		expect((await queryMemories(sess, "panic")).length).toBe(0);
	});

	it("K-049: ciclo auto-suficiente con metadata vacia sin evento session.next.tool.failed", async () => {
		const sess = "empty-meta-e2e-sess";

		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "em-fail" },
			{ args: { command: "npx tsc --noEmit" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "em-fail",
				args: { command: "npx tsc --noEmit" },
			},
			{
				title: "bash",
				output: "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'.",
				metadata: {},
			},
		);

		await waitForAsync(async () => {
			const mems = await queryMemories(sess, "typecheck");
			return mems.some((m) => m.content.includes("Verify types and imports"));
		});

		const memories = await queryMemories(sess, "typecheck");
		const lesson = memories.find((m) =>
			m.content.includes("Verify types and imports"),
		);
		expect(lesson).toBeDefined();
		expect(lesson?.content).toContain("TS2304");

		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [
					{ type: "text", text: "how do I fix the typecheck error?" },
				] as never,
			},
		);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBeGreaterThanOrEqual(1);
		expect(sysOutput.system[0]).toContain("<kevin-context>");
		expect(sysOutput.system[0]).toContain("Verify types and imports");
	});
});

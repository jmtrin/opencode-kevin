import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
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

function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 10));
}

describe("ciclo completo Observe -> Learn -> Share", () => {
	it("session.created captura id, tool calls se registran, fallo genera leccion, system.transform inyecta, session.idle genera retrospective", async () => {
		const sess = "complete-sess";

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
		await flush();

		const queryResult = await hooks.tool?.kevin_query.execute(
			{ query: "typecheck", limit: 10 },
			{
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
			},
		);
		const memories = JSON.parse(
			(queryResult as { output: string }).output,
		) as Array<{
			content: string;
		}>;
		expect(memories.length).toBeGreaterThanOrEqual(1);
		const lesson = memories.find((m) =>
			m.content.includes("Verify types and imports"),
		);
		expect(lesson).toBeDefined();
		expect(lesson?.content.includes("C:\\Users")).toBe(false);
		expect(lesson?.content.includes("<path>")).toBe(true);

		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBeGreaterThanOrEqual(1);
		expect(sysOutput.system[0]).toContain("<kevin-context>");
		expect(sysOutput.system[0]).toContain("Verify types and imports");

		await hooks.event?.({
			event: { type: "session.idle", properties: { sessionID: sess } } as never,
		});
		await flush();

		const retroPath = join(tmpRoot, "retrospectives", `${sess}.md`);
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
			event: { type: "session.idle", properties: { sessionID: sess } } as never,
		});
		await flush();
		expect(existsSync(join(tmpRoot, "retrospectives", `${sess}.md`))).toBe(
			false,
		);
	});
});

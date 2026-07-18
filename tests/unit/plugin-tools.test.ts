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
	copyFileSync(
		join(process.cwd(), "migrations", "003_v02_signal.sql"),
		join(migrationsDir, "003_v02_signal.sql"),
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
			{ query: "typecheck", limit: 10, full: true },
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
			{ query: "lint", type: "decision", limit: 10, full: true },
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

describe("kevin_status — v0.2.0 (K2-014) origin breakdown + metrics", () => {
	it("expone memories_reflector / memories_agent / memories_pattern y el objeto metrics", async () => {
		// 1 agent-saved memory (existing context memory from kevin_save in the
		// earlier describe block may exist, but we add an explicit one for
		// determinism).
		await hooks.tool?.kevin_save.execute(
			{ type: "context", content: "estado agente", scope: "project" },
			ctx,
		);
		// 1 reflector-sourced error memory by triggering a real fail.
		const sess = "k2014-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "k2014c1" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "k2014c1",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr: "error TS2304: Cannot find name 'k2014foo'",
				},
			},
		);
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as {
			memories: number;
			memories_reflector: number;
			memories_agent: number;
			memories_pattern: number;
			tool_calls: number;
			retrospectives: number;
			metrics: Record<string, number>;
		};
		expect(parsed.memories).toBeGreaterThanOrEqual(2);
		expect(parsed.memories_reflector).toBeGreaterThanOrEqual(1);
		expect(parsed.memories_agent).toBeGreaterThanOrEqual(1);
		expect(parsed.memories_pattern).toBe(0);
		expect(typeof parsed.metrics).toBe("object");
		expect(parsed.metrics).not.toBe(null);
		// All 6 seeded metric keys are present (zeros at minimum).
		for (const k of [
			"tokens_injected_pre_prompt",
			"tokens_injected_compacting",
			"reflections_throttled",
			"duplicate_suppressions",
			"tool_calls_deduped",
			"patterns_mined",
		]) {
			expect(parsed.metrics).toHaveProperty(k);
			expect(typeof parsed.metrics[k]).toBe("number");
		}
	});

	it("metrics refleja reflections_throttled cuando un mismo fingerprint se invoca dos veces en la ventana de throttle", async () => {
		// Reflector's per-fingerprint throttle (K2-007) skips the second
		// invoke within the 60 s window and bumps `reflections_throttled`.
		// (Dedup via the partial UNIQUE index is exercised in
		// memorieservice-v02.test.ts; here we just verify the metrics
		// surface in kevin_status reflects the throttle counter.)
		const stderrText = "error TS2304: Cannot find name 'dupk2014'";
		for (let i = 0; i < 2; i++) {
			const sess = `k2014-dup-${i}`;
			await hooks["tool.execute.before"]?.(
				{ tool: "bash", sessionID: sess, callID: `k2014dupc${i}` },
				{ args: { command: "npm run typecheck" } },
			);
			await hooks["tool.execute.after"]?.(
				{
					tool: "bash",
					sessionID: sess,
					callID: `k2014dupc${i}`,
					args: { command: "npm run typecheck" },
				},
				{
					title: "bash",
					output: "",
					metadata: { success: false, stderr: stderrText },
				},
			);
		}
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as {
			metrics: Record<string, number>;
		};
		expect(parsed.metrics.reflections_throttled).toBeGreaterThanOrEqual(1);
	});

	it("backward-compat: campos legacy memories/tool_calls/retrospectives se mantienen", async () => {
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as {
			memories: number;
			tool_calls: number;
			retrospectives: number;
		};
		expect(parsed).toHaveProperty("memories");
		expect(parsed).toHaveProperty("tool_calls");
		expect(parsed).toHaveProperty("retrospectives");
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

describe("tool.execute.after — success=true override via ERROR_LINE_RE", () => {
	it("mantiene success=true cuando output no contiene linea de error", async () => {
		const sess = "ok-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ok1" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "ok1", args: {} },
			{ title: "bash", output: "0 errors", metadata: { success: true } },
		);
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBe(0);
	});

	it("marca success=false cuando meta.success=true pero output matchea ERROR_LINE_RE (caso bash+tsc)", async () => {
		const sess = "fp-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fp1" },
			{ args: { command: "npx tsc --noEmit" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fp1",
				args: { command: "npx tsc --noEmit" },
			},
			{
				title: "bash",
				output: "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'.",
				metadata: { success: true },
			},
		);
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBeGreaterThanOrEqual(1);
		const query = await hooks.tool?.kevin_query.execute(
			{ query: "typecheck", limit: 10, full: true },
			ctx,
		);
		const mems = parse(query as { output: string }) as Array<{
			content: string;
		}>;
		expect(mems.some((m) => m.content.includes("typecheck"))).toBe(true);
	});

	it("exitCode non-zero prevalece sobre meta.success=true", async () => {
		const sess = "exit-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ex1" },
			{ args: { command: "fallar" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "ex1", args: {} },
			{ title: "bash", output: "ok", metadata: { success: true, exitCode: 2 } },
		);
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBeGreaterThanOrEqual(1);
	});

	it("metadata vacia + error TS2304 en output.output dispara reflection sin evento (K-045)", async () => {
		const sess = "empty-meta-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "em1" },
			{ args: { command: "npx tsc --noEmit" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "em1",
				args: { command: "npx tsc --noEmit" },
			},
			{
				title: "bash",
				output: "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'.",
				metadata: {},
			},
		);
		await new Promise((r) => setTimeout(r, 10));
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBeGreaterThanOrEqual(1);
		const query = await hooks.tool?.kevin_query.execute(
			{ query: "typecheck", limit: 10, full: true },
			ctx,
		);
		const mems = parse(query as { output: string }) as Array<{
			content: string;
		}>;
		expect(
			mems.some((m) => m.content.includes("Verify types and imports")),
		).toBe(true);
		expect(mems.some((m) => m.content.includes("TS2304"))).toBe(true);
	});

	it("metadata vacia + '0 errors' sin marcador fuerte → success=true (negativo)", async () => {
		const sess = "empty-meta-ok-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "em2" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "em2", args: {} },
			{ title: "bash", output: "0 errors", metadata: {} },
		);
		await new Promise((r) => setTimeout(r, 10));
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBe(0);
	});

	it("metadata vacia + prosa con 'panic'/'error' sin marcador fuerte → success=true (F#28 en rama default)", async () => {
		const sess = "fp-default-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fpd1" },
			{ args: { command: "npm run build" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "fpd1", args: {} },
			{
				title: "bash",
				output: "Build succeeded. Note: avoid panic in error paths.",
				metadata: {},
			},
		);
		await new Promise((r) => setTimeout(r, 10));
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBe(0);
	});

	it("metadata con exit_code alterna (snake_case) → reflection (verifica pickExitCode)", async () => {
		const sess = "exit-alt-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "ea1" },
			{ args: { command: "fallar" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "ea1", args: {} },
			{ title: "bash", output: "ok", metadata: { exit_code: 2 } },
		);
		const status = await hooks.tool?.kevin_status.execute({}, ctx);
		const parsed = parse(status as { output: string }) as { memories: number };
		expect(parsed.memories).toBeGreaterThanOrEqual(1);
	});
});

describe("kevin_get (v0.2.0 — K2-011)", () => {
	it("retorna la memoria completa por id", async () => {
		const saveRes = await hooks.tool?.kevin_save.execute(
			{
				type: "decision",
				content: "Stack: vitest + biome + tsc strict",
				scope: "project",
			},
			ctx,
		);
		const { id } = parse(saveRes as { output: string }) as { id: string };
		const res = await hooks.tool?.kevin_get.execute({ id }, ctx);
		const got = parse(res as { output: string }) as Record<string, unknown>;
		expect(got.id).toBe(id);
		expect(got.type).toBe("decision");
		expect(got.scope).toBe("project");
		expect(String(got.content)).toContain("vitest");
		expect(typeof got.relevanceScore).toBe("number");
		expect(typeof got.createdAt).toBe("string");
		expect(typeof got.updatedAt).toBe("string");
		expect(got.origin).toBe("agent");
	});

	it("retorna not_found cuando el id no existe", async () => {
		const res = await hooks.tool?.kevin_get.execute(
			{ id: "01959b1f-0000-7000-8000-000000000000" },
			ctx,
		);
		const parsed = parse(res as { output: string }) as {
			error: string;
			id: string;
		};
		expect(parsed.error).toBe("not_found");
		expect(parsed.id).toBe("01959b1f-0000-7000-8000-000000000000");
	});

	it("expone projectId/fingerprint/origin para reflector-sourced error memories", async () => {
		const sess = "fp-reflect-sess";
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fr1" },
			{ args: { command: "fail" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "fr1", args: {} },
			{
				title: "bash",
				output: "Error: TS2304 cannot find name 'x'",
				metadata: { exit_code: 1 },
			},
		);
		await new Promise((r) => setTimeout(r, 10));
		const q = await hooks.tool?.kevin_query.execute(
			{ query: "TS2304", limit: 5, full: true },
			ctx,
		);
		const rows = parse(q as { output: string }) as Array<{
			id: string;
			type: string;
		}>;
		expect(rows.length).toBeGreaterThanOrEqual(1);
		const got = await hooks.tool?.kevin_get.execute({ id: rows[0].id }, ctx);
		const parsed = parse(got as { output: string }) as {
			id: string;
			type: string;
			origin: string;
			fingerprint: string | null;
			projectId: string | null;
		};
		expect(parsed.type).toBe("error");
		expect(parsed.origin).toBe("reflector");
		expect(typeof parsed.fingerprint).toBe("string");
		expect(parsed.fingerprint).not.toBe(null);
		expect(parsed.fingerprint).toMatch(/^[0-9a-f]{16}$/);
	});

	it("metadata se preserva en el fetch completo", async () => {
		const saveRes = await hooks.tool?.kevin_save.execute(
			{
				type: "context",
				content: "info adicional con metadata",
				scope: "project",
				metadata: { foo: "bar", count: 42 },
			},
			ctx,
		);
		const { id } = parse(saveRes as { output: string }) as { id: string };
		const res = await hooks.tool?.kevin_get.execute({ id }, ctx);
		const got = parse(res as { output: string }) as {
			metadata: { foo: string; count: number };
		};
		expect(got.metadata.foo).toBe("bar");
		expect(got.metadata.count).toBe(42);
	});
});

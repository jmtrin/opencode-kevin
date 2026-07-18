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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-v02-val-"));
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

function parse(out: unknown): unknown {
	return JSON.parse((out as { output: string }).output);
}

describe("e2e — K2-028 validation protocol (v0.2.0 Signal Quality)", () => {
	it("Reflector guarda leccion origin=reflector, fingerprint FNV-1a, lesson v2 'Likely cause' — sin kevin_save del agente", async () => {
		const sess = "validation-sess";
		const ctx = makeCtx(sess);

		// 1. session.created
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		// 2. Drive a failure event with stderr containing TS2304 — triggers Reflector (K2-007 + K2-018)
		// NO kevin_save call by the agent — the anti-gaming assertion.
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fail-v02" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fail-v02",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr:
						"error TS2304: Cannot find name 'missing_v028' at C:\\Users\\dev\\src\\bar.ts:42",
					exitCode: 1,
				},
			},
		);

		// 3. Wait for reflector to save
		await waitForAsync(async () => {
			const q = await hooks.tool?.kevin_query.execute(
				{ query: "TS2304 missing_v028", limit: 5, full: true },
				ctx,
			);
			const rows = parse(q) as Array<{ id: string }>;
			return rows.length >= 1;
		});

		// 4. kevin_status — memries_reflector >= 1, memories_pattern === 0, metrics object present
		const statusRes = await hooks.tool?.kevin_status.execute({}, ctx);
		const status = parse(statusRes) as {
			memories: number;
			memories_reflector: number;
			memories_agent: number;
			memories_pattern: number;
			tool_calls: number;
			retrospectives: number;
			metrics: Record<string, number>;
		};
		expect(status.memories).toBeGreaterThanOrEqual(1);
		expect(status.memories_reflector).toBeGreaterThanOrEqual(1);
		expect(status.memories_pattern).toBe(0);
		expect(typeof status.metrics).toBe("object");
		expect(status.metrics).not.toBe(null);
		// All 6 seeded metric keys present
		const expectedKeys = [
			"tokens_injected_pre_prompt",
			"tokens_injected_compacting",
			"reflections_throttled",
			"duplicate_suppressions",
			"tool_calls_deduped",
			"patterns_mined",
		];
		for (const k of expectedKeys) {
			expect(typeof status.metrics[k]).toBe("number");
		}

		// 5. Drive session.idle — triggers metrics.flush, retrospective, boostPositiveReflectors, patternMiner.mine (off by default)
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});

		// 6. kevin_query slim — returns {id, type, scope, score, snippet}
		const slimRes = await hooks.tool?.kevin_query.execute(
			{ query: "TS2304 missing_v028", limit: 5 },
			ctx,
		);
		const slimRows = parse(slimRes) as Array<{
			id: string;
			type: string;
			scope: string;
			score: number;
			snippet: string;
		}>;
		expect(slimRows.length).toBeGreaterThanOrEqual(1);
		const row = slimRows[0];
		expect(row.type).toBe("error");
		expect(row.scope).toBe("project");
		expect(typeof row.score).toBe("number");
		expect(Number.isFinite(row.score)).toBe(true);
		expect(typeof row.snippet).toBe("string");
		expect(row.snippet).toContain("TS2304");

		// 7. kevin_get — full row with origin='reflector', fingerprint 16-char hex, content contains 'Likely cause' (K2-018)
		const getRes = await hooks.tool?.kevin_get.execute({ id: row.id }, ctx);
		const full = parse(getRes) as {
			id: string;
			type: string;
			content: string;
			scope: string;
			origin: string;
			fingerprint: string | null;
			projectId: string | null;
			relevanceScore: number;
		};
		expect(full.id).toBe(row.id);
		expect(full.type).toBe("error");
		expect(full.scope).toBe("project");
		expect(full.origin).toBe("reflector"); // anti-gaming (D2-06, plan §B8)
		expect(typeof full.fingerprint).toBe("string");
		expect(full.fingerprint).not.toBe(null);
		expect(full.fingerprint).toMatch(/^[0-9a-f]{16}$/); // FNV-1a 64-bit (K2-003)
		expect(full.content).toContain(
			"Likely cause: import or typo (code TS2304)",
		); // K2-018 lesson v2 composition
		expect(full.content).toContain("Verify types and imports"); // SUGGESTIONS fallback retained

		// 8. system.transform on a follow-up session — ContextInjector (K2-012 + K2-013) wraps blocks in <protect> with id: line
		const sess2 = "validation-sess-2";
		await hooks["chat.message"]?.(
			{ sessionID: sess2 },
			{
				message: {} as never,
				parts: [{ type: "text", text: "how to fix TS2304?" }] as never,
			},
		);
		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess2, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);
		expect(sysOutput.system.length).toBeGreaterThanOrEqual(1);
		const block = sysOutput.system[0];
		expect(block).toContain("<kevin-context>");
		expect(block).toContain("</kevin-context>");
		expect(block).toContain("<protect>"); // K2-012 default-on wrapper
		expect(block).toContain("</protect>");
		expect(block).toContain("id:"); // K2-012 id line
		expect(block).toContain("[error] When"); // lesson v2 body
		expect(block).toContain("Likely cause: import or typo (code TS2304)"); // lesson v2 dispatched hint (K2-018)

		// 9. Anti-gaming: NO agent-sourced 'error' memory was created during this validation
		// (i.e. test code never called kevin_save; only Reflector ran)
		const allRes = await hooks.tool?.kevin_query.execute(
			{ query: "TS2304 missing_v028", limit: 50, full: true },
			ctx,
		);
		const allRows = parse(allRes) as Array<{
			id: string;
			type: string;
			content: string;
		}>;
		const agentErrors = allRows.filter(
			(r) =>
				r.type === "error" &&
				r.content.includes("missing_v028") &&
				!r.content.includes("Likely cause"), // agent-saved wouldn't have the Likely-cause line composed by Reflector
		);
		expect(agentErrors.length).toBe(0);

		// 10. session.idle for sess2 also flushes metrics + generates retrospective
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess2 },
			} as never,
		});
		const retroPath = join(tmpRoot, "retrospectives", `${sess}.md`);
		await waitForAsync(async () => existsSync(retroPath));
		expect(existsSync(retroPath)).toBe(true);
	});

	it("feedback loop positive (K2-026): boost +0.05 reflector lessons sin recurrencia en tool_calls", async () => {
		const sess = "fb-sess";
		const ctx = makeCtx(sess);

		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fb1" },
			{ args: { command: "npm run typecheck" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fb1",
				args: { command: "npm run typecheck" },
			},
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr: "error TS2304: Cannot find name 'fb_missing'",
					exitCode: 1,
				},
			},
		);

		await waitForAsync(async () => {
			const q = await hooks.tool?.kevin_query.execute(
				{ query: "fb_missing", limit: 5, full: true },
				ctx,
			);
			return (parse(q) as Array<{ id: string }>).length >= 1;
		});

		// Read the relevance_score BEFORE boost via kevin_get (full row, includes relevanceScore)
		const beforeList = parse(
			await hooks.tool?.kevin_query.execute(
				{ query: "fb_missing", limit: 5, full: true },
				ctx,
			),
		) as Array<{ id: string; type: string; content: string; scope: string }>;
		expect(beforeList.length).toBeGreaterThanOrEqual(1);
		const beforeGet = parse(
			await hooks.tool?.kevin_get.execute({ id: beforeList[0].id }, ctx),
		) as {
			id: string;
			relevanceScore: number;
			origin: string;
		};
		expect(beforeGet.origin).toBe("reflector");
		const beforeScore = beforeGet.relevanceScore;

		// session.idle triggers boostPositiveReflectors (K2-026) — no recurrence → +0.05
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});

		// Read the relevance_score AFTER boost via kevin_get on the same id
		const afterGet = parse(
			await hooks.tool?.kevin_get.execute({ id: beforeList[0].id }, ctx),
		) as {
			id: string;
			relevanceScore: number;
		};
		const afterScore = afterGet.relevanceScore;
		// Boost epsilon = 0.05; allow floating point tolerance
		expect(afterScore).toBeGreaterThanOrEqual(beforeScore + 0.049);
		expect(afterScore).toBeLessThanOrEqual(1.0);
	});

	it("kevin_status retorna el objeto metrics con contadorescoherentes tras multiple system.transform", async () => {
		const sess = "metrics-sess";
		const ctx = makeCtx(sess);

		// Trigger Reflector + session.idle once
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "m1" },
			{ args: { command: "fail" } },
		);
		await hooks["tool.execute.after"]?.(
			{ tool: "bash", sessionID: sess, callID: "m1", args: {} },
			{
				title: "bash",
				output: "",
				metadata: {
					success: false,
					stderr: "error TS2304: Cannot find name 'metrics_xyz'",
					exitCode: 1,
				},
			},
		);
		await waitForAsync(async () => {
			const q = await hooks.tool?.kevin_query.execute(
				{ query: "metrics_xyz", limit: 5, full: true },
				ctx,
			);
			return (parse(q) as Array<{ id: string }>).length >= 1;
		});

		// Drive a system.transform — bumps tokens_injected_pre_prompt via ContextInjector (K2-013)
		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [{ type: "text", text: "TS2304 typecheck" }] as never,
			},
		);
		const sysOutput = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			sysOutput,
		);

		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});

		const statusRes = await hooks.tool?.kevin_status.execute({}, ctx);
		const status = parse(statusRes) as {
			memories_reflector: number;
			metrics: Record<string, number>;
		};
		expect(status.memories_reflector).toBeGreaterThanOrEqual(1);
		expect(status.metrics.tokens_injected_pre_prompt).toBeGreaterThan(0);
	});
});

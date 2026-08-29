import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

const MIGRATIONS = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
];

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-trace-e2e-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const name of MIGRATIONS) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", name),
			join(migrationsDir, name),
		);
	}
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath: ":memory:",
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	// v0.6.0 (K6-022): the release default floor (0.6) blocks every
	// single-observation memory (base confidence 0.5). This harness tests
	// v0.5-era push semantics, so it opts out explicitly.
	await hooks.tool?.kevin_config.execute(
		{ action: "set", key: "injection_confidence_floor", value: "0" },
		makeCtx("s-0"),
	);
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

/** chat.message + system.transform — returns the produced system blocks. */
async function transform(sess: string, text: string): Promise<string[]> {
	await hooks["chat.message"]?.(
		{ sessionID: sess },
		{
			message: {} as never,
			parts: [{ type: "text", text }] as never,
		},
	);
	const out = { system: [] as string[] };
	await hooks["experimental.chat.system.transform"]?.(
		{ sessionID: sess, model: { provider: "x", id: "y" } as never },
		out,
	);
	return out.system;
}

async function newSession(sess: string) {
	await hooks.event?.({
		event: { type: "session.created", properties: { info: { id: sess } } },
	} as never);
}

interface PlanPayload {
	query: string;
	tag: string;
	cap: number;
	would_inject: boolean;
	total_tokens: number;
	admitted: { id: string; decision: string }[];
	blocked: { id: string; decision: string; reason: string }[];
}

async function runTrace(
	args: Record<string, unknown>,
	ctx: ToolContext,
): Promise<PlanPayload | { message: string }> {
	const res = (await hooks.tool?.kevin_trace.execute(args as never, ctx)) as {
		output: string;
	};
	return JSON.parse(res.output) as PlanPayload | { message: string };
}

describe("K5-015 — kevin_trace strict dry run (D5-08)", () => {
	it("predicts admission without recording an injection", async () => {
		await newSession("s-tr-1");
		await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-1: fix the import" },
			makeCtx("s-tr-1"),
		);
		const plan = (await runTrace(
			{ query: "tsc-1" },
			makeCtx("s-tr-1"),
		)) as PlanPayload;
		expect(plan.would_inject).toBe(true);
		expect(plan.admitted.length).toBeGreaterThan(0);
		expect(plan.total_tokens).toBeGreaterThan(0);
		// Strict dry run: no ledger rows, no counters, no token metric.
		const status = (await hooks.tool?.kevin_status.execute(
			{},
			makeCtx("s-tr-1"),
		)) as {
			output: string;
		};
		const parsed = JSON.parse(status.output) as {
			metrics: Record<string, number>;
		};
		expect(parsed.metrics.injections_total ?? 0).toBe(0);
		expect(parsed.metrics.tokens_injected_pre_prompt ?? 0).toBe(0);
	});

	it("a trace must not poison the seen-set for a later real injection", async () => {
		await newSession("s-tr-2");
		await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-2: fix the import" },
			makeCtx("s-tr-2"),
		);
		await runTrace({ query: "tsc-2" }, makeCtx("s-tr-2"));
		await runTrace({ query: "tsc-2" }, makeCtx("s-tr-2"));
		// Real transform after two traces: the memory is NOT seen-blocked.
		const blocks = await transform("s-tr-2", "fix tsc-2");
		expect(blocks.join("\n")).toContain("tsc-2");
		const status = (await hooks.tool?.kevin_status.execute(
			{},
			makeCtx("s-tr-2"),
		)) as {
			output: string;
		};
		const parsed = JSON.parse(status.output) as {
			metrics: Record<string, number>;
		};
		expect(parsed.metrics.injections_blocked_seen ?? 0).toBe(0);
		expect(parsed.metrics.injections_total ?? 0).toBe(1);
	});

	it("an ignored memory (D5-07) is filtered out of the plan entirely", async () => {
		await newSession("s-tr-3");
		const saved = (await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-4: fix the import" },
			makeCtx("s-tr-3"),
		)) as { output: string };
		const { id } = JSON.parse(saved.output) as { id: string };
		await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "ignore" },
			makeCtx("s-tr-3"),
		);
		const plan = (await runTrace(
			{ query: "tsc-4", session_id: "s-tr-3" },
			makeCtx("s-tr-3"),
		)) as PlanPayload;
		expect(plan.would_inject).toBe(false);
		expect(plan.admitted).toHaveLength(0);
		expect(plan.blocked).toHaveLength(0);
		expect(plan.total_tokens).toBe(0);
	});

	it("classifies blocked memories with their reason (seen_this_session)", async () => {
		await newSession("s-tr-4");
		await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-6: fix the import" },
			makeCtx("s-tr-4"),
		);
		// Real injection marks the seen-set for this session.
		await transform("s-tr-4", "fix tsc-6");
		// Trace afterwards: the same memory is planned as seen-blocked.
		const plan = (await runTrace(
			{ query: "tsc-6", session_id: "s-tr-4" },
			makeCtx("s-tr-4"),
		)) as PlanPayload;
		expect(plan.would_inject).toBe(false);
		expect(plan.blocked.length).toBeGreaterThan(0);
		expect(plan.blocked[0].reason).toBe("seen_this_session");
		expect(plan.total_tokens).toBe(0);
	});

	it("resolves the query from the session when omitted", async () => {
		await newSession("s-tr-5");
		await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-5: fix the import" },
			makeCtx("s-tr-5"),
		);
		await transform("s-tr-5", "the tsc-5 error is back");
		const plan = (await runTrace(
			{ session_id: "s-tr-5" },
			makeCtx("s-tr-5"),
		)) as PlanPayload;
		expect(plan.query.length).toBeGreaterThan(0);
		expect(plan.query).toContain("tsc");
	});

	it("without any query source returns a graceful message", async () => {
		const res = (await runTrace({}, makeCtx("s-tr-none"))) as {
			message: string;
		};
		expect(res.message).toContain("query");
	});
});

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let migrationsDir: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-compact-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const m of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
	]) {
		copyFileSync(join(process.cwd(), "migrations", m), join(migrationsDir, m));
	}
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

async function seedErrorLesson(): Promise<void> {
	await hooks.tool?.kevin_save.execute(
		{
			type: "error",
			content:
				"When typecheck fails with TS2304: Cannot find name — import or typo.",
			scope: "project",
		},
		makeCtx("seed-sess"),
	);
}

describe("K4-018 — compacting hook fires and counts (plan §5.6)", () => {
	it("injects into output.context when the session has a derived query, and counts tokens", async () => {
		await seedErrorLesson();
		const sess = "compact-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});
		// The real runtime always fires chat.message first for a live
		// session; this registers the per-session query.
		await hooks["chat.message"]?.({ sessionID: sess, messageID: "m1" }, {
			parts: [{ type: "text", text: "fix the TS2304 error on this build" }],
		} as never);
		const output = { context: [] as string[], prompt: undefined };
		await hooks["experimental.session.compacting"]?.(
			{ sessionID: sess },
			output as never,
		);
		expect(output.context.length).toBe(1);
		expect(output.context[0]).toContain("<kevin-memory>");
		expect(output.context[0]).toContain("import or typo");
		// Token accounting is done by the injector via the compacting path.
		const status = await hooks.tool?.kevin_status.execute({}, makeCtx(sess));
		const parsed = JSON.parse((status as { output: string }).output) as {
			metrics: Record<string, number>;
			injections_total: number;
		};
		expect(parsed.metrics.tokens_injected_compacting).toBeGreaterThan(0);
		expect(parsed.injections_total).toBeGreaterThan(0);
	});

	it("still injects when lastUserQuery is null, deriving the query from runtime-provided messages", async () => {
		await seedErrorLesson();
		const sess = "compact-null-sess";
		// No chat.message at all → lastUserQuery (global AND per-session)
		// stays null. The hook must not early-return; it falls back to
		// deriving the query from the messages the runtime provides.
		const output = { context: [] as string[], prompt: undefined };
		await hooks["experimental.session.compacting"]?.(
			{
				sessionID: sess,
				messages: [{ role: "user", content: "fix the TS2304 error" }],
			} as never,
			output as never,
		);
		expect(output.context.length).toBe(1);
		expect(output.context[0]).toContain("<kevin-memory>");
		expect(output.context[0]).toContain("import or typo");
		const status = await hooks.tool?.kevin_status.execute({}, makeCtx(sess));
		const parsed = JSON.parse((status as { output: string }).output) as {
			metrics: Record<string, number>;
		};
		expect(parsed.metrics.tokens_injected_compacting).toBeGreaterThan(0);
	});

	it("no-ops without a query anywhere (sanity: no crash, no injection)", async () => {
		const sess = "compact-empty-sess";
		const output = { context: [] as string[], prompt: undefined };
		await hooks["experimental.session.compacting"]?.(
			{ sessionID: sess },
			output as never,
		);
		expect(output.context.length).toBe(0);
		const status = await hooks.tool?.kevin_status.execute({}, makeCtx(sess));
		const parsed = JSON.parse((status as { output: string }).output) as {
			metrics: Record<string, number>;
		};
		expect(parsed.metrics.tokens_injected_compacting).toBe(0);
	});
});

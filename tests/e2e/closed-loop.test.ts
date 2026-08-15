import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let migrationsDir: string;
let dbPath: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-loop-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "migrations", file),
			join(migrationsDir, file),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
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

afterEach(async () => {
	await hooks.dispose?.();
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

const RG_STDERR =
	"rg: The term 'rg' is not recognized as the name of a cmdlet, function, script file, or operable program.";

async function waitForAsync(
	label: string,
	predicate: () => Promise<boolean>,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`waitForAsync(${label}) timed out after ${timeoutMs}ms`);
}

function parse(result: { output: string }): unknown {
	return JSON.parse(result.output);
}

async function status(): Promise<Record<string, unknown>> {
	const res = await hooks.tool?.kevin_status.execute({}, makeCtx("loop-sess"));
	return parse(res as { output: string }) as Record<string, unknown>;
}

/** A failing bash call whose stderr is the `rg` command-not-found. */
async function failRg(sess: string, callId: string): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{ tool: "bash", sessionID: sess, callID: callId },
		{ args: { command: "rg" } },
	);
	await hooks["tool.execute.after"]?.(
		{
			tool: "bash",
			sessionID: sess,
			callID: callId,
			args: { command: "rg" },
		},
		{
			title: "bash",
			output: "",
			metadata: { success: false, stderr: RG_STDERR, exitCode: 1 },
		},
	);
}

/** A successful bash call that installs rg (the fix). */
async function fixRg(sess: string, callId: string): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{ tool: "bash", sessionID: sess, callID: callId },
		{ args: { command: "npm i -g rg" } },
	);
	await hooks["tool.execute.after"]?.(
		{
			tool: "bash",
			sessionID: sess,
			callID: callId,
			args: { command: "npm i -g rg" },
		},
		{ title: "bash", output: "added rg", metadata: { success: true } },
	);
}

async function idle(sess: string): Promise<void> {
	await hooks.event?.({
		event: { type: "session.idle", properties: { sessionID: sess } } as never,
	});
}

/** chat.message + system.transform → returns the system blocks. */
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

describe("K4-025 — e2e closed-loop cycle (plan §9, exit criterion)", () => {
	it("fail → inject → recur×3 (stale) → no re-inject → fix → promote → re-inject the pattern", async () => {
		const sess = "loop-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		// 1. Failure → Reflector saves a quality-evaluated error
		//    memory (actionable, command-not-found rule, code "rg").
		await failRg(sess, "fail-1");
		let errorId = "";
		await waitForAsync(
			"mem",
			async () => {
				const q = await hooks.tool?.kevin_query.execute(
					{ query: "rg", limit: 5, full: true },
					makeCtx(sess),
				);
				const rows = (q ? parse(q as { output: string }) : []) as Array<{
					id: string;
				}>;
				if (rows.length >= 1) {
					errorId = rows[0].id;
					return true;
				}
				return false;
			},
			2000,
		);
		expect(errorId).not.toBe("");

		// 2. Transform hook fires → gate admits the lesson (snippet,
		//    ledgered pre_prompt). The snippet shows the rescued
		//    errorType `rg`; the full command-not-found hint lives in
		//    the complete memory (progressive disclosure).
		const blocks1 = await transform(sess, "rg command not recognized");
		expect(blocks1.length).toBeGreaterThanOrEqual(1);
		expect(blocks1[0]).toContain("rg");
		expect(blocks1[0]).toContain("[error]");
		const got = await hooks.tool?.kevin_get.execute(
			{ id: errorId },
			makeCtx(sess),
		);
		const fullErr = parse(got as { output: string }) as {
			content: string;
		};
		expect(fullErr.content).toContain(
			"install the tool (e.g. npm i -g rg) or call it by its full path",
		);
		expect(fullErr.content).toContain("(code rg)");
		await waitForAsync("mem", async () => {
			const s = await status();
			return (s.injections_total as number) >= 1;
		});

		// 3. Same failure recurs 3 more times, one settle per idle →
		//    each charges `recurrence_count` on the injected error.
		for (const [i, callId] of ["fail-2", "fail-3", "fail-4"].entries()) {
			await failRg(sess, callId);
			// Reflector stamps tool_calls.error_fingerprint
			// asynchronously; wait before idle so the settle can match.
			await new Promise((r) => setTimeout(r, 100));
			await idle(sess);
			await waitForAsync("mem", async () => {
				const s = await status();
				const rec =
					(s.recurrence_by_origin as Record<string, number>).reflector ?? 0;
				return rec >= i + 1;
			});
		}

		// 4. recurrence_count = 3 → status='stale' (D4-06 demotion);
		//    next transform does NOT inject the error lesson.
		{
			const store = new Store({ path: dbPath });
			try {
				const errRow = store
					.prepare(
						`SELECT status, recurrence_count FROM memories
							  WHERE type = 'error' AND origin = 'reflector'`,
					)
					.get() as { status: string; recurrence_count: number };
				expect(errRow.recurrence_count).toBe(3);
				expect(errRow.status).toBe("stale");
			} finally {
				store.close();
			}
		}
		const blocks2 = await transform(sess, "rg is still failing");
		expect(blocks2.length).toBe(0);

		// 5. Success call `npm i -g rg` (call #8 of the cycle — within
		//    the 10-call window) → CausalChain links → idle promotes a
		//    causal pattern with the captured fix_args.
		await fixRg(sess, "fix-1");
		await idle(sess);
		await waitForAsync("mem", async () => {
			const s = await status();
			return (s.patterns_promoted_new as number) >= 1;
		});
		{
			const store = new Store({ path: dbPath });
			try {
				const patternRow = store
					.prepare(
						`SELECT status, fix_args, content FROM memories
							  WHERE origin = 'causal'`,
					)
					.get() as { status: string; fix_args: string; content: string };
				expect(patternRow.status).toBe("active");
				expect(patternRow.fix_args).toContain("npm i -g rg");
				expect(patternRow.content).toContain("Fixed by:");
			} finally {
				store.close();
			}
		}

		// 6. The pattern (the fix re-admission) IS injectable again.
		const blocks3 = await transform(sess, "rg works now?");
		expect(blocks3.length).toBeGreaterThanOrEqual(1);
		expect(blocks3[0]).toContain("Fixed by:");

		// Metrics: the honest negative evidence — the error was
		// injected once (seen-set) and that one injection was
		// ineffective; its 3 recurrences drove recurrence_count to 3
		// (D4-06 expel), not 3 separate ineffective injections.
		const s = await status();
		expect(s.injections_ineffective).toBe(1);
		expect(s.injections_effective).toBe(0);
		expect(s.precision_rate).toBe(0);
		expect(s.patterns_promoted_new).toBe(1);
		expect((s.recurrence_by_origin as Record<string, number>).reflector).toBe(
			3,
		);
	}, 30_000);
});

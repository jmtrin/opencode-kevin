import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-status-v04-"));
	const migrationsDir = join(tmpRoot, "migrations");
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
		{ sessionID: "s-0", messageID: "m", agent: "test" } as ToolContext,
	);
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

const ctx: ToolContext = {
	sessionID: "status-sess",
	messageID: "m",
	agent: "test",
	directory: "",
	worktree: "",
	abort: new AbortController().signal,
	metadata() {},
	ask() {
		return Promise.resolve();
	},
};

async function waitForAsync(
	predicate: () => Promise<boolean>,
	timeoutMs = 1500,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`waitForAsync timed out after ${timeoutMs}ms`);
}

function parse(result: { output: string }): unknown {
	return JSON.parse(result.output);
}

async function status(): Promise<Record<string, unknown>> {
	const res = await hooks.tool?.kevin_status.execute({}, ctx);
	return parse(res as { output: string }) as Record<string, unknown>;
}

async function failTypecheck(sess: string, callId: string): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{ tool: "bash", sessionID: sess, callID: callId },
		{ args: { command: "npm run typecheck" } },
	);
	await hooks["tool.execute.after"]?.(
		{
			tool: "bash",
			sessionID: sess,
			callID: callId,
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
}

describe("K4-024 — kevin_status precision block", () => {
	it("seeded DB reports the precision fields at zero", async () => {
		const s = await status();
		expect(s.precision_rate).toBe(0);
		expect(s.injections_total).toBe(0);
		expect(s.injections_effective).toBe(0);
		expect(s.injections_ineffective).toBe(0);
		expect(s.patterns_promoted_new).toBe(0);
		expect(s.recurrence_by_origin).toEqual({});
	});

	it("reports per-origin recurrence_count totals after a real fail → inject → recur → idle cycle", async () => {
		const sess = "cycle-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		// 1. Fail → Reflector saves an error memory (origin=reflector).
		await failTypecheck(sess, "fail-1");
		await waitForAsync(async () => {
			const q = await hooks.tool?.kevin_query.execute(
				{ query: "TS2304 missing_v028", limit: 5, full: true },
				ctx,
			);
			const rows = (q ? parse(q as { output: string }) : []) as Array<{
				id: string;
			}>;
			return rows.length >= 1;
		});

		// 2. Fix the error → CausalChain links the fingerprint.
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fix-1" },
			{ args: { command: "npm i -g rg" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fix-1",
				args: { command: "npm i -g rg" },
			},
			{ title: "bash", output: "0 errors", metadata: { success: true } },
		);

		// 3. session.idle → promoteToPattern creates a causal pattern.
		await hooks.event?.({
			event: { type: "session.idle", properties: { sessionID: sess } } as never,
		});
		await waitForAsync(async () => {
			const s = await status();
			return (s.patterns_promoted_new as number) >= 1;
		});

		// 4. Inject: chat.message + system.transform → ledger row.
		await hooks["chat.message"]?.(
			{ sessionID: sess },
			{
				message: {} as never,
				parts: [{ type: "text", text: "TS2304 typecheck error" }] as never,
			},
		);
		const out = { system: [] as string[] };
		await hooks["experimental.chat.system.transform"]?.(
			{ sessionID: sess, model: { provider: "x", id: "y" } as never },
			out,
		);
		expect(out.system.length).toBeGreaterThanOrEqual(1);
		await waitForAsync(async () => {
			const s = await status();
			return (s.injections_total as number) >= 1;
		});

		// 5. Same fingerprint recurs → 2nd idle settles it ineffective.
		await failTypecheck(sess, "fail-2");
		// The Reflector stamps tool_calls.error_fingerprint asynchronously;
		// wait before idle so the settle query can match the recurrence.
		await new Promise((r) => setTimeout(r, 100));
		await hooks.event?.({
			event: { type: "session.idle", properties: { sessionID: sess } } as never,
		});
		await waitForAsync(async () => {
			const s = await status();
			return (s.injections_ineffective as number) >= 1;
		});

		// 6. Precision block: honest numbers + per-origin recurrence totals.
		const s = await status();
		// Both the error (reflector) and the causal pattern are injected →
		// two ledger rows, both settled ineffective by the recurrence.
		expect(s.injections_total).toBe(2);
		expect(s.injections_effective).toBe(0);
		expect(s.injections_ineffective).toBe(2);
		expect(s.precision_rate).toBe(0);
		expect(s.patterns_promoted_new).toBe(1);

		const byOrigin = s.recurrence_by_origin as Record<string, number>;
		// Each settled ineffective injection charges its own memory row.
		expect(byOrigin.reflector).toBe(1);
		expect(byOrigin.causal).toBe(1);

		// Raw legacy keys stay for compatibility.
		expect(typeof s.memories_causal).toBe("number");
	});
});

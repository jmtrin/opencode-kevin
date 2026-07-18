import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let migrationsDir: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-pm-wire-"));
	migrationsDir = join(tmpRoot, "migrations");
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

async function driveToolPair(
	sess: string,
	tool: string,
	callId: string,
): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{ tool, sessionID: sess, callID: callId },
		{ args: {} },
	);
	await hooks["tool.execute.after"]?.(
		{ tool, sessionID: sess, callID: callId, args: {} },
		{ title: tool, output: "ok", metadata: { success: true } },
	);
}

async function queryPatternMemories(
	sess: string,
): Promise<
	Array<{ id: string; type: string; content: string; scope: string }>
> {
	const r = await hooks.tool?.kevin_query.execute(
		{ query: "Pattern:", limit: 50, full: true },
		makeCtx(sess),
	);
	return JSON.parse((r as { output: string }).output) as Array<{
		id: string;
		type: string;
		content: string;
		scope: string;
	}>;
}

describe("PatternMiner wiring (K2-022) — session.idle triggers mine()", () => {
	it("does NOT emit pattern memory when patternminer_enabled = '0' (default)", async () => {
		const sess = "disabled-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});
		// Drive 5 sessions × (read, write) to seed tool_calls.
		for (let i = 0; i < 5; i++) {
			const s = `pre-sess-${i}`;
			await driveToolPair(s, "read", `r-${i}`);
			await driveToolPair(s, "write", `w-${i}`);
		}
		// Trigger idle on the test session (different from the pre-sessions).
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});
		// Even though 5 sessions share the (read, write) 2-gram, default flag
		// is '0' → mine() returns 0 → no pattern memories emitted.
		const rows = await queryPatternMemories(sess);
		expect(rows.length).toBe(0);
	});

	it("emits exactly one pattern memory when patternminer_enabled = '1' AND 5 sessions share the (read,write) 2-gram", async () => {
		// Re-instantiate a separate plugin harness with a patched migration
		// 003 that seeds patternminer_enabled = '1' instead of the default '0'.
		const tmp2 = mkdtempSync(join(tmpdir(), "kevin-pm-wire-on-"));
		const mig2 = join(tmp2, "migrations");
		mkdirSync(mig2, { recursive: true });
		copyFileSync(
			join(process.cwd(), "migrations", "001_initial.sql"),
			join(mig2, "001_initial.sql"),
		);
		const sql003 = readFileSync(
			join(process.cwd(), "migrations", "003_v02_signal.sql"),
			"utf8",
		);
		writeFileSync(
			join(mig2, "003_v02_signal.sql"),
			sql003.replace(
				"('patternminer_enabled',     '0')",
				"('patternminer_enabled',     '1')",
			),
		);
		const hooks2 = await KevinPlugin({ directory: tmp2 } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir: mig2,
			retrospectivesDir: join(tmp2, "retrospectives"),
		});

		try {
			const sess = "enabled-sess";
			await hooks2.event?.({
				event: {
					type: "session.created",
					properties: { info: { id: sess } },
				} as never,
			});
			// Drive 5 sessions × (read, write) to seed tool_calls.
			for (let i = 0; i < 5; i++) {
				const s = `enabled-pre-${i}`;
				await hooks2["tool.execute.before"]?.(
					{ tool: "read", sessionID: s, callID: `r-${i}` },
					{ args: {} },
				);
				await hooks2["tool.execute.after"]?.(
					{
						tool: "read",
						sessionID: s,
						callID: `r-${i}`,
						args: {},
					},
					{ title: "read", output: "ok", metadata: { success: true } },
				);
				await hooks2["tool.execute.before"]?.(
					{ tool: "write", sessionID: s, callID: `w-${i}` },
					{ args: {} },
				);
				await hooks2["tool.execute.after"]?.(
					{
						tool: "write",
						sessionID: s,
						callID: `w-${i}`,
						args: {},
					},
					{ title: "write", output: "ok", metadata: { success: true } },
				);
			}
			// Trigger idle on a separate session.
			await hooks2.event?.({
				event: {
					type: "session.idle",
					properties: { sessionID: sess },
				} as never,
			});
			// Assert exactly 1 pattern memory emitted.
			const r = await hooks2.tool?.kevin_query.execute(
				{ query: "Pattern:", limit: 50, full: true },
				{
					sessionID: sess,
					messageID: "m",
					agent: "test",
					directory: tmp2,
					worktree: tmp2,
					abort: new AbortController().signal,
					metadata() {},
					ask() {
						return Promise.resolve();
					},
				},
			);
			const rows = JSON.parse((r as { output: string }).output) as Array<{
				id: string;
				type: string;
				content: string;
				scope: string;
			}>;
			expect(rows.length).toBe(1);
			expect(rows[0].type).toBe("pattern");
			expect(rows[0].content).toContain('"read"');
			expect(rows[0].content).toContain('"write"');
		} finally {
			rmSync(tmp2, { recursive: true, force: true });
		}
	});

	it("calling session.idle when PatternMiner is disabled does not affect existing memories (sanity)", async () => {
		const sess = "sanity-sess";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});
		// Save a single legacy memory via kevin_save.
		await hooks.tool?.kevin_save.execute(
			{ type: "decision", content: "use vitest", scope: "project" },
			makeCtx(sess),
		);
		// Trigger idle.
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});
		const r = await hooks.tool?.kevin_query.execute(
			{ query: "vitest", limit: 10, full: true },
			makeCtx(sess),
		);
		const rows = JSON.parse((r as { output: string }).output) as Array<{
			id: string;
			type: string;
		}>;
		expect(rows.length).toBeGreaterThanOrEqual(1);
		expect(rows.every((m) => m.type !== "pattern")).toBe(true);
	});
});

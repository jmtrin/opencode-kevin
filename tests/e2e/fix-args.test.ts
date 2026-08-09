import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FIX_ARGS_TRUNCATE,
	enrichAtPromotion,
	extractFixArgs,
} from "../../plugin/LessonFixer.js";
import { KevinPlugin } from "../../plugin/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-fixargs-"));
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
		{ query: text, limit: 50, full: true },
		makeCtx(sess),
	);
	return JSON.parse((r as { output: string }).output) as Array<{
		id: string;
		type: string;
		content: string;
		scope: string;
	}>;
}

describe("LessonFixer — deterministic fix strings (K4-014)", () => {
	it("extractFixArgs builds the deterministic string", () => {
		expect(
			extractFixArgs({ tool: "bash", args_summary: "command: npm i -g rg" }),
		).toBe('bash with args "command: npm i -g rg"');
	});

	it("extractFixArgs truncates long args_summary to ~120 chars", () => {
		const long = "x".repeat(300);
		const out = extractFixArgs({ tool: "bash", args_summary: long });
		expect(out).not.toBeNull();
		expect(out?.length).toBeLessThanOrEqual(FIX_ARGS_TRUNCATE + 30);
		expect(out).toContain("…");
	});

	it("extractFixArgs returns null when there is nothing to say", () => {
		expect(extractFixArgs({ tool: "bash", args_summary: null })).toBeNull();
		expect(extractFixArgs({ tool: "bash", args_summary: "   " })).toBeNull();
	});

	it("enrichAtPromotion default path is deterministic and LLM-free", async () => {
		expect(
			await enrichAtPromotion({
				content: "lesson",
				fixArgs: 'bash with args "command: npm i -g rg"',
			}),
		).toBe('Fixed by: bash with args "command: npm i -g rg"');
		expect(await enrichAtPromotion({ content: "lesson", fixArgs: null })).toBe(
			"",
		);
	});

	it("enrichAtPromotion uses the opt-in hook when it returns a phrase", async () => {
		const hook = async () => 'Fix: install ripgrep first ("npm i -g rg")';
		expect(
			await enrichAtPromotion(
				{ content: "lesson", fixArgs: 'bash with args "x"' },
				hook,
			),
		).toBe('Fix: install ripgrep first ("npm i -g rg")');
	});

	it("enrichAtPromotion falls back to deterministic text when the hook returns null", async () => {
		const hook = async () => null;
		expect(
			await enrichAtPromotion(
				{ content: "lesson", fixArgs: 'bash with args "npm i -g rg"' },
				hook,
			),
		).toBe('Fixed by: bash with args "npm i -g rg"');
	});
});

describe("K4-014 — causal chain captures fix_args end-to-end", () => {
	it("linked success lands in the pattern as 'Fixed by:' with its args", async () => {
		const sess = "fix-args-e2e";
		await hooks.event?.({
			event: {
				type: "session.created",
				properties: { info: { id: sess } },
			} as never,
		});

		const errOut = "src/x.ts: error TS2304: Cannot find name 'rg'.";

		// 1. Failing call — the reflector saves an error memory for this
		// fingerprint.
		await hooks["tool.execute.before"]?.(
			{ tool: "bash", sessionID: sess, callID: "fail-1" },
			{ args: { command: "npx tsc" } },
		);
		await hooks["tool.execute.after"]?.(
			{
				tool: "bash",
				sessionID: sess,
				callID: "fail-1",
				args: { command: "npx tsc" },
			},
			{ title: "bash", output: errOut, metadata: {} },
		);
		await waitForAsync(async () => {
			const m = await queryMemories(sess, "TS2304");
			return m.some((x) => x.content.includes("TS2304"));
		});

		// 2. Success with distinctive args, within MAX_LINK_DISTANCE calls.
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
			{ title: "bash", output: "added 1 package", metadata: {} },
		);

		// 3. session.idle — CausalChain links (fix_args captured) then
		// promotes the error memory to a pattern.
		await hooks.event?.({
			event: {
				type: "session.idle",
				properties: { sessionID: sess },
			} as never,
		});
		await new Promise((r) => setTimeout(r, 100));

		const mems = await queryMemories(sess, "TS2304");
		const pat = mems.find(
			(m) => m.type === "pattern" && m.content.includes("TS2304"),
		);
		expect(pat).toBeDefined();
		expect(pat?.content).toContain("Fixed by:");
		expect(pat?.content).toContain("bash with args");
		expect(pat?.content).toContain("npm i -g rg");
	});
});

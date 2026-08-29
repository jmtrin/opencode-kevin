import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-config-"));
	const migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
	]) {
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
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

async function runConfig(
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_config.execute(
		args as never,
		makeCtx("config-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
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

async function reflectUnknownError(sess: string): Promise<void> {
	await hooks["tool.execute.before"]?.(
		{ tool: "bash", sessionID: sess, callID: "fail-g" },
		{ args: { command: "npm run build" } },
	);
	await hooks["tool.execute.after"]?.(
		{
			tool: "bash",
			sessionID: sess,
			callID: "fail-g",
			args: { command: "npm run build" },
		},
		{
			title: "bash",
			output: "",
			metadata: {
				success: false,
				stderr: "something went horribly wrong during the operation",
				exitCode: 1,
			},
		},
	);
	await waitForAsync(async () => {
		const mems = await queryMemories(sess, "horribly wrong");
		return mems.length > 0;
	});
}

async function chatWith(sess: string, text: string): Promise<void> {
	await hooks["chat.message"]?.(
		{ sessionID: sess },
		{
			message: {} as never,
			parts: [{ type: "text", text }] as never,
		},
	);
}

async function transform(sess: string): Promise<string[]> {
	const output = { system: [] as string[] };
	await hooks["experimental.chat.system.transform"]?.(
		{ sessionID: sess, model: { provider: "x", id: "y" } as never },
		output,
	);
	return output.system;
}

describe("K4-021 — kevin_config tool", () => {
	it("list returns the seeded settings", async () => {
		const out = await runConfig({ action: "list" });
		// Seeded by migrations 004/005.
		expect(out.quality_gate_enabled).toBe("1");
		expect(out.lesson_snippet_injection).toBe("1");
		expect(out.llm_reflection_enabled).toBe("0");
	});

	it("set persists a known key and is readable by list", async () => {
		const out = await runConfig({
			action: "set",
			key: "llm_reflection_enabled",
			value: "1",
		});
		expect(out.ok).toBe(true);
		expect(out.value).toBe("1");

		const listed = await runConfig({ action: "list" });
		expect(listed.llm_reflection_enabled).toBe("1");
	});

	it("set without value defaults to '1'", async () => {
		const out = await runConfig({
			action: "set",
			key: "patternminer_enabled",
		});
		expect(out.ok).toBe(true);
		expect(out.value).toBe("1");
		const listed = await runConfig({ action: "list" });
		expect(listed.patternminer_enabled).toBe("1");
	});

	it("set rejects unknown keys by default (strict)", async () => {
		const out = await runConfig({
			action: "set",
			key: "not_a_known_key",
			value: "1",
		});
		expect(out.error).toBe("unknown_key");
		expect(out.known_keys).toBeDefined();
	});

	it("set accepts unknown keys with strict:false", async () => {
		const out = await runConfig({
			action: "set",
			key: "custom_key",
			value: "x",
			strict: false,
		});
		expect(out.ok).toBe(true);
		expect(out.key).toBe("custom_key");
		const listed = await runConfig({ action: "list" });
		expect(listed.custom_key).toBe("x");
	});

	it("set quality_gate_enabled is honored by the injection gate", async () => {
		// 1. Reflect a failure with no resolvable code → weak, non-actionable lesson.
		await reflectUnknownError("gate-sess");
		// 2. Gate is ON by default (seeded '1') → weak lesson is blocked.
		await chatWith("gate-sess-2", "the operation went horribly wrong again");
		expect(await transform("gate-sess-2")).toEqual([]);

		// 3. Turn the gate OFF via kevin_config…
		const out = await runConfig({
			action: "set",
			key: "quality_gate_enabled",
			value: "0",
		});
		expect(out.ok).toBe(true);

		// 4. …and the same weak lesson is now admitted (fresh session),
		// rendered with the K4-023 `(low confidence)` marker.
		await chatWith("gate-sess-3", "the operation went horribly wrong again");
		const injected = await transform("gate-sess-3");
		expect(injected.length).toBeGreaterThanOrEqual(1);
		expect(injected[0]).toContain("<kevin-context>");
		expect(injected[0]).toContain("(low confidence)");
	});
});

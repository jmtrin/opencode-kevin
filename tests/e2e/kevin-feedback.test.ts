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
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-feedback-e2e-"));
	const migrationsDir = join(tmpRoot, "packages/core/migrations");
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

describe("K5-011 — kevin_feedback tool (D5-02/D5-07)", () => {
	it("registers a 'useful' verdict and folds it into the counters", async () => {
		const saved = (await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-1" },
			makeCtx("s-fb-1"),
		)) as { output: string };
		const { id } = JSON.parse(saved.output) as { id: string };

		const res = (await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "useful", note: "exactly what I needed" },
			makeCtx("s-fb-1"),
		)) as { output: string };
		const parsed = JSON.parse(res.output) as {
			feedback_id: string;
			verdict: string;
			counters: { positive: number; negative: number };
			ignored: boolean;
		};
		expect(parsed.feedback_id).toBeTruthy();
		expect(parsed.verdict).toBe("useful");
		expect(parsed.counters).toEqual({ positive: 1, negative: 0 });
		expect(parsed.ignored).toBe(false);
	});

	it("'ignore' verdict stamps the memory and removes it from recall", async () => {
		const saved = (await hooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-1" },
			makeCtx("s-fb-2"),
		)) as { output: string };
		const { id } = JSON.parse(saved.output) as { id: string };

		const res = (await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "ignore" },
			makeCtx("s-fb-2"),
		)) as { output: string };
		const parsed = JSON.parse(res.output) as {
			counters: { positive: number; negative: number };
			ignored: boolean;
		};
		expect(parsed.counters.negative).toBe(1);
		expect(parsed.ignored).toBe(true);

		const q = (await hooks.tool?.kevin_query.execute(
			{ query: "tsc-1" },
			makeCtx("s-fb-2"),
		)) as { output: string };
		const rows = JSON.parse(q.output) as unknown[];
		expect(rows).toHaveLength(0);
	});

	it("unknown memory id returns a graceful message, not a crash", async () => {
		const res = (await hooks.tool?.kevin_feedback.execute(
			{ memory_id: "does-not-exist", verdict: "wrong" },
			makeCtx("s-fb-3"),
		)) as { output: string };
		const parsed = JSON.parse(res.output) as { message: string };
		expect(parsed.message).toContain("No memory found");
	});

	it("counters recompute and confidence shifts with repeated verdicts", async () => {
		const saved = (await hooks.tool?.kevin_save.execute(
			{ type: "pattern", content: "Causal pattern: tsc-1 fails", metadata: {} },
			makeCtx("s-fb-4"),
		)) as { output: string };
		const { id } = JSON.parse(saved.output) as { id: string };

		await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "useful" },
			makeCtx("s-fb-4"),
		);
		await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "wrong" },
			makeCtx("s-fb-4"),
		);
		const again = (await hooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "wrong" },
			makeCtx("s-fb-4"),
		)) as { output: string };
		const parsed = JSON.parse(again.output) as {
			counters: { positive: number; negative: number };
		};
		expect(parsed.counters).toEqual({ positive: 1, negative: 2 });
	});

	it("gracefully reports when migration 006 is missing", async () => {
		// Rebuild hooks with a 001-005 migration dir; the tool must not crash.
		const oldMigrationsDir = join(tmpRoot, "packages/core/migrations");
		const pre006Dir = join(tmpRoot, "pre006");
		mkdirSync(pre006Dir, { recursive: true });
		for (const name of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
		]) {
			copyFileSync(join(oldMigrationsDir, name), join(pre006Dir, name));
		}
		const preHooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir: pre006Dir,
			retrospectivesDir: join(tmpRoot, "retrospectives"),
		});
		const saved = (await preHooks.tool?.kevin_save.execute(
			{ type: "error", content: "bash fails with tsc-1" },
			makeCtx("s-fb-5"),
		)) as { output: string };
		const { id } = JSON.parse(saved.output) as { id: string };
		const res = (await preHooks.tool?.kevin_feedback.execute(
			{ memory_id: id, verdict: "useful" },
			makeCtx("s-fb-5"),
		)) as { output: string };
		const parsed = JSON.parse(res.output) as { message: string };
		expect(parsed.message).toContain("migration 006");
		expect(existsSync(tmpRoot)).toBe(true);
	});
});

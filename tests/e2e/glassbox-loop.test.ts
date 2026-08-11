import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

/**
 * K5-023 — closed-loop e2e for the v0.5.0 glassbox semantics (plan §F6).
 *
 * Everything is driven through public entry points — hooks and tools. No
 * `kevin_save`, no direct `INSERT INTO memories` (plan §4 traps 5/6: a test
 * that hand-seeds a row proves nothing about whether production ever writes
 * that value).
 *
 * Scenarios:
 *   A — inconclusive: inject then idle with nothing else → outcome
 *       `inconclusive` and `precision_rate` unchanged (D5-01: absence of
 *       recurrence is not evidence).
 *   B — effective: fail → lesson → new session → fail again (pre-injection,
 *       so the fix can LINK) → inject → fix succeeds within 10 calls →
 *       idle → `effective`, precision_rate = 1 (D5-01: effective requires
 *       an OBSERVED linked fix).
 *   C — ineffective: inject → the same error recurs 3× → idle each time →
 *       `ineffective`, recurrence_count 1 → 2 → 3, then `stale`.
 *   D — feedback: two `wrong` verdicts stale the memory; `evidence_count`
 *       and `recurrence_count` untouched (D5-05).
 *   E — archival: a stale memory older than `archive_after_days` becomes
 *       `archived` on idle and stops being retrieved (K5-012).
 *   F — trace purity: `kevin_trace` twice is byte-identical and leaves
 *       `kevin_injections`, `kevin_metrics` and every `relevance_score`
 *       unchanged (D5-08).
 */

const MIGRATIONS = [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
	"006_v05_glassbox.sql",
];

let tmpRoot: string;
let migrationsDir: string;
let dbPath: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>>;
let store: Store;

beforeEach(async () => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-glassbox-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	for (const name of MIGRATIONS) {
		copyFileSync(
			join(process.cwd(), "migrations", name),
			join(migrationsDir, name),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
	store = new Store({ path: dbPath });
});

afterEach(async () => {
	store.close();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
		await sleep(5);
	}
	throw new Error(`waitForAsync(${label}) timed out after ${timeoutMs}ms`);
}

function parse(result: { output: string }): unknown {
	return JSON.parse(result.output);
}

async function status(sess: string): Promise<Record<string, unknown>> {
	const res = await hooks.tool?.kevin_status.execute({}, makeCtx(sess));
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

async function createSession(sess: string): Promise<void> {
	await hooks.event?.({
		event: {
			type: "session.created",
			properties: { info: { id: sess } },
		} as never,
	});
}

async function idle(sess: string): Promise<void> {
	await hooks.event?.({
		event: { type: "session.idle", properties: { sessionID: sess } } as never,
	});
}

/** chat.message + system.transform → returns the injected system blocks. */
async function transform(sess: string, text: string): Promise<string[]> {
	await hooks["chat.message"]?.(
		{ sessionID: sess },
		{ message: {} as never, parts: [{ type: "text", text }] as never },
	);
	const out = { system: [] as string[] };
	await hooks["experimental.chat.system.transform"]?.(
		{ sessionID: sess, model: { provider: "x", id: "y" } as never },
		out,
	);
	return out.system;
}

/** A reflector error memory appears for the `rg` fingerprint. */
async function waitForLesson(sess: string): Promise<string> {
	let id = "";
	await waitForAsync("lesson", async () => {
		const q = await hooks.tool?.kevin_query.execute(
			{ query: "rg", limit: 5, full: true },
			makeCtx(sess),
		);
		const rows = (q ? parse(q as { output: string }) : []) as Array<{
			id: string;
		}>;
		if (rows.length >= 1) {
			id = rows[0].id;
			return true;
		}
		return false;
	});
	return id;
}

async function getMemory(
	sess: string,
	id: string,
): Promise<Record<string, unknown>> {
	const res = await hooks.tool?.kevin_get.execute({ id }, makeCtx(sess));
	return parse(res as { output: string }) as Record<string, unknown>;
}

function ledgerRow(memoryId: string): { outcome: string } | undefined {
	return store
		.prepare("SELECT outcome FROM kevin_injections WHERE memory_id = ?")
		.get(memoryId) as { outcome: string } | undefined;
}

describe("K5-023 — closed-loop e2e for v0.5 semantics (plan §F6)", () => {
	it("A — inconclusive: idle with nothing else does not move precision_rate", async () => {
		const s1 = "gb-a-1";
		const s2 = "gb-a-2";
		await createSession(s1);
		await failRg(s1, "a-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");
		await idle(s1);

		const before = await status(s2);
		expect(before.precision_rate).toBe(0);

		await createSession(s2);
		const blocks = await transform(s2, "rg command not recognized");
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		await waitForAsync("injection", async () => {
			const s = await status(s2);
			return (s.injections_total as number) >= 1;
		});

		// The session goes idle with nothing else happening: no recurrence,
		// no linked fix → the injection lands in the NEW majority bucket.
		await idle(s2);

		const after = await status(s2);
		expect(after.injections_total).toBe(1);
		expect(after.injections_inconclusive).toBe(1);
		expect(after.injections_effective).toBe(0);
		expect(after.injections_ineffective).toBe(0);
		// D5-01/D5-02 — the denominator (effective + ineffective) did not
		// move, so precision_rate is exactly what it was before the idle.
		expect(after.precision_rate).toBe(before.precision_rate);
		expect(after.precision_rate).toBe(0);
	}, 15_000);

	it("B — effective: a linked fix after injection settles as effective", async () => {
		const s1 = "gb-b-1";
		const s2 = "gb-b-2";
		await createSession(s1);
		await failRg(s1, "b-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");
		await idle(s1);

		// New session. The error recurs BEFORE the injection — the failing
		// call is what CausalChain.onSuccess links the fix to (fixes only
		// link within 10 calls of a failure). A post-injection recurrence
		// would settle as `ineffective` instead; the pre-injection one is
		// bounded by `ts >= injected_at` and cannot.
		await createSession(s2);
		await failRg(s2, "b-fail-2");
		// The failure's `error_fingerprint` is stamped asynchronously by
		// the Reflector; and `ts` must fall strictly before `injected_at`
		// (both are `datetime('now')`, 1-second resolution), so wait out
		// the second before injecting.
		await sleep(1100);
		const blocks = await transform(s2, "rg command not recognized");
		expect(blocks.length).toBeGreaterThanOrEqual(1);

		// The fix call lands right after the failure (rowid distance 1 ≤
		// MAX_LINK_DISTANCE 10) and stamps fix_for_fingerprint.
		await fixRg(s2, "b-fix-1");
		await waitForAsync("fix-link", async () => {
			const row = store
				.prepare("SELECT fix_for_fingerprint FROM tool_calls WHERE id = ?")
				.get("b-fix-1") as { fix_for_fingerprint: string | null };
			return row?.fix_for_fingerprint != null;
		});

		await idle(s2);

		const outcome = ledgerRow(lessonId);
		expect(outcome?.outcome).toBe("effective");
		const s = await status(s2);
		expect(s.injections_total).toBe(1);
		expect(s.injections_effective).toBe(1);
		expect(s.injections_ineffective).toBe(0);
		expect(s.precision_rate).toBe(1);
	}, 15_000);

	it("C — ineffective: recurrence charges recurrence_count up to stale", async () => {
		const s1 = "gb-c-1";
		const s2 = "gb-c-2";
		await createSession(s1);
		await failRg(s1, "c-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");
		await idle(s1);

		await createSession(s2);
		const blocks = await transform(s2, "rg command not recognized");
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		await waitForAsync("injection", async () => {
			const s = await status(s2);
			return (s.injections_total as number) >= 1;
		});

		// Three post-injection recurrences, one idle each. The Reflector
		// stamps error_fingerprint asynchronously — wait before each idle
		// so the settle can match (same pattern as the v0.4.0 loop test).
		for (const n of [1, 2, 3]) {
			await failRg(s2, `c-fail-${n + 1}`);
			await sleep(100);
			await idle(s2);
			const mem = await getMemory(s2, lessonId);
			expect(mem.recurrence_count).toBe(n);
		}

		// D4-06: recurrence_count >= 3 expels the lesson.
		const mem = await getMemory(s2, lessonId);
		expect(mem.status).toBe("stale");
		const s = await status(s2);
		expect(s.injections_ineffective).toBe(1);
		expect(s.injections_effective).toBe(0);
		expect(s.injections_inconclusive).toBe(0);
	}, 15_000);

	it("D — feedback: two 'wrong' verdicts stale the memory without touching evidence/recurrence counts", async () => {
		const s1 = "gb-d-1";
		await createSession(s1);
		await failRg(s1, "d-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");

		const before = await getMemory(s1, lessonId);
		expect(before.evidence_count).toBe(0);
		expect(before.recurrence_count).toBe(0);

		// D5-06: "wrong" is an opinion and needs a second opinion.
		for (const verdict of ["wrong", "wrong"] as const) {
			const res = await hooks.tool?.kevin_feedback.execute(
				{ memory_id: lessonId, verdict },
				makeCtx(s1),
			);
			const parsed = parse(res as { output: string }) as {
				counters: { positive: number; negative: number };
			};
			expect(parsed.counters.negative).toBeGreaterThan(0);
		}
		const after = await getMemory(s1, lessonId);
		expect(after.status).toBe("stale");
		// D5-05: opinion never writes the evidence/recurrence columns —
		// they feed computeConfidence, promoteToPattern and kevin_why.
		expect(after.evidence_count).toBe(before.evidence_count);
		expect(after.recurrence_count).toBe(before.recurrence_count);
	}, 15_000);

	it("E — archival: a stale memory past archive_after_days is archived on idle and stops being retrieved", async () => {
		const s1 = "gb-e-1";
		await createSession(s1);
		await failRg(s1, "e-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");

		// Make it stale through the public feedback channel.
		for (let i = 0; i < 2; i++) {
			await hooks.tool?.kevin_feedback.execute(
				{ memory_id: lessonId, verdict: "wrong" },
				makeCtx(s1),
			);
		}
		expect((await getMemory(s1, lessonId)).status).toBe("stale");

		// Shrink the retirement window below one day and let the memory
		// age past the cutoff. Both `updated_at` and the Archiver's cutoff
		// are seconds-resolution strings, so two full seconds of margin
		// guarantee a strict `<` regardless of the second boundary.
		const cfg = await hooks.tool?.kevin_config.execute(
			{
				action: "set",
				key: "archive_after_days",
				value: "0.00001",
			},
			makeCtx(s1),
		);
		expect(parse(cfg as { output: string })).toMatchObject({ ok: true });
		await sleep(2200);

		await idle(s1);

		const mem = await getMemory(s1, lessonId);
		expect(mem.status).toBe("archived");
		const q = await hooks.tool?.kevin_query.execute(
			{ query: "rg", limit: 5 },
			makeCtx(s1),
		);
		const rows = parse(q as { output: string }) as unknown[];
		expect(rows).toHaveLength(0);
	}, 15_000);

	it("F — trace purity: kevin_trace is a strict dry run", async () => {
		const s1 = "gb-f-1";
		await createSession(s1);
		await failRg(s1, "f-fail-1");
		const lessonId = await waitForLesson(s1);
		expect(lessonId).not.toBe("");

		const snapshot = () => ({
			injections: (
				store.prepare("SELECT COUNT(*) AS n FROM kevin_injections").get() as {
					n: number;
				}
			).n,
			metrics: store
				.prepare("SELECT key, value FROM kevin_metrics ORDER BY key")
				.all() as unknown[],
			relevance: store
				.prepare("SELECT id, relevance_score FROM memories ORDER BY id")
				.all() as unknown[],
		});
		const before = snapshot();

		// D5-08 — a debug tool that inserted a ledger row would inflate
		// injections_total and destroy the very metric this release exists
		// to fix. Run it twice: byte-identical, and nothing moved.
		const first = await hooks.tool?.kevin_trace.execute(
			{ query: "rg" },
			makeCtx(s1),
		);
		const second = await hooks.tool?.kevin_trace.execute(
			{ query: "rg" },
			makeCtx(s1),
		);
		const firstOut = (first as { output: string }).output;
		const secondOut = (second as { output: string }).output;
		expect(firstOut).toBe(secondOut);

		expect(snapshot()).toEqual(before);
	}, 15_000);
});

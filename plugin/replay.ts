import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Archiver } from "./Archiver.js";
import { CausalChain } from "./CausalChain.js";
import { ContextInjector } from "./ContextInjector.js";
import { InjectionLedger } from "./InjectionLedger.js";
import { MemoryService } from "./MemoryService.js";
import { Migrate } from "./Migrate.js";
import { Reflector } from "./Reflector.js";
import { Store } from "./Store.js";
import { ToolCallObserver } from "./ToolCallObserver.js";
import { Metrics } from "./metrics.js";
import type { ReplayEvent, ReplayTranscript } from "./replay-types.js";

/**
 * v0.5.0 (K5-019 / plan §5.8, D5-12) — replay harness.
 *
 * Hermetic, deterministic driver: runs a recorded transcript through the
 * plugin's components against an in-memory database with a frozen clock,
 * then reports the outcome distribution. This is an artifact, not a
 * release gate.
 *
 * The components are instantiated directly — NOT through `KevinPlugin`,
 * which resolves a home-directory database path and registers tools.
 * `Date.now()` must never be called in this path; every clock need is
 * satisfied by the event's `at` timestamp (retrieval is frozen by the
 * `deterministic_retrieval` setting; the Archiver clock is injected).
 */

export interface ReplayResult {
	readonly transcript: string;
	readonly memoriesCreated: number;
	readonly injections: {
		total: number;
		effective: number;
		ineffective: number;
		inconclusive: number;
		unmeasured: number;
	};
	readonly precisionRate: number;
	readonly coverageRate: number;
	readonly tokensInjected: { prePrompt: number; compacting: number };
	readonly blocked: Record<string, number>;
}

const MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"migrations",
);

export async function replay(
	transcript: ReplayTranscript,
	opts?: { dbPath?: string },
): Promise<ReplayResult> {
	const store = new Store({ path: opts?.dbPath ?? ":memory:" });
	await new Migrate(store, MIGRATIONS_DIR).run();

	// Freeze retrieval BEFORE any query happens (K5-008): deterministic
	// mode uses the DATE_NOW sentinel, ignores recency and never bumps.
	store
		.prepare(
			"INSERT OR IGNORE INTO kevin_settings (key, value) VALUES ('deterministic_retrieval', '1')",
		)
		.run();
	store
		.prepare(
			"UPDATE kevin_settings SET value = '1' WHERE key = 'deterministic_retrieval'",
		)
		.run();

	const metrics = new Metrics(store);
	const memoryService = new MemoryService(store, metrics);
	const observer = new ToolCallObserver(store, metrics);
	// v0.3.0 fix (mirrors index.ts) — the Reflector stamps
	// tool_calls.error_fingerprint with the stderr-based fingerprint the
	// error memory uses; without it the recurrence queries in settle and
	// the feedback loop never match (tool_calls.fingerprint is keyed on
	// `${tool}|${args}|${success}`, memories on a hash of stderr/stdout).
	const linkErrorStmt = store.prepare(
		"UPDATE tool_calls SET error_fingerprint = ? WHERE id = ?",
	);
	const reflector = new Reflector(
		memoryService,
		{
			throttleMs: 0,
			onLinkError: (callID, fp) => {
				linkErrorStmt.run(fp, callID);
			},
		},
		metrics,
	);
	const ledger = new InjectionLedger(store, metrics);
	const injector = new ContextInjector(memoryService, metrics, ledger);
	const causalChain = new CausalChain(store, memoryService, metrics);

	// The Archiver reads the clock through this accessor, which is updated
	// to the current event's `at` before each event is processed.
	let currentAt = new Date(transcript.events[0]?.at ?? Date.now());
	const archiver = new Archiver(store, memoryService, metrics, () => currentAt);

	const lastUserQueryBySession = new Map<string, string>();
	const callCache = new Map<
		string,
		{ tool: string; args: Record<string, unknown> }
	>();

	function resolveQuery(sessionId: string): string {
		return lastUserQueryBySession.get(sessionId) ?? "";
	}

	for (const event of transcript.events) {
		currentAt = new Date(event.at);
		await handleEvent(event);
	}

	metrics.flush();

	const outcomeRows = store
		.prepare(
			"SELECT outcome, COUNT(*) AS n FROM kevin_injections GROUP BY outcome",
		)
		.all() as { outcome: string; n: number }[];
	const counts: Record<string, number> = {
		unmeasured: 0,
		effective: 0,
		ineffective: 0,
		inconclusive: 0,
	};
	for (const r of outcomeRows) {
		counts[r.outcome] = r.n;
	}
	const total = outcomeRows.reduce((acc, r) => acc + r.n, 0);

	const tokenValue = (key: string): number => {
		const row = store
			.prepare("SELECT value FROM kevin_metrics WHERE key = ?")
			.get(key) as { value: number } | undefined;
		return row?.value ?? 0;
	};

	return {
		transcript: transcript.name,
		memoriesCreated: totalMemories(store),
		injections: {
			total,
			effective: counts.effective,
			ineffective: counts.ineffective,
			inconclusive: counts.inconclusive,
			unmeasured: counts.unmeasured,
		},
		precisionRate: metrics.precisionRate(),
		coverageRate: metrics.coverageRate(),
		tokensInjected: {
			prePrompt: tokenValue("tokens_injected_pre_prompt"),
			compacting: tokenValue("tokens_injected_compacting"),
		},
		blocked: metrics.blockedSnapshot(),
	};

	async function handleEvent(event: ReplayEvent): Promise<void> {
		switch (event.kind) {
			case "session.created":
				// Mirror of the live wiring (index.ts): a fresh session must
				// not inherit the previous session's injection seen-set
				// (plan §5.1 rule 3). Without this, a multi-session
				// transcript would block every memory in session 2 with
				// `seen_this_session` while the live plugin would admit it.
				injector.onSessionCreated(event.sessionId);
				return;
			case "chat.message": {
				const derived = injector.deriveQuery([
					{ role: "user", content: event.text },
				]);
				if (derived.length > 0) {
					lastUserQueryBySession.set(event.sessionId, derived);
				}
				return;
			}
			case "tool.before": {
				callCache.set(event.callId, {
					tool: event.tool,
					args: event.args,
				});
				observer.onBefore(
					{
						tool: event.tool,
						args: event.args,
						sessionId: event.sessionId,
						callID: event.callId,
						projectId: null,
					},
					{},
				);
				return;
			}
			case "tool.after": {
				const cached = callCache.get(event.callId);
				const tool = cached?.tool ?? "unknown";
				const args = cached?.args ?? {};
				const stderr = event.stderr ?? "";
				const stdout = event.stdout ?? "";
				observer.onAfter(
					{
						tool,
						args,
						sessionId: event.sessionId,
						callID: event.callId,
						projectId: null,
					},
					{ success: event.success, stdout, stderr, exitCode: event.exitCode },
				);
				if (!event.success) {
					await reflector.invoke({
						toolName: tool,
						argsSummary: observer.summarizeArgs(args),
						stderr,
						stdout,
						exitCode: event.exitCode,
						errorType: observer.inferErrorType(stderr, stdout, event.exitCode),
						sessionId: event.sessionId,
						callID: event.callId,
						projectId: null,
					});
				} else {
					causalChain.onSuccess(tool, args, null, event.sessionId);
				}
				return;
			}
			case "system.transform": {
				const query = resolveQuery(event.sessionId);
				if (!query) return;
				const output = { system: [] as string[] };
				injector.onSystemTransform(
					{
						sessionID: event.sessionId,
						messages: [{ role: "user", content: query }],
					},
					output,
				);
				return;
			}
			case "compacting": {
				const query = resolveQuery(event.sessionId);
				if (!query) return;
				const output = { context: [] as string[] };
				injector.onCompacting(
					{
						sessionID: event.sessionId,
						messages: [{ role: "user", content: query }],
					},
					output,
				);
				return;
			}
			case "session.idle": {
				ledger.settle(event.sessionId);
				archiver.run();
				metrics.flush();
				return;
			}
		}
	}
}

function totalMemories(store: Store): number {
	const row = store.prepare("SELECT COUNT(*) AS n FROM memories").get() as {
		n: number;
	};
	return row.n ?? 0;
}

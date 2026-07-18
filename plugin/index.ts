import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { ContextInjector } from "./ContextInjector.js";
import {
	type Memory,
	MemoryService,
	type SlimMemory,
} from "./MemoryService.js";
import { Migrate } from "./Migrate.js";
import { PatternMiner } from "./PatternMiner.js";
import { ERROR_LINE_RE, Reflector, STRONG_ERROR_RE } from "./Reflector.js";
import { Retrospective } from "./Retrospective.js";
import { Store } from "./Store.js";
import { ToolCallObserver } from "./ToolCallObserver.js";
import { formatMemories } from "./memory-format.js";
import { Metrics, estimateTokens } from "./metrics.js";

export interface KevinPluginOptions {
	dbPath?: string;
	migrationsDir?: string;
	retrospectivesDir?: string;
	throttleMs?: number;
}

const SYSTEM_TRANSFORM_TOKENS = 1500;
const COMPACTING_TOKENS = 2000;

function resolveMigrationsDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, "..", "migrations");
}

export const KevinPlugin: Plugin = async (input, options) => {
	const opts = (options ?? {}) as KevinPluginOptions;
	const dbPath = opts.dbPath ?? join(homedir(), ".opencode-kevin", "kevin.db");
	if (dbPath !== ":memory:") {
		const dbDir = dirname(dbPath);
		if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
	}
	const store = new Store({ path: dbPath });
	const migrationsDir = opts.migrationsDir ?? resolveMigrationsDir();
	await new Migrate(store, migrationsDir).run();
	const metrics = new Metrics(store);
	const memoryService = new MemoryService(store, metrics);
	const observer = new ToolCallObserver(store, metrics);
	const reflector = new Reflector(
		memoryService,
		{ throttleMs: opts.throttleMs },
		metrics,
	);
	const injector = new ContextInjector(memoryService, metrics);
	const retrospective = new Retrospective(
		store,
		memoryService,
		{
			dir: opts.retrospectivesDir,
		},
		metrics,
	);
	const patternMiner = new PatternMiner(store, memoryService, metrics);
	let currentSessionId: string | null = null;
	let lastUserQuery: string | null = null;
	const pending = new Set<Promise<unknown>>();
	const toolCache = new Map<string, { tool: string; argsSummary: string }>();
	const TOOL_CACHE_MAX = 500;
	function fireAndForget(p: Promise<unknown>): void {
		const tracked = p.catch(() => {});
		pending.add(tracked);
		tracked.finally(() => {
			pending.delete(tracked);
		});
	}
	function rememberToolCall(
		callID: string,
		tool: string,
		args: Record<string, unknown> | undefined,
	): void {
		if (toolCache.size >= TOOL_CACHE_MAX) {
			const oldest = toolCache.keys().next().value;
			if (oldest) toolCache.delete(oldest);
		}
		toolCache.set(callID, {
			tool,
			argsSummary: observer.summarizeArgs(args ?? {}),
		});
	}
	function pickExitCode(meta: Record<string, unknown>): number | undefined {
		for (const k of ["exitCode", "exit_code", "exit"]) {
			const v = meta[k];
			if (typeof v === "number") return v;
		}
		return undefined;
	}

	function handleToolFailed(
		callID: string,
		sessionID: string,
		errorMessage: string,
	): void {
		const cached = toolCache.get(callID);
		toolCache.delete(callID);
		if (!cached) return;
		const errorType = observer.inferErrorType(errorMessage, "", undefined);
		fireAndForget(
			reflector.invoke({
				toolName: cached.tool,
				argsSummary: cached.argsSummary,
				stderr: errorMessage,
				stdout: "",
				exitCode: undefined,
				errorType,
				sessionId: sessionID,
			}),
		);
	}

	return {
		tool: {
			kevin_save: tool({
				description:
					"Guarda una memoria en el conocimiento persistente de Kevin (error, pattern, decision o context).",
				args: {
					type: tool.schema.enum(["error", "pattern", "decision", "context"]),
					content: tool.schema.string().min(1),
					scope: tool.schema.enum(["project", "session"]).default("project"),
					metadata: tool.schema
						.record(tool.schema.string(), tool.schema.unknown())
						.optional(),
					relevanceScore: tool.schema.number().min(0).max(1).optional(),
					sourceTool: tool.schema.string().optional(),
					sourceSession: tool.schema.string().optional(),
				},
				async execute(args) {
					const id = memoryService.save({
						type: args.type,
						content: args.content,
						scope: args.scope,
						metadata: args.metadata,
						relevanceScore: args.relevanceScore,
						sourceTool: args.sourceTool,
						sourceSession: args.sourceSession,
					});
					return { title: "Memoria guardada", output: JSON.stringify({ id }) };
				},
			}),
			kevin_query: tool({
				description:
					"Busca memorias por texto (FTS5). Retorna JSON con [{id,type,scope,score,snippet}] (slim, v0.2.0). Con full=true retorna [{id,type,content,scope,...}] (legacy v0.1.x).",
				args: {
					query: tool.schema.string().min(1),
					type: tool.schema
						.enum(["error", "pattern", "decision", "context"])
						.optional(),
					limit: tool.schema.number().int().positive().default(10),
					full: tool.schema
						.boolean()
						.optional()
						.describe(
							"Cuando true, retorna el contenido completo (v0.1.x). Default false (slim).",
						),
				},
				async execute(args) {
					const memories = memoryService.query({
						text: args.query,
						type: args.type,
						limit: args.limit,
						full: args.full === true,
					});
					const rows =
						args.full === true
							? (memories as unknown as Memory[]).map((m) => ({
									id: m.id,
									type: m.type,
									content: m.content,
									scope: m.scope,
								}))
							: (memories as SlimMemory[]).map((m) => ({
									id: m.id,
									type: m.type,
									scope: m.scope,
									score: m.score,
									snippet: m.snippet,
								}));
					return {
						title: "Resultados query",
						output: JSON.stringify(rows),
					};
				},
			}),
			kevin_get: tool({
				description:
					"Recupera una memoria completa por su id (v0.2.0 — progressive disclosure). Util cuando kevin_query retorna un snippet slim y necesitas el contenido completo.",
				args: {
					id: tool.schema.string().min(1),
				},
				async execute(args) {
					const mem = memoryService.getById(args.id);
					if (mem === null) {
						return {
							title: "No encontrada",
							output: JSON.stringify({
								error: "not_found",
								id: args.id,
							}),
						};
					}
					return {
						title: "Memoria encontrada",
						output: JSON.stringify({
							id: mem.id,
							type: mem.type,
							content: mem.content,
							scope: mem.scope,
							relevanceScore: mem.relevanceScore,
							sourceTool: mem.sourceTool ?? null,
							sourceSession: mem.sourceSession ?? null,
							createdAt: mem.createdAt,
							updatedAt: mem.updatedAt,
							expiresAt: mem.expiresAt ?? null,
							projectId: mem.projectId ?? null,
							fingerprint: mem.fingerprint ?? null,
							origin: mem.origin ?? null,
							metadata: mem.metadata ?? null,
						}),
					};
				},
			}),
			kevin_recall: tool({
				description:
					"Recupera memorias relevantes (greedy fill por budget de tokens). Opcional query; sin query retorna todas del scope.",
				args: {
					query: tool.schema.string().optional(),
					limit: tool.schema.number().int().positive().default(5),
					scope: tool.schema
						.enum(["project", "session", "all"])
						.optional()
						.describe("project | session | all (default all)"),
				},
				async execute(args) {
					const memories = memoryService.getRelevant({
						query: args.query,
						maxTokens: args.limit * 500,
						scope: args.scope ?? "all",
					});
					return {
						title: "Memorias relevantes",
						output: JSON.stringify(
							memories.map((m) => ({
								id: m.id,
								type: m.type,
								content: m.content,
								scope: m.scope,
							})),
						),
					};
				},
			}),
			kevin_status: tool({
				description:
					"Retorna conteos de memorias, tool_calls y retrospectives en la DB de Kevin.",
				args: {},
				async execute() {
					const memoryCount = store
						.prepare("SELECT COUNT(*) as c FROM memories")
						.get() as { c: number };
					const toolCallCount = store
						.prepare("SELECT COUNT(*) as c FROM tool_calls")
						.get() as { c: number };
					const retroCount = store
						.prepare("SELECT COUNT(*) as c FROM retrospectives")
						.get() as { c: number };
					// v0.2.0 (K2-014): origin breakdown + metrics snapshot.
					const originRows = store
						.prepare(
							`SELECT origin, COUNT(*) as c
							 FROM memories
							 GROUP BY origin`,
						)
						.all() as { origin: string | null; c: number }[];
					const byOrigin: Record<string, number> = {};
					for (const r of originRows) {
						byOrigin[r.origin ?? "agent"] = r.c;
					}
					const memoriesReflector = byOrigin.reflector ?? 0;
					const memoriesAgent = byOrigin.agent ?? 0;
					const memoriesPattern = byOrigin.pattern ?? 0;
					return {
						title: "Estado de Kevin",
						output: JSON.stringify({
							memories: memoryCount.c,
							memories_reflector: memoriesReflector,
							memories_agent: memoriesAgent,
							memories_pattern: memoriesPattern,
							tool_calls: toolCallCount.c,
							retrospectives: retroCount.c,
							metrics: metrics.snapshot(),
						}),
					};
				},
			}),
			kevin_retrospective: tool({
				description:
					"Genera un retrospective markdown para una sesion (resume tools que fallaron y lecciones aprendidas).",
				args: {
					session_id: tool.schema.string().optional(),
				},
				async execute(args) {
					const sid = args.session_id ?? currentSessionId;
					if (!sid) {
						return {
							title: "Retrospective omitido",
							output: JSON.stringify({
								message:
									"No hay session_id activo. Pasa session_id explicitamente.",
							}),
						};
					}
					const filePath = await retrospective.generate(sid);
					return filePath
						? {
								title: "Retrospective generado",
								output: JSON.stringify({ file_path: filePath }),
							}
						: {
								title: "Retrospective omitido",
								output: JSON.stringify({
									message:
										"No hubo fallos en la sesion; nada que retrospectar.",
								}),
							};
				},
			}),
		},

		"tool.execute.before": async (hookInput, output) => {
			rememberToolCall(
				hookInput.callID,
				hookInput.tool,
				output.args as Record<string, unknown> | undefined,
			);
			observer.onBefore(
				{
					tool: hookInput.tool,
					args: output.args as Record<string, unknown>,
					sessionId: hookInput.sessionID,
					callID: hookInput.callID,
				},
				{},
			);
		},

		"tool.execute.after": async (hookInput, output) => {
			const meta = (output.metadata ?? {}) as Record<string, unknown>;
			const outputText = String(output.output ?? "");
			const stderr = String(meta.stderr ?? "");
			const stdout = String(meta.stdout ?? outputText);
			const exitCode = pickExitCode(meta);
			let success: boolean;
			if (meta.success === false) {
				success = false;
			} else if (exitCode !== undefined) {
				success = exitCode === 0;
			} else if (stderr.length > 0 && ERROR_LINE_RE.test(stderr)) {
				success = false;
			} else {
				const stream = stdout.length > 0 ? stdout : outputText;
				success = !(stream.length > 0 && STRONG_ERROR_RE.test(stream));
			}
			observer.onAfter(
				{
					tool: hookInput.tool,
					args: hookInput.args as Record<string, unknown>,
					sessionId: hookInput.sessionID,
					callID: hookInput.callID,
				},
				{ success, stdout, stderr, exitCode },
			);
			if (!success) {
				const errorType = observer.inferErrorType(stderr, stdout, exitCode);
				fireAndForget(
					reflector.invoke({
						toolName: hookInput.tool,
						argsSummary: observer.summarizeArgs(
							hookInput.args as Record<string, unknown>,
						),
						stderr,
						stdout,
						exitCode,
						errorType,
						sessionId: hookInput.sessionID,
					}),
				);
			}
		},

		"chat.message": async (_hookInput, output) => {
			const text = output.parts
				.map((p) => p as { type?: string; text?: string })
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join(" ");
			if (text.trim()) {
				const derived = injector.deriveQuery([{ role: "user", content: text }]);
				lastUserQuery = derived.length > 0 ? derived : null;
			}
		},

		"experimental.chat.system.transform": async (_hookInput, output) => {
			if (!lastUserQuery) return;
			const memories = memoryService.getRelevant({
				query: lastUserQuery,
				maxTokens: SYSTEM_TRANSFORM_TOKENS,
				scope: "project",
			});
			const block = formatMemories(memories, "context");
			if (block) {
				output.system.push(block);
				metrics.incr("tokens_injected_pre_prompt", estimateTokens(block));
			}
		},

		"experimental.session.compacting": async (_hookInput, output) => {
			const query = lastUserQuery;
			if (!query) return;
			const memories = memoryService.getRelevant({
				query,
				maxTokens: COMPACTING_TOKENS,
				scope: "project",
			});
			const block = formatMemories(memories, "memory");
			if (block) {
				output.context.push(block);
				metrics.incr("tokens_injected_compacting", estimateTokens(block));
			}
		},

		event: async ({ event }) => {
			const type = (event as { type?: string }).type;
			const props =
				(event as { properties?: Record<string, unknown> }).properties ?? {};
			if (type === "session.created") {
				const info = props.info as { id?: string } | undefined;
				if (info?.id) currentSessionId = info.id;
			} else if (type === "session.idle") {
				const sid = props.sessionID as string | undefined;
				if (sid) {
					toolCache.clear();
					fireAndForget(retrospective.generate(sid));
					memoryService.boostPositiveReflectors(sid);
					patternMiner.mine();
				}
				metrics.flush();
			} else if (type === "session.next.tool.failed") {
				const callID = props.callID as string | undefined;
				const sessionID = props.sessionID as string | undefined;
				const error = props.error as { message?: string } | undefined;
				if (callID && sessionID && error?.message) {
					handleToolFailed(callID, sessionID, error.message);
				}
			} else if (type === "session.next.tool.success") {
				const callID = props.callID as string | undefined;
				if (callID) toolCache.delete(callID);
			}
		},

		dispose: async () => {
			await Promise.allSettled([...pending]);
			metrics.close();
			store.close();
		},
	};
};

export default KevinPlugin;

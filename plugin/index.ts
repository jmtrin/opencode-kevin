import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { ContextInjector } from "./ContextInjector.js";
import { MemoryService } from "./MemoryService.js";
import { Migrate } from "./Migrate.js";
import { ERROR_LINE_RE, Reflector } from "./Reflector.js";
import { Retrospective } from "./Retrospective.js";
import { Store } from "./Store.js";
import { ToolCallObserver } from "./ToolCallObserver.js";

export interface KevinPluginOptions {
	dbPath?: string;
	migrationsDir?: string;
	retrospectivesDir?: string;
	throttleMs?: number;
}

const SYSTEM_TRANSFORM_TOKENS = 1500;
const COMPACTING_TOKENS = 2000;

function formatMemories(
	memories: { type: string; content: string }[],
	tag: "context" | "memory",
): string {
	if (memories.length === 0) return "";
	const body = memories.map((m) => `[${m.type}] ${m.content}`).join("\n");
	return tag === "context"
		? `<kevin-context>Lecciones relevantes:\n${body}\n</kevin-context>`
		: `<kevin-memory>\n${body}\n</kevin-memory>`;
}

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
	const memoryService = new MemoryService(store);
	const observer = new ToolCallObserver(store);
	const reflector = new Reflector(memoryService, {
		throttleMs: opts.throttleMs,
	});
	const injector = new ContextInjector(memoryService);
	const retrospective = new Retrospective(store, memoryService, {
		dir: opts.retrospectivesDir,
	});
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
					"Busca memorias por texto (FTS5). Retorna JSON con [{id,type,content,scope}].",
				args: {
					query: tool.schema.string().min(1),
					type: tool.schema
						.enum(["error", "pattern", "decision", "context"])
						.optional(),
					limit: tool.schema.number().int().positive().default(10),
				},
				async execute(args) {
					const memories = memoryService.query({
						text: args.query,
						type: args.type,
						limit: args.limit,
					});
					return {
						title: "Resultados query",
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
					return {
						title: "Estado de Kevin",
						output: JSON.stringify({
							memories: memoryCount.c,
							tool_calls: toolCallCount.c,
							retrospectives: retroCount.c,
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
			let success: boolean;
			if (meta.success === false) {
				success = false;
			} else if (meta.success === true) {
				success = true;
			} else if (typeof meta.exitCode === "number" && meta.exitCode !== 0) {
				success = false;
			} else {
				const stderr = String(meta.stderr ?? "");
				success = !(stderr.length > 0 && ERROR_LINE_RE.test(stderr));
			}
			const stderr = String(meta.stderr ?? "");
			const stdout = String(meta.stdout ?? outputText);
			const exitCode =
				typeof meta.exitCode === "number" ? meta.exitCode : undefined;
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
			if (block) output.system.push(block);
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
			if (block) output.context.push(block);
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
				}
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
			store.close();
		},
	};
};

export default KevinPlugin;

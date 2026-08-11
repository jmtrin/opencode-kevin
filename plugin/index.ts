import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { Archiver } from "./Archiver.js";
import { CausalChain } from "./CausalChain.js";
import { type ChatMessage, ContextInjector } from "./ContextInjector.js";
import { Feedback } from "./Feedback.js";
import { InjectionLedger } from "./InjectionLedger.js";
import {
	type Memory,
	MemoryService,
	type SlimMemory,
	type SlimMemoryWithEvidence,
} from "./MemoryService.js";
import { Migrate } from "./Migrate.js";
import { PatternMiner } from "./PatternMiner.js";
import { ERROR_LINE_RE, Reflector, STRONG_ERROR_RE } from "./Reflector.js";
import { Retrospective } from "./Retrospective.js";
import { Store } from "./Store.js";
import { ToolCallObserver } from "./ToolCallObserver.js";
import { fingerprint } from "./fingerprint.js";
import { buildAudit } from "./kevin_audit.js";
import { kevinWhy } from "./kevin_why.js";
import type { WhyResult } from "./kevin_why.js";
import { Metrics } from "./metrics.js";
import { exportMarkdown, exportOkf } from "./okf-export.js";
import { importOkf } from "./okf-import.js";

export interface KevinPluginOptions {
	dbPath?: string;
	migrationsDir?: string;
	retrospectivesDir?: string;
	throttleMs?: number;
}

/**
 * v0.4.0 (K4-021) — settings surfaced by `kevin_config` (plan §8.8).
 * Unknown keys are rejected on `set` unless `strict: false`.
 */
export const KEVIN_CONFIG_KEYS = [
	"quality_gate_enabled",
	"lesson_snippet_injection",
	"patternminer_enabled",
	"cross_project_enabled",
	"llm_reflection_enabled",
	"tool_calls_dedup_enabled",
	// v0.5.0 (K5-003 / plan §8.13) — omitting these makes `kevin_config set`
	// return { error: "unknown_key" } while `kevin_config list` still shows
	// the keys seeded by migration 006.
	"deterministic_retrieval",
	"pre_prompt_budget_tokens",
	"archive_after_days",
] as const;

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
	// v0.4.0 (K4-019): the plugin hooks expose no project field, so the
	// project id is derived once from the plugin host's working directory
	// (plan §5.7 fallback; D2-11 project scoping wired into the live path).
	const projectId = fingerprint(process.cwd());
	const memoryService = new MemoryService(store, metrics);
	const observer = new ToolCallObserver(store, metrics);
	// v0.3.0 fix — Prepared UPDATE used by Reflector.onLinkError to stamp
	// tool_calls.error_fingerprint with the stderr-based fingerprint the
	// matching error memory uses. Closes the feedback-loop fingerprint
	// mismatch (plan §B6.10 / bug #2): without this, the recurrence
	// queries in boostPositiveReflectors / penalizeRecurringReflectors
	// never match because tool_calls.fingerprint is keyed on
	// `${tool}|${args}|${success}` (set by ToolCallObserver) while error
	// memories use a hash of stderr/stdout (set by Reflector). The
	// callback is a no-op for legacy rows without an id column.
	const linkErrorStmt = store.prepare(
		"UPDATE tool_calls SET error_fingerprint = ? WHERE id = ?",
	);
	const reflector = new Reflector(
		memoryService,
		{
			throttleMs: opts.throttleMs,
			onLinkError: (callID, fp) => {
				linkErrorStmt.run(fp, callID);
			},
		},
		metrics,
	);
	// v0.4.0 (K4-017): the single injection path. The inline transform/
	// compacting logic was removed; the ContextInjector now owns the whole
	// pipeline (QualityGate admission + snippet payload + ledger rows),
	// so ledger and injector share the same store.
	const ledger = new InjectionLedger(store, metrics);
	const injector = new ContextInjector(memoryService, metrics, ledger);
	// v0.5.0 (K5-009/011 / plan §5.3) — human feedback component behind the
	// `kevin_feedback` tool; 'ignore' verdicts also stamp memories.ignored.
	const feedback = new Feedback(store, metrics);
	// v0.5.0 (K5-012 / plan §5.4) — retires stale memories at session.idle.
	const archiver = new Archiver(store, memoryService, metrics);
	const retrospective = new Retrospective(
		store,
		memoryService,
		{
			dir: opts.retrospectivesDir,
		},
		metrics,
	);
	const patternMiner = new PatternMiner(store, memoryService, metrics);
	const causalChain = new CausalChain(store, memoryService, metrics);
	let currentSessionId: string | null = null;
	// BUG-011 — process-global last derived query. Cleared on
	// `session.idle`; the per-session map below is the preferred source.
	let lastUserQuery: string | null = null;
	// v0.4.0 (K4-018) — compaction may fire without a recent chat.message
	// (auto-compact after a long tool turn, resumed sessions). Keep the
	// last derived query PER SESSION so the compacting hook can always
	// resolve a query for the session it runs in.
	const lastUserQueryBySession = new Map<string, string>();
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
				callID,
				projectId,
			}),
		);
	}

	return {
		tool: {
			kevin_save: tool({
				description:
					"Guarda una memoria en el conocimiento persistente de Kevin (error, pattern, decision o context).",
				args: {
					type: tool.schema.enum([
						"error",
						"pattern",
						"decision",
						"context",
						"rule",
						"solution",
					]),
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
						.enum([
							"error",
							"pattern",
							"decision",
							"context",
							"rule",
							"solution",
						])
						.optional(),
					limit: tool.schema.number().int().positive().default(10),
					full: tool.schema
						.boolean()
						.optional()
						.describe(
							"Cuando true, retorna el contenido completo (v0.1.x). Default false (slim).",
						),
					evidence: tool.schema
						.boolean()
						.optional()
						.describe(
							"Cuando true, incluye confidence, evidence_count y last_verified_at en el payload slim (v0.3.0).",
						),
				},
				async execute(args) {
					const memories = memoryService.query({
						text: args.query,
						type: args.type,
						limit: args.limit,
						full: args.full === true,
						// BUG-001 — pass the flag through so the slim mapper
						// can include the evidence fields (the old code cast
						// SlimMemory rows to Memory and read undefined fields).
						evidence: args.evidence === true,
					});
					const rows =
						args.full === true
							? (memories as unknown as Memory[]).map((m) => ({
									id: m.id,
									type: m.type,
									content: m.content,
									scope: m.scope,
								}))
							: (memories as SlimMemory[]).map((m) => {
									const base = {
										id: m.id,
										type: m.type,
										scope: m.scope,
										score: m.score,
										snippet: m.snippet,
									};
									if (args.evidence === true) {
										// SlimMemoryWithEvidence — carried by the
										// mapper, no per-row getById needed.
										const ev = m as SlimMemoryWithEvidence;
										return {
											...base,
											confidence: ev.confidence ?? null,
											evidence_count: ev.evidence_count ?? null,
											last_verified_at: ev.last_verified_at ?? null,
										};
									}
									return base;
								});
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
							// BUG-010 — v0.3/v0.4 evidence fields so kevin_get
							// is the full-fidelity read path (mapRow already
							// computes confidence via computeConfidence).
							confidence: mem.confidence ?? null,
							evidence_count: mem.evidenceCount ?? null,
							recurrence_count: mem.recurrenceCount ?? null,
							last_verified_at: mem.lastVerifiedAt ?? null,
							status: mem.status ?? "active",
							fix_args: mem.fixArgs ?? null,
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
					const memoriesCausal = byOrigin.causal ?? 0;
					// v0.4.0 (K4-024): per-origin recurrence_count totals
					// (plan §8.8 — honest negative-evidence breakdown).
					// Best-effort: DBs pre-005 lack the column; the rest of
					// the block must still work (same pattern as
					// ledger.settle in session.idle).
					let recurrenceByOrigin: Record<string, number> = {};
					try {
						const recRows = store
							.prepare(
								`SELECT origin, SUM(recurrence_count) as c
								 FROM memories
								 GROUP BY origin`,
							)
							.all() as { origin: string | null; c: number }[];
						for (const r of recRows) {
							recurrenceByOrigin[r.origin ?? "agent"] = r.c;
						}
					} catch {
						recurrenceByOrigin = {};
					}
					// v0.5.0 (K5-021 / plan §5.7) — lifecycle counts; best-effort
					// on pre-006 DBs (columns may be missing).
					let memoriesIgnored = 0;
					let memoriesArchived = 0;
					try {
						memoriesIgnored = (
							store
								.prepare("SELECT COUNT(*) as c FROM memories WHERE ignored = 1")
								.get() as { c: number }
						).c;
					} catch {
						memoriesIgnored = 0;
					}
					try {
						memoriesArchived = (
							store
								.prepare(
									"SELECT COUNT(*) as c FROM memories WHERE status = 'archived'",
								)
								.get() as { c: number }
						).c;
					} catch {
						memoriesArchived = 0;
					}
					return {
						title: "Estado de Kevin",
						output: JSON.stringify({
							memories: memoryCount.c,
							memories_reflector: memoriesReflector,
							memories_agent: memoriesAgent,
							memories_pattern: memoriesPattern,
							memories_causal: memoriesCausal,
							tool_calls: toolCallCount.c,
							retrospectives: retroCount.c,
							metrics: metrics.snapshot(),
							// v0.4.0 (K4-008): precision block. The
							// human-facing "patterns promoted" reading is
							// `patterns_promoted_new` (K4-009 corrected the
							// inflated `patterns_causal` counter; its key
							// stays frozen in metrics for compatibility).
							precision_rate: metrics.precisionRate(),
							injections_total: metrics.get("injections_total"),
							injections_effective: metrics.get("injections_effective"),
							injections_ineffective: metrics.get("injections_ineffective"),
							patterns_promoted_new: metrics.get("patterns_promoted_new"),
							// v0.4.0 (K4-024): per-origin recurrence totals.
							recurrence_by_origin: recurrenceByOrigin,
							// v0.5.0 (K5-021 / plan §5.7) — glassbox fields.
							injections_inconclusive: metrics.get("injections_inconclusive"),
							coverage_rate: metrics.coverageRate(),
							blocked: metrics.blockedSnapshot(),
							memories_ignored: memoriesIgnored,
							memories_archived: memoriesArchived,
							feedback: {
								positive: metrics.get("feedback_positive_total"),
								negative: metrics.get("feedback_negative_total"),
							},
						}),
					};
				},
			}),
			kevin_audit: tool({
				description:
					'Auditoria de solo lectura de la DB (v0.5.0, glassbox): memorias por status/origin/type, salud de inyecciones (precision/coverage), contadores bloqueados, feedback por verdicto, tokens inyectados. Sin writes, sin LLM. En DBs pre-006 devuelve los bloques computables con "partial": true. verbose añade el bloque settings.',
				args: {
					verbose: tool.schema.boolean().default(false),
				},
				async execute(args) {
					const report = buildAudit(store, metrics);
					const payload = args.verbose
						? report
						: { ...report, settings: undefined };
					return {
						title: "Auditoria de Kevin",
						output: JSON.stringify(payload),
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
			kevin_why: tool({
				description:
					"Explica por que Kevin recuerda un hecho (v0.3.0). Retorna summary, confidence, trace de eventos y related_rules.",
				args: {
					query: tool.schema.string().min(1),
				},
				async execute(args) {
					const result = kevinWhy(store, args.query);
					if (!result) {
						return {
							title: "Sin explicacion",
							output: JSON.stringify({
								message: `No causal patterns found for "${args.query}".`,
							}),
						};
					}
					return {
						title: "Explicacion causal",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_feedback: tool({
				description:
					"Reporta juicio humano sobre una memoria (v0.5.0). verdict: useful | wrong | outdated | ignore. 'ignore' excluye la memoria de retrieval e inyeccion (D5-07); los demas ajustan confidence via computeConfidence (D5-02).",
				args: {
					memory_id: tool.schema.string().min(1),
					verdict: tool.schema
						.enum(["useful", "wrong", "outdated", "ignore"])
						.describe(
							"useful: la memoria ayudo. wrong: era incorrecta. outdated: ya no aplica. ignore: no volver a mostrarla.",
						),
					note: tool.schema.string().optional(),
					session_id: tool.schema.string().optional(),
				},
				async execute(args) {
					const memory = memoryService.getById(args.memory_id);
					if (!memory) {
						return {
							title: "Feedback no registrado",
							output: JSON.stringify({
								message: `No memory found for id "${args.memory_id}".`,
							}),
						};
					}
					try {
						const feedbackId = feedback.record({
							memoryId: args.memory_id,
							verdict: args.verdict,
							sessionId: args.session_id ?? currentSessionId ?? null,
							note: args.note,
						});
						const counts = feedback.countsFor(args.memory_id);
						return {
							title: "Feedback registrado",
							output: JSON.stringify({
								feedback_id: feedbackId,
								memory_id: args.memory_id,
								verdict: args.verdict,
								counters: counts,
								ignored:
									args.verdict === "ignore" ? true : memory.ignored === true,
							}),
						};
					} catch (err) {
						return {
							title: "Feedback no registrado",
							output: JSON.stringify({
								message: err instanceof Error ? err.message : String(err),
							}),
						};
					}
				},
			}),
			kevin_trace: tool({
				description:
					"Predice que memorias se inyectarian en el prompt para una query (v0.5.0, dry-run estricto). Retorna el plan: items admitidos/bloqueados con su razon, tokens totales estimados. NO inyecta, NO mueve contadores, NO muta el seen-set, NO hace bump de relevancia (D5-08). Si omites query, usa la ultima query derivada de la sesion.",
				args: {
					query: tool.schema.string().optional(),
					session_id: tool.schema.string().optional(),
					tag: tool.schema
						.enum(["context", "memory"])
						.default("context")
						.describe(
							"context = pre-prompt (cap por setting pre_prompt_budget_tokens, default 900), memory = compacting (cap 2000)",
						),
					cap: tool.schema.number().int().positive().optional(),
				},
				async execute(args) {
					const sid = args.session_id ?? currentSessionId ?? "";
					const query =
						args.query ??
						(sid ? (lastUserQueryBySession.get(sid) ?? null) : null) ??
						lastUserQuery;
					if (!query) {
						return {
							title: "Trace sin query",
							output: JSON.stringify({
								message:
									"No query derivada disponible. Pasa query explicitamente.",
							}),
						};
					}
					const plan = injector.plan(query, {
						tag: args.tag,
						cap: args.cap,
						sessionId: sid,
					});
					return {
						title: "Plan de inyeccion (dry-run)",
						output: JSON.stringify(plan),
					};
				},
			}),
			kevin_export: tool({
				description:
					"Exporta memorias curadas (decision, rule, pattern) como markdown o formato OKF. v0.3.0.",
				args: {
					format: tool.schema
						.enum(["okf", "markdown"])
						.default("okf")
						.describe("okf | markdown"),
				},
				async execute(args) {
					const output =
						args.format === "markdown"
							? exportMarkdown(store)
							: exportOkf(store);
					return {
						title: "Export completado",
						output,
					};
				},
			}),
			kevin_import: tool({
				description:
					"Importa un bundle markdown de conocimiento (v0.3.0). Cada entrada se guarda como context con origin='imported'.",
				args: {
					bundle: tool.schema.string().min(1),
				},
				async execute(args) {
					const result = importOkf(args.bundle, memoryService);
					return {
						title: "Import completado",
						output: JSON.stringify(result),
					};
				},
			}),
			kevin_config: tool({
				description:
					"Lee o modifica settings de Kevin sin SQL (v0.4.0). list: todas las settings de kevin_settings. set: upsert de una key conocida (rechaza keys desconocidas salvo strict:false).",
				args: {
					action: tool.schema.enum(["list", "set"]).describe("list | set"),
					key: tool.schema
						.string()
						.optional()
						.describe("Clave a modificar (action=set)."),
					value: tool.schema
						.string()
						.optional()
						.describe("Nuevo valor (action=set). Default '1'."),
					strict: tool.schema
						.boolean()
						.default(true)
						.optional()
						.describe(
							"Con strict=true (default) se rechazan keys desconocidas.",
						),
				},
				async execute(args) {
					if (args.action === "list") {
						const rows = store
							.prepare("SELECT key, value FROM kevin_settings ORDER BY key")
							.all() as { key: string; value: string }[];
						const settings: Record<string, string> = {};
						for (const r of rows) settings[r.key] = r.value;
						return {
							title: "Configuracion de Kevin",
							output: JSON.stringify(settings),
						};
					}
					if (!args.key) {
						return {
							title: "kevin_config",
							output: JSON.stringify({
								error: "missing_key",
								action: "set",
							}),
						};
					}
					const known = (KEVIN_CONFIG_KEYS as readonly string[]).includes(
						args.key,
					);
					if (!known && args.strict !== false) {
						return {
							title: "kevin_config",
							output: JSON.stringify({
								error: "unknown_key",
								key: args.key,
								known_keys: [...KEVIN_CONFIG_KEYS],
							}),
						};
					}
					const value = args.value ?? "1";
					store
						.prepare(
							`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
							 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
						)
						.run(args.key, value);
					return {
						title: "kevin_config",
						output: JSON.stringify({ ok: true, key: args.key, value }),
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
					projectId,
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
					projectId,
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
						callID: hookInput.callID,
						projectId,
					}),
				);
			} else {
				causalChain.onSuccess(
					hookInput.tool,
					hookInput.args as Record<string, unknown>,
					projectId,
					hookInput.sessionID,
				);
			}
		},

		"chat.message": async (hookInput, output) => {
			const text = output.parts
				.map((p) => p as { type?: string; text?: string })
				.filter((p) => p.type === "text")
				.map((p) => p.text ?? "")
				.join(" ");
			if (text.trim()) {
				const derived = injector.deriveQuery([{ role: "user", content: text }]);
				lastUserQuery = derived.length > 0 ? derived : null;
				if (hookInput.sessionID && lastUserQuery) {
					lastUserQueryBySession.set(hookInput.sessionID, lastUserQuery);
				}
			}
		},

		"experimental.chat.system.transform": async (hookInput, output) => {
			// BUG-011 — prefer the per-session query so a new session whose
			// first transform fires before any chat.message cannot reuse the
			// previous session's query (the global is cleared on idle).
			const query =
				lastUserQueryBySession.get(hookInput.sessionID ?? "") ?? lastUserQuery;
			if (!query) return;
			const suggestion = injector.generateSuggestion();
			if (suggestion) output.system.push(suggestion);
			injector.onSystemTransform(
				{
					sessionID: hookInput.sessionID ?? undefined,
					messages: [{ role: "user", content: query }],
				},
				output,
			);
		},

		"experimental.session.compacting": async (hookInput, output) => {
			// v0.4.0 (K4-018) — plan §5.6: compaction often fires with no
			// recent chat.message (auto-compact after a long tool turn,
			// resumed sessions). Resolve a query per session first, then
			// the global fallback, then any messages the runtime may
			// provide (defensive — the current SDK contract only exposes
			// sessionID).
			// BUG-012 — the HITL suggestion fires AT MOST ONCE per session:
			// whichever hook (transform or compacting) runs first consumes
			// the pending recurrence signal (generateSuggestion resets it).
			const suggestion = injector.generateSuggestion();
			if (suggestion) output.context.push(suggestion);
			const sid = hookInput.sessionID;
			const sessionQuery = lastUserQueryBySession.get(sid) ?? lastUserQuery;
			const runtimeMessages = (hookInput as { messages?: ChatMessage[] })
				.messages;
			const messages =
				sessionQuery != null
					? [{ role: "user" as const, content: sessionQuery }]
					: (runtimeMessages ?? []);
			injector.onCompacting(
				{
					sessionID: sid,
					messages,
				},
				output,
			);
		},

		event: async ({ event }) => {
			const type = (event as { type?: string }).type;
			const props =
				(event as { properties?: Record<string, unknown> }).properties ?? {};
			if (type === "session.created") {
				const info = props.info as { id?: string } | undefined;
				if (info?.id) {
					currentSessionId = info.id;
					// BUG-011 — a fresh session must not inherit the
					// previous session's derived query (the global may
					// still hold it if no idle fired).
					lastUserQueryBySession.delete(info.id);
					// v0.4.0 (K4-017) — plan §5.1 rule 3: the per-session
					// seen-set resets when a session is created.
					injector.onSessionCreated(info.id);
				}
			} else if (type === "session.idle") {
				const sid = props.sessionID as string | undefined;
				if (sid) {
					toolCache.clear();
					// BUG-011 — the session is done: drop the global query
					// so the next session cannot reuse it.
					lastUserQuery = null;
					// v0.4.0 (K4-024) — plan §5.2: settle the session's
					// unmeasured injections (effective/ineffective +
					// recurrence_count charges) at idle. Best-effort: a
					// legacy DB without migration 005 has no ledger table.
					try {
						ledger.settle(sid);
					} catch {
						// best-effort: a legacy DB without the ledger
						// table must not break the idle path
					}
					// v0.5.0 (K5-012 / plan §5.4) — retire stale lessons at
					// idle; pre-006 DBs degrade to a no-op.
					try {
						archiver.run();
					} catch {
						// best-effort, same pattern as ledger.settle
					}
					fireAndForget(retrospective.generate(sid));
					memoryService.boostPositiveReflectors(sid);
					const recurred = memoryService.penalizeRecurringReflectors(sid);
					injector.setRecurrences(recurred, sid);
					patternMiner.mine(projectId);
					fireAndForget(
						Promise.resolve()
							.then(() => causalChain.onSessionIdle(sid))
							// non-blocking — promote is a best-effort pass
							// (legacy DBs pre-005 lack the recurrence_count
							// column)
							.catch(() => {}),
					);
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

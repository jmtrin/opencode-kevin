import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

export interface RetrospectiveOptions {
	dir?: string;
}

interface CountRow {
	success_count: number;
	failure_count: number;
	total: number;
}

interface FailedToolRow {
	tool: string;
	args_summary: string | null;
	error_type: string | null;
}

interface LessonRow {
	id: string;
	content: string;
	origin: string | null;
	fingerprint: string | null;
	project_id: string | null;
}

interface FalsePositiveRow {
	id: string;
	content: string;
	fingerprint: string;
	project_id: string | null;
	recurrence_count: number;
}

// v0.6.0 (K6-004 / plan §8.16) — exported so tests can assert that every
// METRIC_KEYS entry has a label by iterating the keys (not by counting).
export const METRIC_KEY_LABELS: Record<string, string> = {
	tokens_injected_pre_prompt: "Tokens inyectados (pre-prompt)",
	tokens_injected_compacting: "Tokens inyectados (compacting)",
	reflections_throttled: "Reflexiones throttled",
	duplicate_suppressions: "Supresiones por dedup",
	tool_calls_deduped: "Tool calls deduped",
	patterns_mined: "Patrones minados",
	// BUG-014 — v0.4.0 keys (K4-006/K4-008/K4-025) had no Spanish labels,
	// so the "## Métricas" section printed raw keys for them.
	injections_total: "Inyecciones totales",
	injections_effective: "Inyecciones efectivas",
	injections_ineffective: "Inyecciones ineficaces",
	patterns_promoted_new: "Patrones promovidos (nuevos)",
	patterns_causal: "Patrones causales",
	causal_links: "Enlaces causales",
	memories_superseded: "Memorias superadas",
	// v0.5.0 (K5-004 / plan §8.3) — the K5 metric keys need their own
	// Spanish labels; the e2e BUG-014 regression test forbids raw-key
	// fallback for any key in METRIC_KEYS.
	injections_inconclusive: "Inyecciones sin conclusión",
	injections_blocked_seen: "Inyecciones bloqueadas (ya vistas)",
	injections_blocked_weak: "Inyecciones bloqueadas (débiles)",
	injections_blocked_recurrence: "Inyecciones bloqueadas (recurrentes)",
	injections_blocked_stale: "Inyecciones bloqueadas (obsoletas)",
	injections_blocked_ignored: "Inyecciones bloqueadas (ignoradas)",
	feedback_positive_total: "Feedback positivo total",
	feedback_negative_total: "Feedback negativo total",
	memories_archived: "Memorias archivadas",
	// v0.6.0 (K6-004 / plan §8.16) — the K6 metric keys need their own
	// Spanish labels; the audit regression forbids raw-key fallback for any
	// key in METRIC_KEYS.
	proposals_created: "Propuestas de curación creadas",
	proposals_approved: "Propuestas aprobadas",
	proposals_rejected: "Propuestas rechazadas",
	artifact_writes_total: "Escrituras de artefacto (escritas)",
	artifact_writes_noop: "Escrituras de artefacto (sin cambios)",
	injections_blocked_confidence: "Inyecciones bloqueadas (confianza baja)",
	// v0.7.0 (K7-004 / plan §8.3) — the K7 metric keys need their own
	// Spanish labels; the audit regression forbids raw-key fallback for any
	// key in METRIC_KEYS.
	repo_facts_scanned: "Hechos del repositorio escaneados",
	memories_contradicted: "Memorias contradichas",
	conventions_mined: "Convenciones minadas",
	conflicts_detected: "Conflictos detectados",
	error_lessons_suppressed: "Lecciones de error suprimidas",
	// v0.8.0 (K8-003 / plan §8.16) — the K8 metric keys need their own
	// Spanish labels; the audit regression forbids raw-key fallback for any
	// key in METRIC_KEYS.
	shared_entries_total: "Entradas compartidas (totales)",
	shared_entries_imported: "Entradas compartidas importadas",
	shared_entries_exported: "Entradas compartidas exportadas",
	okf_merge_folds: "Fusiones OKF (folds)",
	rekey_events: "Re-keys de repositorio",
	injections_from_shared: "Inyecciones desde la capa compartida",
	// v0.9.0 (K9-003 / plan §8.16) — the K9 metric keys need their own
	// Spanish labels; the audit regression forbids raw-key fallback for any
	// key in METRIC_KEYS.
	hook_fires_total: "Disparos de hooks (totales)",
	hook_errors_total: "Errores de hooks",
	hooks_dead_total: "Hooks muertos",
	injections_suppressed_dead_hook: "Inyecciones suprimidas (hook muerto)",
	native_registrations_total: "Registros nativos (totales)",
	native_registration_failures: "Fallos de registro nativo",
	// v1.0.0 (K10-005 / plan §6) — the six keys seeded by migration 011 section 3.
	perf_samples_recorded: "Muestras de rendimiento registradas",
	perf_budget_breaches: "Brechas de presupuesto de rendimiento",
	dispose_fires_total: "Disparos de dispose (totales)",
	dispose_misses_total: "Misses de dispose",
	contract_digest_changes: "Cambios de digest de contrato",
	bench_runs_total: "Ejecuciones de benchmark (totales)",
	// v1.1.0 (K11-001 / plan §4) — drift metrics; labels required by BUG-014 regression.
	bench_regression_failures: "Fallos de regresion de benchmark",
	forget_requests_total: "Solicitudes de olvido totales",
	forget_tombstones_published: "Tombstones publicados por olvido",
	// v1.2.0 (K12-001 / plan §4) — surface metrics; labels required by BUG-014 regression.
	tui_snapshots_flushed: "Snapshots TUI generados",
	tui_actions_invoked: "Acciones TUI invocadas",
};

function originLabel(
	origin: string | null,
): "reflector" | "agent" | "pattern" | "retrospective" | "agent" {
	if (origin === "reflector") return "reflector";
	if (origin === "pattern") return "pattern";
	if (origin === "retrospective") return "retrospective";
	return "agent";
}

export class Retrospective {
	private retrospectivesDir: string;
	private metrics: Metrics | null;

	constructor(
		private store: Store,
		private memoryService: MemoryService,
		options?: RetrospectiveOptions,
		metrics?: Metrics | null,
	) {
		this.retrospectivesDir =
			options?.dir ?? join(homedir(), ".opencode-kevin", "retrospectives");
		this.metrics = metrics ?? null;
	}

	async generate(sessionId: string): Promise<string | null> {
		const existing = this.store
			.prepare("SELECT file_path FROM retrospectives WHERE session_id = ?")
			.get(sessionId) as { file_path?: string } | undefined;
		if (existing?.file_path) return existing.file_path;

		const counts = this.store
			.prepare(
				`SELECT
					SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
					SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
					COUNT(*) AS total
				 FROM tool_calls WHERE session_id = ?`,
			)
			.get(sessionId) as CountRow | undefined;

		const successCount = counts?.success_count ?? 0;
		const failureCount = counts?.failure_count ?? 0;
		const total = counts?.total ?? 0;

		if (failureCount === 0) return null;

		const failedTools = this.store
			.prepare(
				`SELECT tool, args_summary, error_type
				 FROM tool_calls
				 WHERE session_id = ? AND success = 0
				 ORDER BY ts ASC`,
			)
			.all(sessionId) as FailedToolRow[];

		const lessons = this.store
			.prepare(
				`SELECT id, content, origin, fingerprint, project_id
				 FROM memories
				 WHERE type = 'error' AND source_session = ?
				 ORDER BY created_at ASC`,
			)
			.all(sessionId) as LessonRow[];

		const falsePositives = this.collectFalsePositives(sessionId, lessons);

		const metricsSnapshot = this.metrics?.snapshot() ?? null;

		const md = this.buildMarkdown(
			sessionId,
			total,
			successCount,
			failureCount,
			failedTools,
			lessons,
			falsePositives,
			metricsSnapshot,
		);

		mkdirSync(this.retrospectivesDir, { recursive: true });
		const filePath = join(this.retrospectivesDir, `${sessionId}.md`);
		writeFileSync(filePath, md, "utf8");

		const id = uuidv7();
		this.store
			.prepare(
				`INSERT OR IGNORE INTO retrospectives
				 (id, session_id, ts, failure_count, success_count, lessons_count, file_path, metadata)
				 VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				sessionId,
				failureCount,
				successCount,
				lessons.length,
				filePath,
				null,
			);

		return filePath;
	}

	private collectFalsePositives(
		_sessionId: string,
		lessons: LessonRow[],
	): FalsePositiveRow[] {
		const reflectorLessons = lessons.filter(
			(l) => l.origin === "reflector" && l.fingerprint !== null,
		);
		if (reflectorLessons.length === 0) return [];

		const result: FalsePositiveRow[] = [];
		for (const lesson of reflectorLessons) {
			const fp = lesson.fingerprint as string;
			const row = this.store
				.prepare(
					`SELECT COUNT(*) AS c FROM tool_calls
				 WHERE COALESCE(error_fingerprint, fingerprint) = ?
				   AND success = 0
				   AND (project_id IS ? OR (project_id IS NULL AND ? IS NULL))`,
				)
				.get(fp, lesson.project_id, lesson.project_id) as
				| { c: number }
				| undefined;
			const recurrenceCount = row?.c ?? 0;
			if (recurrenceCount > 0) {
				result.push({
					id: lesson.id,
					content: lesson.content,
					fingerprint: fp,
					project_id: lesson.project_id,
					recurrence_count: recurrenceCount,
				});
			}
		}
		return result;
	}

	private buildMarkdown(
		sessionId: string,
		total: number,
		successCount: number,
		failureCount: number,
		failedTools: FailedToolRow[],
		lessons: LessonRow[],
		falsePositives: FalsePositiveRow[],
		metricsSnapshot: Record<string, number> | null,
	): string {
		const lines: string[] = [];
		lines.push(`# Retrospective — Session ${sessionId}`);
		lines.push("");
		lines.push("## Resumen");
		lines.push(
			`- Tool calls: ${total} (${successCount} ok, ${failureCount} failed)`,
		);
		lines.push("");
		lines.push("## Tools que fallaron");
		for (const ft of failedTools) {
			const et = ft.error_type ?? "unknown";
			const summary = ft.args_summary ?? "";
			lines.push(`- ${ft.tool} (${et}): ${summary}`);
		}
		lines.push("");
		lines.push("## Lecciones generadas");
		for (const lesson of lessons) {
			const label = originLabel(lesson.origin);
			lines.push(`- [${label}] ${lesson.content}`);
		}
		lines.push("");
		lines.push("## False-positive recap");
		if (falsePositives.length === 0) {
			lines.push(
				"- Ninguna lección reflector-sourceada recurrrió en tool_calls.",
			);
		} else {
			for (const fp of falsePositives) {
				lines.push(
					`- [reflector] ${fp.content} (fingerprint ${fp.fingerprint}, recurrencias: ${fp.recurrence_count})`,
				);
			}
		}
		lines.push("");

		if (metricsSnapshot !== null) {
			lines.push("## Métricas");
			for (const [key, value] of Object.entries(metricsSnapshot)) {
				const label = METRIC_KEY_LABELS[key] ?? key;
				lines.push(`- ${label}: ${value}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}
}

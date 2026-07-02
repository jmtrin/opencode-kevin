import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryService } from "./MemoryService.js";
import type { Store } from "./Store.js";
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
	content: string;
}

export class Retrospective {
	private retrospectivesDir: string;

	constructor(
		private store: Store,
		private memoryService: MemoryService,
		options?: RetrospectiveOptions,
	) {
		this.retrospectivesDir = options?.dir ?? ".kevin/retrospectives";
	}

	async generate(sessionId: string): Promise<string | null> {
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
				`SELECT content FROM memories
				 WHERE type = 'error' AND source_session = ?
				 ORDER BY created_at ASC`,
			)
			.all(sessionId) as LessonRow[];

		const md = this.buildMarkdown(
			sessionId,
			total,
			successCount,
			failureCount,
			failedTools,
			lessons,
		);

		mkdirSync(this.retrospectivesDir, { recursive: true });
		const filePath = join(this.retrospectivesDir, `${sessionId}.md`);
		writeFileSync(filePath, md, "utf8");

		const id = uuidv7();
		this.store
			.prepare(
				`INSERT INTO retrospectives
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

	private buildMarkdown(
		sessionId: string,
		total: number,
		successCount: number,
		failureCount: number,
		failedTools: FailedToolRow[],
		lessons: LessonRow[],
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
			lines.push(`- ${lesson.content}`);
		}
		lines.push("");
		return lines.join("\n");
	}
}

import type { MemoryService } from "./MemoryService.js";

export interface ReflectionInput {
	toolName: string;
	argsSummary: string;
	stderr: string;
	stdout: string;
	exitCode?: number;
	errorType: string;
	sessionId: string;
}

export interface ReflectorOptions {
	throttleMs?: number;
}

export interface HeuristicLessonInput {
	toolName: string;
	errorType: string;
	firstErrorLine: string;
}

const DEFAULT_THROTTLE_MS = 60_000;
const MAX_CONTENT_CHARS = 4096;
const MAX_ERROR_LINE_CHARS = 500;

const SUGGESTIONS: Record<string, string> = {
	typecheck: "Verify types and imports before running.",
	lint: "Run linter and fix warnings before committing.",
	test: "Run tests and fix failures before proceeding.",
	runtime: "Check error message and stack trace for root cause.",
	timeout: "Check for infinite loops or long-running operations.",
	unknown: "Review the error output for details.",
};

const SECRET_PATTERNS: RegExp[] = [
	/(API_KEY|SECRET|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	/\btoken\s+\S+/gi,
];

const SECRET_VALUE_PATTERN = /\s*=\s*\S+(.*)$/;

const PATH_PATTERNS: RegExp[] = [
	/[a-z]:\\[^\s"'<>|*?:]+/gi,
	/\/(?:home|users|var|tmp|opt|etc|root|usr)(?:\/[^\s"'<>|*?:]+)*/gi,
];

export class Reflector {
	private lastReflectionTs = 0;
	private throttleMs: number;

	constructor(
		private memoryService: MemoryService,
		options?: ReflectorOptions,
	) {
		this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
	}

	async invoke(input: ReflectionInput): Promise<string | null> {
		const now = Date.now();
		if (now - this.lastReflectionTs < this.throttleMs) {
			return null;
		}
		this.lastReflectionTs = now;

		const redactedStderr = this.redactSecrets(this.redactPaths(input.stderr));
		const redactedStdout = this.redactSecrets(this.redactPaths(input.stdout));

		const sourceOutput =
			redactedStderr.length > 0 ? redactedStderr : redactedStdout;
		const firstErrorLine = this.extractFirstErrorLine(sourceOutput);

		const lesson = this.generateHeuristicLesson({
			toolName: input.toolName,
			errorType: input.errorType,
			firstErrorLine,
		});

		let content = lesson;
		if (sourceOutput.length > 0) {
			content = `${lesson}\n\nContext:\n${sourceOutput}`;
		}

		let finalContent = content;
		const metadata: Record<string, unknown> = {};
		if (content.length > MAX_CONTENT_CHARS) {
			finalContent = `${content.slice(0, MAX_CONTENT_CHARS)}... [truncated]`;
			metadata.not_searchable = true;
		}

		const id = this.memoryService.save({
			type: "error",
			content: finalContent,
			scope: "project",
			sourceTool: input.toolName,
			sourceSession: input.sessionId,
			metadata,
		});

		return id;
	}

	generateHeuristicLesson(input: HeuristicLessonInput): string {
		const suggestion = SUGGESTIONS[input.errorType] ?? SUGGESTIONS.unknown;
		const line =
			input.firstErrorLine.length > MAX_ERROR_LINE_CHARS
				? `${input.firstErrorLine.slice(0, MAX_ERROR_LINE_CHARS)}...`
				: input.firstErrorLine;
		return `When ${input.toolName} fails with ${input.errorType}: ${line}\nSuggestion: ${suggestion}`;
	}

	redactPaths(text: string): string {
		let out = text;
		for (const pat of PATH_PATTERNS) {
			out = out.replace(pat, "<path>");
		}
		return out;
	}

	redactSecrets(text: string): string {
		let out = text;
		for (const pat of SECRET_PATTERNS) {
			out = out.replace(pat, (match) => {
				const eq = match.match(SECRET_VALUE_PATTERN);
				if (eq) {
					const label = match.split(/[=:]/)[0].trim();
					return `${label}=<redacted>`;
				}
				const parts = match.split(/\s+/);
				return `${parts[0]} <redacted>`;
			});
		}
		return out;
	}

	private extractFirstErrorLine(text: string): string {
		const lines = text.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.length > 0 && /error|Error|FAIL/i.test(trimmed)) {
				return trimmed;
			}
		}
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.length > 0) return trimmed;
		}
		return "";
	}
}

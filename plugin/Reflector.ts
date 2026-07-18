import type { MemoryService } from "./MemoryService.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import type { Metrics } from "./metrics.js";
import { redactPaths as redactPathsText } from "./redact.js";

export interface ReflectionInput {
	toolName: string;
	argsSummary: string;
	stderr: string;
	stdout: string;
	exitCode?: number;
	errorType: string;
	sessionId: string;
	/** Optional project scope for v0.2.0 dedup + per-fingerprint throttle. */
	projectId?: string | null;
}

export interface ReflectorOptions {
	throttleMs?: number;
}

export interface HeuristicLessonInput {
	toolName: string;
	errorType: string;
	firstErrorLine: string;
	/** v0.2.0 (K2-018) — optional pre-computed dispatch result. When absent,
	 * dispatch is performed on `firstErrorLine` alone. */
	dispatched?: DispatchedLesson | null;
}

/** Result of the per-error-code deterministic rule dispatch (K2-018 / D2-09). */
export interface DispatchedLesson {
	/** Stable short code captured from the source output (e.g. `TS2304`,
	 * `EADDRINUSE`, `F401`, the captured `Error: <Name>` class, the failing
	 * command string). `null` when no rule matches (fallback path). */
	code: string | null;
	/** Short deterministic hint, e.g. `import or typo`, `review syscall:
	 * EADDRINUSE`. `null` when `code` is null (the v0.1.x fallback path). */
	hint: string | null;
}

const DEFAULT_THROTTLE_MS = 60_000;
const MAX_CONTENT_CHARS = 4096;
const MAX_ERROR_LINE_CHARS = 500;
const TRUNC_SUFFIX = "... [truncated]";
const CONTEXT_PREFIX = "\n\nContext:\n";

export const ERROR_LINE_RE =
	/\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|referenceerror|typeerror|syntaxerror|command failed|non-zero exit)\b/i;

export const STRONG_ERROR_RE =
	/\b(cannot find|cannot resolve|TS\d{4,}|error TS\d|command failed|non-zero exit|exit code [1-9]\d*|traceback|referenceerror|typeerror|syntaxerror|fatal error|exception|failed to compile|build failed|compilation failed)\b/i;

/** v0.1.x fallback table — keyed by `errorType`. RETAINED in v0.2.0 as the
 * fallback for memos whose output does not match a deterministic code rule.
 * The v0.2.0 per-error-code rule table below layers ON TOP of this fallback:
 * when a code is matched, the hint is appended to the v0.1.x suggestion as a
 * 'Likely cause:' line; when no code is matched, output is identical to v0.1.x.
 */
const SUGGESTIONS: Record<string, string> = {
	typecheck: "Verify types and imports before running.",
	lint: "Run linter and fix warnings before committing.",
	test: "Run tests and fix failures before proceeding.",
	runtime: "Check error message and stack trace for root cause.",
	timeout: "Check for infinite loops or long-running operations.",
	unknown: "Review the error output for details.",
};

// --- v0.2.0 (K2-018) lesson v2 — per-error-code deterministic dispatch (D2-09).
// Pure TS, NO LLM hop. Order of dispatch matches the plan §B6.4 priority list:
// (1) TS\d{4,5} > (2) Python lint > (3) syscall > (4) generic `Error: <Name>` >
// (5) `Command "<cmd>" failed` > (6) v0.1.x SUGGESTIONS fallback.

const TS_CODE_RULES: Record<string, string> = {
	"2304": "import or typo",
	"2322": "type mismatch",
	"2740": "missing or wrong property",
	"2552": "undefined identifier",
	"18047": "possibly null",
};

const TS_CODE_RE = /\bTS(\d{4,5})\b/;
const PY_LINT_RE = /\b(ELIF\d{0,4})\b|\b(F\d{3,4})\b|flake8:\s+(\S+)/;
const SYSCALL_RE = /\b(EADDRINUSE|ENOENT|EACCES|EPERM)\b/;
const GENERIC_ERROR_RE = /\bError:\s+(\w+)/;
const COMMAND_FAILED_RE = /Command\s+"([^"]+)"\s+failed/;

const SECRET_PATTERNS: RegExp[] = [
	/(API_KEY|SECRET|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	/\btoken\s+\S+/gi,
];

const SECRET_VALUE_PATTERN = /\s*=\s*\S+(.*)$/;

const PATH_PATTERNS_DEPRECATED = null;

export class Reflector {
	private lastReflectionByFp = new Map<string, number>();
	private throttleMs: number;
	private metrics: Metrics | null;

	constructor(
		private memoryService: MemoryService,
		options?: ReflectorOptions,
		metrics?: Metrics | null,
	) {
		this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
		this.metrics = metrics ?? null;
	}

	async invoke(input: ReflectionInput): Promise<string | null> {
		const now = Date.now();

		const redactedStderr = this.redactSecrets(this.redactPaths(input.stderr));
		const redactedStdout = this.redactSecrets(this.redactPaths(input.stdout));

		const sourceOutput =
			redactedStderr.length > 0 ? redactedStderr : redactedStdout;
		const firstErrorLine = this.extractFirstErrorLine(sourceOutput);

		const lesson = this.generateHeuristicLesson({
			toolName: input.toolName,
			errorType: input.errorType,
			firstErrorLine,
			dispatched: this.dispatchLesson(
				redactedStderr,
				redactedStdout,
				input.errorType,
			),
		});

		const metadata: Record<string, unknown> = {};
		let finalContent: string;
		if (sourceOutput.length > 0) {
			const fullLen =
				lesson.length + CONTEXT_PREFIX.length + sourceOutput.length;
			if (fullLen <= MAX_CONTENT_CHARS) {
				finalContent = `${lesson}${CONTEXT_PREFIX}${sourceOutput}`;
			} else {
				const budget =
					MAX_CONTENT_CHARS -
					lesson.length -
					CONTEXT_PREFIX.length -
					TRUNC_SUFFIX.length;
				const truncated = sourceOutput.slice(0, Math.max(0, budget));
				finalContent = `${lesson}${CONTEXT_PREFIX}${truncated}${TRUNC_SUFFIX}`;
				metadata.truncated = true;
			}
		} else {
			finalContent = lesson;
		}

		// K2-007: per-fingerprint throttle keyed by (project_id-salted) hash of
		// the source output (or lesson when the output is empty). The same
		// fingerprint is also passed to MemoryService.save so dedup and throttle
		// agree on identity.
		const projectId = input.projectId ?? null;
		const fpContent = sourceOutput.length > 0 ? sourceOutput : lesson;
		const fp = computeFingerprint(fpContent, projectId ?? undefined);
		const last = this.lastReflectionByFp.get(fp) ?? 0;
		if (now - last < this.throttleMs) {
			this.metrics?.incr("reflections_throttled", 1);
			return null;
		}
		this.lastReflectionByFp.set(fp, now);

		const id = this.memoryService.save({
			type: "error",
			content: finalContent,
			scope: "project",
			sourceTool: input.toolName,
			sourceSession: input.sessionId,
			metadata,
			origin: "reflector",
			projectId: projectId ?? undefined,
			fingerprint: fp,
		});

		return id;
	}

	generateHeuristicLesson(input: HeuristicLessonInput): string {
		const dispatched =
			input.dispatched ??
			this.dispatchLesson(input.firstErrorLine, "", input.errorType);
		const suggestion = SUGGESTIONS[input.errorType] ?? SUGGESTIONS.unknown;
		const line =
			input.firstErrorLine.length > MAX_ERROR_LINE_CHARS
				? `${input.firstErrorLine.slice(0, MAX_ERROR_LINE_CHARS)}...`
				: input.firstErrorLine;
		let lesson = `When ${input.toolName} fails with ${input.errorType}: ${line}\nSuggestion: ${suggestion}`;
		if (dispatched.code && dispatched.hint) {
			lesson += `\nLikely cause: ${dispatched.hint} (code ${dispatched.code})`;
		}
		return lesson;
	}

	/**
	 * v0.2.0 (K2-018 / D2-09) — deterministic per-error-code rule dispatch.
	 * Pure regex sweep over `stderr + '\n' + stdout` with NO LLM hop. Returns
	 * a short stable `code` + `hint` pair when a known rule matches, or
	 * `{ code: null, hint: null }` for the v0.1.x fallback path (which keeps
	 * the v0.1.x `SUGGESTIONS[errorType]` suggestion verbatim).
	 *
	 * Exported for unit testing (K2-019).
	 */
	dispatchLesson(
		stderr: string,
		stdout: string,
		errorType: string,
	): DispatchedLesson {
		const combined = `${stderr}\n${stdout}`;

		const tsMatch = combined.match(TS_CODE_RE);
		if (tsMatch) {
			const num = tsMatch[1];
			const hint = TS_CODE_RULES[num] ?? `review TS${num}`;
			return { code: `TS${num}`, hint };
		}

		const pyMatch = combined.match(PY_LINT_RE);
		if (pyMatch) {
			const rule = pyMatch[1] || pyMatch[2] || pyMatch[3] || "unknown";
			return { code: rule, hint: `review python lint: ${rule}` };
		}

		const sysMatch = combined.match(SYSCALL_RE);
		if (sysMatch) {
			const code = sysMatch[1];
			return { code, hint: `review syscall: ${code}` };
		}

		const errMatch = combined.match(GENERIC_ERROR_RE);
		if (errMatch) {
			const name = errMatch[1];
			return { code: name, hint: `review error class: ${name}` };
		}

		const cmdMatch = combined.match(COMMAND_FAILED_RE);
		if (cmdMatch) {
			const cmd = cmdMatch[1];
			return { code: cmd, hint: `review failing command: ${cmd}` };
		}

		return { code: null, hint: null };
	}

	redactPaths(text: string): string {
		return redactPathsText(text);
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
			if (trimmed.length > 0 && ERROR_LINE_RE.test(trimmed)) {
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

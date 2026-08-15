import type { MemoryService } from "./MemoryService.js";
import { fingerprint as computeFingerprint } from "./fingerprint.js";
import { classify } from "./inferability.js";
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
	/** v0.3.0 fix — callID of the failing tool_call. Used by onLinkError
	 * (see ReflectorOptions) to stamp tool_calls.error_fingerprint so the
	 * feedback loop can match recurrences by the SAME identity dimension
	 * the error memory uses. */
	callID?: string;
}

export interface ReflectorOptions {
	throttleMs?: number;
	/** v0.3.0 (K3-018) — optional LLM enrichment callback. Default no-op. */
	enrich?: (
		lesson: string,
		stderr: string,
		stdout: string,
	) => Promise<string | null>;
	/** v0.3.0 fix — link a failing tool_call to the stderr-based fingerprint
	 * the matching error memory uses. Default no-op. The caller (index.ts)
	 * provides an implementation that UPDATEs tool_calls.error_fingerprint
	 * for the given callID, so boost/penalize feedback queries stop missing
	 * recurrences by fingerprint mismatch. */
	onLinkError?: (callID: string, fingerprint: string) => void;
}

export interface HeuristicLessonInput {
	toolName: string;
	errorType: string;
	/** v0.4.0 (K4-005) — errorType shown in the `fails with` slot after
	 * rescue: the dispatched code when one matched, else the coarse
	 * errorType. Suggestion lookup still uses `errorType` (the coarse
	 * category) so the category suggestion is kept even when a code
	 * overrides the display. */
	displayErrorType?: string;
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

/**
 * v0.1.x fallback table — keyed by `errorType`. RETAINED in v0.2.0 as the
 * fallback for memos whose output does not match a deterministic code rule.
 * The v0.2.0 per-error-code rule table below layers ON TOP of this fallback:
 * when a code is matched, the hint is appended to the v0.1.x suggestion as a
 * 'Likely cause:' line; when no code is matched, output is identical to v0.1.x.
 *
 * Exported since v0.4.0 (K4-003) so QualityGate can detect the generic
 * fallback suggestions without duplicating the strings.
 */
export const SUGGESTIONS: Record<string, string> = {
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

// v0.2.0 (K2-018) — shared per-error-code rule table. Exported so
// kevin_why.ts reuses the SAME hints instead of duplicating them
// (bug #6).
// v0.4.0 (K4-022 / plan §5.4, D4-07) — expanded with the observed §3.3
// cases: TS2307 (cannot find module), TS2339/TS2305 (missing member),
// TS6133 (unused).
export const TS_CODE_RULES: Record<string, string> = {
	"2304": "import or typo",
	"2322": "type mismatch",
	"2740": "missing or wrong property",
	"2552": "undefined identifier",
	"18047": "possibly null",
	"2307": "install the dependency or add it to package.json before importing",
	"2339": "check the imported surface for the correct member name",
	"2305": "check the imported surface for the correct member name",
	"6133": "remove the declaration or use it",
};

const TS_CODE_RE = /\bTS(\d{4,5})\b/i;
const PY_LINT_RE = /\b(ELIF\d{0,4})\b|\b(F\d{3,4})\b|flake8:\s+(\S+)/;
const SYSCALL_RE = /\b(EADDRINUSE|ENOENT|EACCES|EPERM)\b/;
// v0.4.0 (K4-022) — rust unresolved item/module (E0433/E0432).
const RUST_CODE_RE = /\b(E0433|E0432)\b/;
// v0.4.0 (K4-022) — shell command-not-found (`cmd: command not found`,
// `The term 'cmd' is not recognized ...`).
const COMMAND_NOT_FOUND_RE =
	/\b([a-zA-Z0-9_.-]+):\s+(?:command not found|The term\s+['"][^'"]+['"]\s+is not recognized)\b/i;
const GENERIC_ERROR_RE = /\bError:\s+(\w+)/;
const COMMAND_FAILED_RE = /Command\s+"([^"]+)"\s+failed/;

const SECRET_PATTERNS: RegExp[] = [
	/\b(API_KEY|SECRET|PASSWORD|TOKEN)\b\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	// BUG-013 — same narrowing as ToolCallObserver: the old
	// `\btoken\s+\S+/gi` mangled harmless phrasing ("token budget",
	// "token count") in stderr/stdout — corrupting stored summaries AND
	// the fingerprints derived from the redacted text. Credential
	// contexts only: named token variables WITH an assignment, and
	// `token=<value>` / `token: <value>` assignments.
	/\b(access_?token|auth_?token|api_?token)\b\s*[=:]\s*\S+/gi,
	/\btoken\s*[=:]\s*\S+/gi,
];

const PATH_PATTERNS_DEPRECATED = null;

export class Reflector {
	private lastReflectionByFp = new Map<string, number>();
	private throttleMs: number;
	private metrics: Metrics | null;
	private enrichFn: (
		lesson: string,
		stderr: string,
		stdout: string,
	) => Promise<string | null>;
	private onLinkErrorFn: (callID: string, fingerprint: string) => void;

	constructor(
		private memoryService: MemoryService,
		options?: ReflectorOptions,
		metrics?: Metrics | null,
	) {
		this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
		this.metrics = metrics ?? null;
		this.enrichFn = options?.enrich ?? (async () => null);
		this.onLinkErrorFn = options?.onLinkError ?? (() => {});
	}

	async invoke(input: ReflectionInput): Promise<string | null> {
		const now = Date.now();

		const redactedStderr = this.redactSecrets(this.redactPaths(input.stderr));
		const redactedStdout = this.redactSecrets(this.redactPaths(input.stdout));

		const sourceOutput =
			redactedStderr.length > 0 ? redactedStderr : redactedStdout;
		const firstErrorLine = this.extractFirstErrorLine(sourceOutput);

		// v0.4.0 (K4-005) — dispatch once and reuse for the rescued
		// errorType AND metadata.dispatch.
		const dispatched = this.dispatchLesson(
			redactedStderr,
			redactedStdout,
			input.errorType,
		);

		const lesson = this.generateHeuristicLesson({
			toolName: input.toolName,
			errorType: input.errorType,
			displayErrorType: dispatched.code ?? input.errorType,
			firstErrorLine,
			dispatched,
		});

		// v0.3.0 fix (bug #5) — the per-fingerprint throttle check runs
		// BEFORE the optional LLM enrichment, so throttled repeats never
		// waste an LLM call. The fingerprint is computed from the source
		// output when present, otherwise from the PRE-enrichment lesson,
		// keeping the identity stable and identical to the saved memory's.
		const projectId = input.projectId ?? null;
		const fpContent = sourceOutput.length > 0 ? sourceOutput : lesson;
		const fp = computeFingerprint(fpContent, projectId ?? undefined);
		// v0.3.0 fix — stamp the failing tool_call with the stderr-based
		// fingerprint so the feedback loop's recurrence queries can match
		// it (closes the fingerprint-mismatch bug). Runs BEFORE the
		// throttle check: throttled repeats (K4-025 recurrences) still
		// stamp — the throttle only skips the expensive enrichment/save,
		// but the recurrence signal (settle's COUNT, QualityGate,
		// penalizeRecurringReflectors) must see every failing call.
		if (input.callID && this.onLinkErrorFn) {
			try {
				this.onLinkErrorFn(input.callID, fp);
			} catch {
				// linking failure is non-blocking
			}
		}
		const last = this.lastReflectionByFp.get(fp) ?? 0;
		if (now - last < this.throttleMs) {
			this.metrics?.incr("reflections_throttled", 1);
			return null;
		}
		this.lastReflectionByFp.set(fp, now);
		const configurableMemoryService = this.memoryService as MemoryService & {
			getSetting?: (key: string, fallback?: string) => string;
		};
		const lessonMode =
			configurableMemoryService.getSetting?.("error_lesson_mode", "all") ??
			"all";
		const verdict = classify({
			type: "error",
			content: lesson,
			metadata: { dispatch: { code: dispatched.code, hint: dispatched.hint } },
		});
		if (lessonMode === "triage_only" && verdict === "inferable") {
			this.metrics?.incr("error_lessons_suppressed", 1);
			return null;
		}

		// v0.3.0 (K3-018): optional LLM enrichment opt-in. Runs only when
		// the throttle check passed (bug #5).
		let enrichedLesson = lesson;
		try {
			const enrichment = await this.enrichFn(
				lesson,
				redactedStderr,
				redactedStdout,
			);
			if (enrichment) {
				enrichedLesson = `${lesson}\n${enrichment}`;
			}
		} catch {
			// enrichment failures are non-blocking
		}

		const metadata: Record<string, unknown> = {};
		if (input.callID) {
			metadata.origin_call_id = input.callID;
		}
		// v0.4.0 (K4-005) — persist the dispatch result so injection and
		// promotion can reuse the rescued errorType and hint without
		// re-dispatching. Stored even when no code matched ({code:null,hint:null})
		// so callers can distinguish "checked and unmatched" from "absent".
		metadata.dispatch = { code: dispatched.code, hint: dispatched.hint };
		let finalContent: string;
		if (sourceOutput.length > 0) {
			const fullLen =
				enrichedLesson.length + CONTEXT_PREFIX.length + sourceOutput.length;
			if (fullLen <= MAX_CONTENT_CHARS) {
				finalContent = `${enrichedLesson}${CONTEXT_PREFIX}${sourceOutput}`;
			} else {
				const budget =
					MAX_CONTENT_CHARS -
					enrichedLesson.length -
					CONTEXT_PREFIX.length -
					TRUNC_SUFFIX.length;
				const truncated = sourceOutput.slice(0, Math.max(0, budget));
				finalContent = `${enrichedLesson}${CONTEXT_PREFIX}${truncated}${TRUNC_SUFFIX}`;
				metadata.truncated = true;
			}
		} else {
			finalContent = enrichedLesson;
		}

		// K2-007: the per-fingerprint throttle check ran above (before
		// enrichment); `fp` is reused here so dedup/throttle and the saved
		// memory agree on identity.
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
		const shownErrorType = input.displayErrorType ?? input.errorType;
		const line =
			input.firstErrorLine.length > MAX_ERROR_LINE_CHARS
				? `${input.firstErrorLine.slice(0, MAX_ERROR_LINE_CHARS)}...`
				: input.firstErrorLine;
		let lesson = `When ${input.toolName} fails with ${shownErrorType}: ${line}\nSuggestion: ${suggestion}`;
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

		const rustMatch = combined.match(RUST_CODE_RE);
		if (rustMatch) {
			const code = rustMatch[1];
			return {
				code,
				hint: "add the dependency to Cargo.toml or use a full path (crate::...)",
			};
		}

		const sysMatch = combined.match(SYSCALL_RE);
		if (sysMatch) {
			const code = sysMatch[1];
			const hint =
				code === "EADDRINUSE"
					? "free the port (netstat -ano | findstr :PORT) or change the port"
					: `review syscall: ${code}`;
			return { code, hint };
		}

		const cmdNotFoundMatch = combined.match(COMMAND_NOT_FOUND_RE);
		if (cmdNotFoundMatch) {
			const cmd = cmdNotFoundMatch[1];
			return {
				code: cmd,
				hint: `install the tool (e.g. npm i -g ${cmd}) or call it by its full path`,
			};
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
				// BUG-013 — preserve the original separator so
				// `auth_token = abc123` keeps its spacing: only the
				// value is replaced.
				const m = match.match(/^(.+?)(\s*[=:]\s*)(\S+)$/);
				if (m) {
					return `${m[1]}${m[2]}<redacted>`;
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

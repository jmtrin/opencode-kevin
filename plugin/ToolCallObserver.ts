import type { Store } from "./Store.js";
import { uuidv7 } from "./uuid.js";

export interface ToolExecuteInput {
	tool: string;
	args?: Record<string, unknown>;
	agent?: string;
	sessionId?: string;
}

export interface ToolExecuteOutput {
	success?: boolean;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

const SECRET_PATTERNS: RegExp[] = [
	/(API_KEY|SECRET|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	/\btoken\s+\S+/gi,
];

const SECRET_VALUE_PATTERN = /\s*=\s*\S+(.*)$/;

export class ToolCallObserver {
	private startTs = new Map<string, number>();

	constructor(private store: Store) {}

	onBefore(input: ToolExecuteInput, _output: ToolExecuteOutput): void {
		const key = this.key(input);
		this.startTs.set(key, Date.now());
	}

	onAfter(input: ToolExecuteInput, output: ToolExecuteOutput): void {
		const key = this.key(input);
		const start = this.startTs.get(key) ?? Date.now();
		this.startTs.delete(key);
		const durationMs = Math.max(0, Date.now() - start);
		const sessionId = input.sessionId ?? "unknown";
		const argsSummary = this.summarizeArgs(input.args ?? {});
		const success = output.success === true ? 1 : 0;
		const agent = input.agent ?? null;
		const errorType =
			output.success === false
				? this.inferErrorType(
						output.stderr ?? "",
						output.stdout ?? "",
						output.exitCode,
					)
				: null;
		const metadata = JSON.stringify(this.redactArgs(input.args ?? {}));

		this.store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata)
				 VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				uuidv7(),
				sessionId,
				input.tool,
				argsSummary,
				success,
				durationMs,
				agent,
				errorType,
				metadata,
			);
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

	summarizeArgs(args: Record<string, unknown>): string {
		const interestingKeys = [
			"filePath",
			"path",
			"cwd",
			"command",
			"cmd",
			"file",
			"directory",
		];
		const parts: string[] = [];
		for (const [k, v] of Object.entries(args)) {
			if (interestingKeys.includes(k)) {
				parts.push(`${k}: ${this.redactSecrets(String(v))}`);
			} else if (this.looksSecret(k)) {
				parts.push(`${k}: <redacted>`);
			} else {
				const s = this.redactSecrets(String(v));
				const truncated = s.length > 200 ? `${s.slice(0, 200)}...` : s;
				parts.push(`${k}: ${truncated}`);
			}
		}
		let summary = parts.join(", ");
		if (summary.length > 500) summary = `${summary.slice(0, 500)}...`;
		return summary;
	}

	inferErrorType(stderr: string, stdout: string, exitCode?: number): string {
		const stderrLower = stderr.toLowerCase();
		if (/error ts|tsc|\btypescript\b/.test(stderrLower)) return "typecheck";
		if (/\b(lint|biome|eslint)\b/.test(stderrLower)) return "lint";
		if (/\b(fail|vitest|jest|test failed)\b/.test(stderrLower)) return "test";
		if (/error:|typeerror|referenceerror/.test(stderrLower)) return "runtime";
		if ((exitCode === undefined || exitCode === -1) && stderr.trim() === "")
			return "timeout";
		return "unknown";
	}

	private key(input: ToolExecuteInput): string {
		const argsKey = JSON.stringify(input.args ?? {});
		return `${input.sessionId ?? "unknown"}::${input.tool}::${argsKey}`;
	}

	private looksSecret(key: string): boolean {
		const k = key.toLowerCase();
		return /(key|secret|password|token|bearer)/.test(k);
	}

	private redactArgs(args: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(args)) {
			if (this.looksSecret(k)) {
				out[k] = "<redacted>";
			} else if (typeof v === "string") {
				out[k] = this.redactSecrets(v);
			} else {
				out[k] = v;
			}
		}
		return out;
	}
}
